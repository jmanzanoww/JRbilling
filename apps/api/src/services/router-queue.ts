import { prisma } from "../prisma.js";
import { setPppoeEnabled } from "./mikrotik.js";

export async function enqueueRouterJob(input: {
  clientId: number;
  serviceActionId?: number | null;
  mikrotikDeviceId?: number | null;
  account: string;
  enabled: boolean;
  maxAttempts?: number;
}) {
  const action = input.enabled ? "ENABLE_PPPOE" : "DISABLE_PPPOE";
  if (input.serviceActionId) {
    const existing = await prisma.routerJob.findFirst({
      where: { serviceActionId: input.serviceActionId, action, status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] } },
      orderBy: { id: "desc" }
    });
    if (existing) return existing;
  }
  return prisma.routerJob.create({
    data: {
      clientId: input.clientId,
      serviceActionId: input.serviceActionId ?? null,
      mikrotikDeviceId: input.mikrotikDeviceId ?? null,
      account: input.account,
      action,
      maxAttempts: input.maxAttempts ?? 10
    }
  });
}

export async function processRouterJobs(limit = 20) {
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (!config.mikrotikEnabled) return { processed: 0, succeeded: 0, retried: 0, failed: 0, skipped: true };

  const now = new Date();
  const eligibleStatuses = config.routerRetryEnabled ? ["PENDING", "FAILED"] as const : ["PENDING"] as const;
  const jobs = await prisma.routerJob.findMany({
    where: { status: { in: [...eligibleStatuses] }, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(limit, 100)),
    include: { client: { select: { mikrotikDeviceId: true } } }
  });

  let succeeded = 0, retried = 0, failed = 0;
  for (const job of jobs) {
    if (job.attempts >= job.maxAttempts) continue;
    const deviceId = job.mikrotikDeviceId ?? job.client.mikrotikDeviceId;
    if (!deviceId) {
      await prisma.routerJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: "No MikroTik device is assigned to this subscriber." } });
      failed++;
      continue;
    }
    const claimed = await prisma.routerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", lastAttemptAt: now, attempts: { increment: 1 }, mikrotikDeviceId: deviceId } });
    try {
      await setPppoeEnabled(deviceId, claimed.account, claimed.action === "ENABLE_PPPOE");
      await prisma.$transaction(async (tx) => {
        await tx.routerJob.update({ where: { id: claimed.id }, data: { status: "SUCCEEDED", lastError: null } });
        await tx.client.update({ where: { id: claimed.clientId }, data: { networkStatus: claimed.action === "DISABLE_PPPOE" ? "SUSPENDED" : "ACTIVE" } });
        if (claimed.serviceActionId) await tx.serviceAction.update({ where: { id: claimed.serviceActionId }, data: { routerAttempted: true, routerSucceeded: true, routerMessage: `Router job #${claimed.id} succeeded` } });
      });
      succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Router sync failed";
      const terminal = claimed.attempts >= claimed.maxAttempts || !config.routerRetryEnabled;
      const nextAttemptAt = new Date(Date.now() + Math.max(1, config.routerRetryMinutes) * 60_000);
      await prisma.$transaction(async (tx) => {
        await tx.routerJob.update({ where: { id: claimed.id }, data: { status: terminal ? "FAILED" : "PENDING", lastError: message, nextAttemptAt } });
        if (terminal) await tx.client.update({ where: { id: claimed.clientId }, data: { networkStatus: "FAILED" } });
        if (claimed.serviceActionId) await tx.serviceAction.update({ where: { id: claimed.serviceActionId }, data: { routerAttempted: true, routerSucceeded: false, routerMessage: message } });
      });
      if (terminal) failed++; else retried++;
    }
  }
  return { processed: jobs.length, succeeded, retried, failed, skipped: false };
}

export async function retryRouterJob(id: number) {
  return prisma.routerJob.update({ where: { id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
}
