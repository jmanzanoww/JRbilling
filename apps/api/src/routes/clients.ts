import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { actorFrom, audit } from "../audit.js";
import { normalizeAreaName } from "../utils.js";
import { authenticate, requireRoles } from "../auth.js";

const clientInput = z.object({
  fullName: z.string().min(2),
  primaryMobile: z.string().trim().optional().nullable(),
  alternateMobile: z.string().trim().optional().nullable(),
  area: z.string().min(1),
  address: z.string().optional().nullable(),
  dueDay: z.number().int().min(1).max(31),
  monthlyRate: z.number().positive(),
  allowNotifications: z.boolean().default(true),
  installedAt: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const clientRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/clients", async (request) => {
    const query = z.object({
      q: z.string().optional(), area: z.string().optional(),
      serviceStatus: z.enum(["ACTIVE", "EXTENDED", "FOR_CUT", "CUT", "RECONNECTED", "INACTIVE"]).optional()
    }).parse(request.query);
    const clients = await prisma.client.findMany({
      where: { AND: [
        query.q ? { OR: [{ fullName: { contains: query.q } }, { clientCode: { contains: query.q } }, { primaryMobile: { contains: query.q } }, { mikrotikAccount: { contains: query.q } }] } : {},
        query.area ? { area: query.area } : {}, query.serviceStatus ? { serviceStatus: query.serviceStatus } : {}
      ] },
      include: { bills: { where: { balance: { gt: 0 } }, select: { balance: true } }, mikrotikDevice: { select: { id: true, name: true, enforcementPolicy: true, isTrustedTier: true } } },
      orderBy: [{ area: "asc" }, { fullName: "asc" }], take: 2000
    });
    return clients.map((client) => ({ ...client, monthlyRate: Number(client.monthlyRate), creditBalance: Number(client.creditBalance), outstanding: client.bills.reduce((sum, bill) => sum + Number(bill.balance), 0), openBills: client.bills.length }));
  });

  app.post("/clients", { preHandler: requireRoles("ADMIN", "COLLECTOR") }, async (request, reply) => {
    const parsed = clientInput.parse(request.body);
    const input = { ...parsed, area: normalizeAreaName(parsed.area) };
    const max = await prisma.client.aggregate({ _max: { id: true } });
    const clientCode = `ISP-${String((max._max.id ?? 0) + 1).padStart(5, "0")}`;
    const areaDefault = await prisma.areaRouterDefault.findUnique({ where: { area: input.area } });
    const client = await prisma.client.create({ data: { ...input, clientCode, monthlyRate: input.monthlyRate, mikrotikDeviceId: areaDefault?.mikrotikDeviceId ?? null, networkStatus: "FOR_ACTIVATION" } });
    await audit("CLIENT_CREATED", "Client", client.id, actorFrom(request), { clientCode, fullName: input.fullName, area: input.area });
    return reply.code(201).send({ ...client, monthlyRate: Number(client.monthlyRate), creditBalance: Number(client.creditBalance) });
  });

  app.patch("/clients/:id", { preHandler: requireRoles("ADMIN", "COLLECTOR") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const parsed = clientInput.partial().parse(request.body);
    const input = { ...parsed, ...(parsed.area ? { area: normalizeAreaName(parsed.area) } : {}) };
    const existing = await prisma.client.findUnique({ where: { id }, include: { mikrotikDevice: true } });
    if (!existing) return reply.code(404).send({ message: "Client not found" });
    let networkStatus = undefined as "MIGRATION_REQUIRED" | undefined;
    let suggestedDeviceId = undefined as number | null | undefined;
    if (input.area && input.area !== existing.area) {
      const areaDefault = await prisma.areaRouterDefault.findUnique({ where: { area: input.area } });
      if (existing.networkStatus === "ACTIVE" || existing.networkStatus === "SUSPENDED") {
        // A trusted/no-cut subscriber intentionally stays on the trusted router regardless of area default.
        // Area defaults represent the subscriber's normal/standard router, not a forced destination for trusted clients.
        if (!existing.mikrotikDevice?.isTrustedTier && areaDefault?.mikrotikDeviceId && areaDefault.mikrotikDeviceId !== existing.mikrotikDeviceId) networkStatus = "MIGRATION_REQUIRED";
      } else if (existing.networkStatus === "FOR_LINKING" || existing.networkStatus === "FOR_ACTIVATION" || (existing.networkStatus === "FAILED" && !existing.networkActivatedAt)) {
        suggestedDeviceId = areaDefault?.mikrotikDeviceId ?? null;
      }
    }
    const updated = await prisma.client.update({ where: { id }, data: { ...input, ...(networkStatus ? { networkStatus } : {}), ...(suggestedDeviceId !== undefined ? { mikrotikDeviceId: suggestedDeviceId } : {}) } });
    await audit("CLIENT_UPDATED", "Client", id, actorFrom(request), input);
    return { ...updated, monthlyRate: Number(updated.monthlyRate), creditBalance: Number(updated.creditBalance) };
  });

  app.get("/clients/:id/ledger", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const client = await prisma.client.findUnique({ where: { id }, include: {
      bills: { include: { allocations: { include: { payment: true } }, extensions: { orderBy: { createdAt: "desc" } } }, orderBy: { periodStart: "desc" } },
      payments: { include: { allocations: { include: { bill: true } } }, orderBy: { paidAt: "desc" } },
      dueDateChanges: { orderBy: { changedAt: "desc" } }, serviceActions: { orderBy: { effectiveAt: "desc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 50 }, creditTransactions: { orderBy: { createdAt: "desc" }, take: 100 }, billExtensions: { orderBy: { createdAt: "desc" }, take: 100 }, mikrotikDevice: true, networkMigrations: { include: { fromDevice: true, toDevice: true }, orderBy: { createdAt: "desc" }, take: 50 }
    } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    return client;
  });

  app.get("/clients/:id/soa", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const client = await prisma.client.findUnique({ where: { id }, include: { bills: { orderBy: { periodStart: "asc" }, include: { extensions: { orderBy: { createdAt: "desc" } } } }, payments: { orderBy: { paidAt: "desc" }, take: 20 }, mikrotikDevice: true } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    const openBills = client.bills.filter((bill) => Number(bill.balance) > 0);
    const outstanding = openBills.reduce((sum, bill) => sum + Number(bill.balance), 0);
    return { generatedAt: new Date(), client: { id: client.id, clientCode: client.clientCode, fullName: client.fullName, primaryMobile: client.primaryMobile, area: client.area, address: client.address, dueDay: client.dueDay, monthlyRate: Number(client.monthlyRate), creditBalance: Number(client.creditBalance), serviceStatus: client.serviceStatus, networkStatus: client.networkStatus, mikrotikDevice: client.mikrotikDevice }, openBills, recentPayments: client.payments, outstanding, netDue: Math.max(0, outstanding - Number(client.creditBalance)) };
  });
};
