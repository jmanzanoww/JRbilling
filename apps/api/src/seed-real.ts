import "./env.js";
import { prisma } from "./prisma.js";
import { realDataSnapshot } from "./data/real-client-snapshot.js";
import { dueDateFor, normalizeKey, periodLabel, periodStartFor } from "./utils.js";

function normalizeBillingStatus(value: string): "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" {
  const status = normalizeKey(value);
  if (status.includes("unpaid") || status.includes("not paid") || status.includes("balance")) return "UNPAID";
  if (status.includes("partial") || status.includes("installment")) return "PARTIAL";
  if (status.includes("overdue") || status.includes("cut")) return "OVERDUE";
  if (status.includes("paid")) return "PAID";
  return "UNPAID";
}

async function main() {
  console.log("JRbilling real-data seed");
  console.log(`Source: ${realDataSnapshot.snapshot.sheet} · ${realDataSnapshot.snapshot.year}-${String(realDataSnapshot.snapshot.month).padStart(2, "0")}`);
  console.log(`Ready clients: ${realDataSnapshot.clients.length}; review-only rows: ${realDataSnapshot.reviewRows.length}`);

  const mt1 = await prisma.mikrotikDevice.upsert({
    where: { name: "MikroTik 1" },
    create: {
      name: "MikroTik 1",
      baseUrl: "https://mikrotik-1.invalid",
      credentialKey: "MT1",
      enforcementPolicy: "WITH_CUT",
      isTrustedTier: false,
      isActive: true,
      notes: "Standard area router. Placeholder REST URL; edit before linking."
    },
    update: { enforcementPolicy: "WITH_CUT", isTrustedTier: false }
  });

  const mt2 = await prisma.mikrotikDevice.upsert({
    where: { name: "MikroTik 2" },
    create: {
      name: "MikroTik 2",
      baseUrl: "https://mikrotik-2.invalid",
      credentialKey: "MT2",
      enforcementPolicy: "WITH_CUT",
      isTrustedTier: false,
      isActive: true,
      notes: "Standard area router. Placeholder REST URL; edit before linking."
    },
    update: { enforcementPolicy: "WITH_CUT", isTrustedTier: false }
  });

  const mt3 = await prisma.mikrotikDevice.upsert({
    where: { name: "MikroTik 3" },
    create: {
      name: "MikroTik 3",
      baseUrl: "https://mikrotik-3.invalid",
      credentialKey: "MT3",
      enforcementPolicy: "NO_AUTO_CUT",
      isTrustedTier: true,
      isActive: true,
      notes: "Trusted / good-payer router. No fixed area mapping by default."
    },
    update: { enforcementPolicy: "NO_AUTO_CUT", isTrustedTier: true }
  });

  for (const area of realDataSnapshot.areaMappings.MIKROTIK_1) {
    await prisma.areaRouterDefault.upsert({
      where: { area },
      create: { area, mikrotikDeviceId: mt1.id, updatedBy: "db:seed-real" },
      update: { mikrotikDeviceId: mt1.id, updatedBy: "db:seed-real" }
    });
  }
  for (const area of realDataSnapshot.areaMappings.MIKROTIK_2) {
    await prisma.areaRouterDefault.upsert({
      where: { area },
      create: { area, mikrotikDeviceId: mt2.id, updatedBy: "db:seed-real" },
      update: { mikrotikDeviceId: mt2.id, updatedBy: "db:seed-real" }
    });
  }

  const maxClient = await prisma.client.aggregate({ _max: { id: true } });
  let nextNumber = (maxClient._max.id ?? 0) + 1;
  const periodStart = periodStartFor(realDataSnapshot.snapshot.year, realDataSnapshot.snapshot.month);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let created = 0;
  let updated = 0;
  let paid = 0;
  let unpaid = 0;
  let cut = 0;

  const deviceForGroup = {
    MIKROTIK_1: mt1.id,
    MIKROTIK_2: mt2.id
  } as const;

  for (let index = 0; index < realDataSnapshot.clients.length; index++) {
    const row = realDataSnapshot.clients[index];
    const legacyKey = `${normalizeKey(row.area)}|${normalizeKey(row.fullName)}`;
    const existing = await prisma.client.findUnique({ where: { legacyKey } });
    const deviceId = row.routerGroup ? deviceForGroup[row.routerGroup] : null;
    const serviceStatus = normalizeKey(row.legacyStatus).includes("cut") ? "CUT" as const : "ACTIVE" as const;

    let client;
    if (existing) {
      client = await prisma.client.update({
        where: { id: existing.id },
        data: {
          area: row.area,
          fullName: row.fullName,
          dueDay: row.dueDay,
          monthlyRate: row.monthlyRate,
          notes: row.legacyNote ? `Excel note: ${row.legacyNote}` : existing.notes,
          mikrotikDeviceId: existing.mikrotikDeviceId ?? deviceId,
          networkStatus: existing.networkStatus === "ACTIVE" || existing.networkStatus === "SUSPENDED" ? existing.networkStatus : "FOR_LINKING",
          serviceStatus
        }
      });
      updated++;
    } else {
      client = await prisma.client.create({
        data: {
          clientCode: `ISP-${String(nextNumber++).padStart(5, "0")}`,
          legacyKey,
          area: row.area,
          fullName: row.fullName,
          dueDay: row.dueDay,
          monthlyRate: row.monthlyRate,
          serviceStatus,
          mikrotikDeviceId: deviceId,
          networkStatus: "FOR_LINKING",
          notes: row.legacyNote ? `Excel note: ${row.legacyNote}` : null
        }
      });
      created++;
    }

    const dueDate = dueDateFor(realDataSnapshot.snapshot.year, realDataSnapshot.snapshot.month, row.dueDay);
    let status = normalizeBillingStatus(row.legacyStatus);
    if (status === "UNPAID" && dueDate < today) status = "OVERDUE";
    const balance = status === "PAID" ? 0 : row.monthlyRate;

    await prisma.bill.upsert({
      where: { clientId_periodStart: { clientId: client.id, periodStart } },
      update: {
        dueDate,
        originalDueDate: dueDate,
        amountDue: row.monthlyRate,
        balance,
        status,
        legacyStatus: row.legacyStatus || null
      },
      create: {
        clientId: client.id,
        periodStart,
        periodLabel: periodLabel(realDataSnapshot.snapshot.year, realDataSnapshot.snapshot.month),
        originalDueDate: dueDate,
        dueDate,
        amountDue: row.monthlyRate,
        balance,
        status,
        legacyStatus: row.legacyStatus || null
      }
    });

    if (status === "PAID") paid++;
    else unpaid++;
    if (serviceStatus === "CUT") cut++;

    if ((index + 1) % 25 === 0 || index + 1 === realDataSnapshot.clients.length) {
      console.log(`Seeded ${index + 1}/${realDataSnapshot.clients.length} clients...`);
    }
  }

  const auditDetails = {
    created,
    updated,
    total: realDataSnapshot.clients.length,
    paid,
    unpaid,
    cut,
    reviewCount: realDataSnapshot.reviewRows.length,
    sourceSheet: realDataSnapshot.snapshot.sheet,
    mt1Id: mt1.id,
    mt2Id: mt2.id,
    mt3Id: mt3.id,
    source: "CLI_DB_SEED_REAL"
  };

  const existingAudit = await prisma.auditLog.findFirst({ where: { action: "REAL_DATA_SNAPSHOT_IMPORTED" } });
  if (!existingAudit) {
    await prisma.auditLog.create({
      data: {
        actor: "db:seed-real",
        action: "REAL_DATA_SNAPSHOT_IMPORTED",
        entityType: "ExcelSnapshot",
        entityId: `${realDataSnapshot.snapshot.year}-${String(realDataSnapshot.snapshot.month).padStart(2, "0")}`,
        details: auditDetails
      }
    });
  }

  const [clientCount, billCount] = await Promise.all([prisma.client.count(), prisma.bill.count()]);
  console.log("");
  console.log("Real-data seed complete.");
  console.log(`Clients in database: ${clientCount}`);
  console.log(`Bills in database:   ${billCount}`);
  console.log(`Created: ${created}; updated: ${updated}; paid: ${paid}; open/unpaid: ${unpaid}; cut: ${cut}`);
  console.log(`Review-only incomplete rows not imported: ${realDataSnapshot.reviewRows.length}`);
  console.log("Existing subscribers are FOR_LINKING; no PPPoE account was created or changed.");
}

main()
  .catch((error) => {
    console.error("Real-data seed failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
