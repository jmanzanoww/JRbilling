import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { actorFrom, audit } from "../audit.js";
import { authenticate, requireRoles } from "../auth.js";
import { generateBillsForPeriod } from "../services/billing.js";
import { enqueueRouterJob, processRouterJobs } from "../services/router-queue.js";
import { recordOfficialPayment } from "../services/payments.js";

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/dashboard", async (request) => {
    const query = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query);
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const [year, month] = (query.month ?? defaultMonth).split("-").map(Number) as [number, number];
    const start = new Date(year, month - 1, 1, 12, 0, 0);
    const end = new Date(year, month, 1, 12, 0, 0);
    const [clients, bills, payments, allOpenBills] = await Promise.all([
      prisma.client.findMany({ select: { id: true, serviceStatus: true, creditBalance: true } }),
      prisma.bill.findMany({ where: { periodStart: start } }),
      prisma.payment.findMany({ where: { paidAt: { gte: start, lt: end } } }),
      prisma.bill.findMany({ where: { balance: { gt: 0 } }, select: { balance: true } })
    ]);
    const billed = bills.reduce((sum, x) => sum + Number(x.amountDue), 0);
    const outstanding = allOpenBills.reduce((sum, x) => sum + Number(x.balance), 0);
    const collected = payments.reduce((sum, x) => sum + Number(x.amount), 0);
    const availableCredit = clients.reduce((sum, x) => sum + Number(x.creditBalance), 0);
    return { period: `${year}-${String(month).padStart(2, "0")}`, clients: clients.length, billed, collected, outstanding, availableCredit, netReceivable: Math.max(0, outstanding - availableCredit), paid: bills.filter((x) => x.status === "PAID").length, unpaid: bills.filter((x) => x.status === "UNPAID" || x.status === "OVERDUE").length, partial: bills.filter((x) => x.status === "PARTIAL").length, extended: clients.filter((x) => x.serviceStatus === "EXTENDED").length, cut: clients.filter((x) => x.serviceStatus === "CUT").length, forCut: clients.filter((x) => x.serviceStatus === "FOR_CUT").length };
  });

  app.post("/billing/generate", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const input = z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) }).parse(request.body);
    const result = await generateBillsForPeriod(input.year, input.month);
    await audit("BILLING_GENERATED", "BillingPeriod", `${input.year}-${String(input.month).padStart(2,"0")}`, actorFrom(request), result);
    return result;
  });

  app.post("/clients/:id/payments", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ amount: z.number().positive(), method: z.enum(["CASH", "GCASH", "BANK_TRANSFER", "OTHER"]).default("CASH"), referenceNo: z.string().optional(), notes: z.string().optional() }).parse(request.body);
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    const actor = actorFrom(request);
    const result = await recordOfficialPayment({ clientId: id, amount: input.amount, method: input.method, referenceNo: input.referenceNo, notes: input.notes, actor, receivedBy: actor, approvedBy: actor });
    await audit("PAYMENT_RECORDED", "Payment", result.payment.id, actor, { clientId: id, amount: input.amount, creditAdded: result.creditAdded, autoReconnect: result.autoReconnect, source: "ADMIN_DIRECT" });
    return result;
  });

  app.post("/clients/:id/credit-adjust", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ amount: z.number().refine((x) => x !== 0), notes: z.string().min(2) }).parse(request.body);
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    const next = Number(client.creditBalance) + input.amount;
    if (next < 0) return reply.code(400).send({ message: "Adjustment would make client credit negative" });
    await prisma.$transaction([prisma.client.update({ where: { id }, data: { creditBalance: next } }), prisma.creditTransaction.create({ data: { clientId: id, type: "MANUAL_ADJUSTMENT", amount: input.amount, balanceAfter: next, notes: input.notes } })]);
    await audit("CREDIT_ADJUSTED", "Client", id, actorFrom(request), input);
    return { creditBalance: next };
  });

  app.post("/clients/:id/extend", { preHandler: requireRoles("ADMIN", "COLLECTOR") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({
      billId: z.number().int().positive(),
      extensionUntil: z.coerce.date().optional(),
      newDueDate: z.coerce.date().optional(),
      reason: z.string().min(2),
      notes: z.string().optional()
    }).refine((v) => Boolean(v.extensionUntil || v.newDueDate), { message: "Extension date is required" }).parse(request.body);
    const extensionUntil = input.extensionUntil ?? input.newDueDate!;
    const bill = await prisma.bill.findFirst({ where: { id: input.billId, clientId: id } });
    if (!bill) return reply.code(404).send({ message: "Bill not found" });
    if (Number(bill.balance) <= 0) return reply.code(400).send({ message: "Paid bills do not need an extension." });
    if (extensionUntil <= bill.dueDate) return reply.code(400).send({ message: "Extension must be after the original billing due date." });
    const client = await prisma.client.findUnique({ where: { id }, include: { bills: { where: { balance: { gt: 0 } } }, mikrotikDevice: true } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    const outstanding = client.bills.reduce((sum, item) => sum + Number(item.balance), 0), actor = actorFrom(request);
    const extension = await prisma.$transaction(async (tx) => {
      const row = await tx.billExtension.create({ data: { clientId: id, billId: bill.id, extensionUntil, reason: input.reason, notes: input.notes, approvedBy: actor } });
      await tx.serviceAction.create({ data: { clientId: id, type: "EXTEND", previousStatus: client.serviceStatus, nextStatus: "EXTENDED", outstandingAtAction: outstanding, reason: input.reason, notes: input.notes, performedBy: actor } });
      await tx.client.update({ where: { id }, data: { serviceStatus: "EXTENDED" } });
      return row;
    });
    await audit("PAYMENT_DEADLINE_EXTENDED", "BillExtension", extension.id, actor, { clientId: id, billId: bill.id, billingDueDate: bill.dueDate, extensionUntil, recurringDueDayUnchanged: client.dueDay });
    return { ok: true, extension, billingDueDate: bill.dueDate, recurringDueDay: client.dueDay };
  });

  app.post("/clients/:id/service-action", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ type: z.enum(["MARK_FOR_CUT", "CUT", "RECONNECT", "ACTIVATE", "DEACTIVATE"]), reason: z.string().optional(), notes: z.string().optional(), newDueDay: z.number().int().min(1).max(31).optional(), syncRouter: z.boolean().default(true) }).parse(request.body);
    const client = await prisma.client.findUnique({ where: { id }, include: { bills: { where: { balance: { gt: 0 } } }, mikrotikDevice: true } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    if (input.type === "CUT" && client.mikrotikDevice?.enforcementPolicy === "NO_AUTO_CUT") {
      return reply.code(409).send({ message: "This subscriber is on a No Auto Cut / trusted MikroTik. Move the subscriber to a With Cut router before suspension." });
    }
    const nextStatus = ({ MARK_FOR_CUT: "FOR_CUT", CUT: "CUT", RECONNECT: "RECONNECTED", ACTIVATE: "ACTIVE", DEACTIVATE: "INACTIVE" } as const)[input.type];
    const outstanding = client.bills.reduce((sum, b) => sum + Number(b.balance), 0), actor = actorFrom(request);
    const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const action = await prisma.$transaction(async (tx) => {
      const row = await tx.serviceAction.create({ data: {
        clientId: id, type: input.type, previousStatus: client.serviceStatus, nextStatus, outstandingAtAction: outstanding,
        reason: input.reason, notes: input.notes, performedBy: actor
      } });
      await tx.client.update({ where: { id }, data: { serviceStatus: nextStatus, ...(input.type === "RECONNECT" && input.newDueDay ? { dueDay: input.newDueDay } : {}), ...((input.type === "CUT") ? { networkStatus: "SUSPENDED" as const } : (input.type === "RECONNECT" || input.type === "ACTIVATE") && client.networkStatus !== "FOR_ACTIVATION" && client.networkStatus !== "FOR_LINKING" ? { networkStatus: "ACTIVE" as const } : {}) } });
      return row;
    });

    let routerJob: { id: number; status: string; attempts: number; lastError: string | null } | null = null;
    if (input.syncRouter && config.mikrotikEnabled && client.mikrotikAccount && (input.type === "CUT" || input.type === "RECONNECT" || input.type === "ACTIVATE")) {
      const queued = await enqueueRouterJob({ clientId: id, serviceActionId: action.id, mikrotikDeviceId: client.mikrotikDeviceId, account: client.mikrotikAccount, enabled: input.type !== "CUT" });
      await processRouterJobs(20);
      const refreshed = await prisma.routerJob.findUnique({ where: { id: queued.id } });
      if (refreshed) routerJob = { id: refreshed.id, status: refreshed.status, attempts: refreshed.attempts, lastError: refreshed.lastError };
    }
    await audit("SERVICE_ACTION", "Client", id, actor, { type: input.type, previousStatus: client.serviceStatus, nextStatus, outstanding, routerJob });
    return { ok: true, serviceStatus: nextStatus, routerJob, actionId: action.id };
  });

  app.get("/payments/:id/receipt", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const payment = await prisma.payment.findUnique({ where: { id }, include: { client: { select: { clientCode: true, fullName: true, primaryMobile: true, area: true, address: true, creditBalance: true } }, allocations: { include: { bill: { select: { periodLabel: true, amountDue: true, balance: true } } } }, creditTransactions: { where: { type: "ADVANCE_PAYMENT" } } } });
    if (!payment) return reply.code(404).send({ message: "Payment not found" });
    return payment;
  });

  app.get("/collections", async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return prisma.payment.findMany({ take: limit, orderBy: { paidAt: "desc" }, include: { client: { select: { id: true, clientCode: true, fullName: true, area: true } } } });
  });
};
