import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { actorFrom, audit } from "../audit.js";
import { authenticate, requireRoles } from "../auth.js";
import { runAutomationCycle } from "../services/automation.js";
import { processMessageQueue, queueDueReminders, queueManualMessage } from "../services/messaging.js";
import { testMikrotikConnection } from "../services/mikrotik.js";
import { processRouterJobs, retryRouterJob } from "../services/router-queue.js";
import { createAutomaticBackup, listAutomaticBackups } from "../services/backup.js";

const configSchema = z.object({
  autoBillingEnabled: z.boolean().optional(),
  messagingEnabled: z.boolean().optional(),
  reminderDaysBefore: z.number().int().min(0).max(30).optional(),
  overdueReminderDays: z.number().int().min(0).max(30).optional(),
  smsProvider: z.enum(["LOG_ONLY", "WEBHOOK"]).optional(),
  smsWebhookUrl: z.string().url().nullable().optional(),
  mikrotikEnabled: z.boolean().optional(),
  mikrotikBaseUrl: z.string().url().nullable().optional(),
  routerRetryEnabled: z.boolean().optional(),
  routerRetryMinutes: z.number().int().min(1).max(1440).optional(),
  autoReconnectOnPayment: z.boolean().optional(),
  defaultGraceDays: z.number().int().min(0).max(30).optional(),
  dueDateReminderEnabled: z.boolean().optional(),
  graceReminderEnabled: z.boolean().optional(),
  finalWarningEnabled: z.boolean().optional(),
  autoCutAfterGrace: z.boolean().optional(),
  trustedQualificationMonths: z.number().int().min(1).max(36).optional(),
  trustedDowngradeUnpaidMonths: z.number().int().min(1).max(12).optional(),
  automaticBackupEnabled: z.boolean().optional(),
  backupHour: z.number().int().min(0).max(23).optional(),
  backupRetentionDays: z.number().int().min(1).max(3650).optional()
});

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/settings", { preHandler: requireRoles("ADMIN") }, async () =>
    prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
  );

  app.patch("/settings", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const input = configSchema.parse(request.body);
    const row = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
    await audit("SETTINGS_UPDATED", "SystemConfig", 1, actorFrom(request), { ...input, smsWebhookUrl: input.smsWebhookUrl ? "configured" : input.smsWebhookUrl, mikrotikBaseUrl: input.mikrotikBaseUrl });
    return row;
  });

  app.post("/automation/run", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const result = await runAutomationCycle();
    await audit("AUTOMATION_RUN_MANUAL", "System", null, actorFrom(request), result);
    return result;
  });

  app.post("/messages/queue-reminders", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const result = await queueDueReminders();
    await audit("REMINDERS_QUEUED", "MessageHistory", null, actorFrom(request), result);
    return result;
  });

  app.post("/messages/process", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const result = await processMessageQueue();
    await audit("MESSAGE_QUEUE_PROCESSED", "MessageHistory", null, actorFrom(request), result);
    return result;
  });

  app.post("/clients/:id/messages", { preHandler: requireRoles("ADMIN", "COLLECTOR") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(request.body);
    try {
      const message = await queueManualMessage(id, body);
      await audit("MESSAGE_QUEUED", "MessageHistory", message.id, actorFrom(request), { clientId: id, destination: message.destination });
      return reply.code(201).send(message);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Unable to queue message" });
    }
  });

  app.get("/messages", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    return prisma.messageHistory.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { client: { select: { clientCode: true, fullName: true } } } });
  });

  app.post("/mikrotik/test", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const input = z.object({ deviceId: z.number().int().positive().optional() }).parse(request.body ?? {});
    const deviceId = input.deviceId ?? (await prisma.mikrotikDevice.findFirst({ where: { isActive: true }, orderBy: { id: "asc" }, select: { id: true } }))?.id;
    if (!deviceId) return reply.code(400).send({ message: "Add an active MikroTik device first." });
    try {
      const result = await testMikrotikConnection(deviceId);
      await audit("MIKROTIK_TEST_OK", "MikrotikDevice", deviceId, actorFrom(request), result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "MikroTik test failed";
      await audit("MIKROTIK_TEST_FAILED", "MikrotikDevice", deviceId, actorFrom(request), { message });
      return reply.code(400).send({ message });
    }
  });

  app.get("/router-jobs", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    return prisma.routerJob.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { client: { select: { clientCode: true, fullName: true } } } });
  });

  app.post("/router-jobs/process", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const result = await processRouterJobs(100);
    await audit("ROUTER_QUEUE_PROCESSED", "RouterJob", null, actorFrom(request), result);
    return result;
  });

  app.post("/router-jobs/:id/retry", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const found = await prisma.routerJob.findUnique({ where: { id } });
    if (!found) return reply.code(404).send({ message: "Router job not found" });
    const result = await retryRouterJob(id);
    await audit("ROUTER_JOB_REQUEUED", "RouterJob", id, actorFrom(request), { clientId: found.clientId, account: found.account });
    return result;
  });

  app.post("/admin/backup/run", { preHandler: requireRoles("ADMIN") }, async (request) => {
    const result = await createAutomaticBackup(true);
    await audit("AUTOMATIC_BACKUP_RUN_MANUAL", "Database", null, actorFrom(request), result);
    return result;
  });

  app.get("/admin/backups", { preHandler: requireRoles("ADMIN") }, async () => listAutomaticBackups());
};
