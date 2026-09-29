import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { actorFrom, audit } from "../audit.js";
import { authenticate, hashPin, requireRoles } from "../auth.js";
import { exportBackupPayload } from "../services/backup.js";

const userSchema = z.object({
  username: z.string().trim().min(2).max(50).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(2).max(100),
  role: z.enum(["ADMIN", "COLLECTOR", "VIEWER"]).default("COLLECTOR"),
  isActive: z.boolean().default(true),
  pin: z.string().regex(/^\d{4,8}$/).optional()
});

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/users", { preHandler: requireRoles("ADMIN") }, async () =>
    prisma.user.findMany({ select: { id: true, username: true, displayName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true }, orderBy: [{ isActive: "desc" }, { displayName: "asc" }] })
  );

  app.post("/users", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const input = userSchema.extend({ pin: z.string().regex(/^\d{4,8}$/) }).parse(request.body);
    const user = await prisma.user.create({ data: { username: input.username, displayName: input.displayName, role: input.role, isActive: input.isActive, pinHash: hashPin(input.pin) } });
    await audit("USER_CREATED", "User", user.id, actorFrom(request), { username: input.username, displayName: input.displayName, role: input.role });
    return reply.code(201).send({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive, createdAt: user.createdAt });
  });

  app.patch("/users/:id", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = userSchema.partial().parse(request.body);
    const found = await prisma.user.findUnique({ where: { id } });
    if (!found) return reply.code(404).send({ message: "User not found" });
    const data: Record<string, unknown> = { ...input };
    if (input.pin) data.pinHash = hashPin(input.pin);
    delete data.pin;
    const user = await prisma.user.update({ where: { id }, data: data as any });
    if (input.pin || input.isActive === false) await prisma.authSession.deleteMany({ where: { userId: id } });
    await audit("USER_UPDATED", "User", id, actorFrom(request), { username: input.username, displayName: input.displayName, role: input.role, isActive: input.isActive, pinReset: Boolean(input.pin) });
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt };
  });

  app.get("/audit", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    return prisma.auditLog.findMany({ take: limit, orderBy: { createdAt: "desc" } });
  });

  app.get("/admin/backup", { preHandler: requireRoles("ADMIN") }, async () => exportBackupPayload());

  app.post("/admin/restore", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const body = z.object({
      confirm: z.literal("RESTORE"),
      backup: z.object({ format: z.literal("isp-billing-json-backup"), version: z.string().optional(), data: z.object({
        clients: z.array(z.any()), bills: z.array(z.any()), payments: z.array(z.any()), allocations: z.array(z.any()),
        credits: z.array(z.any()), dueDateChanges: z.array(z.any()), serviceActions: z.array(z.any()), messages: z.array(z.any()),
        users: z.array(z.any()), auditLogs: z.array(z.any()), systemConfig: z.any().optional(), routerJobs: z.array(z.any()).optional().default([]),
        paymentSubmissions: z.array(z.any()).optional().default([]), collectionAssignments: z.array(z.any()).optional().default([]), areaCollectorDefaults: z.array(z.any()).optional().default([]),
        mikrotikDevices: z.array(z.any()).optional().default([]), areaRouterDefaults: z.array(z.any()).optional().default([]), billExtensions: z.array(z.any()).optional().default([]), networkMigrations: z.array(z.any()).optional().default([])
      }) })
    }).parse(request.body);
    const d = body.backup.data;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.authSession.deleteMany(); await tx.paymentSubmission.deleteMany(); await tx.collectionAssignment.deleteMany(); await tx.areaCollectorDefault.deleteMany(); await tx.areaRouterDefault.deleteMany(); await tx.networkMigration.deleteMany(); await tx.routerJob.deleteMany(); await tx.billExtension.deleteMany(); await tx.paymentAllocation.deleteMany(); await tx.creditTransaction.deleteMany();
        await tx.dueDateChange.deleteMany(); await tx.serviceAction.deleteMany(); await tx.messageHistory.deleteMany();
        await tx.payment.deleteMany(); await tx.bill.deleteMany(); await tx.client.deleteMany(); await tx.mikrotikDevice.deleteMany(); await tx.user.deleteMany();
        await tx.auditLog.deleteMany(); await tx.systemConfig.deleteMany();
        const asDate = (value: unknown) => value == null ? null : new Date(String(value));
        const mikrotikDevices = (d.mikrotikDevices ?? []).map((x: any) => ({ ...x, createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        const areaRouterDefaults = (d.areaRouterDefaults ?? []).map((x: any) => ({ ...x, createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        const clients = d.clients.map((x: any) => ({ ...x, networkActivatedAt: asDate(x.networkActivatedAt), installedAt: asDate(x.installedAt), createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        const bills = d.bills.map((x: any) => ({ ...x, periodStart: asDate(x.periodStart), originalDueDate: asDate(x.originalDueDate), dueDate: asDate(x.dueDate), createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        const billExtensions = (d.billExtensions ?? []).map((x: any) => ({ ...x, extensionUntil: asDate(x.extensionUntil), createdAt: asDate(x.createdAt) }));
        const networkMigrations = (d.networkMigrations ?? []).map((x: any) => ({ ...x, startedAt: asDate(x.startedAt), completedAt: asDate(x.completedAt), createdAt: asDate(x.createdAt) }));
        const payments = d.payments.map((x: any) => ({ ...x, paidAt: asDate(x.paidAt), createdAt: asDate(x.createdAt) }));
        const credits = d.credits.map((x: any) => ({ ...x, createdAt: asDate(x.createdAt) }));
        const dueChanges = d.dueDateChanges.map((x: any) => ({ ...x, oldDueDate: asDate(x.oldDueDate), newDueDate: asDate(x.newDueDate), changedAt: asDate(x.changedAt) }));
        const actions = d.serviceActions.map((x: any) => ({ ...x, effectiveAt: asDate(x.effectiveAt) }));
        const messages = d.messages.map((x: any) => ({ ...x, sentAt: asDate(x.sentAt), createdAt: asDate(x.createdAt) }));
        const users = d.users.map((x: any) => ({ ...x, lastLoginAt: asDate(x.lastLoginAt), createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        const logs = d.auditLogs.map((x: any) => ({ ...x, createdAt: asDate(x.createdAt) }));
        const routerJobs = (d.routerJobs ?? []).map((x: any) => ({ ...x, nextAttemptAt: asDate(x.nextAttemptAt), lastAttemptAt: asDate(x.lastAttemptAt), createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        const paymentSubmissions = (d.paymentSubmissions ?? []).map((x: any) => ({ ...x, submittedAt: asDate(x.submittedAt), reviewedAt: asDate(x.reviewedAt) }));
        const collectionAssignments = (d.collectionAssignments ?? []).map((x: any) => ({ ...x, collectionDate: asDate(x.collectionDate), createdAt: asDate(x.createdAt) }));
        const areaCollectorDefaults = (d.areaCollectorDefaults ?? []).map((x: any) => ({ ...x, createdAt: asDate(x.createdAt), updatedAt: asDate(x.updatedAt) }));
        if (mikrotikDevices.length) await tx.mikrotikDevice.createMany({ data: mikrotikDevices }); if (areaRouterDefaults.length) await tx.areaRouterDefault.createMany({ data: areaRouterDefaults });
        if (clients.length) await tx.client.createMany({ data: clients }); if (bills.length) await tx.bill.createMany({ data: bills }); if (billExtensions.length) await tx.billExtension.createMany({ data: billExtensions });
        if (payments.length) await tx.payment.createMany({ data: payments }); if (d.allocations.length) await tx.paymentAllocation.createMany({ data: d.allocations });
        if (credits.length) await tx.creditTransaction.createMany({ data: credits }); if (dueChanges.length) await tx.dueDateChange.createMany({ data: dueChanges });
        if (actions.length) await tx.serviceAction.createMany({ data: actions }); if (messages.length) await tx.messageHistory.createMany({ data: messages });
        if (users.length) await tx.user.createMany({ data: users }); if (areaCollectorDefaults.length) await tx.areaCollectorDefault.createMany({ data: areaCollectorDefaults }); if (logs.length) await tx.auditLog.createMany({ data: logs });
        if (routerJobs.length) await tx.routerJob.createMany({ data: routerJobs });
        if (networkMigrations.length) await tx.networkMigration.createMany({ data: networkMigrations });
        if (collectionAssignments.length) await tx.collectionAssignment.createMany({ data: collectionAssignments });
        if (paymentSubmissions.length) await tx.paymentSubmission.createMany({ data: paymentSubmissions });
        if (d.systemConfig) await tx.systemConfig.create({ data: { ...d.systemConfig, updatedAt: asDate(d.systemConfig.updatedAt) } });
        else await tx.systemConfig.create({ data: { id: 1 } });
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(400).send({ message: "Restore failed. Database was rolled back.", detail: error instanceof Error ? error.message : "Unknown restore error" });
    }
    await audit("DATABASE_RESTORED", "Database", null, actorFrom(request), { sourceVersion: body.backup.version ?? "unknown" });
    return { ok: true, reloginRequired: true };
  });
};
