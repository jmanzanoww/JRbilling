import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../prisma.js";

export const BACKUP_FORMAT = "isp-billing-json-backup";
export const BACKUP_VERSION = "0.7.0";

export async function exportBackupPayload() {
  const [mikrotikDevices, areaRouterDefaults, clients, bills, billExtensions, networkMigrations, payments, allocations, credits, dueDateChanges, serviceActions, messages, users, auditLogs, systemConfig, routerJobs, paymentSubmissions, collectionAssignments, areaCollectorDefaults] = await Promise.all([
    prisma.mikrotikDevice.findMany(), prisma.areaRouterDefault.findMany(), prisma.client.findMany(), prisma.bill.findMany(), prisma.billExtension.findMany(), prisma.networkMigration.findMany(), prisma.payment.findMany(), prisma.paymentAllocation.findMany(),
    prisma.creditTransaction.findMany(), prisma.dueDateChange.findMany(), prisma.serviceAction.findMany(), prisma.messageHistory.findMany(),
    prisma.user.findMany(), prisma.auditLog.findMany(), prisma.systemConfig.findUnique({ where: { id: 1 } }), prisma.routerJob.findMany(),
    prisma.paymentSubmission.findMany(), prisma.collectionAssignment.findMany(), prisma.areaCollectorDefault.findMany()
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { mikrotikDevices, areaRouterDefaults, clients, bills, billExtensions, networkMigrations, payments, allocations, credits, dueDateChanges, serviceActions, messages, users, auditLogs, systemConfig, routerJobs, paymentSubmissions, collectionAssignments, areaCollectorDefaults }
  };
}

function backupDir() {
  return path.resolve(process.env.BACKUP_DIR ?? path.join(process.env.PROGRAMDATA ?? process.cwd(), "ISP Billing", "backups"));
}

export async function createAutomaticBackup(force = false) {
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (!force && !config.automaticBackupEnabled) return { created: false, reason: "disabled" as const };
  const now = new Date();
  if (!force && now.getHours() < config.backupHour) return { created: false, reason: "before-schedule" as const };

  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const day = now.toISOString().slice(0, 10);
  const existing = await readdir(dir);
  if (!force && existing.some((name) => name.startsWith(`isp-billing-auto-${day}-`) && name.endsWith(".json"))) {
    return { created: false, reason: "already-created" as const };
  }

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const fileName = `isp-billing-auto-${stamp}.json`;
  const filePath = path.join(dir, fileName);
  const payload = await exportBackupPayload();
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  const cutoff = Date.now() - Math.max(1, config.backupRetentionDays) * 86_400_000;
  let deleted = 0;
  for (const name of await readdir(dir)) {
    if (!name.startsWith("isp-billing-auto-") || !name.endsWith(".json")) continue;
    const candidate = path.join(dir, name);
    const info = await stat(candidate);
    if (info.mtimeMs < cutoff) { await unlink(candidate); deleted++; }
  }
  const info = await stat(filePath);
  return { created: true, fileName, filePath, sizeBytes: info.size, deletedOldBackups: deleted };
}

export async function listAutomaticBackups(limit = 30) {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const rows = [] as { fileName: string; sizeBytes: number; modifiedAt: string }[];
  for (const fileName of await readdir(dir)) {
    if (!fileName.endsWith(".json")) continue;
    const info = await stat(path.join(dir, fileName));
    rows.push({ fileName, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() });
  }
  return rows.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, Math.max(1, Math.min(limit, 200)));
}
