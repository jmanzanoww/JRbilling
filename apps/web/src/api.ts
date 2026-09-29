export const API_URL = import.meta.env.VITE_API_URL ?? "/api";

export function getAuthToken(): string | null {
  try { return localStorage.getItem("isp_auth_token"); } catch { return null; }
}
export function setAuthToken(token: string | null) {
  try { if (token) localStorage.setItem("isp_auth_token", token); else localStorage.removeItem("isp_auth_token"); } catch {}
}

async function request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (authenticated) {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await res.json().catch(() => ({ message: res.statusText }));
  if (!res.ok) {
    const error = new Error(payload?.message ?? res.statusText) as Error & { status?: number; payload?: unknown };
    error.status = res.status;
    error.payload = payload;
    if (res.status === 401) setAuthToken(null);
    throw error;
  }
  return payload as T;
}

export function api<T>(path: string, init?: RequestInit): Promise<T> { return request<T>(path, init, true); }
export function publicApi<T>(path: string, init?: RequestInit): Promise<T> { return request<T>(path, init, false); }

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(payload?.message ?? res.statusText) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.blob();
}
