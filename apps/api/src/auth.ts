import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

export type AuthUser = { id: number; username: string; displayName: string; role: "ADMIN" | "COLLECTOR" | "VIEWER" };

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${digest}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const candidate = scryptSync(pin, salt, 32);
  const expected = Buffer.from(digest, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await prisma.authSession.create({ data: { userId, tokenHash: tokenHash(raw), expiresAt } });
  return raw;
}

function bearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

export function currentUser(request: FastifyRequest): AuthUser | null {
  return ((request as FastifyRequest & { authUser?: AuthUser }).authUser ?? null);
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (currentUser(request)) return;
  const raw = bearerToken(request);
  if (!raw) {
    reply.code(401).send({ message: "Login required" });
    return;
  }
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(raw) },
    include: { user: true }
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    if (session) await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    reply.code(401).send({ message: "Session expired. Please log in again." });
    return;
  }
  (request as FastifyRequest & { authUser?: AuthUser }).authUser = {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    role: session.user.role
  };
}

export function requireRoles(...roles: AuthUser["role"][]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (reply.sent) return;
    const user = currentUser(request);
    if (!user || !roles.includes(user.role)) {
      reply.code(403).send({ message: "You do not have permission for this action." });
    }
  };
}

export async function revokeSession(request: FastifyRequest): Promise<void> {
  const raw = bearerToken(request);
  if (!raw) return;
  await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(raw) } });
}
