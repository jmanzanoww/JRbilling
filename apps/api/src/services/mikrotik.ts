import { prisma } from "../prisma.js";

type RouterRecord = { ".id"?: string; name?: string; disabled?: string; profile?: string; service?: string } & Record<string, unknown>;
type DeviceShape = { id: number; name: string; baseUrl: string; credentialKey: string; isActive: boolean };

function envKey(device: DeviceShape, suffix: "USER" | "PASSWORD") {
  const safe = device.credentialKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return `MIKROTIK_${safe}_${suffix}`;
}

async function loadDevice(deviceId: number): Promise<DeviceShape> {
  const device = await prisma.mikrotikDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw new Error("MikroTik device not found");
  if (!device.isActive) throw new Error(`MikroTik device '${device.name}' is inactive`);
  return device;
}

async function routerFetch(deviceId: number, path: string, init?: RequestInit) {
  const config = await prisma.systemConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (!config.mikrotikEnabled) throw new Error("MikroTik integration is disabled");
  const device = await loadDevice(deviceId);
  const username = process.env[envKey(device, "USER")];
  const password = process.env[envKey(device, "PASSWORD")];
  if (!username || password == null) throw new Error(`${envKey(device, "USER")} / ${envKey(device, "PASSWORD")} are missing in .env`);
  const base = device.baseUrl.replace(/\/$/, "");
  if (base.startsWith("http://") && process.env.MIKROTIK_ALLOW_INSECURE_HTTP !== "true") {
    throw new Error("HTTP MikroTik access is blocked. Use HTTPS, or explicitly allow insecure HTTP for an isolated test LAN.");
  }
  const response = await fetch(`${base}/rest/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(`MikroTik ${device.name} returned HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function testMikrotikConnection(deviceId: number) {
  const device = await loadDevice(deviceId);
  const data = await routerFetch(deviceId, "system/resource");
  const resource = Array.isArray(data) ? data[0] : data;
  return { ok: true, deviceId, device: device.name, boardName: resource?.["board-name"], version: resource?.version, uptime: resource?.uptime };
}

async function findByName(deviceId: number, menu: string, name: string): Promise<RouterRecord | null> {
  const rows = await routerFetch(deviceId, menu) as RouterRecord[];
  return Array.isArray(rows) ? rows.find((row) => row.name === name) ?? null : null;
}

export async function lookupPppoeAccount(deviceId: number, account: string) {
  const secret = await findByName(deviceId, "ppp/secret", account);
  if (!secret?.[".id"]) throw new Error(`PPPoE secret '${account}' was not found on the selected MikroTik`);
  return {
    account: String(secret.name ?? account),
    profile: String(secret.profile ?? "default"),
    service: String(secret.service ?? "pppoe"),
    enabled: String(secret.disabled ?? "no").toLowerCase() !== "yes"
  };
}

export async function setPppoeEnabled(deviceId: number, account: string, enabled: boolean) {
  const secret = await findByName(deviceId, "ppp/secret", account);
  if (!secret?.[".id"]) throw new Error(`PPPoE secret '${account}' was not found on the selected MikroTik`);
  await routerFetch(deviceId, `ppp/secret/${encodeURIComponent(secret[".id"])}`, { method: "PATCH", body: JSON.stringify({ disabled: enabled ? "no" : "yes" }) });
  if (!enabled) {
    const activeRows = await routerFetch(deviceId, "ppp/active") as RouterRecord[];
    const matches = Array.isArray(activeRows) ? activeRows.filter((row) => row.name === account && row[".id"]) : [];
    for (const row of matches) await routerFetch(deviceId, `ppp/active/${encodeURIComponent(String(row[".id"]))}`, { method: "DELETE" });
  }
  return { ok: true, deviceId, account, enabled };
}

export async function provisionPppoeAccount(deviceId: number, input: { account: string; password: string; profile: string; enabled?: boolean }) {
  const existing = await findByName(deviceId, "ppp/secret", input.account);
  const body = { name: input.account, password: input.password, profile: input.profile, service: "pppoe", disabled: input.enabled === false ? "yes" : "no" };
  if (existing?.[".id"]) {
    await routerFetch(deviceId, `ppp/secret/${encodeURIComponent(existing[".id"])}`, { method: "PATCH", body: JSON.stringify(body) });
    return { ok: true, created: false, account: input.account, deviceId };
  }
  await routerFetch(deviceId, "ppp/secret", { method: "PUT", body: JSON.stringify(body) });
  return { ok: true, created: true, account: input.account, deviceId };
}

export async function removePppoeAccount(deviceId: number, account: string) {
  const secret = await findByName(deviceId, "ppp/secret", account);
  if (!secret?.[".id"]) return { ok: true, removed: false, account, deviceId };
  const activeRows = await routerFetch(deviceId, "ppp/active") as RouterRecord[];
  for (const row of Array.isArray(activeRows) ? activeRows.filter((r) => r.name === account && r[".id"]) : []) {
    await routerFetch(deviceId, `ppp/active/${encodeURIComponent(String(row[".id"]))}`, { method: "DELETE" });
  }
  await routerFetch(deviceId, `ppp/secret/${encodeURIComponent(secret[".id"])}`, { method: "DELETE" });
  return { ok: true, removed: true, account, deviceId };
}
