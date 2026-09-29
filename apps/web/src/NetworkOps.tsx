import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, CheckCircle2, Network, Plus, RefreshCcw, Router, ShieldCheck, Wifi, XCircle } from "lucide-react";
import { api } from "./api";
import { EmptyState, Metric, Notice, StatusBadge } from "./ui";
import type { AreaRouterDefaultRow, AuthUser, MikrotikDeviceRow, NetworkActivationClient, NetworkMigrationRow, NetworkRecommendations } from "./types";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

type Props = { authUser: AuthUser | null; live: boolean };

export default function NetworkOps({ authUser, live }: Props) {
  const isAdmin = authUser?.role === "ADMIN";
  const [devices, setDevices] = useState<MikrotikDeviceRow[]>([]);
  const [linkQueue, setLinkQueue] = useState<NetworkActivationClient[]>([]);
  const [queue, setQueue] = useState<NetworkActivationClient[]>([]);
  const [migrationRequired, setMigrationRequired] = useState<NetworkActivationClient[]>([]);
  const [migrations, setMigrations] = useState<NetworkMigrationRow[]>([]);
  const [recommendations, setRecommendations] = useState<NetworkRecommendations | null>(null);
  const [areaDefaults, setAreaDefaults] = useState<AreaRouterDefaultRow[]>([]);
  const [areaPlan, setAreaPlan] = useState<Record<string, number | "">>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    if (!live || !isAdmin) return;
    try {
      const [d, lq, q, mr, m, r, a] = await Promise.all([
        api<MikrotikDeviceRow[]>("/network/devices"), api<NetworkActivationClient[]>("/network/linking-queue"), api<NetworkActivationClient[]>("/network/activation-queue"), api<NetworkActivationClient[]>("/network/migration-required"),
        api<NetworkMigrationRow[]>("/network/migrations"), api<NetworkRecommendations>("/network/recommendations"), api<AreaRouterDefaultRow[]>("/network/area-defaults")
      ]);
      setDevices(d); setLinkQueue(lq); setQueue(q); setMigrationRequired(mr); setMigrations(m); setRecommendations(r); setAreaDefaults(a);
      const map: Record<string, number | ""> = {}; for (const row of a) map[row.area] = row.mapping?.mikrotikDeviceId ?? ""; setAreaPlan(map);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to load network operations."); }
  }
  useEffect(() => { void load(); }, [live, authUser?.id]);

  const activeDevices = useMemo(() => devices.filter(d => d.isActive), [devices]);

  async function addDevice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); setBusy(true);
    try {
      await api("/network/devices", { method: "POST", body: JSON.stringify({
        name: String(fd.get("name")), baseUrl: String(fd.get("baseUrl")), credentialKey: String(fd.get("credentialKey")),
        enforcementPolicy: String(fd.get("enforcementPolicy")), isTrustedTier: fd.get("isTrustedTier") === "on", isActive: true,
        notes: String(fd.get("notes") || "") || null
      }) });
      setShowAdd(false); setNotice("MikroTik device added. Add its credential variables to the server .env before testing."); await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to add MikroTik."); } finally { setBusy(false); }
  }

  async function testDevice(id: number) {
    try { const r = await api<any>(`/network/devices/${id}/test`, { method: "POST" }); setNotice(`${r.device} connected · RouterOS ${r.version ?? "unknown"} · ${r.boardName ?? "router"}`); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Connection test failed."); }
  }

  async function editDevice(device: MikrotikDeviceRow) {
    const baseUrl = prompt(`REST base URL for ${device.name}:`, device.baseUrl); if (!baseUrl) return;
    const credentialKey = prompt(`Credential key for ${device.name} (used as MIKROTIK_<KEY>_USER/PASSWORD):`, device.credentialKey); if (!credentialKey) return;
    const policy = prompt(`Enforcement policy for ${device.name}:\nWITH_CUT = grace/cut automation allowed\nNO_AUTO_CUT = trusted, never auto-cut\nMANUAL_ONLY = manual cut only`, device.enforcementPolicy);
    if (!policy || !["WITH_CUT", "NO_AUTO_CUT", "MANUAL_ONLY"].includes(policy)) return;
    const trustedRaw = prompt(`Trusted / good-payer tier? Type YES or NO.`, device.isTrustedTier ? "YES" : "NO");
    if (!trustedRaw || !["YES", "NO"].includes(trustedRaw.trim().toUpperCase())) return;
    const trusted = trustedRaw.trim().toUpperCase() === "YES";
    if (trusted && policy !== "NO_AUTO_CUT") { setNotice("Trusted tier must use NO_AUTO_CUT policy."); return; }
    const activeRaw = prompt(`Router active? Type YES or NO.`, device.isActive ? "YES" : "NO");
    if (!activeRaw || !["YES", "NO"].includes(activeRaw.trim().toUpperCase())) return;
    const active = activeRaw.trim().toUpperCase() === "YES";
    setBusy(true);
    try {
      await api(`/network/devices/${device.id}`, { method: "PATCH", body: JSON.stringify({ baseUrl, credentialKey, enforcementPolicy: policy, isTrustedTier: trusted, isActive: active }) });
      setNotice(`${device.name} policy updated. Existing billing history is unchanged.`);
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to update MikroTik policy."); } finally { setBusy(false); }
  }

  async function saveAreaDefaults() {
    setBusy(true);
    try { await api("/network/area-defaults", { method: "PUT", body: JSON.stringify({ mappings: areaDefaults.map(a => ({ area: a.area, mikrotikDeviceId: areaPlan[a.area] ? Number(areaPlan[a.area]) : null })) }) }); setNotice("Default MikroTik per area saved."); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Unable to save area mapping."); } finally { setBusy(false); }
  }

  async function linkExisting(client: NetworkActivationClient) {
    if (!activeDevices.length) { setNotice("Configure an active MikroTik device first."); return; }
    const defaultId = client.mikrotikDeviceId && activeDevices.some(d => d.id === client.mikrotikDeviceId) ? client.mikrotikDeviceId : activeDevices[0].id;
    const deviceRaw = prompt(`MikroTik device ID for ${client.fullName}:\n${activeDevices.map(d => `${d.id} = ${d.name} (${d.enforcementPolicy})`).join("\n")}`, String(defaultId)); if (!deviceRaw) return;
    const deviceId = Number(deviceRaw); if (!activeDevices.some(d => d.id === deviceId)) { setNotice("Invalid MikroTik device ID."); return; }
    const account = prompt("Existing PPPoE username on that MikroTik:", client.mikrotikAccount || ""); if (!account) return;
    const password = prompt("Optional: enter the current PPPoE password so future router migration can be automated. Leave blank if unknown.", "") || undefined;
    setBusy(true);
    try {
      const r = await api<{account:string;profile:string;networkStatus:string;passwordStored:boolean;device:{name:string}}>(`/clients/${client.id}/network/link-existing`, { method:"POST", body:JSON.stringify({ mikrotikDeviceId:deviceId, account, password }) });
      setNotice(`${client.fullName} linked to ${r.device.name} · ${r.account} · profile ${r.profile}. ${r.passwordStored?"Migration credential stored securely.":"Password not stored; enter it before any future router migration."}`);
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to link existing PPPoE account."); } finally { setBusy(false); }
  }

  async function activate(client: NetworkActivationClient) {
    if (!activeDevices.length) { setNotice("Add an active MikroTik device first."); return; }
    const defaultId = client.mikrotikDeviceId && activeDevices.some(d => d.id === client.mikrotikDeviceId) ? client.mikrotikDeviceId : activeDevices[0].id;
    const deviceRaw = prompt(`MikroTik device ID for ${client.fullName}:\n${activeDevices.map(d => `${d.id} = ${d.name} (${d.enforcementPolicy})`).join("\n")}`, String(defaultId)); if (!deviceRaw) return;
    const deviceId = Number(deviceRaw); if (!activeDevices.some(d => d.id === deviceId)) { setNotice("Invalid MikroTik device ID."); return; }
    const account = prompt("PPPoE username:", client.mikrotikAccount || client.clientCode.toLowerCase().replace(/[^a-z0-9]/g, "")); if (!account) return;
    const profile = prompt("MikroTik PPP profile:", client.mikrotikProfile || "default"); if (!profile) return;
    const password = prompt("PPPoE password (leave blank to auto-generate):", "") || undefined;
    setBusy(true);
    try {
      const r = await api<{password:string;generated:boolean;device:{name:string}}>(`/clients/${client.id}/network/activate`, { method: "POST", body: JSON.stringify({ mikrotikDeviceId: deviceId, account, profile, password }) });
      setNotice(`Activated ${client.fullName} on ${r.device.name}. PPPoE password: ${r.password}${r.generated ? " (generated)" : ""}. Save/configure this on the client CPE.`); await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Activation failed."); } finally { setBusy(false); }
  }

  async function migrate(item: { clientId:number; fullName:string; targets:Array<{id:number;name:string}> }, defaultReason: string) {
    if (!item.targets.length) return;
    const raw = prompt(`Destination MikroTik ID for ${item.fullName}:\n${item.targets.map(t => `${t.id} = ${t.name}`).join("\n")}`, String(item.targets[0].id)); if (!raw) return;
    const toDeviceId = Number(raw); if (!item.targets.some(t => t.id === toDeviceId)) { setNotice("Choose one of the recommended destination routers."); return; }
    const reason = prompt("Migration reason:", defaultReason); if (!reason) return;
    setBusy(true);
    try { await api(`/clients/${item.clientId}/network/migrate`, { method: "POST", body: JSON.stringify({ toDeviceId, reason }) }); setNotice(`${item.fullName} migrated successfully.`); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Migration failed."); } finally { setBusy(false); }
  }

  async function moveRequired(client: NetworkActivationClient) {
    const targets = activeDevices.filter((d) => d.id !== client.mikrotikDeviceId).map((d) => ({ id: d.id, name: d.name }));
    if (!targets.length) { setNotice("Add another active MikroTik before migrating this subscriber."); return; }
    await migrate({ clientId: client.id, fullName: client.fullName, targets }, `Area/network assignment changed · ${client.area}`);
  }

  async function retryMigration(id: number) { setBusy(true); try { await api(`/network/migrations/${id}/retry`, { method: "POST" }); setNotice(`Migration #${id} retried successfully.`); await load(); } catch(e){ setNotice(e instanceof Error?e.message:"Retry failed."); } finally { setBusy(false); } }

  if (!live) return <section className="panel"><EmptyState title="Network operations require live mode" description="MikroTik provisioning and migration are intentionally disabled in demo mode."/></section>;
  if (!isAdmin) return <section className="panel"><EmptyState title="Admin access required" description="Only administrators can provision or migrate subscriber network accounts."/></section>;

  return <div className="space-y-5">
    {notice && <Notice>{notice}</Notice>}
    <section className="panel">
      <div className="section-header"><div><h2 className="section-title">MikroTik devices</h2><p className="section-description">Multiple routers can use different enforcement policies. Credentials are referenced from server environment variables per device.</p></div><div className="section-actions"><button onClick={()=>void load()} className="action-btn"><RefreshCcw size={15}/>Refresh</button><button onClick={()=>setShowAdd(v=>!v)} className="primary-btn"><Plus size={15}/>Add MikroTik</button></div></div>
      {showAdd && <form onSubmit={addDevice} className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-2 xl:grid-cols-3"><label className="field-label">Name<input name="name" className="field mt-1 w-full" placeholder="MT-01 Standard" required/></label><label className="field-label">REST base URL<input name="baseUrl" className="field mt-1 w-full" placeholder="https://192.168.88.1" required/></label><label className="field-label">Credential key<input name="credentialKey" className="field mt-1 w-full" placeholder="MT1" required/></label><label className="field-label">Enforcement policy<select name="enforcementPolicy" className="field mt-1 w-full"><option value="WITH_CUT">With Cut</option><option value="NO_AUTO_CUT">No Auto Cut</option><option value="MANUAL_ONLY">Manual Only</option></select></label><label className="check-row mt-6"><input type="checkbox" name="isTrustedTier"/><span>Trusted / good-payer tier</span></label><label className="field-label md:col-span-2 xl:col-span-3">Notes<input name="notes" className="field mt-1 w-full"/></label><button disabled={busy} className="primary-btn md:col-span-2 xl:col-span-3">Save device</button></form>}
      <div className="overflow-x-auto"><table className="data-table min-w-[850px]"><thead><tr><th>Router</th><th>Policy</th><th>Tier</th><th>Credential env key</th><th>Subscribers</th><th>Status</th><th></th></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td><b>{d.name}</b><div className="text-xs text-slate-500">{d.baseUrl}</div></td><td><StatusBadge value={d.enforcementPolicy}/></td><td>{d.isTrustedTier?"Trusted":"Standard"}</td><td className="font-mono text-xs">MIKROTIK_{d.credentialKey.toUpperCase()}_*</td><td>{d._count?.clients??0}</td><td><StatusBadge value={d.isActive?"ACTIVE":"INACTIVE"}/></td><td><div className="flex gap-2"><button onClick={()=>void testDevice(d.id)} className="btn-ghost">Test</button><button disabled={busy} onClick={()=>void editDevice(d)} className="btn-ghost">Edit policy</button></div></td></tr>)}{!devices.length&&<tr><td colSpan={7}><EmptyState title="No MikroTik devices yet" description="Add each router separately, then map areas and provision subscribers."/></td></tr>}</tbody></table></div>
    </section>

    <section className="panel p-4"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">Area → default MikroTik</h3><p className="mt-1 text-sm text-slate-500">New subscribers are suggested/assigned to the area's default router but remain For Activation until an admin provisions PPPoE.</p></div><button disabled={busy} onClick={()=>void saveAreaDefaults()} className="action-btn">Save mapping</button></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{areaDefaults.map(a=><label key={a.area} className="field-label">{a.area}<select value={areaPlan[a.area]??""} onChange={e=>setAreaPlan(p=>({...p,[a.area]:Number(e.target.value)||""}))} className="field mt-1 w-full"><option value="">No default router</option>{activeDevices.map(d=><option key={d.id} value={d.id}>{d.name} · {d.enforcementPolicy.replaceAll("_"," ")}</option>)}</select></label>)}</div></section>

    <section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Existing Subscribers to Link</h2><p className="section-description">Imported real clients already have internet service. Link each record to its existing PPPoE account; this does not create or change the router secret.</p></div><Metric label="Waiting" value={linkQueue.length} tone={linkQueue.length?"warning":"neutral"}/></div><div className="overflow-x-auto"><table className="data-table min-w-[900px]"><thead><tr><th>Subscriber</th><th>Area</th><th>Suggested router</th><th>Status</th><th></th></tr></thead><tbody>{linkQueue.map(c=><tr key={c.id}><td><b>{c.fullName}</b><div className="text-xs text-slate-500">{c.clientCode}</div></td><td>{c.area}</td><td>{c.mikrotikDevice?.name??"Unassigned"}</td><td><StatusBadge value="FOR_LINKING"/></td><td><button disabled={busy} onClick={()=>void linkExisting(c)} className="action-btn"><Wifi size={14}/>Link existing PPPoE</button></td></tr>)}{!linkQueue.length&&<tr><td colSpan={5}><EmptyState title="Existing-link queue is clear" description="Imported subscribers waiting to be matched to their current MikroTik PPPoE account will appear here."/></td></tr>}</tbody></table></div></section>

    <section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">For Activation</h2><p className="section-description">Saving a subscriber does not create a router account. Provisioning is a separate audited admin action.</p></div><Metric label="Waiting" value={queue.length}/></div><div className="overflow-x-auto"><table className="data-table min-w-[850px]"><thead><tr><th>Subscriber</th><th>Area</th><th>Suggested router</th><th>Network status</th><th></th></tr></thead><tbody>{queue.map(c=><tr key={c.id}><td><b>{c.fullName}</b><div className="text-xs text-slate-500">{c.clientCode}</div></td><td>{c.area}</td><td>{c.mikrotikDevice?.name??"—"}</td><td><StatusBadge value={c.networkStatus??"FOR_ACTIVATION"}/></td><td><button disabled={busy} onClick={()=>void activate(c)} className="primary-btn">Activate PPPoE</button></td></tr>)}{!queue.length&&<tr><td colSpan={5}><EmptyState title="Activation queue is clear" description="New clients that are not yet provisioned will appear here."/></td></tr>}</tbody></table></div></section>

    <section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Migration Required</h2><p className="section-description">Active subscribers whose area now points to a different router stay on their current MikroTik until Admin explicitly migrates them.</p></div><Metric label="Waiting" value={migrationRequired.length} tone={migrationRequired.length?"warning":"neutral"}/></div><div className="overflow-x-auto"><table className="data-table min-w-[820px]"><thead><tr><th>Subscriber</th><th>Area</th><th>Current router</th><th>Status</th><th></th></tr></thead><tbody>{migrationRequired.map(c=><tr key={c.id}><td><b>{c.fullName}</b><div className="text-xs text-slate-500">{c.clientCode}</div></td><td>{c.area}</td><td>{c.mikrotikDevice?.name??"—"}</td><td><StatusBadge value="MIGRATION_REQUIRED"/></td><td><button disabled={busy} onClick={()=>void moveRequired(c)} className="action-btn"><ArrowRightLeft size={14}/>Move router</button></td></tr>)}{!migrationRequired.length&&<tr><td colSpan={5}><EmptyState title="No required migrations" description="Area changes that point an active subscriber to another default router will appear here."/></td></tr>}</tbody></table></div></section>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Eligible for trusted router</h2><p className="section-description">Recommendation only. Admin decides whether to move a consistently paid-up subscriber.</p></div><ShieldCheck size={18} className="text-slate-400"/></div><div className="divide-y divide-[var(--border)]">{recommendations?.promote.map(r=><div key={r.clientId} className="flex items-center justify-between gap-4 p-4"><div><b>{r.fullName}</b><div className="text-xs text-slate-500">{r.area} · {r.currentRouter} · {r.paidStreak} paid month streak</div></div><button onClick={()=>void migrate(r,`Good payer · ${r.paidStreak} paid months`)} className="action-btn"><ArrowRightLeft size={14}/>Move</button></div>)}{!recommendations?.promote.length&&<EmptyState title="No trusted-tier candidates" description={`Requires ${recommendations?.rules.trustedQualificationMonths??"configured"} consecutive paid due periods and no past-due balance.`}/>}</div></section>
      <section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Trusted watchlist</h2><p className="section-description">Trusted/no-cut clients with repeated unpaid months can be returned to a standard With Cut router.</p></div><XCircle size={18} className="text-slate-400"/></div><div className="divide-y divide-[var(--border)]">{recommendations?.downgrade.map(r=><div key={r.clientId} className="flex items-center justify-between gap-4 p-4"><div><b>{r.fullName}</b><div className="text-xs text-slate-500">{r.unpaidMonths} unpaid month(s) · {peso.format(r.outstanding)} · {r.currentRouter}</div></div><button onClick={()=>void migrate(r,`${r.unpaidMonths} unpaid months on trusted router`)} className="action-btn"><ArrowRightLeft size={14}/>Return</button></div>)}{!recommendations?.downgrade.length&&<EmptyState title="Trusted watchlist is clear" description={`Review starts at ${recommendations?.rules.trustedDowngradeUnpaidMonths??"configured"} past-due unpaid month(s).`}/>}</div></section>
    </div>

    <section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Router migration history</h2><p className="section-description">Moves keep the same billing history and PPPoE credentials; only the assigned MikroTik changes.</p></div><Network size={18} className="text-slate-400"/></div><div className="overflow-x-auto"><table className="data-table min-w-[900px]"><thead><tr><th>Subscriber</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>{migrations.map(m=><tr key={m.id}><td>{m.client?.fullName??`Client #${m.clientId}`}</td><td>{m.fromDevice?.name??"Not provisioned"}</td><td>{m.toDevice?.name??m.toDeviceId}</td><td>{m.reason}</td><td><StatusBadge value={m.status}/>{m.errorMessage&&<div className="mt-1 max-w-xs text-xs text-rose-300">{m.errorMessage}</div>}</td><td>{m.status==="FAILED"&&<button disabled={busy} onClick={()=>void retryMigration(m.id)} className="btn-ghost">Retry</button>}</td></tr>)}{!migrations.length&&<tr><td colSpan={6}><EmptyState title="No router migrations yet" description="Approved moves between standard and trusted MikroTik devices will be recorded here."/></td></tr>}</tbody></table></div></section>
  </div>;
}
