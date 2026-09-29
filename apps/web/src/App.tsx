import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, CalendarClock, CheckCircle2, CircleDollarSign, ClipboardList, DatabaseBackup, FileSpreadsheet,
  History, LayoutDashboard, LockKeyhole, LogOut, MessageSquareText, Phone, Plus, Power, Printer, ReceiptText, RefreshCcw,
  Router, Save, Search, Send, Settings, ShieldCheck, Signal, UserCog, UserRound, Users, WalletCards, Wifi, X, ChevronDown, ChevronRight
} from "lucide-react";
import { api, API_URL, publicApi, setAuthToken } from "./api";
import FieldCollectionOps, { type FieldCollectionView } from "./FieldCollectionOps";
import NetworkOps, { type NetworkView } from "./NetworkOps";
import { EmptyState, LoadingState, Metric, StatusBadge } from "./ui";
import { Dialog } from "./components/ui";
import { demoClients, demoDashboard, demoLedgers } from "./demo";
import type {
  AuditRow, AuthResponse, AuthUser, BackupFileRow, ClientRow, Dashboard, Ledger, LedgerBill, MessageRow, OperatorUser, PaymentMethod, Receipt,
  RouterJobRow, StatementOfAccount, SystemConfig, UserRole
} from "./types";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const money = (value: unknown) => Number(value ?? 0);
const dateOnly = (value: string) => dateFmt.format(new Date(value));
const todayInput = () => new Date().toISOString().slice(0, 10);

type Tab = "Dashboard" | "Clients" | "Billing" | "Field Collection" | "Collections" | "Service" | "Network" | "Subscriber Maintenance" | "User Maintenance" | "Import" | "Admin";
type ModalName = "payment" | "extend" | "service" | "edit" | "receipt" | "soa" | "newClient" | "newUser" | "editUser" | "message" | null;
type CollectionRow = { id: number; receiptNo: string; paidAt: string; amount: number | string; method: PaymentMethod; receivedBy?: string | null; approvedBy?: string | null; client: { id: number; clientCode: string; fullName: string; area: string } };
type ConfirmAction =
  | { type: "SUBSCRIBER_STATUS"; client: ClientRow; inactive: boolean }
  | { type: "SUBSCRIBER_DELETE"; client: ClientRow }
  | { type: "REAL_DATA_IMPORT" }
  | { type: "RESTORE_BACKUP" }
  | null;
type PinAction = { type: "RESET_USER"; user: OperatorUser } | { type: "CHANGE_OWN" } | null;
type RealDataPreview = { sheet: string; year: number; month: number; readyCount: number; reviewCount: number; areaMappings: { MIKROTIK_1: readonly string[]; MIKROTIK_2: readonly string[] }; unassignedAreas: string[]; reviewRows: Array<{ sourceRow:number; area:string; fullName:string; dueDay:number|null; monthlyRate:number|null; legacyStatus:string; legacyNote:string; reason:string }> };

