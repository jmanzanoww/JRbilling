import { audit } from "../audit.js";
import { generateBillsForPeriod, refreshOverdueStatuses } from "./billing.js";
import { processMessageQueue, queueDueReminders } from "./messaging.js";
import { processRouterJobs } from "./router-queue.js";
import { createAutomaticBackup } from "./backup.js";
import { refreshServiceEnforcement } from "./enforcement.js";
import { prisma } from "../prisma.js";

let running = false;
export async function runAutomationCycle() {
  if (running) return { skipped: true };
  running = true;
  try {
    const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const now = new Date();
    const expiredSessionsDeleted = (await prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } })).count;
    const overdueUpdated = await refreshOverdueStatuses();
    const enforcement = await refreshServiceEnforcement();
    const billing = config.autoBillingEnabled ? await generateBillsForPeriod(now.getFullYear(), now.getMonth() + 1) : { created: 0, skipped: 0, creditsApplied: 0 };
    const reminders = config.messagingEnabled ? await queueDueReminders() : { queued: 0, skipped: 0 };
    const messages = config.messagingEnabled ? await processMessageQueue() : { processed: 0, sent: 0, failed: 0, skipped: 0 };
    const router = await processRouterJobs();
    const backup = await createAutomaticBackup();
    const result = { at: now.toISOString(), expiredSessionsDeleted, overdueUpdated, enforcement, billing, reminders, messages, router, backup };
    if (billing.created || reminders.queued || overdueUpdated || enforcement.cut || enforcement.forCut || router.processed || backup.created) await audit("AUTOMATION_CYCLE", "System", null, "System", result);
    return result;
  } finally {
    running = false;
  }
}

export function startAutomationScheduler() {
  const intervalMs = Math.max(60_000, Number(process.env.AUTOMATION_INTERVAL_MS ?? 60 * 60 * 1000));
  const timer = setInterval(() => void runAutomationCycle().catch((error) => console.error("Automation cycle failed", error)), intervalMs);
  timer.unref();
  setTimeout(() => void runAutomationCycle().catch((error) => console.error("Initial automation cycle failed", error)), 10_000).unref();
}
