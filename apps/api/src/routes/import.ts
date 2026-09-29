import type { FastifyPluginAsync } from "fastify";
import ExcelJS from "exceljs";
import { prisma } from "../prisma.js";
import { dueDateFor, normalizeAreaName, normalizeKey, normalizeText, periodLabel, periodStartFor, toMoney } from "../utils.js";
import { authenticate, requireRoles } from "../auth.js";
import { actorFrom, audit } from "../audit.js";
import { realDataSnapshot } from "../data/real-client-snapshot.js";

function normalizeBillingStatus(value: string): "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" {
  const status = normalizeKey(value);
  if (status.includes("unpaid") || status.includes("not paid") || status.includes("balance")) return "UNPAID";
  if (status.includes("partial") || status.includes("installment")) return "PARTIAL";
  if (status.includes("overdue") || status.includes("cut")) return "OVERDUE";
  if (status.includes("paid")) return "PAID";
  return "UNPAID";
}

async function nextClientCodeNumber() {
  const maxClient = await prisma.client.aggregate({ _max: { id: true } });
  return (maxClient._max.id ?? 0) + 1;
}

export const importRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/import/real-data/preview", { preHandler: requireRoles("ADMIN") }, async () => ({
    ...realDataSnapshot.snapshot,
    areaMappings: realDataSnapshot.areaMappings,
    reviewRows: realDataSnapshot.reviewRows,
    unassignedAreas: [...new Set(realDataSnapshot.clients.filter((x) => !x.routerGroup).map((x) => x.area))].sort()
  }));

  app.post("/import/real-data/bootstrap", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const previous = await prisma.auditLog.findFirst({ where: { action: "REAL_DATA_SNAPSHOT_IMPORTED" } });
    if (previous) return reply.code(409).send({ message: "The bundled real-data snapshot was already imported. Use normal client editing/import for later changes.", importedAt: previous.createdAt });
    const actor = actorFrom(request);
    const periodStart = periodStartFor(realDataSnapshot.snapshot.year, realDataSnapshot.snapshot.month);
    let nextNumber = await nextClientCodeNumber();
    const today = new Date(); today.setHours(0,0,0,0);

    const result = await prisma.$transaction(async (tx) => {
      const mt1 = await tx.mikrotikDevice.upsert({
        where: { name: "MikroTik 1" },
        create: { name: "MikroTik 1", baseUrl: "https://mikrotik-1.invalid", credentialKey: "MT1", enforcementPolicy: "WITH_CUT", isTrustedTier: false, isActive: true, notes: "Placeholder URL. Edit the real REST URL and .env credentials before enabling MikroTik integration." },
        update: { enforcementPolicy: "WITH_CUT", isTrustedTier: false }
      });
      const mt2 = await tx.mikrotikDevice.upsert({
        where: { name: "MikroTik 2" },
        create: { name: "MikroTik 2", baseUrl: "https://mikrotik-2.invalid", credentialKey: "MT2", enforcementPolicy: "WITH_CUT", isTrustedTier: false, isActive: true, notes: "Standard area router. Placeholder URL; edit before network linking." },
        update: { enforcementPolicy: "WITH_CUT", isTrustedTier: false }
      });
      const mt3 = await tx.mikrotikDevice.upsert({
        where: { name: "MikroTik 3" },
        create: { name: "MikroTik 3", baseUrl: "https://mikrotik-3.invalid", credentialKey: "MT3", enforcementPolicy: "NO_AUTO_CUT", isTrustedTier: true, isActive: true, notes: "Trusted / good-payer router. No fixed area mapping by default. Placeholder URL; edit before migration/provisioning." },
        update: { enforcementPolicy: "NO_AUTO_CUT", isTrustedTier: true }
      });
      const deviceForGroup = { MIKROTIK_1: mt1.id, MIKROTIK_2: mt2.id } as const;
      for (const area of realDataSnapshot.areaMappings.MIKROTIK_1) await tx.areaRouterDefault.upsert({ where: { area }, create: { area, mikrotikDeviceId: mt1.id, updatedBy: actor }, update: { mikrotikDeviceId: mt1.id, updatedBy: actor } });
      for (const area of realDataSnapshot.areaMappings.MIKROTIK_2) await tx.areaRouterDefault.upsert({ where: { area }, create: { area, mikrotikDeviceId: mt2.id, updatedBy: actor }, update: { mikrotikDeviceId: mt2.id, updatedBy: actor } });

      let created = 0, updated = 0, paid = 0, unpaid = 0, cut = 0;
      for (const row of realDataSnapshot.clients) {
        const legacyKey = `${normalizeKey(row.area)}|${normalizeKey(row.fullName)}`;
        const existing = await tx.client.findUnique({ where: { legacyKey } });
        const deviceId = row.routerGroup ? deviceForGroup[row.routerGroup] : null;
        const serviceStatus = normalizeKey(row.legacyStatus).includes("cut") ? "CUT" as const : "ACTIVE" as const;
        const client = existing ? await tx.client.update({ where: { id: existing.id }, data: { area: row.area, fullName: row.fullName, dueDay: row.dueDay, monthlyRate: row.monthlyRate, notes: row.legacyNote ? `Excel note: ${row.legacyNote}` : existing.notes, mikrotikDeviceId: existing.mikrotikDeviceId ?? deviceId, networkStatus: existing.networkStatus === "ACTIVE" || existing.networkStatus === "SUSPENDED" ? existing.networkStatus : "FOR_LINKING", serviceStatus } }) : await tx.client.create({ data: { clientCode: `ISP-${String(nextNumber++).padStart(5,"0")}`, legacyKey, area: row.area, fullName: row.fullName, dueDay: row.dueDay, monthlyRate: row.monthlyRate, serviceStatus, mikrotikDeviceId: deviceId, networkStatus: "FOR_LINKING", notes: row.legacyNote ? `Excel note: ${row.legacyNote}` : null } });
        existing ? updated++ : created++;
        const dueDate = dueDateFor(realDataSnapshot.snapshot.year, realDataSnapshot.snapshot.month, row.dueDay);
        let status = normalizeBillingStatus(row.legacyStatus);
        if (status === "UNPAID" && dueDate < today) status = "OVERDUE";
        const balance = status === "PAID" ? 0 : row.monthlyRate;
        await tx.bill.upsert({ where: { clientId_periodStart: { clientId: client.id, periodStart } }, update: { dueDate, originalDueDate: dueDate, amountDue: row.monthlyRate, balance, status, legacyStatus: row.legacyStatus || null }, create: { clientId: client.id, periodStart, periodLabel: periodLabel(realDataSnapshot.snapshot.year, realDataSnapshot.snapshot.month), originalDueDate: dueDate, dueDate, amountDue: row.monthlyRate, balance, status, legacyStatus: row.legacyStatus || null } });
        if (status === "PAID") paid++; else unpaid++; if (serviceStatus === "CUT") cut++;
      }
      return { created, updated, total: realDataSnapshot.clients.length, paid, unpaid, cut, mt1Id: mt1.id, mt2Id: mt2.id, mt3Id: mt3.id };
    });

    await audit("REAL_DATA_SNAPSHOT_IMPORTED", "ExcelSnapshot", `${realDataSnapshot.snapshot.year}-${String(realDataSnapshot.snapshot.month).padStart(2,"0")}`, actor, { ...result, reviewCount: realDataSnapshot.reviewRows.length, sourceSheet: realDataSnapshot.snapshot.sheet });
    return { ...result, reviewRows: realDataSnapshot.reviewRows, unassignedAreas: [...new Set(realDataSnapshot.clients.filter((x) => !x.routerGroup).map((x) => x.area))].sort(), note: "Paid rows are marked paid without fabricating payment dates/receipts. Existing subscribers are placed in For Linking, not For Activation." };
  });

  app.post("/import/excel", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const part = await request.file();
    if (!part) return reply.code(400).send({ message: "Upload an .xlsx file" });
    const query = request.query as Record<string, unknown>;
    const sheetName = normalizeText(query.sheetName) || "paid for this month";
    const year = Number(query.year ?? new Date().getFullYear());
    const month = Number(query.month ?? new Date().getMonth() + 1);
    if (month < 1 || month > 12 || year < 2020 || year > 2100) return reply.code(400).send({ message: "Invalid year/month" });

    const buffer = await part.toBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) return reply.code(400).send({ message: `Sheet '${sheetName}' not found`, sheets: workbook.worksheets.map((x) => x.name) });

    const periodStart = periodStartFor(year, month);
    let imported = 0, skipped = 0, nextClientNumber = await nextClientCodeNumber();
    const warnings: string[] = [];

    for (let rowNo = 1; rowNo <= sheet.rowCount; rowNo++) {
      const row = sheet.getRow(rowNo);
      const area = normalizeAreaName(row.getCell(1).value);
      const fullName = normalizeText(row.getCell(2).value);
      const dueDay = Number(row.getCell(3).value);
      const rate = toMoney(row.getCell(4).value);
      const legacyStatus = normalizeText(row.getCell(5).value);
      const looksLikeHeader = /area|barangay|address/i.test(area) || /client|name/i.test(fullName);
      if (!area || !fullName || looksLikeHeader || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31 || rate <= 0) { if (area || fullName) skipped++; continue; }

      const legacyKey = `${normalizeKey(area)}|${normalizeKey(fullName)}`;
      const existing = await prisma.client.findUnique({ where: { legacyKey } });
      const areaDefault = await prisma.areaRouterDefault.findUnique({ where: { area } });
      const candidateCode = `ISP-${String(nextClientNumber).padStart(5, "0")}`;
      const client = await prisma.client.upsert({ where: { legacyKey }, update: { area, fullName, dueDay, monthlyRate: rate }, create: { clientCode: candidateCode, legacyKey, area, fullName, dueDay, monthlyRate: rate, serviceStatus: normalizeKey(legacyStatus).includes("cut") ? "CUT" : "ACTIVE", mikrotikDeviceId: areaDefault?.mikrotikDeviceId ?? null, networkStatus: "FOR_LINKING" } });
      if (!existing) nextClientNumber++;
      const dueDate = dueDateFor(year, month, dueDay);
      let status = normalizeBillingStatus(legacyStatus);
      if (status === "UNPAID" && dueDate < new Date()) status = "OVERDUE";
      const balance = status === "PAID" ? 0 : rate;
      await prisma.bill.upsert({ where: { clientId_periodStart: { clientId: client.id, periodStart } }, update: { dueDate, amountDue: rate, balance, status, legacyStatus }, create: { clientId: client.id, periodStart, periodLabel: periodLabel(year, month), originalDueDate: dueDate, dueDate, amountDue: rate, balance, status, legacyStatus } });
      if (normalizeKey(legacyStatus).includes("balance")) warnings.push(`${fullName}: legacy status '${legacyStatus}' was preserved for review; no historical payment date was invented.`);
      imported++;
    }
    return { sheet: sheetName, year, month, imported, skipped, warnings: warnings.slice(0, 50) };
  });
};
