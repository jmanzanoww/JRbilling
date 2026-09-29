import { prisma } from "../prisma.js";
import { cutDateFor } from "./enforcement.js";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const dateFmt = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });

export async function queueDueReminders() {
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (!config.messagingEnabled) return { queued: 0, skipped: 0 };

  const now = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);
  const upcomingEnd = new Date(today); upcomingEnd.setDate(upcomingEnd.getDate() + Math.max(0, config.reminderDaysBefore)); upcomingEnd.setHours(23,59,59,999);
  const bills = await prisma.bill.findMany({
    where: { balance: { gt: 0 }, dueDate: { lte: upcomingEnd } },
    include: { client: { include: { mikrotikDevice: true } }, extensions: { orderBy: { extensionUntil: "desc" }, take: 1 } },
    take: 5000
  });

  let queued = 0, skipped = 0;
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const dateKey = dayKey(today);
  const diffDays = (a: Date, b: Date) => Math.round((new Date(a.getFullYear(),a.getMonth(),a.getDate()).getTime() - new Date(b.getFullYear(),b.getMonth(),b.getDate()).getTime()) / 86400000);

  for (const bill of bills) {
    const client = bill.client;
    if (!client.allowNotifications || !client.primaryMobile) { skipped++; continue; }
    const due = new Date(bill.dueDate); due.setHours(0,0,0,0);
    const extensionUntil = bill.extensions[0]?.extensionUntil ? new Date(bill.extensions[0].extensionUntil) : null;
    if (extensionUntil) extensionUntil.setHours(0,0,0,0);
    const cutDate = cutDateFor(due, config.defaultGraceDays, extensionUntil);
    const daysFromDue = diffDays(today, due);
    const daysToCut = diffDays(cutDate, today);
    const noAutoCut = client.mikrotikDevice?.enforcementPolicy === "NO_AUTO_CUT";

    let templateKey: string | null = null;
    let body = "";
    if (daysFromDue === 0 && config.dueDateReminderEnabled) {
      templateKey = "DUE_TODAY";
      body = `Billing reminder: ${client.fullName}, your ${bill.periodLabel} internet bill with balance ${peso.format(Number(bill.balance))} is due today (${dateFmt.format(due)}). Please disregard if already paid.`;
    } else if (daysFromDue < 0 && Math.abs(daysFromDue) <= config.reminderDaysBefore) {
      templateKey = "DUE_REMINDER";
      body = `Billing reminder: ${client.fullName}, your ${bill.periodLabel} internet bill of ${peso.format(Number(bill.balance))} is due on ${dateFmt.format(due)}. Please disregard if already paid.`;
    } else if (daysFromDue > 0) {
      if (!noAutoCut && config.finalWarningEnabled && daysToCut === 1) {
        templateKey = "FINAL_CUT_WARNING";
        body = `Final reminder: ${client.fullName}, ${peso.format(Number(bill.balance))} remains unpaid from ${dateFmt.format(due)}. Your current protection period ends today and service may be suspended tomorrow (${dateFmt.format(cutDate)}).`;
      } else if (config.graceReminderEnabled && daysFromDue === Math.max(1, config.overdueReminderDays)) {
        templateKey = extensionUntil && today <= extensionUntil ? "EXTENSION_REMINDER" : "GRACE_REMINDER";
        const protection = extensionUntil && extensionUntil >= today ? `Approved extension is until ${dateFmt.format(extensionUntil)}.` : `Grace period is ${config.defaultGraceDays} day(s).`;
        body = noAutoCut
          ? `Billing reminder: ${client.fullName}, ${peso.format(Number(bill.balance))} remains unpaid from ${dateFmt.format(due)}. ${protection} Your account remains active under its current network policy, but the balance is still due.`
          : `Billing reminder: ${client.fullName}, ${peso.format(Number(bill.balance))} remains unpaid from ${dateFmt.format(due)}. ${protection} Please settle before possible service suspension.`;
      }
    }
    if (!templateKey) { skipped++; continue; }
    const dedupeKey = `${templateKey}:${bill.id}:${dateKey}`;
    if (await prisma.messageHistory.findUnique({ where: { dedupeKey } })) { skipped++; continue; }
    await prisma.messageHistory.create({ data: { clientId: client.id, destination: client.primaryMobile, templateKey, body, dedupeKey } });
    queued++;
  }
  return { queued, skipped };
}

export async function queueManualMessage(clientId: number, body: string, templateKey = "MANUAL") {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  if (!client.allowNotifications) throw new Error("Client notifications are disabled");
  if (!client.primaryMobile) throw new Error("Client has no primary mobile number");
  return prisma.messageHistory.create({ data: { clientId, destination: client.primaryMobile, templateKey, body } });
}

export async function processMessageQueue(limit = 50) {
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const queued = await prisma.messageHistory.findMany({ where: { status: "QUEUED" }, include: { client: true }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0, failed = 0, skipped = 0;

  for (const message of queued) {
    if (!config.messagingEnabled) break;
    if (config.smsProvider === "LOG_ONLY") {
      await prisma.messageHistory.update({ where: { id: message.id }, data: { status: "SKIPPED", errorMessage: "LOG_ONLY provider: message preview only; no external SMS was sent." } });
      skipped++;
      continue;
    }
    if (config.smsProvider !== "WEBHOOK" || !config.smsWebhookUrl) {
      await prisma.messageHistory.update({ where: { id: message.id }, data: { status: "FAILED", errorMessage: "SMS provider is not configured." } });
      failed++;
      continue;
    }
    try {
      const response = await fetch(config.smsWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: message.destination, message: message.body, clientCode: message.client.clientCode, templateKey: message.templateKey })
      });
      if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}`);
      await prisma.messageHistory.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), errorMessage: null } });
      sent++;
    } catch (error) {
      await prisma.messageHistory.update({ where: { id: message.id }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message : "Unknown SMS error" } });
      failed++;
    }
  }
  return { processed: sent + failed + skipped, sent, failed, skipped };
}
