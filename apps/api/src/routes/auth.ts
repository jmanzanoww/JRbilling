import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, createSession, currentUser, hashPin, revokeSession, verifyPin } from "../auth.js";
import { prisma } from "../prisma.js";
import { audit } from "../audit.js";

const pinSchema = z.string().regex(/^\d{4,8}$/, "PIN must be 4 to 8 digits");
const failedLogins = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
const lockKey = (username: string, ip: string) => `${username.toLowerCase()}|${ip}`;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/status", async () => {
    const [totalUsers, securedUsers] = await Promise.all([prisma.user.count(), prisma.user.count({ where: { pinHash: { not: null } } })]);
    return { needsBootstrap: totalUsers === 0 || securedUsers === 0, legacySecurityUpgrade: totalUsers > 0 && securedUsers === 0 };
  });

  app.post("/auth/bootstrap", async (request, reply) => {
    const [totalUsers, securedUsers] = await Promise.all([prisma.user.count(), prisma.user.count({ where: { pinHash: { not: null } } })]);
    if (totalUsers > 0 && securedUsers > 0) return reply.code(409).send({ message: "System already has a secured administrator." });
    const input = z.object({
      username: z.string().trim().min(2).max(50).regex(/^[a-zA-Z0-9._-]+$/),
      displayName: z.string().trim().min(2).max(100),
      pin: pinSchema
    }).parse(request.body);
    const existing = await prisma.user.findUnique({ where: { username: input.username } });
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { displayName: input.displayName, pinHash: hashPin(input.pin), role: "ADMIN", isActive: true } })
      : await prisma.user.create({ data: { username: input.username, displayName: input.displayName, pinHash: hashPin(input.pin), role: "ADMIN" } });
    const token = await createSession(user.id);
    await audit("ADMIN_BOOTSTRAPPED", "User", user.id, user.displayName, { username: user.username });
    return reply.code(201).send({ token, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  });

  app.post("/auth/login", async (request, reply) => {
    const input = z.object({ username: z.string().trim().min(1), pin: pinSchema }).parse(request.body);
    const key = lockKey(input.username, request.ip);
    let attempt = failedLogins.get(key);
    const now = Date.now();
    if (attempt && attempt.lockedUntil > now) return reply.code(429).send({ message: "Too many failed attempts. Try again in 15 minutes." });
    if (attempt && now - attempt.firstAt > 15 * 60 * 1000) { failedLogins.delete(key); attempt = undefined; }
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user || !user.isActive || !user.pinHash || !verifyPin(input.pin, user.pinHash)) {
      const count = (attempt?.count ?? 0) + 1;
      failedLogins.set(key, { count, firstAt: attempt?.firstAt ?? now, lockedUntil: count >= 5 ? now + 15 * 60 * 1000 : 0 });
      return reply.code(401).send({ message: "Invalid username or PIN." });
    }
    failedLogins.delete(key);
    const token = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit("LOGIN", "User", user.id, user.displayName);
    return { token, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } };
  });

  app.get("/auth/me", { preHandler: authenticate }, async (request) => currentUser(request));

  app.post("/auth/logout", { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    await revokeSession(request);
    if (user) await audit("LOGOUT", "User", user.id, user.displayName);
    return { ok: true };
  });

  app.post("/auth/change-pin", { preHandler: authenticate }, async (request, reply) => {
    const input = z.object({ currentPin: pinSchema, newPin: pinSchema }).parse(request.body);
    const auth = currentUser(request)!;
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user || !user.pinHash || !verifyPin(input.currentPin, user.pinHash)) return reply.code(400).send({ message: "Current PIN is incorrect." });
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: hashPin(input.newPin) } });
    await prisma.authSession.deleteMany({ where: { userId: user.id } });
    await audit("PIN_CHANGED", "User", user.id, user.displayName);
    return { ok: true, reloginRequired: true };
  });
};
