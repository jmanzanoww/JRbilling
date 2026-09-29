import { prisma } from "../prisma.js";
import { enqueueRouterJob, processRouterJobs } from "./router-queue.js";

function dayStart(value = new Date()) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function cutDateFor(dueDate: Date, graceDays: number, extensionUntil?: Date | null) {
  const graceEnd = addDays(dayStart(dueDate), Math.max(0, graceDays));
  const protectedUntil = extensionUntil && dayStart(extensionUntil) > graceEnd ? dayStart(extensionUntil) : graceEnd;
  return addDays(protectedUntil, 1);
}

export async function refreshServiceEnforcement() {
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const now = dayStart();
  const clients = await prisma.client.findMany({
    where: { serviceStatus: { not: "INACTIVE" }, bills: { some: { balance: { gt: 0 } } } },
    include: {
      mikrotikDevice: true,
      bills: { where: { balance: { gt: 0 } }, orderBy: { dueDate: "asc" }, include: { extensions: { orderBy: { extensionUntil: "desc" }, take: 1 } } }
    },
    take: 5000
  });
  let extended = 0, forCut = 0, cut = 0, trustedOverdue = 0;
  for (const client of clients) {
    const bill = client.bills[0];
    if (!bill) continue;
    const ext = bill.extensions[0]?.extensionUntil ?? null;
    const cutoff = cutDateFor(bill.dueDate, config.defaultGraceDays, ext);
    const extensionActive = Boolean(ext && now <= dayStart(ext) && now > dayStart(bill.dueDate));

    if (extensionActive && client.serviceStatus !== "CUT" && client.serviceStatus !== "EXTENDED") {
      await prisma.client.update({ where: { id: client.id }, data: { serviceStatus: "EXTENDED" } });
      extended++;
      continue;
    }
    if (now < cutoff) continue;

    const policy = client.mikrotikDevice?.enforcementPolicy ?? "MANUAL_ONLY";
    if (policy === "NO_AUTO_CUT") {
      trustedOverdue++;
      if (client.serviceStatus === "EXTENDED") await prisma.client.update({ where: { id: client.id }, data: { serviceStatus: "ACTIVE" } });
      continue;
    }
    if (client.serviceStatus === "CUT") continue;

    if (!config.autoCutAfterGrace || policy === "MANUAL_ONLY" || !client.mikrotikAccount || !client.mikrotikDeviceId || client.networkStatus !== "ACTIVE") {
      if (client.serviceStatus !== "FOR_CUT") {
        await prisma.$transaction(async (tx) => {
          await tx.serviceAction.create({ data: { clientId: client.id, type: "MARK_FOR_CUT", previousStatus: client.serviceStatus, nextStatus: "FOR_CUT", outstandingAtAction: client.bills.reduce((s,b)=>s+Number(b.balance),0), reason: "Grace period / extension expired", performedBy: "System" } });
          await tx.client.update({ where: { id: client.id }, data: { serviceStatus: "FOR_CUT" } });
        });
        forCut++;
      }
      continue;
    }

    const action = await prisma.$transaction(async (tx) => {
      const row = await tx.serviceAction.create({ data: { clientId: client.id, type: "CUT", previousStatus: client.serviceStatus, nextStatus: "CUT", outstandingAtAction: client.bills.reduce((s,b)=>s+Number(b.balance),0), reason: "Automatic cut after grace period / approved extension", performedBy: "System" } });
      await tx.client.update({ where: { id: client.id }, data: { serviceStatus: "CUT", networkStatus: "SUSPENDED" } });
      return row;
    });
    await enqueueRouterJob({ clientId: client.id, serviceActionId: action.id, mikrotikDeviceId: client.mikrotikDeviceId, account: client.mikrotikAccount, enabled: false });
    cut++;
  }
  if (cut) await processRouterJobs(Math.min(100, cut));
  return { checked: clients.length, extended, forCut, cut, trustedOverdue };
}
