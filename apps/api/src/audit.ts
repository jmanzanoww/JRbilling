import type { FastifyRequest } from "fastify";
import { currentUser } from "./auth.js";
import { prisma } from "./prisma.js";

export function actorFrom(request: FastifyRequest): string {
  const user = currentUser(request);
  return user?.displayName || user?.username || "System";
}

export async function audit(action: string, entityType: string, entityId: string | number | null, actor: string, details?: unknown) {
  await prisma.auditLog.create({
    data: {
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      actor,
      details: details == null ? undefined : (JSON.parse(JSON.stringify(details)) as any)
    }
  });
}
