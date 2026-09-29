import { prisma } from "../prisma.js";

const CORRECTION_ACTION = "ROUTER_TOPOLOGY_MT3_TRUSTED_APPLIED";

/**
 * v0.7.2 correction for the owner's real topology:
 * - MikroTik 1: standard WITH_CUT
 * - MikroTik 2: standard WITH_CUT (keeps its approved area mappings)
 * - MikroTik 3: trusted NO_AUTO_CUT (no fixed area mapping by default)
 *
 * This only runs for databases that already imported the bundled v0.7.1 real-data snapshot,
 * and only once. It never moves a linked subscriber automatically.
 */
export async function applyRealTopologyCorrectionIfNeeded() {
  const imported = await prisma.auditLog.findFirst({ where: { action: "REAL_DATA_SNAPSHOT_IMPORTED" }, select: { id: true } });
  if (!imported) return { applied: false, reason: "real-data snapshot not imported" };

  const alreadyApplied = await prisma.auditLog.findFirst({ where: { action: CORRECTION_ACTION }, select: { id: true } });
  if (alreadyApplied) return { applied: false, reason: "already applied" };

  const result = await prisma.$transaction(async (tx) => {
    const mt1 = await tx.mikrotikDevice.upsert({
      where: { name: "MikroTik 1" },
      create: {
        name: "MikroTik 1",
        baseUrl: "https://mikrotik-1.invalid",
        credentialKey: "MT1",
        enforcementPolicy: "WITH_CUT",
        isTrustedTier: false,
        isActive: true,
        notes: "Standard area router. Edit the real REST URL and credentials before enabling integration."
      },
      update: { enforcementPolicy: "WITH_CUT", isTrustedTier: false }
    });

    const mt2 = await tx.mikrotikDevice.upsert({
      where: { name: "MikroTik 2" },
      create: {
        name: "MikroTik 2",
        baseUrl: "https://mikrotik-2.invalid",
        credentialKey: "MT2",
        enforcementPolicy: "WITH_CUT",
        isTrustedTier: false,
        isActive: true,
        notes: "Standard area router. Keeps the approved Pogo/Palisoc/Ketegan/Cacandongan/Laoac area mappings."
      },
      update: { enforcementPolicy: "WITH_CUT", isTrustedTier: false }
    });

    const mt3 = await tx.mikrotikDevice.upsert({
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

    await tx.auditLog.create({
      data: {
        actor: "System",
        action: CORRECTION_ACTION,
        entityType: "NetworkTopology",
        entityId: "v0.7.2",
        details: {
          mt1: { id: mt1.id, policy: "WITH_CUT" },
          mt2: { id: mt2.id, policy: "WITH_CUT" },
          mt3: { id: mt3.id, policy: "NO_AUTO_CUT", trusted: true },
          note: "No client was automatically moved. Existing area mappings stay intact."
        }
      }
    });

    return { mt1Id: mt1.id, mt2Id: mt2.id, mt3Id: mt3.id };
  });

  return { applied: true, ...result };
}