const nav: { key: Tab; icon: typeof LayoutDashboard; label: string }[] = [
  { key: "Dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { key: "Clients", icon: Users, label: "Subscribers" },
  { key: "Billing", icon: CalendarClock, label: "Billing" },
  { key: "Field Collection", icon: ClipboardList, label: "Field Collection" },
  { key: "Collections", icon: WalletCards, label: "Collections" },
  { key: "Service", icon: Signal, label: "Service Actions" },
  { key: "Network", icon: Router, label: "Network" },
  { key: "Subscriber Maintenance", icon: UserCog, label: "Subscriber Maintenance" },
  { key: "User Maintenance", icon: Users, label: "User Maintenance" },
  { key: "Import", icon: FileSpreadsheet, label: "Data Import" },
  { key: "Admin", icon: Settings, label: "System Settings" }
];

const navGroups: { label: string; keys: Tab[] }[] = [
  { label: "Overview", keys: ["Dashboard"] },
  { label: "Billing & Collection", keys: ["Billing", "Field Collection", "Collections"] },
  { label: "Subscriber Operations", keys: ["Clients", "Service"] },
  { label: "Network Operations", keys: ["Network"] },
  { label: "Maintenance", keys: ["Subscriber Maintenance", "User Maintenance", "Import"] },
  { label: "System", keys: ["Admin"] }
];

function normalizeLedger(raw: Ledger): Ledger {
  const bills = (raw.bills ?? []).map((b) => ({ ...b, amountDue: money(b.amountDue), balance: money(b.balance) }));
  return {
    ...raw,
    monthlyRate: money(raw.monthlyRate),
    creditBalance: money(raw.creditBalance),
    outstanding: bills.reduce((sum, b) => sum + money(b.balance), 0),
    openBills: bills.filter((b) => money(b.balance) > 0).length,
    bills,
    payments: (raw.payments ?? []).map((p) => ({ ...p, amount: money(p.amount), allocations: (p.allocations ?? []).map((a) => ({ ...a, amount: money(a.amount) })) })),
    serviceActions: (raw.serviceActions ?? []).map((s) => ({ ...s, outstandingAtAction: money(s.outstandingAtAction) })),
    creditTransactions: (raw.creditTransactions ?? []).map((c) => ({ ...c, amount: money(c.amount), balanceAfter: money(c.balanceAfter) }))
  };
}

function Status({ value }: { value: string }) { return <StatusBadge value={value}/>; }

function Card({ title, value, note, icon: Icon }: { title: string; value: string; note: string; icon: typeof Users }) {
  return <div className="metric"><div className="metric-icon"><Icon size={20}/></div><div className="metric-label">{title}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="dialog-backdrop"><div className={`dialog ${wide ? "max-w-4xl" : "max-w-xl"}`}><div className="dialog-header"><h3 className="dialog-title">{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close dialog" title="Close"><X size={17}/></button></div><div className="dialog-body">{children}</div></div></div>;
}

function ClientFormFields({ client }: { client?: Ledger | ClientRow | null }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <label className="field-label block sm:col-span-2">Full name<input name="fullName" defaultValue={client?.fullName ?? ""} className="field mt-1 w-full" required/></label>
    <label className="field-label block">Primary mobile<input name="primaryMobile" defaultValue={client?.primaryMobile ?? ""} className="field mt-1 w-full" placeholder="09xxxxxxxxx"/></label>
    <label className="field-label block">Alternate mobile<input name="alternateMobile" defaultValue={client?.alternateMobile ?? ""} className="field mt-1 w-full"/></label>
    <label className="field-label block">Area / Barangay<input name="area" defaultValue={client?.area ?? ""} className="field mt-1 w-full" required/></label>
    <label className="field-label block">Default due day<input name="dueDay" type="number" min="1" max="31" defaultValue={client?.dueDay ?? 15} className="field mt-1 w-full" required/></label>
    <label className="field-label block">Monthly rate<input name="monthlyRate" type="number" min="1" step="0.01" defaultValue={client?.monthlyRate ?? 1000} className="field mt-1 w-full" required/></label>
    <label className="field-label block">Installation date<input name="installedAt" type="date" defaultValue={client?.installedAt ? String(client.installedAt).slice(0,10) : ""} className="field mt-1 w-full"/></label>
    <div className="notice notice-info sm:col-span-2">Network account is provisioned separately from the Network → For Activation page. Saving a client never creates a MikroTik account automatically.</div>
    <label className="field-label block sm:col-span-2">Address<input name="address" defaultValue={client?.address ?? ""} className="field mt-1 w-full"/></label>
    <label className="field-label block sm:col-span-2">Notes<textarea name="notes" defaultValue={client?.notes ?? ""} className="field mt-1 min-h-20 w-full"/></label>
    <label className="check-row sm:col-span-2 text-sm"><input name="allowNotifications" type="checkbox" defaultChecked={client?.allowNotifications !== false} className="mt-1"/><span><b className="text-slate-900">Allow billing notifications</b><span className="mt-1 block text-xs text-slate-500">Used later for SMS/payment reminders.</span></span></label>
  </div>;
}

function soaForDemo(ledger: Ledger): StatementOfAccount {
  return {
    generatedAt: new Date().toISOString(),
    client: { id: ledger.id, clientCode: ledger.clientCode, fullName: ledger.fullName, primaryMobile: ledger.primaryMobile, area: ledger.area, address: ledger.address, dueDay: ledger.dueDay, monthlyRate: ledger.monthlyRate, creditBalance: money(ledger.creditBalance), serviceStatus: ledger.serviceStatus },
    openBills: ledger.bills.filter((b)=>money(b.balance)>0), recentPayments: ledger.payments.slice(0,20), outstanding: ledger.outstanding,
    netDue: Math.max(0, ledger.outstanding - money(ledger.creditBalance))
  };
}

function printStatement(soa: StatementOfAccount) {
  const w = window.open("", "_blank", "width=840,height=900"); if (!w) return;
  const rows = soa.openBills.map(b=>{const ext=b.extensions?.[0];return `<tr><td>${b.periodLabel}</td><td>${dateOnly(b.dueDate)}</td><td>${ext?dateOnly(ext.extensionUntil):"—"}</td><td style="text-align:right">${peso.format(money(b.amountDue))}</td><td style="text-align:right">${peso.format(money(b.balance))}</td></tr>`}).join("");
  w.document.write(`<!doctype html><html><head><title>SOA - ${soa.client.fullName}</title><style>body{font-family:Arial,sans-serif;padding:34px;color:#111}h1{font-size:22px;margin:0}small{color:#666}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}.totals{margin-top:22px;margin-left:auto;width:320px}.line{display:flex;justify-content:space-between;padding:6px 0}.net{font-size:20px;font-weight:700;border-top:2px solid #111;margin-top:8px;padding-top:10px}</style></head><body><h1>Statement of Account</h1><small>Generated ${dateTimeFmt.format(new Date(soa.generatedAt))}</small><p><b>${soa.client.fullName}</b><br>${soa.client.clientCode} · ${soa.client.area}<br>${soa.client.primaryMobile ?? ""}</p><table><thead><tr><th>Billing Period</th><th>Billing Due</th><th>Extension Until</th><th style="text-align:right">Bill</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No open bills.</td></tr>`}</tbody></table><div class="totals"><div class="line"><span>Outstanding</span><b>${peso.format(soa.outstanding)}</b></div><div class="line"><span>Advance credit</span><b>-${peso.format(soa.client.creditBalance)}</b></div><div class="line net"><span>NET AMOUNT DUE</span><span>${peso.format(soa.netDue)}</span></div></div><script>window.print()</script></body></html>`); w.document.close();
}

function printReceipt(receipt: Receipt) {
  const creditAdded = (receipt.creditTransactions ?? []).reduce((s,x)=>s+money(x.amount),0);
  const w = window.open("", "_blank", "width=520,height=760"); if (!w) return;
  const allocations = receipt.allocations.map(a=>`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${a.bill.periodLabel}</span><span>${peso.format(money(a.amount))}</span></div>`).join("");
  w.document.write(`<!doctype html><html><head><title>${receipt.receiptNo}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#111}.r{display:flex;justify-content:space-between;margin:6px 0}.dash{border-top:1px dashed #999;margin:18px 0}</style></head><body><h2 style="text-align:center;margin-bottom:3px">ISP Billing Receipt</h2><div style="text-align:center;color:#666;font-size:12px">Payment acknowledgement</div><div class="dash"></div><div class="r"><span>Receipt</span><b>${receipt.receiptNo}</b></div><div class="r"><span>Client</span><b>${receipt.client.fullName}</b></div><div class="r"><span>Date</span><span>${dateTimeFmt.format(new Date(receipt.paidAt))}</span></div><div class="dash"></div>${allocations}${creditAdded>0?`<div class="r"><span>Advance credit added</span><span>${peso.format(creditAdded)}</span></div>`:""}<div class="dash"></div><div class="r" style="font-size:18px"><b>TOTAL PAID</b><b>${peso.format(money(receipt.amount))}</b></div><div class="r"><span>Method</span><span>${receipt.method.replaceAll("_"," ")}</span></div><div class="r"><span>Received by</span><span>${receipt.receivedBy ?? "Local Admin"}</span></div><div class="r"><span>Approved by</span><span>${receipt.approvedBy ?? receipt.receivedBy ?? "Local Admin"}</span></div><script>window.print()</script></body></html>`); w.document.close();
}

export default function App() {
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [fieldCollectionView, setFieldCollectionView] = useState<FieldCollectionView>("ROUTE");
  const [networkView, setNetworkView] = useState<NetworkView>("DEVICES");
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard>(clone(demoDashboard));
  const [clients, setClients] = useState<ClientRow[]>(clone(demoClients));
  const [demoLedgerState, setDemoLedgerState] = useState<Record<number, Ledger>>(()=>clone(demoLedgers));
  const [live, setLive] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Ledger | null>(null);
  const [maintenanceTarget, setMaintenanceTarget] = useState<ClientRow | null>(null);
  const [userTarget, setUserTarget] = useState<OperatorUser | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [soa, setSoa] = useState<StatementOfAccount | null>(null);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [operator, setOperator] = useState("Local Admin");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [settings, setSettings] = useState<SystemConfig | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [routerJobs, setRouterJobs] = useState<RouterJobRow[]>([]);
  const [backups, setBackups] = useState<BackupFileRow[]>([]);
  const [automationMessage, setAutomationMessage] = useState("");
  const [file, setFile] = useState<File | null>(null); const [importMessage, setImportMessage] = useState("");
  const [realDataPreview, setRealDataPreview] = useState<RealDataPreview | null>(null);
  const now = new Date(); const [importYear,setImportYear]=useState(now.getFullYear()); const [importMonth,setImportMonth]=useState(now.getMonth()+1);
  const [billYear,setBillYear]=useState(now.getFullYear()); const [billMonth,setBillMonth]=useState(now.getMonth()+1); const [billingMessage,setBillingMessage]=useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [pinAction, setPinAction] = useState<PinAction>(null);

  async function refresh() {
    if (backendOnline && !authUser) return;
    try {
      const [d,c,recent] = await Promise.all([api<Dashboard>("/dashboard"),api<ClientRow[]>("/clients"),api<CollectionRow[]>("/collections?limit=50")]);
      setDashboard(d); setClients(c.map(x=>({...x,monthlyRate:money(x.monthlyRate),creditBalance:money(x.creditBalance),outstanding:money(x.outstanding)}))); setCollections(recent); setLive(true);
    } catch (err) { if ((err as any)?.status===401) setAuthUser(null); setLive(false); }
  }
  async function refreshAdmin() { if(!live || authUser?.role!=="ADMIN") return; try { const [u,a,c,m,r,b]=await Promise.all([api<OperatorUser[]>("/users"),api<AuditRow[]>("/audit?limit=100"),api<SystemConfig>("/settings"),api<MessageRow[]>("/messages?limit=100"),api<RouterJobRow[]>("/router-jobs?limit=100"),api<BackupFileRow[]>("/admin/backups")]); setUsers(u); setAudits(a); setSettings(c); setMessages(m); setRouterJobs(r); setBackups(b); } catch {} }
  async function boot() {
    try {
      const status=await publicApi<{needsBootstrap:boolean}>("/auth/status"); setBackendOnline(true); setNeedsBootstrap(status.needsBootstrap);
      try { const me=await api<AuthUser>("/auth/me"); setAuthUser(me); setOperator(me.displayName); setLive(true); } catch { setAuthUser(null); setLive(false); }
    } catch { setBackendOnline(false); setLive(false); } finally { setAuthReady(true); }
  }
  useEffect(()=>{ void boot(); },[]);
  useEffect(()=>{ if(authUser) void refresh(); },[authUser]);
  useEffect(()=>{ if(tab==="Admin"||tab==="User Maintenance") void refreshAdmin(); },[tab,live,authUser]);
  useEffect(()=>{ if(authUser) setOperator(authUser.displayName); },[authUser]);
  useEffect(()=>{
    if(authUser?.role==="COLLECTOR"){
      setFieldCollectionView("MY_ROUTE");
    }else if(authUser?.role==="ADMIN" && (fieldCollectionView==="MY_ROUTE"||fieldCollectionView==="MY_SUBMISSIONS")){
      setFieldCollectionView("ROUTE");
    }
  },[authUser?.role]);

  const filtered=useMemo(()=>clients.filter(c=>`${c.clientCode} ${c.fullName} ${c.area} ${c.primaryMobile??""} ${c.mikrotikAccount??""}`.toLowerCase().includes(q.toLowerCase())),[clients,q]);
  const operationalFiltered=useMemo(()=>filtered.filter(c=>c.serviceStatus!=="INACTIVE"),[filtered]);
  const serviceClients=useMemo(()=>clients.filter(c=>["EXTENDED","FOR_CUT","CUT","RECONNECTED"].includes(c.serviceStatus)),[clients]);
  const demoPayments=useMemo(()=>Object.values(demoLedgerState).flatMap(l=>l.payments.map(p=>({...p,clientName:l.fullName,clientCode:l.clientCode}))).sort((a,b)=>+new Date(b.paidAt)-+new Date(a.paidAt)),[demoLedgerState]);
  const currentOpenBills = selected?.bills.filter(b=>money(b.balance)>0) ?? [];

  async function openClient(client: ClientRow) {
    setNotice("");
    try { setSelected(live ? normalizeLedger(await api<Ledger>(`/clients/${client.id}/ledger`)) : normalizeLedger(clone(demoLedgerState[client.id] ?? ({...client,bills:[],payments:[],dueDateChanges:[],serviceActions:[],creditTransactions:[]} as Ledger)))); }
    catch(err){setNotice(err instanceof Error?err.message:"Unable to load subscriber.");}
  }
  function syncDemo(next: Ledger) { const n=normalizeLedger(next); setDemoLedgerState(p=>({...p,[n.id]:n})); setClients(p=>p.map(c=>c.id===n.id?{...c,...n,outstanding:n.outstanding,openBills:n.openBills}:c)); setSelected(n); }
  async function reloadSelected() { if(!selected)return; if(live){setSelected(normalizeLedger(await api<Ledger>(`/clients/${selected.id}/ledger`)));await refresh();}else setSelected(normalizeLedger(clone(demoLedgerState[selected.id]))); }

  async function submitClient(e:FormEvent<HTMLFormElement>, isEdit=false){
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const payload={
      fullName:String(fd.get("fullName")),
      primaryMobile:String(fd.get("primaryMobile")||"")||null,
      alternateMobile:String(fd.get("alternateMobile")||"")||null,
      area:String(fd.get("area")),
      address:String(fd.get("address")||"")||null,
      dueDay:Number(fd.get("dueDay")),
      monthlyRate:Number(fd.get("monthlyRate")),
      installedAt:fd.get("installedAt")?`${String(fd.get("installedAt"))}T12:00:00`:null,
      notes:String(fd.get("notes")||"")||null,
      allowNotifications:fd.get("allowNotifications")==="on"
    };
    const target=isEdit?(maintenanceTarget??selected):null;
    setBusy(true);
    setNotice("");
    try{
      if(live){
        if(isEdit&&target){
          await api(`/clients/${target.id}`,{method:"PATCH",body:JSON.stringify(payload)});
          await refresh();
          if(selected?.id===target.id) await reloadSelected();
        }else{
          await api("/clients",{method:"POST",body:JSON.stringify(payload)});
          await refresh();
        }
      }else if(isEdit&&target){
        setClients(p=>p.map(c=>c.id===target.id?{...c,...payload,installedAt:payload.installedAt??null}:c));
        if(demoLedgerState[target.id]) setDemoLedgerState(p=>({...p,[target.id]:{...p[target.id],...payload,installedAt:payload.installedAt??null}}));
      }else{
        const id=Math.max(0,...clients.map(c=>c.id))+1;
        const row:ClientRow={id,clientCode:`ISP-${String(id).padStart(5,"0")}`,...payload,installedAt:payload.installedAt??null,creditBalance:0,serviceStatus:"ACTIVE",networkStatus:"FOR_ACTIVATION",outstanding:0,openBills:0};
        setClients(p=>[...p,row]);
        setDemoLedgerState(p=>({...p,[id]:{...row,bills:[],payments:[],dueDateChanges:[],serviceActions:[],creditTransactions:[]}}));
      }
      setModal(null);
      setMaintenanceTarget(null);
      setNotice(isEdit?"Subscriber master record updated.":"New subscriber master record created.");
    }catch(err){
      setNotice(err instanceof Error?err.message:"Unable to save subscriber.");
    }finally{
      setBusy(false);
    }
  }

  function openMaintenanceEdit(client: ClientRow){
    setMaintenanceTarget(client);
    setModal("edit");
  }

  async function setSubscriberMaintenanceStatus(client: ClientRow, inactive: boolean){
    setConfirmAction({ type: "SUBSCRIBER_STATUS", client, inactive });
  }

  async function deleteSubscriberMaintenance(client: ClientRow){
    setConfirmAction({ type: "SUBSCRIBER_DELETE", client });
  }

  async function executeConfirmAction(){
    if(!confirmAction)return;
    setBusy(true);
    try{
      if(confirmAction.type==="SUBSCRIBER_STATUS"){
        const {client,inactive}=confirmAction;
        if(live){
          await api(`/clients/${client.id}/maintenance-status`,{method:"PATCH",body:JSON.stringify({inactive})});
          await refresh();
        }else{
          setClients(p=>p.map(c=>c.id===client.id?{...c,serviceStatus:inactive?"INACTIVE":"ACTIVE"}:c));
        }
        setNotice(`Subscriber ${inactive?"deactivated":"reactivated"} in Maintenance.`);
      }else if(confirmAction.type==="SUBSCRIBER_DELETE"){
        const client=confirmAction.client;
        if(live){
          await api(`/clients/${client.id}`,{method:"DELETE"});
          await refresh();
        }else{
          setClients(p=>p.filter(c=>c.id!==client.id));
        }
        setNotice("Unused subscriber master record deleted.");
      }else if(confirmAction.type==="REAL_DATA_IMPORT"){
        const r=await api<{created:number;updated:number;total:number;paid:number;unpaid:number;cut:number;reviewRows:RealDataPreview["reviewRows"];unassignedAreas:string[];note:string}>("/import/real-data/bootstrap",{method:"POST"});
        setImportMessage(`Real data loaded: ${r.total} clients (${r.created} new, ${r.updated} updated). ${r.paid} marked paid, ${r.unpaid} open/unpaid, ${r.cut} cut. ${r.reviewRows.length} incomplete rows remain for manual review. ${r.note}`);
        await refresh();
        await previewBundledRealData();
      }else if(confirmAction.type==="RESTORE_BACKUP"){
        if(!restoreFile)throw new Error("Choose a JSON backup first.");
        const backup=JSON.parse(await restoreFile.text());
        await api("/admin/restore",{method:"POST",body:JSON.stringify({confirm:"RESTORE",backup})});
        setNotice("Backup restored successfully. Please sign in again.");
        setAuthToken(null);setAuthUser(null);setLive(false);await boot();
      }
      setConfirmAction(null);
    }catch(err){
      const message=err instanceof Error?err.message:"Action failed.";
      if(confirmAction.type==="REAL_DATA_IMPORT")setImportMessage(message);else setNotice(message);
    }finally{
      setBusy(false);
    }
  }

  async function submitPayment(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selected)return;const fd=new FormData(e.currentTarget);const amount=Number(fd.get("amount"));const method=String(fd.get("method")) as PaymentMethod;const referenceNo=String(fd.get("referenceNo")||"").trim();const notes=String(fd.get("notes")||"").trim();if(amount<=0)return;setBusy(true);setNotice("");try{if(live){const r=await api<{payment:{id:number}}>(`/clients/${selected.id}/payments`,{method:"POST",body:JSON.stringify({amount,method,referenceNo:referenceNo||undefined,notes:notes||undefined})});setReceipt(await api<Receipt>(`/payments/${r.payment.id}/receipt`));await reloadSelected();}else{const next=clone(selected);let remaining=amount;const allocations:Receipt["allocations"]=[];for(const bill of [...next.bills].sort((a,b)=>+new Date(a.periodStart)-+new Date(b.periodStart))){if(remaining<=0)break;const bal=money(bill.balance);if(bal<=0)continue;const applied=Math.min(bal,remaining);bill.balance=bal-applied;bill.status=money(bill.balance)<=0?"PAID":"PARTIAL";remaining-=applied;allocations.push({amount:applied,bill:{periodLabel:bill.periodLabel,amountDue:bill.amountDue,balance:bill.balance}});}const id=Date.now(),paidAt=new Date().toISOString(),receiptNo=`OR-${paidAt.slice(0,10).replaceAll("-","")}-${String(id).slice(-4)}`;if(remaining>0){next.creditBalance=money(next.creditBalance)+remaining;next.creditTransactions=[{id:id+1,type:"ADVANCE_PAYMENT",amount:remaining,balanceAfter:next.creditBalance,notes:"Advance payment",createdAt:paidAt},...(next.creditTransactions??[])];}next.payments.unshift({id,receiptNo,paidAt,amount,method,referenceNo:referenceNo||null,notes:notes||null,receivedBy:operator,allocations:allocations.map((a,i)=>({id:i,amount:a.amount,bill:{id:i,periodLabel:a.bill.periodLabel}}))});syncDemo(next);setReceipt({id,receiptNo,paidAt,amount,method,referenceNo:referenceNo||null,notes:notes||null,receivedBy:operator,client:{clientCode:next.clientCode,fullName:next.fullName,primaryMobile:next.primaryMobile,area:next.area,address:next.address,creditBalance:next.creditBalance},allocations,creditTransactions:remaining>0?[{amount:remaining,balanceAfter:next.creditBalance}]:[]});setDashboard(d=>({...d,collected:d.collected+amount,outstanding:Math.max(0,d.outstanding-Math.min(amount,selected.outstanding)),availableCredit:money(d.availableCredit)+Math.max(0,remaining),netReceivable:Math.max(0,money(d.netReceivable)-Math.min(amount,selected.outstanding))}));}setModal("receipt");}catch(err){setNotice(err instanceof Error?err.message:"Payment failed.");}finally{setBusy(false);}}

  async function submitExtension(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selected)return;const fd=new FormData(e.currentTarget);const billId=Number(fd.get("billId")),extensionDate=String(fd.get("extensionUntil")),reason=String(fd.get("reason")||"").trim(),notes=String(fd.get("notes")||"").trim();const bill=selected.bills.find(b=>b.id===billId);if(!bill||!extensionDate||!reason)return;setBusy(true);try{if(live){await api(`/clients/${selected.id}/extend`,{method:"POST",body:JSON.stringify({billId,extensionUntil:`${extensionDate}T12:00:00`,reason,notes:notes||undefined})});await reloadSelected();}else{const next=clone(selected);const extension={id:Date.now(),billId,clientId:next.id,extensionUntil:new Date(`${extensionDate}T12:00:00`).toISOString(),reason,notes:notes||null,approvedBy:operator,createdAt:new Date().toISOString()};const target=next.bills.find(b=>b.id===billId)!;target.extensions=[extension,...(target.extensions??[])];next.billExtensions=[extension,...(next.billExtensions??[])];next.serviceActions.unshift({id:Date.now()+1,type:"EXTEND",effectiveAt:new Date().toISOString(),previousStatus:next.serviceStatus,nextStatus:"EXTENDED",outstandingAtAction:next.outstanding,reason,performedBy:operator});next.serviceStatus="EXTENDED";syncDemo(next);}setModal(null);setNotice(`Extension saved until ${dateOnly(new Date(`${extensionDate}T12:00:00`).toISOString())}. Regular due day remains Day ${selected.dueDay}.`);}catch(err){setNotice(err instanceof Error?err.message:"Extension failed.");}finally{setBusy(false);}}

  async function submitService(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selected)return;const fd=new FormData(e.currentTarget);const type=String(fd.get("type")),reason=String(fd.get("reason")||"").trim(),notes=String(fd.get("notes")||"").trim(),newDueDay=fd.get("newDueDay")?Number(fd.get("newDueDay")):undefined;setBusy(true);try{if(live){const r=await api<{routerJob?:{id:number;status:string;attempts:number;lastError:string|null}|null}>(`/clients/${selected.id}/service-action`,{method:"POST",body:JSON.stringify({type,reason:reason||undefined,notes:notes||undefined,newDueDay,syncRouter:true})});await reloadSelected();if(r.routerJob)setNotice(r.routerJob.status==="SUCCEEDED"?`Service saved. Router sync succeeded (job #${r.routerJob.id}).`:`Service saved; router job #${r.routerJob.id} is ${r.routerJob.status.toLowerCase()}${r.routerJob.lastError?`: ${r.routerJob.lastError}`:"."}`);}else{const next=clone(selected);const nextStatus=({MARK_FOR_CUT:"FOR_CUT",CUT:"CUT",RECONNECT:"RECONNECTED",ACTIVATE:"ACTIVE",DEACTIVATE:"INACTIVE"} as Record<string,any>)[type];next.serviceActions.unshift({id:Date.now(),type,effectiveAt:new Date().toISOString(),previousStatus:next.serviceStatus,nextStatus,outstandingAtAction:next.outstanding,reason:reason||null,notes:notes||null,performedBy:operator});next.serviceStatus=nextStatus;if(type==="RECONNECT"&&newDueDay)next.dueDay=newDueDay;syncDemo(next);}setModal(null);if(!live)setNotice("Service action saved. Billing balances were not changed.");}catch(err){setNotice(err instanceof Error?err.message:"Service action failed.");}finally{setBusy(false);}}

  async function openSoa(){if(!selected)return;try{const result=live?await api<StatementOfAccount>(`/clients/${selected.id}/soa`):soaForDemo(selected);setSoa(result);setModal("soa");}catch(err){setNotice(err instanceof Error?err.message:"Unable to create SOA.");}}

  async function generateBills(){setBillingMessage("");try{if(live){const r=await api<{created:number;skipped:number;creditsApplied:number}>("/billing/generate",{method:"POST",body:JSON.stringify({year:billYear,month:billMonth})});setBillingMessage(`Created ${r.created}; skipped ${r.skipped}; advance credit auto-applied ${peso.format(r.creditsApplied)}.`);await refresh();}else setBillingMessage("Demo preview: live MySQL mode is required to generate bills for every subscriber.");}catch(err){setBillingMessage(err instanceof Error?err.message:"Generation failed.");}}
  async function importExcel(){if(!file){setImportMessage("Choose the Excel file first.");return;}if(!live){setImportMessage("Excel import writes to MySQL; start the API/database first.");return;}const form=new FormData();form.append("file",file);try{const r=await api<{imported:number;skipped:number;warnings:string[]}>(`/import/excel?year=${importYear}&month=${importMonth}&sheetName=${encodeURIComponent("paid for this month")}`,{method:"POST",body:form});setImportMessage(`Imported ${r.imported}; skipped ${r.skipped}. ${r.warnings.length?`${r.warnings.length} row(s) need balance review.`:""}`);await refresh();}catch(err){setImportMessage(err instanceof Error?err.message:"Import failed.");}}
  async function previewBundledRealData(){if(!live){setImportMessage("Start the API/database first.");return;}try{const r=await api<RealDataPreview>("/import/real-data/preview");setRealDataPreview(r);setImportMessage(`Ready to import ${r.readyCount} complete client records. ${r.reviewCount} incomplete row(s) will stay in review and will not be guessed.`);}catch(err){setImportMessage(err instanceof Error?err.message:"Unable to load real-data preview.");}}
  async function bootstrapBundledRealData(){if(!live){setImportMessage("Start the API/database first.");return;}setConfirmAction({type:"REAL_DATA_IMPORT"});}

  async function createUser(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const payload={username:String(fd.get("username")),displayName:String(fd.get("displayName")),role:String(fd.get("role")) as UserRole,pin:String(fd.get("pin")),isActive:true};setBusy(true);try{if(live){await api("/users",{method:"POST",body:JSON.stringify(payload)});await refreshAdmin();}else setUsers(p=>[...p,{id:Date.now(),...payload}]);setModal(null);}catch(err){setNotice(err instanceof Error?err.message:"Unable to create operator.");}finally{setBusy(false);}}
  async function editUser(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!userTarget)return;
    const fd=new FormData(e.currentTarget);
    const payload={
      displayName:String(fd.get("displayName")),
      role:String(fd.get("role")) as UserRole
    };
    setBusy(true);
    try{
      if(live){
        await api(`/users/${userTarget.id}`,{method:"PATCH",body:JSON.stringify(payload)});
        await refreshAdmin();
      }else{
        setUsers(p=>p.map(u=>u.id===userTarget.id?{...u,...payload}:u));
      }
      setModal(null);
      setUserTarget(null);
      setNotice("User account updated.");
    }catch(err){
      setNotice(err instanceof Error?err.message:"Unable to update user.");
    }finally{
      setBusy(false);
    }
  }

  async function toggleUser(u:OperatorUser){if(live){await api(`/users/${u.id}`,{method:"PATCH",body:JSON.stringify({isActive:!u.isActive})});await refreshAdmin();}else setUsers(p=>p.map(x=>x.id===u.id?{...x,isActive:!x.isActive}:x));}
  async function resetUserPin(u:OperatorUser){setPinAction({type:"RESET_USER",user:u});}
  async function downloadBackup(){if(!live){setNotice("Backup requires live MySQL mode.");return;}const data=await api<any>("/admin/backup");const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`isp-billing-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}
  async function restoreBackup(){if(!live||!restoreFile){setNotice(!live?"Restore requires live MySQL mode.":"Choose a JSON backup first.");return;}setConfirmAction({type:"RESTORE_BACKUP"});}

  async function submitAuth(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);setBusy(true);setNotice("");try{const payload=needsBootstrap?{username:String(fd.get("username")),displayName:String(fd.get("displayName")),pin:String(fd.get("pin"))}:{username:String(fd.get("username")),pin:String(fd.get("pin"))};const result=await publicApi<AuthResponse>(needsBootstrap?"/auth/bootstrap":"/auth/login",{method:"POST",body:JSON.stringify(payload)});setAuthToken(result.token);setAuthUser(result.user);setOperator(result.user.displayName);setNeedsBootstrap(false);setLive(true);}catch(err){setNotice(err instanceof Error?err.message:"Login failed.");}finally{setBusy(false);}}
  async function logout(){try{if(live)await api("/auth/logout",{method:"POST"});}catch{}setAuthToken(null);setAuthUser(null);setLive(false);setSelected(null);setTab("Dashboard");}
  async function changeOwnPin(){setPinAction({type:"CHANGE_OWN"});}

  async function submitPinAction(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!pinAction)return;
    const fd=new FormData(e.currentTarget);
    setBusy(true);
    try{
      if(pinAction.type==="RESET_USER"){
        const pin=String(fd.get("newPin")||"");
        const confirmPin=String(fd.get("confirmPin")||"");
        if(!/^\d{4,8}$/.test(pin))throw new Error("PIN must be 4–8 digits.");
        if(pin!==confirmPin)throw new Error("PIN and confirmation do not match.");
        await api(`/users/${pinAction.user.id}`,{method:"PATCH",body:JSON.stringify({pin})});
        setNotice(`PIN reset for ${pinAction.user.displayName}. Their existing sessions were revoked.`);
        await refreshAdmin();
      }else{
        const currentPin=String(fd.get("currentPin")||"");
        const newPin=String(fd.get("newPin")||"");
        const confirmPin=String(fd.get("confirmPin")||"");
        if(!/^\d{4,8}$/.test(newPin))throw new Error("New PIN must be 4–8 digits.");
        if(newPin!==confirmPin)throw new Error("New PIN and confirmation do not match.");
        await api("/auth/change-pin",{method:"POST",body:JSON.stringify({currentPin,newPin})});
        setNotice("PIN changed. Please sign in again.");
        setAuthToken(null);setAuthUser(null);setLive(false);
      }
      setPinAction(null);
    }catch(err){setNotice(err instanceof Error?err.message:"Unable to update PIN.");}
    finally{setBusy(false);}
  }
  async function saveSettings(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!settings)return;const fd=new FormData(e.currentTarget);const payload={autoBillingEnabled:fd.get("autoBillingEnabled")==="on",messagingEnabled:fd.get("messagingEnabled")==="on",reminderDaysBefore:Number(fd.get("reminderDaysBefore")),overdueReminderDays:Number(fd.get("overdueReminderDays")),smsProvider:String(fd.get("smsProvider")),smsWebhookUrl:String(fd.get("smsWebhookUrl")||"")||null,mikrotikEnabled:fd.get("mikrotikEnabled")==="on",routerRetryEnabled:fd.get("routerRetryEnabled")==="on",routerRetryMinutes:Number(fd.get("routerRetryMinutes")),autoReconnectOnPayment:fd.get("autoReconnectOnPayment")==="on",defaultGraceDays:Number(fd.get("defaultGraceDays")),dueDateReminderEnabled:fd.get("dueDateReminderEnabled")==="on",graceReminderEnabled:fd.get("graceReminderEnabled")==="on",finalWarningEnabled:fd.get("finalWarningEnabled")==="on",autoCutAfterGrace:fd.get("autoCutAfterGrace")==="on",trustedQualificationMonths:Number(fd.get("trustedQualificationMonths")),trustedDowngradeUnpaidMonths:Number(fd.get("trustedDowngradeUnpaidMonths")),automaticBackupEnabled:fd.get("automaticBackupEnabled")==="on",backupHour:Number(fd.get("backupHour")),backupRetentionDays:Number(fd.get("backupRetentionDays"))};setBusy(true);try{setSettings(await api<SystemConfig>("/settings",{method:"PATCH",body:JSON.stringify(payload)}));setNotice("Automation and integration settings saved.");await refreshAdmin();}catch(err){setNotice(err instanceof Error?err.message:"Unable to save settings.");}finally{setBusy(false);}}
  async function runAutomation(){setAutomationMessage("");try{const r=await api<any>("/automation/run",{method:"POST"});setAutomationMessage(`Automation complete: ${r.billing?.created??0} bill(s), ${r.reminders?.queued??0} reminder(s), ${r.enforcement?.forCut??0} marked for cut, ${r.enforcement?.cut??0} auto-cut, ${r.messages?.sent??0} SMS sent, ${r.router?.succeeded??0} router job(s) synced${r.backup?.created?", backup created":""}.`);await refresh();await refreshAdmin();}catch(err){setAutomationMessage(err instanceof Error?err.message:"Automation failed.");}}
  async function testRouter(){setAutomationMessage("");try{const r=await api<any>("/mikrotik/test",{method:"POST"});setAutomationMessage(`MikroTik connected: ${r.boardName??"router"} · RouterOS ${r.version??"unknown"}.`);}catch(err){setAutomationMessage(err instanceof Error?err.message:"MikroTik test failed.");}}
  async function queueReminders(){try{const r=await api<{queued:number;skipped:number}>("/messages/queue-reminders",{method:"POST"});setAutomationMessage(`Queued ${r.queued} reminder(s); skipped ${r.skipped}.`);await refreshAdmin();}catch(err){setAutomationMessage(err instanceof Error?err.message:"Unable to queue reminders.");}}
  async function processMessages(){try{const r=await api<{processed:number;sent:number;failed:number;skipped:number}>("/messages/process",{method:"POST"});setAutomationMessage(`Message queue: ${r.sent} sent, ${r.failed} failed, ${r.skipped} preview/skipped.`);await refreshAdmin();}catch(err){setAutomationMessage(err instanceof Error?err.message:"Unable to process messages.");}}
  async function processRouterQueue(){try{const r=await api<{processed:number;succeeded:number;retried:number;failed:number}>("/router-jobs/process",{method:"POST"});setAutomationMessage(`Router queue: ${r.succeeded} synced, ${r.retried} scheduled for retry, ${r.failed} terminal failure(s).`);await refreshAdmin();}catch(err){setAutomationMessage(err instanceof Error?err.message:"Unable to process router queue.");}}
  async function retryRouterJobUi(id:number){try{await api(`/router-jobs/${id}/retry`,{method:"POST"});setAutomationMessage(`Router job #${id} reset for retry.`);await refreshAdmin();}catch(err){setAutomationMessage(err instanceof Error?err.message:"Unable to retry router job.");}}
  async function runAutomaticBackup(){try{const r=await api<{created:boolean;fileName?:string}>("/admin/backup/run",{method:"POST"});setAutomationMessage(r.created?`Backup created: ${r.fileName}`:"Backup was not created.");await refreshAdmin();}catch(err){setAutomationMessage(err instanceof Error?err.message:"Unable to create backup.");}}
  async function sendManualMessage(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selected)return;const fd=new FormData(e.currentTarget);const body=String(fd.get("body")||"").trim();if(!body)return;setBusy(true);try{if(live){await api(`/clients/${selected.id}/messages`,{method:"POST",body:JSON.stringify({body})});await reloadSelected();}else{const next=clone(selected);next.messages=[{id:Date.now(),channel:"SMS",destination:next.primaryMobile||"demo",templateKey:"MANUAL",body,status:"QUEUED",createdAt:new Date().toISOString()},...(next.messages??[])];syncDemo(next);}setModal(null);setNotice("Message queued. External sending depends on the configured SMS provider.");}catch(err){setNotice(err instanceof Error?err.message:"Unable to queue message.");}finally{setBusy(false);}}

  const canCollect=!live || authUser?.role==="ADMIN" || authUser?.role==="COLLECTOR";
  const isAdmin=!live || authUser?.role==="ADMIN";
  const visibleNav = nav.filter(n=>isAdmin||(!(n.key==="Admin"||n.key==="Import"||n.key==="Network"||n.key==="Subscriber Maintenance"||n.key==="User Maintenance")&&!(authUser?.role==="VIEWER"&&n.key==="Field Collection")));
  const fieldCollectionMenu: Array<{key:FieldCollectionView;label:string}> = isAdmin
    ? [
        {key:"ROUTE",label:"Route Planner"},
        {key:"EXCEPTIONS",label:"Client Exceptions"},
        {key:"SHEETS",label:"Collector Sheets"},
        {key:"APPROVALS",label:"Payment Approvals"}
      ]
    : authUser?.role==="COLLECTOR"
      ? [
          {key:"MY_ROUTE",label:"My Route"},
          {key:"MY_SUBMISSIONS",label:"My Submissions"}
        ]
      : [];
  const networkMenu: Array<{key:NetworkView;label:string}> = [
    {key:"DEVICES",label:"MikroTik Devices"},
    {key:"AREA_MAPPING",label:"Area Mapping"},
    {key:"LINKING",label:"Existing PPPoE Linking"},
    {key:"ACTIVATION",label:"Activation Queue"},
    {key:"MIGRATION_REQUIRED",label:"Migration Required"},
    {key:"TRUSTED",label:"Trusted Router"},
    {key:"HISTORY",label:"Migration History"}
  ];
  const fieldCollectionLabel=fieldCollectionMenu.find(item=>item.key===fieldCollectionView)?.label??"Field Collection";
  const networkLabel=networkMenu.find(item=>item.key===networkView)?.label??"Network";
  const pageLabel=selected?.fullName??(tab==="Field Collection"?fieldCollectionLabel:tab==="Network"?networkLabel:nav.find(item=>item.key===tab)?.label??tab);

  if(!authReady) return <div className="flex min-h-screen items-center justify-center text-slate-300"><div className="panel p-6">Loading ISP Billing...</div></div>;
  if(backendOnline&&!authUser) return <div className="flex min-h-screen items-center justify-center p-4 text-slate-100"><div className="panel w-full max-w-sm p-6"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center text-[var(--accent)]"><LockKeyhole size={23}/></div><div><h1 className="text-xl font-bold">{needsBootstrap?"Create system admin":"ISP Billing Login"}</h1><p className="text-sm text-slate-500">Secure local administration</p></div></div>{notice&&<div className="mt-5 rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">{notice}</div>}<form onSubmit={submitAuth} className="mt-6 space-y-4">{needsBootstrap&&<label className="field-label block">Display name<input name="displayName" className="field mt-1 w-full" required/></label>}<label className="field-label block">Username<input name="username" autoComplete="username" className="field mt-1 w-full" required/></label><label className="field-label block">PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} autoComplete={needsBootstrap?"new-password":"current-password"} className="field mt-1 w-full" required/></label><button disabled={busy} className="primary-btn w-full"><LockKeyhole size={16}/>{busy?"Please wait...":needsBootstrap?"Create admin & sign in":"Sign in"}</button></form><p className="mt-5 text-xs leading-5 text-slate-500">PIN is stored as a salted hash. Sessions expire after 12 hours.</p></div></div>;

  return <div className="admin-shell min-h-screen text-slate-100"><aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-64 px-4 py-5 lg:block"><div className="flex items-center gap-3 px-1 py-1"><div className="brand-mark"><Wifi size={19}/></div><div><div className="text-lg font-bold tracking-tight text-slate-900">JR Billing</div><div className="text-xs text-slate-500">ISP Administration</div></div></div><div className="mt-5 space-y-5">{navGroups.map(group=>{const items=visibleNav.filter(n=>group.keys.includes(n.key));if(!items.length)return null;return <div key={group.label}><div className="nav-group-label">{group.label}</div><div className="mt-1 space-y-1">{items.map(n=><button key={n.key} onClick={()=>{setTab(n.key);setSelected(null)}} className={`nav-item ${tab===n.key?"nav-item-active":""}`}><n.icon size={17}/>{n.label}</button>)}</div></div>})}</div><div className="system-status-card absolute bottom-5 left-4 right-4"><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">System status</div><div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${live?"text-[#039855]":"text-[#dc6803]"}`}><span className={`h-2 w-2 rounded-full ${live?"bg-emerald-500":"bg-amber-500"}`}/>{live?"Live MySQL":"Interactive demo"}</div></div></aside>

    <main className="lg:ml-64"><header className="admin-topbar sticky top-0 z-20 border-b px-4 py-3 md:px-6"><div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4"><div className="flex min-w-0 flex-1 items-center gap-4"><div className="admin-topbar-search hidden sm:block"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){setTab("Clients");setSelected(null)}}} placeholder="Search subscriber, area, mobile..."/></div><div className="topbar-page hidden xl:block">{selected?selected.fullName:tab}</div></div><div className="flex items-center gap-2">{live&&authUser?<><button onClick={()=>void refresh()} className="icon-btn" aria-label="Refresh data" title="Refresh data"><RefreshCcw size={17}/></button><button onClick={()=>void changeOwnPin()} title="Change PIN" className="icon-btn"><LockKeyhole size={17}/></button><div className="hidden h-9 w-9 items-center justify-center rounded-full bg-[#eef2ff] text-sm font-bold text-[#465fff] sm:flex">{authUser.displayName.trim().slice(0,1).toUpperCase()}</div><div className="admin-user-box hidden px-1 py-1 text-left sm:block"><div className="text-sm font-semibold text-slate-900">{authUser.displayName}</div><div className="text-[11px] text-slate-500">{authUser.role}</div></div><button onClick={()=>void logout()} title="Log out" className="icon-btn"><LogOut size={17}/></button></>:<><div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#dc6803]">Demo Mode</div><button onClick={()=>void refresh()} className="icon-btn" aria-label="Refresh data" title="Refresh data"><RefreshCcw size={17}/></button></>}</div></div></header>
    <nav className="mobile-nav lg:hidden" aria-label="Primary navigation"><div className="mobile-nav-inner">{visibleNav.map(n=><button key={n.key} onClick={()=>{setTab(n.key);setSelected(null)}} className={`nav-item ${tab===n.key?"nav-item-active":""}`}><n.icon size={15}/>{n.label}</button>)}</div></nav>

    <div className="admin-content mx-auto max-w-[1680px] p-4 md:p-6">{notice&&<div className="notice notice-info mb-4">{notice}</div>}
      {selected ? <div className="space-y-5"><button onClick={()=>setSelected(null)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={16}/>Back to subscribers</button><section className="panel p-5 md:p-6"><div className="flex flex-col justify-between gap-5 xl:flex-row"><div className="flex gap-4"><div className="pt-1 text-[var(--text-3)]"><UserRound size={21}/></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{selected.fullName}</h2><Status value={selected.serviceStatus}/>{selected.networkStatus&&<Status value={selected.networkStatus}/>}</div><p className="mt-1 text-sm text-slate-500">{selected.clientCode} · {selected.area}</p><p className="mt-2 flex items-center gap-2 text-sm text-slate-300"><Phone size={14}/>{selected.primaryMobile||"No mobile number yet"}</p></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-6"><button disabled={!isAdmin} onClick={()=>setModal("payment")} className="primary-btn disabled:opacity-40" title={isAdmin?"Record an official direct payment":"Collectors submit payments from Field Collection for admin approval"}><WalletCards size={16}/>{isAdmin?"Pay":"Approval flow"}</button><button disabled={!canCollect} onClick={()=>setModal("extend")} className="action-btn disabled:opacity-40"><CalendarClock size={16}/>Extend</button><button disabled={!isAdmin} onClick={()=>setModal("service")} className="action-btn disabled:opacity-40"><Power size={16}/>Service</button><button onClick={()=>void openSoa()} className="action-btn"><Printer size={16}/>SOA</button><button disabled={!canCollect} onClick={()=>setModal("message")} className="action-btn disabled:opacity-40"><Send size={16}/>Message</button>{isAdmin&&<button onClick={()=>{setMaintenanceTarget(selected);setSelected(null);setTab("Subscriber Maintenance");setModal("edit")}} className="action-btn"><UserCog size={16}/>Maintenance</button>}</div></div><div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-7"><Metric label="Outstanding" value={peso.format(selected.outstanding)} tone="warning"/><Metric label="Advance credit" value={peso.format(money(selected.creditBalance))} tone="info"/><Metric label="Net due" value={peso.format(Math.max(0,selected.outstanding-money(selected.creditBalance)))}/><Metric label="Monthly rate" value={peso.format(selected.monthlyRate)}/><Metric label="Default due" value={`Day ${selected.dueDay}`}/><Metric label="Network" value={(selected.networkStatus??"FOR_ACTIVATION").replaceAll("_"," ")}/><Metric label="Router" value={selected.mikrotikDevice?.name??"Not assigned"}/></div></section>
        <section className="panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h3 className="font-semibold">Billing ledger</h3><p className="mt-1 text-sm text-slate-500">Billing due dates stay fixed. Grace and one-time extensions only affect service suspension timing.</p></div><div className="overflow-x-auto"><table className="data-table min-w-[820px]"><thead><tr><th>Period</th><th>Billing due</th><th>Extension until</th><th>Bill</th><th>Balance</th><th>Status</th></tr></thead><tbody>{selected.bills.map(b=>{const ext=b.extensions?.[0];return <tr key={b.id}><td className="font-medium">{b.periodLabel}</td><td>{dateOnly(b.dueDate)}</td><td className={ext?"text-[#e5be6d]":"text-slate-500"}>{ext?dateOnly(ext.extensionUntil):"—"}</td><td>{peso.format(money(b.amountDue))}</td><td className={`font-semibold ${money(b.balance)>0?"text-[#e5be6d]":"text-[#8ed5ae]"}`}>{peso.format(money(b.balance))}</td><td><Status value={b.status}/></td></tr>})}</tbody></table></div></section>
        <div className="grid gap-4 xl:grid-cols-3"><section className="panel p-4"><div className="section-title">Payments</div><div className="mt-4 space-y-3">{selected.payments.slice(0,8).map(p=><div key={p.id} className="border-b border-[var(--border)] py-3 last:border-b-0"><div className="flex justify-between"><span className="font-medium">{p.receiptNo}</span><b className="text-[#8ed5ae]">{peso.format(money(p.amount))}</b></div><div className="mt-1 text-xs text-slate-500">{dateTimeFmt.format(new Date(p.paidAt))}{p.receivedBy?` · ${p.receivedBy}`:""}</div></div>)}{!selected.payments.length&&<p className="text-sm text-slate-500">No payments yet.</p>}</div></section><section className="panel p-4"><div className="section-title">Credit history</div><div className="mt-4 space-y-3">{(selected.creditTransactions??[]).slice(0,8).map(c=><div key={c.id} className="border-b border-[var(--border)] py-3 last:border-b-0"><div className="flex justify-between"><span>{c.type.replaceAll("_"," ")}</span><b className={money(c.amount)>=0?"text-[#8fc8df]":"text-[#e5be6d]"}>{money(c.amount)>=0?"+":""}{peso.format(money(c.amount))}</b></div><div className="mt-1 text-xs text-slate-500">Balance after: {peso.format(money(c.balanceAfter))}</div></div>)}{!(selected.creditTransactions??[]).length&&<p className="text-sm text-slate-500">No advance credit history.</p>}</div></section><section className="panel p-4"><div className="section-title">Account activity</div><div className="mt-4 space-y-3">{[...(selected.billExtensions??[]).map(x=>({id:`e${x.id}`,at:x.createdAt,t:"Temporary extension",d:`Billing due unchanged · protected until ${dateOnly(x.extensionUntil)} · ${x.reason}`})),...selected.dueDateChanges.map(x=>({id:`d${x.id}`,at:x.changedAt,t:"Legacy due date change",d:`${dateOnly(x.oldDueDate)} → ${dateOnly(x.newDueDate)} · ${x.reason}`})),...selected.serviceActions.map(x=>({id:`s${x.id}`,at:x.effectiveAt,t:x.type.replaceAll("_"," "),d:`${x.previousStatus} → ${x.nextStatus}${x.reason?` · ${x.reason}`:""}`}))].sort((a,b)=>+new Date(b.at)-+new Date(a.at)).slice(0,8).map(x=><div key={x.id} className="border-b border-[var(--border)] py-3 last:border-b-0"><div className="font-medium">{x.t}</div><div className="mt-1 text-xs text-slate-400">{x.d}</div></div>)}</div></section></div></div> : <>
        {tab==="Dashboard"&&<div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <Card title="Subscribers" value={String(dashboard.clients)} note="Total client records" icon={Users}/>
            <Card title="Collected" value={peso.format(dashboard.collected)} note={dashboard.period??"Current month"} icon={CircleDollarSign}/>
            <Card title="Outstanding" value={peso.format(dashboard.outstanding)} note="Across all open billing periods" icon={Activity}/>
            <Card title="Advance credit" value={peso.format(money(dashboard.availableCredit))} note="Deposits and overpayments" icon={WalletCards}/>
            <Card title="Net receivable" value={peso.format(money(dashboard.netReceivable??dashboard.outstanding))} note="Outstanding less credits" icon={ReceiptText}/>
          </div>
          <section className="panel overflow-hidden">
            <div className="section-header"><div><h2 className="section-title">Subscriber status</h2><p className="section-description">A compact operational view of accounts that need collection or service attention.</p></div><div className="section-actions"><button onClick={()=>setTab("Field Collection")} className="btn-secondary"><ClipboardList size={15}/>Plan collection</button><button onClick={()=>setTab("Clients")} className="btn-secondary">Open subscribers</button></div></div>
            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border)] sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
              {[["Paid",dashboard.paid,"success"],["Unpaid",dashboard.unpaid,"neutral"],["Partial",dashboard.partial,"warning"],["Extended",dashboard.extended,"warning"],["For cut",dashboard.forCut,"danger"],["Cut",dashboard.cut,"danger"]].map(([label,value,tone])=><div key={String(label)} className="px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-lg font-semibold tabular-nums ${tone==="danger"?"text-[#f09aa0]":tone==="warning"?"text-[#e5be6d]":tone==="success"?"text-[#8ed5ae]":"text-slate-200"}`}>{value}</div></div>)}
            </div>
          </section>
          <section className="panel">
            <div className="section-header"><div><h2 className="section-title">Daily operations</h2><p className="section-description">Shortcuts follow the real billing-to-collection workflow without duplicating data into decorative cards.</p></div></div>
            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-4">
              <button onClick={()=>setTab("Billing")} className="bg-[var(--surface-1)] p-4 text-left hover:bg-[var(--surface-2)]"><div className="text-sm font-semibold">Generate billing</div><div className="mt-1 text-xs leading-5 text-slate-500">Create missing monthly bills and apply available advance credit.</div></button>
              <button onClick={()=>setTab("Field Collection")} className="bg-[var(--surface-1)] p-4 text-left hover:bg-[var(--surface-2)]"><div className="text-sm font-semibold">Prepare field route</div><div className="mt-1 text-xs leading-5 text-slate-500">Group due and overdue subscribers by area and collector.</div></button>
              <button onClick={()=>setTab("Collections")} className="bg-[var(--surface-1)] p-4 text-left hover:bg-[var(--surface-2)]"><div className="text-sm font-semibold">Review collections</div><div className="mt-1 text-xs leading-5 text-slate-500">Check posted receipts, collector, approver, and payment method.</div></button>
              <button onClick={()=>setTab("Service")} className="bg-[var(--surface-1)] p-4 text-left hover:bg-[var(--surface-2)]"><div className="text-sm font-semibold">Service attention</div><div className="mt-1 text-xs leading-5 text-slate-500">Review extensions, for-cut accounts, suspensions, and reconnects.</div></button>
            </div>
          </section>
        </div>}
        {tab==="Clients"&&<section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Subscriber master</h2><p className="section-description">Search billing identity, contact, due cycle, balance, credit, and service state.</p></div><div className="section-actions"><div className="relative"><Search size={15} className="absolute left-3 top-[11px] text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, area, mobile" className="field w-72 max-w-full pl-9"/></div>{isAdmin&&<button onClick={()=>{setTab("Subscriber Maintenance");setSelected(null)}} className="btn-secondary"><UserCog size={15}/>Open maintenance</button>}</div></div><div className="overflow-x-auto"><table className="data-table min-w-[1020px]"><thead ><tr><th className="px-5 py-3">Subscriber</th><th className="px-5 py-3">Mobile</th><th className="px-5 py-3">Area</th><th className="px-5 py-3">Due</th><th className="px-5 py-3">Rate</th><th className="px-5 py-3">Outstanding</th><th className="px-5 py-3">Credit</th><th className="px-5 py-3">Service</th><th className="px-5 py-3">Network</th></tr></thead><tbody>{operationalFiltered.map(c=><tr key={c.id} onClick={()=>void openClient(c)} className="cursor-pointer hover:bg-white/[.025]"><td className="px-5 py-4"><b>{c.fullName}</b><div className="text-xs text-slate-500">{c.clientCode}</div></td><td className="px-5 py-4">{c.primaryMobile||<span className="text-[#e5be6d]">Add number</span>}</td><td className="px-5 py-4">{c.area}</td><td className="px-5 py-4">Day {c.dueDay}</td><td className="px-5 py-4">{peso.format(c.monthlyRate)}</td><td className="px-5 py-4 font-semibold text-[#e5be6d]">{peso.format(c.outstanding)}</td><td className="px-5 py-4 font-semibold text-[#8fc8df]">{peso.format(money(c.creditBalance))}</td><td className="px-5 py-4"><Status value={c.serviceStatus}/></td><td className="px-5 py-4"><Status value={c.networkStatus??"FOR_ACTIVATION"}/><div className="mt-1 text-xs text-slate-500">{c.mikrotikDevice?.name??"Not provisioned"}</div></td></tr>)}{!operationalFiltered.length&&<tr><td colSpan={9} className="p-0"><EmptyState title="No subscribers found" description="Try a different name, area, mobile number, or clear the search."/></td></tr>}</tbody></table></div></section>}
        {tab==="Billing"&&<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="panel">
            <div className="section-header"><div><h2 className="section-title">Generate monthly billing</h2><p className="section-description">Creates one missing bill per active subscriber for the selected period. Existing bills are skipped safely.</p></div></div>
            <div className="p-4"><div className="flex flex-wrap items-end gap-3"><label className="field-label">Month<select value={billMonth} onChange={e=>setBillMonth(Number(e.target.value))} className="field mt-1 block min-w-40">{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2026,i,1).toLocaleString("en-PH",{month:"long"})}</option>)}</select></label><label className="field-label">Year<input type="number" value={billYear} onChange={e=>setBillYear(Number(e.target.value))} className="field mt-1 block w-28"/></label><button disabled={!isAdmin} onClick={()=>void generateBills()} className="primary-btn disabled:opacity-40">Generate bills</button></div>{billingMessage&&<div className="notice notice-info mt-4">{billingMessage}</div>}</div>
          </section>
          <section className="panel">
            <div className="section-header"><div><h2 className="section-title">Billing rules</h2><p className="section-description">Current behavior used when a bill is generated.</p></div></div>
            <dl className="divide-y divide-[var(--border)] text-sm">
              <div className="grid grid-cols-[140px_1fr] gap-4 px-4 py-3"><dt className="font-semibold text-slate-300">Duplicate period</dt><dd className="text-slate-500">Skipped; billing generation is idempotent.</dd></div>
              <div className="grid grid-cols-[140px_1fr] gap-4 px-4 py-3"><dt className="font-semibold text-slate-300">Advance credit</dt><dd className="text-slate-500">Applied automatically to the new bill before a balance remains.</dd></div>
              <div className="grid grid-cols-[140px_1fr] gap-4 px-4 py-3"><dt className="font-semibold text-slate-300">Unpaid history</dt><dd className="text-slate-500">Older balances stay separate and remain visible in the ledger and SOA.</dd></div>
              <div className="grid grid-cols-[140px_1fr] gap-4 px-4 py-3"><dt className="font-semibold text-slate-300">Due cycle</dt><dd className="text-slate-500">Uses each subscriber’s current default due day.</dd></div>
            </dl>
          </section>
        </div>}
        {tab==="Field Collection"&&<FieldCollectionOps authUser={authUser} live={live}/>}
        {tab==="Collections"&&<section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Recent collections</h2><p className="section-description">Official posted payments with receipt, collector, approver, method, and amount.</p></div></div><div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead ><tr><th className="px-5 py-3">Receipt</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Received by</th><th className="px-5 py-3">Approved by</th><th className="px-5 py-3">Amount</th></tr></thead><tbody>{(live?collections:demoPayments.slice(0,50)).map((p:any)=><tr key={p.id} ><td className="px-5 py-4 font-medium">{p.receiptNo}</td><td className="px-5 py-4">{live?p.client.fullName:p.clientName}</td><td className="px-5 py-4 text-slate-400">{dateTimeFmt.format(new Date(p.paidAt))}</td><td className="px-5 py-4">{p.method.replaceAll("_"," ")}</td><td className="px-5 py-4 text-slate-400">{p.receivedBy??"—"}</td><td className="px-5 py-4 text-slate-400">{p.approvedBy??p.receivedBy??"—"}</td><td className="px-5 py-4 font-semibold text-[#8ed5ae]">{peso.format(money(p.amount))}</td></tr>)}{!(live?collections:demoPayments.slice(0,50)).length&&<tr><td colSpan={7} className="p-0"><EmptyState title="No posted collections" description="Approved payments and direct admin payments will appear here."/></td></tr>}</tbody></table></div></section>}
        {tab==="Service"&&<section className="panel overflow-hidden"><div className="section-header"><div><h2 className="section-title">Service attention</h2><p className="section-description">Subscribers currently extended, marked for cut, suspended, or recently reconnected.</p></div></div><div className="overflow-x-auto"><table className="data-table min-w-[720px]"><thead ><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Area</th><th className="px-5 py-3">Outstanding</th><th className="px-5 py-3">Status</th><th></th></tr></thead><tbody>{serviceClients.map(c=><tr key={c.id} ><td className="px-5 py-4 font-medium">{c.fullName}</td><td className="px-5 py-4">{c.area}</td><td className="px-5 py-4 font-semibold text-[#e5be6d]">{peso.format(c.outstanding)}</td><td className="px-5 py-4"><Status value={c.serviceStatus}/></td><td className="px-5 py-4"><button onClick={()=>void openClient(c)} className="btn-ghost !min-h-8 !px-2.5">Manage</button></td></tr>)}{!serviceClients.length&&<tr><td colSpan={5} className="p-0"><EmptyState title="No service actions need attention" description="Extended, for-cut, cut, and reconnected subscribers will appear here."/></td></tr>}</tbody></table></div></section>}
        {tab==="Network"&&<NetworkOps authUser={authUser} live={live}/>}
        {tab==="User Maintenance"&&isAdmin&&<div className="space-y-5">
          <section className="panel overflow-hidden">
            <div className="section-header">
              <div>
                <h2 className="section-title">User maintenance</h2>
                <p className="section-description">Manage application accounts, roles, PIN resets, and active/inactive access. This page is for account maintenance only.</p>
              </div>
              <div className="section-actions"><button onClick={()=>{setUserTarget(null);setModal("newUser")}} className="primary-btn"><Plus size={15}/>Add user</button></div>
            </div>
            <div className="overflow-x-auto p-5">
              <table className="data-table min-w-[820px]">
                <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Last login</th><th>Status</th><th className="text-right">Maintenance actions</th></tr></thead>
                <tbody>
                  {users.map(u=><tr key={u.id}>
                    <td className="font-semibold text-slate-900">{u.displayName}</td>
                    <td>{u.username}</td>
                    <td>{u.role}</td>
                    <td>{u.lastLoginAt?dateTimeFmt.format(new Date(u.lastLoginAt)):"Never"}</td>
                    <td><Status value={u.isActive?"ACTIVE":"INACTIVE"}/></td>
                    <td><div className="flex justify-end gap-2">
                      <button onClick={()=>{setUserTarget(u);setModal("editUser")}} className="btn-secondary !min-h-8"><Save size={14}/>Edit</button>
                      <button onClick={()=>void resetUserPin(u)} className="btn-secondary !min-h-8">Reset PIN</button>
                      <button onClick={()=>void toggleUser(u)} className="btn-secondary !min-h-8">{u.isActive?"Disable":"Enable"}</button>
                    </div></td>
                  </tr>)}
                  {!users.length&&<tr><td colSpan={6} className="p-0"><EmptyState title="No user accounts found" description="Add an administrator, collector, or viewer account."/></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>}
        {tab==="Subscriber Maintenance"&&isAdmin&&<div className="space-y-5">
          <section className="panel overflow-hidden">
            <div className="section-header">
              <div>
                <h2 className="section-title">Subscriber maintenance</h2>
                <p className="section-description">Master-data administration only. Add, edit, deactivate/reactivate, or remove unused subscriber records here. Payments, SOA, extensions, and service work stay in Subscriber Operations.</p>
              </div>
              <div className="section-actions">
                <div className="relative"><Search size={15} className="absolute left-3 top-[12px] text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search subscriber master..." className="field w-72 max-w-full pl-9"/></div>
                <button onClick={()=>{setMaintenanceTarget(null);setModal("newClient")}} className="primary-btn"><Plus size={15}/>Add subscriber</button>
              </div>
            </div>
            <div className="notice notice-info m-5 mb-0"><b>Safe delete:</b> permanent delete is allowed only for unused records with no billing, payment, service, collection, or network history. Historical records should be deactivated instead.</div>
            <div className="overflow-x-auto p-5 pt-4">
              <table className="data-table min-w-[980px]">
                <thead><tr><th>Subscriber</th><th>Area</th><th>Due day</th><th>Monthly rate</th><th>Status</th><th>Network</th><th className="text-right">Maintenance actions</th></tr></thead>
                <tbody>
                  {filtered.map(c=><tr key={c.id}>
                    <td><div className="font-semibold text-slate-900">{c.fullName}</div><div className="text-xs text-slate-500">{c.clientCode}</div></td>
                    <td>{c.area}</td>
                    <td>Day {c.dueDay}</td>
                    <td>{peso.format(c.monthlyRate)}</td>
                    <td><Status value={c.serviceStatus}/></td>
                    <td><Status value={c.networkStatus??"FOR_ACTIVATION"}/></td>
                    <td><div className="flex justify-end gap-2">
                      <button onClick={()=>openMaintenanceEdit(c)} className="btn-secondary !min-h-8"><Save size={14}/>Edit</button>
                      <button onClick={()=>void setSubscriberMaintenanceStatus(c,c.serviceStatus!=="INACTIVE")} className="btn-secondary !min-h-8">{c.serviceStatus==="INACTIVE"?"Reactivate":"Deactivate"}</button>
                      <button onClick={()=>void deleteSubscriberMaintenance(c)} className="btn-danger !min-h-8">Delete</button>
                    </div></td>
                  </tr>)}
                  {!filtered.length&&<tr><td colSpan={7} className="p-0"><EmptyState title="No subscriber master records found" description="Clear the search or add a new subscriber record."/></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>}
        {tab==="Import"&&<div className="space-y-5"><section className="panel p-5"><div className="section-header !px-0 !pt-0"><div><h2 className="section-title">Approved real-data snapshot</h2><p className="section-description mt-1 max-w-3xl">Loads the cleaned <b>paid for this month</b> sheet as September 2026 opening data. Existing subscribers go to <b>For Linking</b>, not For Activation, so no duplicate PPPoE account is created.</p></div></div><div className="flex flex-wrap gap-2"><button onClick={()=>void previewBundledRealData()} className="action-btn"><FileSpreadsheet size={15}/>Preview real data</button><button disabled={busy} onClick={()=>void bootstrapBundledRealData()} className="primary-btn"><DatabaseBackup size={15}/>{busy?"Importing...":"Load real data"}</button></div>{realDataPreview&&<div className="mt-5 space-y-4"><div className="grid gap-3 md:grid-cols-4"><Metric label="Ready clients" value={realDataPreview.readyCount}/><Metric label="Needs review" value={realDataPreview.reviewCount} tone={realDataPreview.reviewCount?"warning":"neutral"}/><Metric label="MikroTik 1 areas" value={realDataPreview.areaMappings.MIKROTIK_1.length}/><Metric label="MikroTik 2 areas" value={realDataPreview.areaMappings.MIKROTIK_2.length}/></div><div className="grid gap-4 xl:grid-cols-2"><div className="subpanel p-4"><b className="text-sm">MikroTik 1 · With Cut</b><p className="mt-2 text-sm text-slate-400">{realDataPreview.areaMappings.MIKROTIK_1.join(" · ")}</p></div><div className="subpanel p-4"><b className="text-sm">MikroTik 2 · With Cut</b><p className="mt-2 text-sm text-slate-400">{realDataPreview.areaMappings.MIKROTIK_2.join(" · ")}</p></div></div><div className="notice notice-info"><b>MikroTik 3:</b> seeded separately as the No Auto Cut / Trusted router for good-payer migrations. It has no default area mapping.</div>{realDataPreview.unassignedAreas.length>0&&<div className="notice notice-info"><b>Router not assigned yet:</b> {realDataPreview.unassignedAreas.join(", ")}. Clients are imported, but you can map these areas later in Network.</div>}{realDataPreview.reviewRows.length>0&&<div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead><tr><th>Excel row</th><th>Client</th><th>Area</th><th>Due</th><th>Rate</th><th>Needs review</th></tr></thead><tbody>{realDataPreview.reviewRows.map(r=><tr key={`${r.sourceRow}-${r.fullName}`}><td>{r.sourceRow}</td><td>{r.fullName}</td><td>{r.area||"—"}</td><td>{r.dueDay??"—"}</td><td>{r.monthlyRate?peso.format(r.monthlyRate):"—"}</td><td>{r.reason}</td></tr>)}</tbody></table></div>}</div>}{importMessage&&<div className="notice notice-info mt-4">{importMessage}</div>}</section><section className="panel p-5"><h2 className="section-title">Manual Excel import</h2><p className="section-description mt-1 max-w-2xl">For later spreadsheet updates. Area names are normalized and imported existing clients are placed in For Linking.</p><div className="mt-6 rounded-md border border-dashed border-slate-700 p-6"><input type="file" accept=".xlsx" onChange={e=>setFile(e.target.files?.[0]??null)} className="max-w-full text-sm text-slate-400"/></div><div className="mt-4 flex flex-wrap items-end gap-3"><label className="field-label">Month<select value={importMonth} onChange={e=>setImportMonth(Number(e.target.value))} className="field mt-1">{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2026,i,1).toLocaleString("en-PH",{month:"long"})}</option>)}</select></label><label className="field-label">Year<input type="number" value={importYear} onChange={e=>setImportYear(Number(e.target.value))} className="field mt-1 w-28"/></label><button onClick={()=>void importExcel()} className="primary-btn">Import workbook</button></div></section></div>}
        {tab==="Admin"&&isAdmin&&<div className="space-y-5"><section className="panel p-5"><div className="flex items-center gap-2"><DatabaseBackup size={18} className="text-[#8fc8df]"/><b>Backup / restore</b></div><p className="mt-3 text-sm text-slate-400">Portable JSON backup plus scheduled server-side backups with retention cleanup.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><button onClick={()=>void downloadBackup()} className="primary-btn"><DatabaseBackup size={16}/>Download backup</button><button onClick={()=>void runAutomaticBackup()} className="action-btn"><RefreshCcw size={15}/>Create server backup</button></div><div className="mt-4 space-y-1 text-xs text-slate-500">{backups.slice(0,3).map(b=><div key={b.fileName} className="flex justify-between gap-3"><span className="truncate">{b.fileName}</span><span>{Math.max(1,Math.round(b.sizeBytes/1024))} KB</span></div>)}{!backups.length&&<div>No scheduled backups yet.</div>}</div><div className="mt-5 border-t border-[var(--border)] pt-5"><input type="file" accept=".json" onChange={e=>setRestoreFile(e.target.files?.[0]??null)} className="max-w-full text-sm text-slate-400"/><button disabled={busy} onClick={()=>void restoreBackup()} className="action-btn mt-3 w-full">Restore selected backup</button></div></section>{settings&&<section className="panel p-5"><div className="flex items-center gap-2"><Router size={18} className="text-[#8fc8df]"/><b>Automation & integrations</b></div><form onSubmit={saveSettings} className="mt-5 grid gap-4 lg:grid-cols-2"><div className="subpanel p-4"><label className="flex items-start gap-3 text-sm"><input name="autoBillingEnabled" type="checkbox" defaultChecked={settings.autoBillingEnabled}/><span><b>Automatic monthly billing</b><span className="block text-xs text-slate-500">Hourly idempotent check creates the current month's missing bills.</span></span></label><label className="mt-4 flex items-start gap-3 text-sm"><input name="messagingEnabled" type="checkbox" defaultChecked={settings.messagingEnabled}/><span><b>Messaging automation</b><span className="block text-xs text-slate-500">Queues due/overdue reminders for consenting clients with mobile numbers.</span></span></label><div className="mt-4 grid grid-cols-2 gap-3"><label className="field-label">Days before due<input name="reminderDaysBefore" type="number" min="0" max="30" defaultValue={settings.reminderDaysBefore} className="field mt-1 w-full"/></label><label className="field-label">Overdue delay<input name="overdueReminderDays" type="number" min="0" max="30" defaultValue={settings.overdueReminderDays} className="field mt-1 w-full"/></label></div><label className="field-label mt-4 block">SMS provider<select name="smsProvider" defaultValue={settings.smsProvider} className="field mt-1 w-full"><option value="LOG_ONLY">Preview only (no external SMS)</option><option value="WEBHOOK">Webhook gateway</option></select></label><label className="field-label mt-4 block">SMS webhook URL<input name="smsWebhookUrl" defaultValue={settings.smsWebhookUrl??""} placeholder="https://gateway.example/send" className="field mt-1 w-full"/></label></div><div className="subpanel p-4"><div className="text-sm font-semibold">Grace, cut & trust rules</div><p className="mt-1 text-xs leading-5 text-slate-500">Grace affects service enforcement only. Billing due dates and collection print eligibility remain unchanged.</p><div className="mt-4 grid grid-cols-2 gap-3"><label className="field-label">Default grace days<input name="defaultGraceDays" type="number" min="0" max="30" defaultValue={settings.defaultGraceDays} className="field mt-1 w-full"/></label><label className="field-label">Trusted qualification (months)<input name="trustedQualificationMonths" type="number" min="1" max="36" defaultValue={settings.trustedQualificationMonths} className="field mt-1 w-full"/></label><label className="field-label">Trusted downgrade unpaid months<input name="trustedDowngradeUnpaidMonths" type="number" min="1" max="12" defaultValue={settings.trustedDowngradeUnpaidMonths} className="field mt-1 w-full"/></label><label className="field-label">Router retry minutes<input name="routerRetryMinutes" type="number" min="1" max="1440" defaultValue={settings.routerRetryMinutes} className="field mt-1 w-full"/></label></div><div className="mt-4 space-y-3"><label className="check-row text-sm"><input name="dueDateReminderEnabled" type="checkbox" defaultChecked={settings.dueDateReminderEnabled}/><span>Send reminder on the actual due date</span></label><label className="check-row text-sm"><input name="graceReminderEnabled" type="checkbox" defaultChecked={settings.graceReminderEnabled}/><span>Send grace / approved-extension reminder</span></label><label className="check-row text-sm"><input name="finalWarningEnabled" type="checkbox" defaultChecked={settings.finalWarningEnabled}/><span>Send final warning before eligible cut date</span></label><label className="check-row text-sm"><input name="autoCutAfterGrace" type="checkbox" defaultChecked={settings.autoCutAfterGrace}/><span>Automatically cut after grace/extension, but only on With Cut routers</span></label><label className="check-row text-sm"><input name="mikrotikEnabled" type="checkbox" defaultChecked={settings.mikrotikEnabled}/><span>Enable MikroTik integration globally</span></label><label className="check-row text-sm"><input name="routerRetryEnabled" type="checkbox" defaultChecked={settings.routerRetryEnabled}/><span>Retry failed router jobs</span></label><label className="check-row text-sm"><input name="autoReconnectOnPayment" type="checkbox" defaultChecked={settings.autoReconnectOnPayment}/><span>Auto reconnect a CUT subscriber after all open balances are cleared</span></label></div><p className="mt-4 text-xs leading-5 text-slate-500">Router URLs, policies, trusted tiers, and area mapping are managed from the Network page. Per-router credentials stay in the API .env.</p></div><div className="subpanel p-4 lg:col-span-2"><label className="flex items-start gap-3 text-sm"><input name="automaticBackupEnabled" type="checkbox" defaultChecked={settings.automaticBackupEnabled}/><span><b>Automatic database backup</b><span className="block text-xs text-slate-500">Creates at most one JSON backup per day and removes files older than the retention window.</span></span></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="field-label">Backup hour (0–23)<input name="backupHour" type="number" min="0" max="23" defaultValue={settings.backupHour} className="field mt-1 w-full"/></label><label className="field-label">Retention days<input name="backupRetentionDays" type="number" min="1" max="3650" defaultValue={settings.backupRetentionDays} className="field mt-1 w-full"/></label></div></div><div className="lg:col-span-2 flex flex-wrap gap-2"><button disabled={busy} className="primary-btn"><Save size={16}/>Save settings</button><button type="button" onClick={()=>void runAutomation()} className="action-btn">Run automation now</button><button type="button" onClick={()=>void queueReminders()} className="action-btn">Queue reminders</button><button type="button" onClick={()=>void processMessages()} className="action-btn">Process message queue</button><button type="button" onClick={()=>void processRouterQueue()} className="action-btn">Process router queue</button></div></form>{automationMessage&&<div className="mt-4 rounded-md bg-white/5 p-3 text-sm text-cyan-100">{automationMessage}</div>}</section>}<section className="panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><div className="flex items-center gap-2"><MessageSquareText size={18} className="text-[#8fc8df]"/><b>Recent messages</b></div></div><div className="overflow-x-auto"><table className="data-table min-w-[850px]"><thead ><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Destination</th><th className="px-5 py-3">Template</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Created</th><th className="px-5 py-3">Message</th></tr></thead><tbody>{messages.slice(0,30).map(m=><tr key={m.id} ><td className="px-5 py-4">{m.client?.fullName??"—"}</td><td className="px-5 py-4">{m.destination}</td><td className="px-5 py-4">{m.templateKey??"—"}</td><td className="px-5 py-4"><Status value={m.status}/></td><td className="px-5 py-4 text-slate-400">{dateTimeFmt.format(new Date(m.createdAt))}</td><td className="max-w-sm truncate px-5 py-4 text-slate-400" title={m.body}>{m.body}</td></tr>)}{!messages.length&&<tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No queued messages yet.</td></tr>}</tbody></table></div></section><section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--border)] p-5"><div className="flex items-center gap-2"><Router size={18} className="text-[#8fc8df]"/><b>Router sync queue</b></div><button onClick={()=>void processRouterQueue()} className="action-btn"><RefreshCcw size={14}/>Process now</button></div><div className="overflow-x-auto"><table className="data-table min-w-[900px]"><thead ><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Account</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Attempts</th><th className="px-5 py-3">Last error</th><th></th></tr></thead><tbody>{routerJobs.slice(0,50).map(j=><tr key={j.id} ><td className="px-5 py-4">{j.client?.fullName??`Client #${j.clientId}`}</td><td className="px-5 py-4">{j.account}</td><td className="px-5 py-4">{j.action.replaceAll("_"," ")}</td><td className="px-5 py-4"><Status value={j.status}/></td><td className="px-5 py-4">{j.attempts}/{j.maxAttempts}</td><td className="max-w-sm truncate px-5 py-4 text-slate-400" title={j.lastError??""}>{j.lastError??"—"}</td><td className="px-5 py-4">{j.status==="FAILED"&&<button onClick={()=>void retryRouterJobUi(j.id)} className="text-[#8fc8df]">Retry</button>}</td></tr>)}{!routerJobs.length&&<tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">No router sync jobs yet.</td></tr>}</tbody></table></div></section><section className="panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-[#8fc8df]"/><b>Audit log</b></div></div><div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead ><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Operator</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Entity</th></tr></thead><tbody>{audits.map(a=><tr key={a.id} ><td className="px-5 py-4 text-slate-400">{dateTimeFmt.format(new Date(a.createdAt))}</td><td className="px-5 py-4">{a.actor??"—"}</td><td className="px-5 py-4 font-medium">{a.action.replaceAll("_"," ")}</td><td className="px-5 py-4 text-slate-400">{a.entityType}{a.entityId?` #${a.entityId}`:""}</td></tr>)}{!audits.length&&<tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No audit entries.</td></tr>}</tbody></table></div></section></div>}
      </>}
    </div></main>

    <Dialog
      open={Boolean(confirmAction)}
      title={
        confirmAction?.type==="SUBSCRIBER_STATUS"
          ? `${confirmAction.inactive?"Deactivate":"Reactivate"} subscriber`
          : confirmAction?.type==="SUBSCRIBER_DELETE"
            ? "Delete subscriber record"
            : confirmAction?.type==="REAL_DATA_IMPORT"
              ? "Import approved real data"
              : "Restore database backup"
      }
      description={
        confirmAction?.type==="SUBSCRIBER_STATUS"
          ? `${confirmAction.client.fullName} · this changes the subscriber master status only.`
          : confirmAction?.type==="SUBSCRIBER_DELETE"
            ? `${confirmAction.client.fullName} · permanent delete is allowed only when no protected history exists.`
            : confirmAction?.type==="REAL_DATA_IMPORT"
              ? "Loads the approved snapshot and creates the configured MikroTik placeholders/area mappings. Existing PPPoE accounts are not created or changed."
              : confirmAction?.type==="RESTORE_BACKUP"
                ? "This replaces the current database contents with the selected backup and signs users out."
                : undefined
      }
      onClose={()=>{if(!busy)setConfirmAction(null)}}
    >
      {confirmAction&&<div className="space-y-4">
        {(confirmAction.type==="SUBSCRIBER_DELETE"||confirmAction.type==="RESTORE_BACKUP")&&<div className="notice notice-warning"><b>Important:</b> This is a destructive administrative action. Review the target before continuing.</div>}
        {confirmAction.type==="SUBSCRIBER_STATUS"&&<div className="subpanel p-4 text-sm"><div className="flex justify-between gap-4"><span>Subscriber</span><b>{confirmAction.client.fullName}</b></div><div className="mt-2 flex justify-between gap-4"><span>New status</span><b>{confirmAction.inactive?"INACTIVE":"ACTIVE"}</b></div><div className="mt-2 text-xs text-slate-500">MikroTik state is not changed automatically by this maintenance action.</div></div>}
        {confirmAction.type==="SUBSCRIBER_DELETE"&&<div className="subpanel p-4 text-sm"><div className="flex justify-between gap-4"><span>Subscriber</span><b>{confirmAction.client.fullName}</b></div><div className="mt-2 flex justify-between gap-4"><span>Client code</span><span>{confirmAction.client.clientCode}</span></div></div>}
        {confirmAction.type==="RESTORE_BACKUP"&&<div className="subpanel p-4 text-sm"><div className="flex justify-between gap-4"><span>Selected backup</span><b className="max-w-[70%] truncate">{restoreFile?.name??"No file selected"}</b></div></div>}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          
          <button type="button" onClick={()=>void executeConfirmAction()} disabled={busy} className={confirmAction.type==="SUBSCRIBER_DELETE"||confirmAction.type==="RESTORE_BACKUP"?"btn-danger":"primary-btn"}>
            {busy?"Please wait...":confirmAction.type==="SUBSCRIBER_STATUS"?(confirmAction.inactive?"Deactivate":"Reactivate"):confirmAction.type==="SUBSCRIBER_DELETE"?"Delete record":confirmAction.type==="REAL_DATA_IMPORT"?"Import real data":"Restore backup"}
          </button>
        </div>
      </div>}
    </Dialog>

    <Dialog
      open={Boolean(pinAction)}
      title={pinAction?.type==="RESET_USER" ? "Reset user PIN" : "Change my PIN"}
      description={pinAction?.type==="RESET_USER" ? `Set a new 4–8 digit PIN for ${pinAction.user.displayName}. Existing sessions will be revoked.` : "Enter your current PIN and choose a new 4–8 digit PIN."}
      onClose={()=>{if(!busy)setPinAction(null)}}
    >
      {pinAction&&<form onSubmit={submitPinAction} className="space-y-4">
        {pinAction.type==="CHANGE_OWN"&&<label className="field-label block">Current PIN<input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" className="field mt-1 w-full" required/></label>}
        <label className="field-label block">New PIN<input name="newPin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} autoComplete="new-password" className="field mt-1 w-full" required/></label>
        <label className="field-label block">Confirm new PIN<input name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} autoComplete="new-password" className="field mt-1 w-full" required/></label>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          
          <button disabled={busy} className="primary-btn">{busy?"Saving...":"Save PIN"}</button>
        </div>
      </form>}
    </Dialog>

    {modal==="newClient"&&<Modal title="New subscriber master record" onClose={()=>{setModal(null);setMaintenanceTarget(null)}}><form onSubmit={e=>void submitClient(e,false)} className="space-y-4"><ClientFormFields/><button disabled={busy} className="primary-btn w-full"><Plus size={16}/>{busy?"Saving...":"Create subscriber"}</button></form></Modal>}
    {maintenanceTarget&&modal==="edit"&&<Modal title="Edit subscriber master record" onClose={()=>{setModal(null);setMaintenanceTarget(null)}}><form onSubmit={e=>void submitClient(e,true)} className="space-y-4"><ClientFormFields client={maintenanceTarget}/><button disabled={busy} className="primary-btn w-full"><Save size={16}/>{busy?"Saving...":"Save changes"}</button></form></Modal>}
    {selected&&modal==="payment"&&<Modal title="Record payment / advance" onClose={()=>setModal(null)}><form onSubmit={submitPayment} className="space-y-4"><div className="grid grid-cols-2 gap-2"><Metric label="Outstanding" value={peso.format(selected.outstanding)} tone="warning"/><Metric label="Current credit" value={peso.format(money(selected.creditBalance))} tone="info"/></div><p className="text-xs leading-5 text-slate-500">Payments clear the oldest unpaid month first. Any amount beyond total debt is stored as advance credit.</p><label className="field-label block">Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={selected.outstanding||selected.monthlyRate} className="field mt-1 w-full" required/></label><label className="field-label block">Payment method<select name="method" className="field mt-1 w-full"><option value="CASH">Cash</option><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label><label className="field-label block">Reference no.<input name="referenceNo" className="field mt-1 w-full"/></label><label className="field-label block">Notes<textarea name="notes" className="field mt-1 min-h-20 w-full"/></label><button disabled={busy} className="primary-btn w-full"><ReceiptText size={16}/>{busy?"Saving...":"Save payment & receipt"}</button></form></Modal>}
    {selected&&modal==="extend"&&<Modal title="Temporary payment extension" onClose={()=>setModal(null)}><form onSubmit={submitExtension} className="space-y-4"><div className="notice notice-info">This is a one-time protection for the selected bill. It does not change the billing due date or the subscriber’s regular due day.</div><label className="field-label block">Billing period<select name="billId" className="field mt-1 w-full" defaultValue={currentOpenBills[0]?.id}>{currentOpenBills.map((b:LedgerBill)=><option key={b.id} value={b.id}>{b.periodLabel} — {peso.format(money(b.balance))} — billing due {dateOnly(b.dueDate)}</option>)}</select></label><label className="field-label block">Protect service until<input name="extensionUntil" type="date" min={todayInput()} className="field mt-1 w-full" required/></label><label className="field-label block">Reason<input name="reason" className="field mt-1 w-full" required/></label><label className="field-label block">Notes<textarea name="notes" className="field mt-1 min-h-20 w-full"/></label><button disabled={busy||!currentOpenBills.length} className="primary-btn w-full">Save one-time extension</button></form></Modal>}
    {selected&&modal==="service"&&<Modal title="Service action" onClose={()=>setModal(null)}><form onSubmit={submitService} className="space-y-4"><div className="subpanel p-4"><div className="flex justify-between"><span className="text-slate-400">Current</span><Status value={selected.serviceStatus}/></div><div className="mt-3 flex justify-between"><span className="text-slate-400">Outstanding</span><b className="text-[#e5be6d]">{peso.format(selected.outstanding)}</b></div></div><label className="field-label block">Action<select name="type" className="field mt-1 w-full"><option value="MARK_FOR_CUT">Mark for cut</option><option value="CUT">Cut / suspend</option><option value="RECONNECT">Reconnect</option><option value="ACTIVATE">Mark active</option><option value="DEACTIVATE">Deactivate</option></select></label><label className="field-label block">Reason<input name="reason" className="field mt-1 w-full"/></label><label className="field-label block">Permanent due day change (optional)<input name="newDueDay" type="number" min="1" max="31" className="field mt-1 w-full"/></label><label className="field-label block">Notes<textarea name="notes" className="field mt-1 min-h-20 w-full"/></label><button disabled={busy} className="primary-btn w-full">Save service action</button></form></Modal>}
    {selected&&modal==="message"&&<Modal title="Message subscriber" onClose={()=>setModal(null)}><form onSubmit={sendManualMessage} className="space-y-4"><div className="subpanel p-4 text-sm"><div className="flex justify-between"><span className="text-slate-400">Recipient</span><b>{selected.primaryMobile||"No mobile number"}</b></div><div className="mt-2 flex justify-between"><span className="text-slate-400">Consent</span><span>{selected.allowNotifications!==false?"Allowed":"Disabled"}</span></div></div><label className="field-label block">Message<textarea name="body" className="field mt-1 min-h-32 w-full" placeholder="Type billing/payment reminder..." required/></label><p className="text-xs leading-5 text-slate-500">Message is queued first. LOG_ONLY provider previews it without sending; WEBHOOK sends it through your configured gateway.</p><button disabled={busy||!selected.primaryMobile||selected.allowNotifications===false} className="primary-btn w-full"><Send size={16}/>Queue message</button></form></Modal>}
    {receipt&&modal==="receipt"&&<Modal title="Payment saved" onClose={()=>setModal(null)}><div className="rounded-lg bg-white p-6 text-slate-900"><div className="text-center"><b className="text-lg">ISP Billing Receipt</b><div className="text-xs text-slate-500">{receipt.receiptNo}</div></div><div className="my-4 border-t border-dashed border-slate-300"/><div className="flex justify-between text-sm"><span>Client</span><b>{receipt.client.fullName}</b></div><div className="mt-2 flex justify-between text-sm"><span>Date</span><span>{dateTimeFmt.format(new Date(receipt.paidAt))}</span></div><div className="my-4 border-t border-dashed border-slate-300"/>{receipt.allocations.map((a,i)=><div key={i} className="flex justify-between py-1 text-sm"><span>{a.bill.periodLabel}</span><span>{peso.format(money(a.amount))}</span></div>)}{(receipt.creditTransactions??[]).map((c,i)=><div key={`c${i}`} className="flex justify-between py-1 text-sm text-cyan-700"><span>Advance credit</span><span>{peso.format(money(c.amount))}</span></div>)}<div className="my-4 border-t border-dashed border-slate-300"/><div className="flex justify-between text-lg"><b>Total paid</b><b>{peso.format(money(receipt.amount))}</b></div></div><button onClick={()=>printReceipt(receipt)} className="primary-btn mt-4 w-full"><Printer size={16}/>Print receipt</button></Modal>}
    {soa&&modal==="soa"&&<Modal title="Statement of Account" onClose={()=>setModal(null)} wide><div className="rounded-lg bg-white p-6 text-slate-900"><div className="flex justify-between gap-4"><div><h2 className="text-xl font-bold">Statement of Account</h2><p className="text-sm text-slate-500">{soa.client.fullName} · {soa.client.clientCode}</p></div><div className="text-right text-sm"><div>{soa.client.area}</div><div>{soa.client.primaryMobile}</div></div></div><table className="data-table mt-6"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">Period</th><th>Billing due</th><th>Extension until</th><th className="text-right">Bill</th><th className="text-right">Balance</th></tr></thead><tbody>{soa.openBills.map(b=><tr key={b.id} className="border-b"><td className="py-2">{b.periodLabel}</td><td>{dateOnly(b.dueDate)}</td><td>{b.extensions?.[0]?dateOnly(b.extensions[0].extensionUntil):"—"}</td><td className="text-right">{peso.format(money(b.amountDue))}</td><td className="text-right">{peso.format(money(b.balance))}</td></tr>)}</tbody></table><div className="ml-auto mt-6 w-full max-w-sm space-y-2"><div className="flex justify-between"><span>Outstanding</span><b>{peso.format(soa.outstanding)}</b></div><div className="flex justify-between"><span>Advance credit</span><b className="text-cyan-700">-{peso.format(soa.client.creditBalance)}</b></div><div className="flex justify-between border-t pt-3 text-lg"><b>Net amount due</b><b>{peso.format(soa.netDue)}</b></div></div></div><button onClick={()=>printStatement(soa)} className="primary-btn mt-4 w-full"><Printer size={16}/>Print SOA</button></Modal>}
    {modal==="newUser"&&<Modal title="Add installer / collector account" onClose={()=>setModal(null)}><form onSubmit={createUser} className="space-y-4"><label className="field-label block">Display name<input name="displayName" className="field mt-1 w-full" required/></label><label className="field-label block">Username<input name="username" className="field mt-1 w-full" required/></label><label className="field-label block">Role<select name="role" className="field mt-1 w-full"><option value="COLLECTOR">Installer / Collector</option><option value="ADMIN">Admin</option><option value="VIEWER">Viewer</option></select></label><label className="field-label block">4–8 digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} className="field mt-1 w-full" required/></label><button disabled={busy} className="primary-btn w-full">Create operator</button></form></Modal>}
    {userTarget&&modal==="editUser"&&<Modal title="Edit user account" onClose={()=>{setModal(null);setUserTarget(null)}}><form onSubmit={editUser} className="space-y-4"><label className="field-label block">Display name<input name="displayName" defaultValue={userTarget.displayName} className="field mt-1 w-full" required/></label><label className="field-label block">Username<input value={userTarget.username} className="field mt-1 w-full" disabled/></label><label className="field-label block">Role<select name="role" defaultValue={userTarget.role} className="field mt-1 w-full"><option value="COLLECTOR">Installer / Collector</option><option value="ADMIN">Admin</option><option value="VIEWER">Viewer</option></select></label><button disabled={busy} className="primary-btn w-full"><Save size={16}/>{busy?"Saving...":"Save user"}</button></form></Modal>}
  </div>;
}
