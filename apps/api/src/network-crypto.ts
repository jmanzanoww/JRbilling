import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.NETWORK_SECRET_KEY;
  if (!raw || raw.length < 16) throw new Error("NETWORK_SECRET_KEY must be set to a strong server-only secret (16+ characters).");
  return createHash("sha256").update(raw).digest();
}

export function encryptNetworkSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptNetworkSecret(value: string): string {
  const [version, ivPart, tagPart, dataPart] = value.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) throw new Error("Stored PPPoE secret has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

export function generatePppoePassword(): string {
  return randomBytes(12).toString("base64url").replace(/[-_]/g, "7").slice(0, 14);
}
