import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { actorFrom, audit } from "../audit.js";
import { authenticate, currentUser, requireRoles } from "../auth.js";
import { recordOfficialPayment } from "../services/payments.js";

const paymentMethod = z.enum(["CASH", "GCASH", "BANK_TRANSFER", "OTHER"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const candidateMode = z.enum(["ALL_UNPAID", "OVERDUE", "TODAY", "TODAY_TOMORROW", "NEXT_3_DAYS", "OVERDUE_NEXT_3_DAYS", "CUSTOM"]);
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const startOfDate = (value: string) => new Date(`${value}T00:00:00.000`);
const endOfDate = (value: string) => new Date(`${value}T23:59:59.999`);
function addDays(value: string, days: number) {
  const d = dateAtNoon(value);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function numericClient(client: any) {
  const bills = (client.bills ?? []).map((bill: any) => ({ ...bill, amountDue: Number(bill.amountDue), balance: Number(bill.balance) }));
  return {
    ...client,
    monthlyRate: Number(client.monthlyRate),
    creditBalance: Number(client.creditBalance),
    outstanding: bills.reduce((sum: number, bill: any) => sum + Number(bill.balance), 0),
    oldestDueDate: bills.length ? bills.slice().sort((a: any, b: any) => +new Date(a.dueDate) - +new Date(b.dueDate))[0].dueDate : null,
    openPeriods: bills.map((bill: any) => bill.periodLabel),
    bills
  };
}

function eligibleBillWhere(input: { mode: z.infer<typeof candidateMode>; anchorDate: string; dueFrom?: string; dueTo?: string; includeOverdue: boolean }): any {
  const balance = { gt: 0 } as const;
  if (input.mode === "ALL_UNPAID") return { balance };
  if (input.mode === "OVERDUE") return { balance, dueDate: { lt: startOfDate(input.anchorDate) } };
  if (input.mode === "TODAY") return { balance, dueDate: { gte: startOfDate(input.anchorDate), lte: endOfDate(input.anchorDate) } };
  if (input.mode === "TODAY_TOMORROW") return { balance, dueDate: { gte: startOfDate(input.anchorDate), lte: endOfDate(addDays(input.anchorDate, 1)) } };
  if (input.mode === "NEXT_3_DAYS") return { balance, dueDate: { gte: startOfDate(input.anchorDate), lte: endOfDate(addDays(input.anchorDate, 2)) } };
  if (input.mode === "OVERDUE_NEXT_3_DAYS") return { balance, dueDate: { lte: endOfDate(addDays(input.anchorDate, 2)) } };
  const from = input.dueFrom ?? input.anchorDate;
  const to = input.dueTo ?? from;
  return input.includeOverdue
    ? { balance, dueDate: { lte: endOfDate(to) } }
    : { balance, dueDate: { gte: startOfDate(from), lte: endOfDate(to) } };
}

export const fieldCollectionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/field-collection/candidates", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const query = z.object({
      date: dateSchema,
      mode: candidateMode.default("OVERDUE_NEXT_3_DAYS"),
      anchorDate: dateSchema.optional(),
      dueFrom: dateSchema.optional(),
      dueTo: dateSchema.optional(),
      includeOverdue: z.enum(["true", "false"]).optional().default("true"),
      includeExtended: z.enum(["true", "false"]).optional().default("true"),
      q: z.string().optional(),
      area: z.string().optional()
    }).parse(request.query);
    const anchorDate = query.anchorDate ?? query.date;
    const billFilter = eligibleBillWhere({ mode: query.mode, anchorDate, dueFrom: query.dueFrom, dueTo: query.dueTo, includeOverdue: query.includeOverdue === "true" });
    const clients = await prisma.client.findMany({
      where: {
        serviceStatus: query.includeExtended === "true" ? { not: "INACTIVE" } : { notIn: ["INACTIVE", "EXTENDED"] },
        bills: { some: billFilter },
        ...(query.area ? { area: query.area } : {}),
        ...(query.q ? { OR: [{ fullName: { contains: query.q } }, { clientCode: { contains: query.q } }, { primaryMobile: { contains: query.q } }] } : {})
      },
      include: {
        bills: { where: { balance: { gt: 0 } }, orderBy: [{ dueDate: "asc" }, { periodStart: "asc" }], include: { extensions: { orderBy: { extensionUntil: "desc" }, take: 1 } } },
        collectionAssignments: { where: { collectionDate: dateAtNoon(query.date) }, include: { collector: { select: { id: true, displayName: true, username: true } } } }
      },
      orderBy: [{ area: "asc" }, { fullName: "asc" }],
      take: 3000
    });
    return clients.map((client) => numericClient({ ...client, assignment: client.collectionAssignments[0] ?? null, collectionAssignments: undefined }));
  });

  app.get("/field-collection/area-defaults", { preHandler: requireRoles("ADMIN") }, async () => {
    const [areaRows, defaults] = await Promise.all([
      prisma.client.findMany({ where: { serviceStatus: { not: "INACTIVE" } }, distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } }),
      prisma.areaCollectorDefault.findMany({ include: { collector: { select: { id: true, username: true, displayName: true, isActive: true, role: true } } }, orderBy: { area: "asc" } })
    ]);
    const byArea = new Map(defaults.map((row) => [row.area, row]));
    return areaRows.map(({ area }) => ({ area, mapping: byArea.get(area) ?? null }));
  });

  app.put("/field-collection/area-defaults", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const input = z.object({ mappings: z.array(z.object({ area: z.string().trim().min(1).max(200), collectorId: z.number().int().positive().nullable() })).max(1000) }).parse(request.body);
    const collectorIds = [...new Set(input.mappings.map((m) => m.collectorId).filter((id): id is number => Boolean(id)))];
    if (collectorIds.length) {
      const valid = await prisma.user.findMany({ where: { id: { in: collectorIds }, role: "COLLECTOR", isActive: true }, select: { id: true } });
      if (valid.length !== collectorIds.length) return reply.code(400).send({ message: "One or more selected collectors are inactive or invalid." });
    }
    const actor = actorFrom(request);
    await prisma.$transaction(async (tx) => {
      for (const mapping of input.mappings) {
        if (mapping.collectorId) {
          await tx.areaCollectorDefault.upsert({ where: { area: mapping.area }, create: { area: mapping.area, collectorId: mapping.collectorId, updatedBy: actor }, update: { collectorId: mapping.collectorId, updatedBy: actor } });
        } else {
          await tx.areaCollectorDefault.deleteMany({ where: { area: mapping.area } });
        }
      }
    });
    await audit("AREA_COLLECTOR_DEFAULTS_UPDATED", "AreaCollectorDefault", "bulk", actor, { mappings: input.mappings });
    return { ok: true, updated: input.mappings.length };
  });

  app.post("/field-collection/assignments", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const input = z.object({ collectionDate: dateSchema, collectorId: z.number().int().positive(), clientIds: z.array(z.number().int().positive()).min(1), notes: z.string().optional() }).parse(request.body);
    const collector = await prisma.user.findFirst({ where: { id: input.collectorId, role: "COLLECTOR", isActive: true } });
    if (!collector) return reply.code(400).send({ message: "Selected collector account is not active." });
    const uniqueClientIds = [...new Set(input.clientIds)];
    const count = await prisma.client.count({ where: { id: { in: uniqueClientIds } } });
    if (count !== uniqueClientIds.length) return reply.code(400).send({ message: "One or more selected clients no longer exist." });
    const collectionDate = dateAtNoon(input.collectionDate);
    const actor = actorFrom(request);
    await prisma.$transaction(uniqueClientIds.map((clientId) => prisma.collectionAssignment.upsert({
      where: { collectionDate_clientId: { collectionDate, clientId } },
      create: { collectionDate, collectorId: collector.id, clientId, assignedBy: actor, notes: input.notes },
      update: { collectorId: collector.id, assignedBy: actor, notes: input.notes }
    })));
    await audit("COLLECTION_LIST_ASSIGNED", "CollectionDate", input.collectionDate, actor, { collectorId: collector.id, collector: collector.displayName, clientCount: uniqueClientIds.length });
    return { ok: true, assigned: uniqueClientIds.length, collector: { id: collector.id, displayName: collector.displayName } };
  });

  app.get("/field-collection/assignment-dates", async (request) => {
    const auth = currentUser(request)!;
    const query = z.object({ collectorId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(180).default(60) }).parse(request.query);
    const collectorId = auth.role === "ADMIN" ? query.collectorId : auth.id;
    const rows = await prisma.collectionAssignment.findMany({
      where: collectorId ? { collectorId } : {},
      select: { collectionDate: true },
      distinct: ["collectionDate"],
      orderBy: { collectionDate: "desc" },
      take: query.limit
    });
    return rows.map((row) => row.collectionDate.toISOString().slice(0, 10));
  });

  app.get("/field-collection/assignments", async (request) => {
    const auth = currentUser(request)!;
    const query = z.object({ date: dateSchema, collectorId: z.coerce.number().int().positive().optional() }).parse(request.query);
    const collectorId = auth.role === "ADMIN" ? query.collectorId : auth.id;
    const rows = await prisma.collectionAssignment.findMany({
      where: { collectionDate: dateAtNoon(query.date), ...(collectorId ? { collectorId } : {}) },
      include: {
        collector: { select: { id: true, username: true, displayName: true } },
        client: { include: { bills: { where: { balance: { gt: 0 } }, orderBy: [{ dueDate: "asc" }, { periodStart: "asc" }], include: { extensions: { orderBy: { extensionUntil: "desc" }, take: 1 } } } } }
      },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => ({ ...row, client: numericClient(row.client) })).sort((a, b) => `${a.collector.displayName}|${a.client.area}|${a.client.fullName}`.localeCompare(`${b.collector.displayName}|${b.client.area}|${b.client.fullName}`));
  });

  app.delete("/field-collection/assignments/:id", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const row = await prisma.collectionAssignment.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ message: "Assignment not found" });
    await prisma.collectionAssignment.delete({ where: { id } });
    await audit("COLLECTION_ASSIGNMENT_REMOVED", "CollectionAssignment", id, actorFrom(request), { clientId: row.clientId, collectorId: row.collectorId });
    return { ok: true };
  });

  app.post("/clients/:id/payment-submissions", { preHandler: requireRoles("COLLECTOR") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const auth = currentUser(request)!;
    const client = await prisma.client.findUnique({ where: { id }, include: { bills: { where: { balance: { gt: 0 } } } } });
    if (!client) return reply.code(404).send({ message: "Client not found" });

    let amount = NaN;
    let method: "CASH" | "GCASH" | "BANK_TRANSFER" | "OTHER" = "CASH";
    let referenceNo: string | undefined;
    let notes: string | undefined;
    let proofBase64: string | undefined;
    let proofMime: string | undefined;
    let proofFileName: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "proof") { await part.toBuffer(); continue; }
        if (!part.mimetype.startsWith("image/") && part.mimetype !== "application/pdf") return reply.code(400).send({ message: "Proof must be an image or PDF." });
        const buffer = await part.toBuffer();
        if (buffer.length > 5 * 1024 * 1024) return reply.code(400).send({ message: "Proof of payment must be 5 MB or smaller." });
        proofBase64 = buffer.toString("base64");
        proofMime = part.mimetype;
        proofFileName = part.filename;
      } else {
        const value = String(part.value ?? "");
        if (part.fieldname === "amount") amount = Number(value);
        if (part.fieldname === "method" && paymentMethod.safeParse(value).success) method = value as typeof method;
        if (part.fieldname === "referenceNo") referenceNo = value.trim() || undefined;
        if (part.fieldname === "notes") notes = value.trim() || undefined;
      }
    }
    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ message: "Enter a valid payment amount." });
    if ((method === "GCASH" || method === "BANK_TRANSFER") && !proofBase64) return reply.code(400).send({ message: "Proof of payment is required for GCash or bank transfer." });

    const pendingDuplicate = await prisma.paymentSubmission.findFirst({ where: { clientId: id, submittedByUserId: auth.id, status: { in: ["PENDING", "APPROVING"] } } });
    if (pendingDuplicate) return reply.code(409).send({ message: "You already have a pending payment submission for this client. Ask admin to review it first." });

    const submission = await prisma.paymentSubmission.create({ data: {
      clientId: id, submittedByUserId: auth.id, amount, method, referenceNo, notes, proofBase64, proofMime, proofFileName
    } });
    await audit("PAYMENT_SUBMITTED_FOR_APPROVAL", "PaymentSubmission", submission.id, actorFrom(request), { clientId: id, amount, method, referenceNo, hasProof: Boolean(proofBase64), currentOutstanding: client.bills.reduce((sum, bill) => sum + Number(bill.balance), 0) });
    return reply.code(201).send({ ...submission, proofBase64: undefined, hasProof: Boolean(submission.proofBase64) });
  });

  app.get("/payment-submissions", async (request) => {
    const auth = currentUser(request)!;
    const query = z.object({ status: z.enum(["PENDING", "APPROVING", "APPROVED", "REJECTED", "NEEDS_INFO"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    const rows = await prisma.paymentSubmission.findMany({
      where: { ...(auth.role === "ADMIN" ? {} : { submittedByUserId: auth.id }), ...(query.status ? { status: query.status } : {}) },
      take: query.limit,
      orderBy: { submittedAt: "desc" },
      include: {
        client: { select: { id: true, clientCode: true, fullName: true, area: true, primaryMobile: true, serviceStatus: true, bills: { where: { balance: { gt: 0 } }, select: { balance: true } } } },
        submittedBy: { select: { id: true, displayName: true, username: true } },
        reviewedBy: { select: { id: true, displayName: true, username: true } }
      }
    });
    return rows.map((row) => ({ ...row, amount: Number(row.amount), approvedAmount: row.approvedAmount == null ? null : Number(row.approvedAmount), proofBase64: undefined, hasProof: Boolean(row.proofBase64), currentOutstanding: row.client.bills.reduce((sum, bill) => sum + Number(bill.balance), 0), client: { ...row.client, bills: undefined } }));
  });

  app.get("/payment-submissions/:id/proof", async (request, reply) => {
    const auth = currentUser(request)!;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const row = await prisma.paymentSubmission.findUnique({ where: { id } });
    if (!row || !row.proofBase64) return reply.code(404).send({ message: "Proof not found" });
    if (auth.role !== "ADMIN" && row.submittedByUserId !== auth.id) return reply.code(403).send({ message: "You do not have access to this proof." });
    const buffer = Buffer.from(row.proofBase64, "base64");
    reply.header("Content-Type", row.proofMime ?? "application/octet-stream");
    reply.header("Content-Disposition", `inline; filename="${(row.proofFileName ?? `proof-${id}`).replaceAll('"', '')}"`);
    return reply.send(buffer);
  });

  app.post("/payment-submissions/:id/review", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const auth = currentUser(request)!;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ decision: z.enum(["APPROVE", "REJECT", "NEEDS_INFO"]), approvedAmount: z.number().positive().optional(), reviewNotes: z.string().trim().max(2000).optional() }).parse(request.body);
    const submission = await prisma.paymentSubmission.findUnique({ where: { id }, include: { submittedBy: true } });
    if (!submission) return reply.code(404).send({ message: "Payment submission not found" });
    if (!(["PENDING", "NEEDS_INFO"] as string[]).includes(submission.status)) return reply.code(409).send({ message: `Submission is already ${submission.status.toLowerCase().replaceAll("_", " ")}.` });
    if (submission.submittedByUserId === auth.id) return reply.code(403).send({ message: "A user cannot approve their own payment submission." });

    if (input.decision !== "APPROVE") {
      const status = input.decision === "REJECT" ? "REJECTED" : "NEEDS_INFO";
      const updated = await prisma.paymentSubmission.update({ where: { id }, data: { status, reviewNotes: input.reviewNotes, reviewedByUserId: auth.id, reviewedAt: new Date() } });
      await audit(`PAYMENT_SUBMISSION_${status}`, "PaymentSubmission", id, actorFrom(request), { reviewNotes: input.reviewNotes });
      return { ...updated, proofBase64: undefined, hasProof: Boolean(updated.proofBase64) };
    }

    const claimed = await prisma.paymentSubmission.updateMany({ where: { id, status: { in: ["PENDING", "NEEDS_INFO"] } }, data: { status: "APPROVING", reviewedByUserId: auth.id, reviewedAt: new Date(), reviewNotes: input.reviewNotes } });
    if (!claimed.count) return reply.code(409).send({ message: "Another admin is already reviewing this submission." });
    const finalAmount = input.approvedAmount ?? Number(submission.amount);
    try {
      const paymentResult = await recordOfficialPayment({ clientId: submission.clientId, amount: finalAmount, method: submission.method, referenceNo: submission.referenceNo, notes: submission.notes, actor: actorFrom(request), receivedBy: submission.submittedBy.displayName, approvedBy: actorFrom(request), sourceSubmissionId: id });
      const updated = await prisma.paymentSubmission.update({ where: { id }, data: { status: "APPROVED", approvedAmount: finalAmount, reviewedByUserId: auth.id, reviewedAt: new Date(), reviewNotes: input.reviewNotes } });
      await audit("PAYMENT_SUBMISSION_APPROVED", "PaymentSubmission", id, actorFrom(request), { clientId: submission.clientId, submittedAmount: Number(submission.amount), approvedAmount: finalAmount, paymentId: paymentResult.payment.id, collector: submission.submittedBy.displayName });
      return { ...updated, proofBase64: undefined, hasProof: Boolean(updated.proofBase64), payment: paymentResult.payment, creditAdded: paymentResult.creditAdded, autoReconnect: paymentResult.autoReconnect };
    } catch (error) {
      await prisma.paymentSubmission.update({ where: { id }, data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null } }).catch(() => undefined);
      throw error;
    }
  });

  app.post("/payment-submissions/:id/resubmit", { preHandler: requireRoles("COLLECTOR") }, async (request, reply) => {
    const auth = currentUser(request)!;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const row = await prisma.paymentSubmission.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ message: "Payment submission not found" });
    if (row.submittedByUserId !== auth.id) return reply.code(403).send({ message: "You can only resubmit your own payment." });
    if (row.status !== "NEEDS_INFO") return reply.code(409).send({ message: "Only submissions marked Needs Info can be resubmitted." });
    await prisma.paymentSubmission.update({ where: { id }, data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null, reviewNotes: null } });
    await audit("PAYMENT_SUBMISSION_RESUBMITTED", "PaymentSubmission", id, actorFrom(request));
    return { ok: true };
  });
};
