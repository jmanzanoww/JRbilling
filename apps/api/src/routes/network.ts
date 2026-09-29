import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { actorFrom, audit } from "../audit.js";
import { authenticate, requireRoles } from "../auth.js";
import { decryptNetworkSecret, encryptNetworkSecret, generatePppoePassword } from "../network-crypto.js";
import { lookupPppoeAccount, provisionPppoeAccount, removePppoeAccount, setPppoeEnabled, testMikrotikConnection } from "../services/mikrotik.js";

const deviceInput = z.object({
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().url(),
  credentialKey: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_]+$/),
  enforcementPolicy: z.enum(["WITH_CUT", "NO_AUTO_CUT", "MANUAL_ONLY"]).default("WITH_CUT"),
  isTrustedTier: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable()
});

async function migrationRun(id: number, actor: string) {
  const migration = await prisma.networkMigration.findUnique({ where: { id }, include: { client: true, fromDevice: true, toDevice: true } });
  if (!migration) throw new Error("Migration not found");
  const client = migration.client;
  if (!client.mikrotikAccount || !client.mikrotikProfile || !client.pppoeSecretEncrypted) throw new Error("Subscriber does not have complete PPPoE credentials/profile for migration.");
  const password = decryptNetworkSecret(client.pppoeSecretEncrypted);
  await prisma.networkMigration.update({ where: { id }, data: { status: "PROCESSING", startedAt: new Date(), errorMessage: null } });
  await prisma.client.update({ where: { id: client.id }, data: { networkStatus: "MIGRATION_REQUIRED" } });
  let targetCreated = false;
  try {
    await provisionPppoeAccount(migration.toDeviceId, { account: client.mikrotikAccount, password, profile: client.mikrotikProfile, enabled: false });
    targetCreated = true;
    if (migration.fromDeviceId) await setPppoeEnabled(migration.fromDeviceId, client.mikrotikAccount, false);
    await setPppoeEnabled(migration.toDeviceId, client.mikrotikAccount, true);
    if (migration.fromDeviceId) await removePppoeAccount(migration.fromDeviceId, client.mikrotikAccount);
    await prisma.$transaction([
      prisma.client.update({ where: { id: client.id }, data: { mikrotikDeviceId: migration.toDeviceId, networkStatus: "ACTIVE", networkActivatedAt: new Date() } }),
      prisma.networkMigration.update({ where: { id }, data: { status: "SUCCEEDED", completedAt: new Date(), errorMessage: null } })
    ]);
    await audit("NETWORK_MIGRATION_SUCCEEDED", "NetworkMigration", id, actor, { clientId: client.id, fromDeviceId: migration.fromDeviceId, toDeviceId: migration.toDeviceId, reason: migration.reason });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network migration failed";
    if (migration.fromDeviceId) await setPppoeEnabled(migration.fromDeviceId, client.mikrotikAccount, true).catch(() => undefined);
    if (targetCreated) await removePppoeAccount(migration.toDeviceId, client.mikrotikAccount).catch(() => undefined);
    await prisma.$transaction([
      prisma.client.update({ where: { id: client.id }, data: { networkStatus: "FAILED" } }),
      prisma.networkMigration.update({ where: { id }, data: { status: "FAILED", errorMessage: message } })
    ]);
    await audit("NETWORK_MIGRATION_FAILED", "NetworkMigration", id, actor, { clientId: client.id, message });
    throw new Error(message);
  }
}

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticate);

  app.get("/network/devices", async () => prisma.mikrotikDevice.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { clients: true } } } }));

  app.post("/network/devices", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const input = deviceInput.parse(request.body);
    if (input.isTrustedTier && input.enforcementPolicy !== "NO_AUTO_CUT") return reply.code(400).send({ message: "Trusted / good-payer tier devices must use NO_AUTO_CUT policy." });
    const row = await prisma.mikrotikDevice.create({ data: input });
    await audit("MIKROTIK_DEVICE_CREATED", "MikrotikDevice", row.id, actorFrom(request), { ...input, baseUrl: input.baseUrl });
    return reply.code(201).send(row);
  });

  app.patch("/network/devices/:id", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = deviceInput.partial().parse(request.body);
    const existing = await prisma.mikrotikDevice.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ message: "MikroTik device not found" });
    const mergedPolicy = input.enforcementPolicy ?? existing.enforcementPolicy;
    const mergedTrusted = input.isTrustedTier ?? existing.isTrustedTier;
    if (mergedTrusted && mergedPolicy !== "NO_AUTO_CUT") return reply.code(400).send({ message: "Trusted / good-payer tier devices must use NO_AUTO_CUT policy." });
    const row = await prisma.mikrotikDevice.update({ where: { id }, data: input });
    await audit("MIKROTIK_DEVICE_UPDATED", "MikrotikDevice", id, actorFrom(request), input);
    return row;
  });

  app.post("/network/devices/:id/test", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    try { return await testMikrotikConnection(id); }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Connection test failed" }); }
  });

  app.get("/network/area-defaults", { preHandler: requireRoles("ADMIN") }, async () => {
    const [areas, mappings] = await Promise.all([
      prisma.client.findMany({ distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } }),
      prisma.areaRouterDefault.findMany({ include: { mikrotikDevice: true }, orderBy: { area: "asc" } })
    ]);
    const byArea = new Map(mappings.map((m) => [m.area, m]));
    const names = [...new Set([...areas.map((x) => x.area), ...mappings.map((x) => x.area)])].sort((a,b)=>a.localeCompare(b));
    return names.map((area) => ({ area, mapping: byArea.get(area) ?? null }));
  });

  app.put("/network/area-defaults", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const input = z.object({ mappings: z.array(z.object({ area: z.string().trim().min(1), mikrotikDeviceId: z.number().int().positive().nullable() })).max(1000) }).parse(request.body);
    const ids = [...new Set(input.mappings.map(x => x.mikrotikDeviceId).filter((x): x is number => Boolean(x)))];
    if (ids.length && await prisma.mikrotikDevice.count({ where: { id: { in: ids }, isActive: true } }) !== ids.length) return reply.code(400).send({ message: "One or more MikroTik devices are invalid/inactive." });
    const actor = actorFrom(request);
    await prisma.$transaction(async (tx) => {
      for (const m of input.mappings) {
        if (m.mikrotikDeviceId) await tx.areaRouterDefault.upsert({ where: { area: m.area }, create: { area: m.area, mikrotikDeviceId: m.mikrotikDeviceId, updatedBy: actor }, update: { mikrotikDeviceId: m.mikrotikDeviceId, updatedBy: actor } });
        else await tx.areaRouterDefault.deleteMany({ where: { area: m.area } });
        await tx.client.updateMany({
          where: { area: m.area, OR: [{ networkStatus: "FOR_LINKING" }, { networkStatus: "FOR_ACTIVATION" }, { networkStatus: "FAILED", networkActivatedAt: null }] },
          data: { mikrotikDeviceId: m.mikrotikDeviceId ?? null }
        });
      }
    });
    await audit("AREA_ROUTER_DEFAULTS_UPDATED", "AreaRouterDefault", "bulk", actor, { count: input.mappings.length });
    return { ok: true };
  });

  app.get("/network/linking-queue", { preHandler: requireRoles("ADMIN") }, async () => prisma.client.findMany({
    where: { serviceStatus: { not: "INACTIVE" }, networkStatus: "FOR_LINKING" },
    include: { mikrotikDevice: true }, orderBy: [{ area: "asc" }, { fullName: "asc" }], take: 3000
  }));

  app.post("/clients/:id/network/link-existing", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ mikrotikDeviceId: z.number().int().positive(), account: z.string().trim().min(2).max(100), password: z.string().min(6).max(128).optional() }).parse(request.body);
    const [client, device] = await Promise.all([prisma.client.findUnique({ where: { id } }), prisma.mikrotikDevice.findFirst({ where: { id: input.mikrotikDeviceId, isActive: true } })]);
    if (!client) return reply.code(404).send({ message: "Client not found" });
    if (!device) return reply.code(400).send({ message: "Selected MikroTik is invalid or inactive" });
    try {
      const found = await lookupPppoeAccount(device.id, input.account);
      const networkStatus = found.enabled ? "ACTIVE" as const : "SUSPENDED" as const;
      await prisma.client.update({ where: { id }, data: { mikrotikDeviceId: device.id, mikrotikAccount: found.account, mikrotikProfile: found.profile, ...(input.password ? { pppoeSecretEncrypted: encryptNetworkSecret(input.password) } : {}), networkStatus, networkActivatedAt: new Date() } });
      await audit("EXISTING_PPPOE_LINKED", "Client", id, actorFrom(request), { mikrotikDeviceId: device.id, account: found.account, profile: found.profile, enabled: found.enabled, migrationPasswordStored: Boolean(input.password) });
      return { ok: true, account: found.account, profile: found.profile, networkStatus, passwordStored: Boolean(input.password), device: { id: device.id, name: device.name, enforcementPolicy: device.enforcementPolicy } };
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Unable to link existing PPPoE account" });
    }
  });

  app.get("/network/activation-queue", async () => prisma.client.findMany({
    where: {
      serviceStatus: { not: "INACTIVE" },
      OR: [
        { networkStatus: "FOR_ACTIVATION" },
        { networkStatus: "FAILED", networkActivatedAt: null }
      ]
    },
    include: { mikrotikDevice: true }, orderBy: [{ area: "asc" }, { fullName: "asc" }], take: 3000
  }));

  app.get("/network/migration-required", { preHandler: requireRoles("ADMIN") }, async () => prisma.client.findMany({
    where: { networkStatus: "MIGRATION_REQUIRED", serviceStatus: { not: "INACTIVE" }, mikrotikDeviceId: { not: null } },
    include: { mikrotikDevice: true }, orderBy: [{ area: "asc" }, { fullName: "asc" }], take: 1000
  }));

  app.post("/clients/:id/network/activate", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ mikrotikDeviceId: z.number().int().positive(), account: z.string().trim().min(2).max(100), profile: z.string().trim().min(1).max(100), password: z.string().min(6).max(128).optional() }).parse(request.body);
    const [client, device] = await Promise.all([prisma.client.findUnique({ where: { id } }), prisma.mikrotikDevice.findFirst({ where: { id: input.mikrotikDeviceId, isActive: true } })]);
    if (!client) return reply.code(404).send({ message: "Client not found" });
    if (!device) return reply.code(400).send({ message: "Selected MikroTik is invalid or inactive" });
    const password = input.password ?? generatePppoePassword();
    try {
      await provisionPppoeAccount(device.id, { account: input.account, password, profile: input.profile, enabled: true });
      await prisma.client.update({ where: { id }, data: { mikrotikDeviceId: device.id, mikrotikAccount: input.account, mikrotikProfile: input.profile, pppoeSecretEncrypted: encryptNetworkSecret(password), networkStatus: "ACTIVE", networkActivatedAt: new Date() } });
      await audit("NETWORK_ACCOUNT_ACTIVATED", "Client", id, actorFrom(request), { mikrotikDeviceId: device.id, account: input.account, profile: input.profile, generatedPassword: !input.password });
      return { ok: true, password, generated: !input.password, device: { id: device.id, name: device.name, enforcementPolicy: device.enforcementPolicy } };
    } catch (error) {
      await prisma.client.update({ where: { id }, data: { mikrotikDeviceId: device.id, mikrotikAccount: input.account, mikrotikProfile: input.profile, networkStatus: "FAILED" } });
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Activation failed" });
    }
  });

  app.get("/clients/:id/network-secret", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const client = await prisma.client.findUnique({ where: { id }, select: { pppoeSecretEncrypted: true, mikrotikAccount: true } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    if (!client.pppoeSecretEncrypted) return reply.code(404).send({ message: "No stored PPPoE password" });
    await audit("PPPOE_SECRET_REVEALED", "Client", id, actorFrom(request), { account: client.mikrotikAccount });
    return { account: client.mikrotikAccount, password: decryptNetworkSecret(client.pppoeSecretEncrypted) };
  });

  app.get("/network/migrations", { preHandler: requireRoles("ADMIN") }, async () => prisma.networkMigration.findMany({ include: { client: { select: { clientCode: true, fullName: true, area: true } }, fromDevice: true, toDevice: true }, orderBy: { createdAt: "desc" }, take: 200 }));

  app.post("/clients/:id/network/migrate", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = z.object({ toDeviceId: z.number().int().positive(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return reply.code(404).send({ message: "Client not found" });
    if (client.mikrotikDeviceId === input.toDeviceId) return reply.code(400).send({ message: "Subscriber is already assigned to that MikroTik." });
    if (!(await prisma.mikrotikDevice.findFirst({ where: { id: input.toDeviceId, isActive: true } }))) return reply.code(400).send({ message: "Destination MikroTik is invalid/inactive." });
    const migration = await prisma.networkMigration.create({ data: { clientId: id, fromDeviceId: client.mikrotikDeviceId, toDeviceId: input.toDeviceId, reason: input.reason, performedBy: actorFrom(request) } });
    try { await migrationRun(migration.id, actorFrom(request)); return await prisma.networkMigration.findUnique({ where: { id: migration.id }, include: { fromDevice: true, toDevice: true } }); }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Migration failed", migrationId: migration.id }); }
  });

  app.post("/network/migrations/:id/retry", { preHandler: requireRoles("ADMIN") }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    try { await migrationRun(id, actorFrom(request)); return { ok: true }; }
    catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Migration retry failed" }); }
  });

  app.get("/network/recommendations", { preHandler: requireRoles("ADMIN") }, async () => {
    const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const clients = await prisma.client.findMany({
      where: { mikrotikDeviceId: { not: null }, networkStatus: "ACTIVE", serviceStatus: { not: "INACTIVE" } },
      include: { mikrotikDevice: true, bills: { orderBy: { periodStart: "desc" }, take: Math.max(config.trustedQualificationMonths, config.trustedDowngradeUnpaidMonths, 12) } }
    });
    const trustedTargets = await prisma.mikrotikDevice.findMany({ where: { isActive: true, isTrustedTier: true, enforcementPolicy: "NO_AUTO_CUT" }, select: { id: true, name: true } });
    const standardTargets = await prisma.mikrotikDevice.findMany({ where: { isActive: true, enforcementPolicy: "WITH_CUT" }, select: { id: true, name: true } });
    const promote: any[] = [], downgrade: any[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const client of clients) {
      // A bill that is not due yet must not hurt a client's good-payer streak or trusted standing.
      const dueHistory = client.bills.filter(b => new Date(b.dueDate) < today);
      const pastDueOpen = dueHistory.filter(b => Number(b.balance) > 0);
      const firstNonPaid = dueHistory.findIndex(b => b.status !== "PAID" || Number(b.balance) > 0);
      const streak = firstNonPaid === -1 ? dueHistory.length : firstNonPaid;
      if (client.mikrotikDevice?.enforcementPolicy === "WITH_CUT" && pastDueOpen.length === 0 && streak >= config.trustedQualificationMonths && trustedTargets.length) {
        promote.push({ clientId: client.id, clientCode: client.clientCode, fullName: client.fullName, area: client.area, currentRouter: client.mikrotikDevice.name, paidStreak: streak, targets: trustedTargets });
      }
      if (client.mikrotikDevice?.enforcementPolicy === "NO_AUTO_CUT" && pastDueOpen.length >= config.trustedDowngradeUnpaidMonths && standardTargets.length) {
        downgrade.push({ clientId: client.id, clientCode: client.clientCode, fullName: client.fullName, area: client.area, currentRouter: client.mikrotikDevice.name, unpaidMonths: pastDueOpen.length, outstanding: pastDueOpen.reduce((sum,bill)=>sum+Number(bill.balance),0), targets: standardTargets });
      }
    }
    return { promote, downgrade, rules: { trustedQualificationMonths: config.trustedQualificationMonths, trustedDowngradeUnpaidMonths: config.trustedDowngradeUnpaidMonths } };
  });
};
