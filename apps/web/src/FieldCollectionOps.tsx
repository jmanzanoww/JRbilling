import { FormEvent, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, ClipboardList, FileCheck2, MapPin, PhoneCall, Printer, RefreshCcw, Search, Upload, WalletCards, X, XCircle } from "lucide-react";
import { api, apiBlob } from "./api";
import { EmptyState, Metric, Notice, StatusBadge } from "./ui";
import { Dialog } from "./components/ui";
import type {
  AreaCollectorDefaultRow,
  AuthUser,
  CollectionAssignmentRow,
  CollectionCandidate,
  CollectionCandidateMode,
  OperatorUser,
  PaymentSubmissionRow,
  Receipt,
  StatementOfAccount
} from "./types";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const money = (v: unknown) => Number(v ?? 0);
const localDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDateInput = (value: string) => dateFmt.format(new Date(`${value}T12:00:00`));

const modeLabels: Record<CollectionCandidateMode, string> = {
  ALL_UNPAID: "All unpaid",
  OVERDUE: "All overdue",
  TODAY: "Due today",
  TODAY_TOMORROW: "Due today + tomorrow",
  NEXT_3_DAYS: "Due in next 3 days",
  OVERDUE_NEXT_3_DAYS: "Overdue + next 3 days",
  CUSTOM: "Custom due range"
};

function Badge({ value }: { value: string }) { return <StatusBadge value={value}/>; }

function printCollectionList(rows: CollectionAssignmentRow[], date: string, collectorName: string) {
  const w = window.open("", "_blank", "width=1100,height=900");
  if (!w) return;
  const sorted = [...rows].sort((a, b) => `${a.client.area}|${a.client.address ?? ""}|${a.client.fullName}`.localeCompare(`${b.client.area}|${b.client.address ?? ""}|${b.client.fullName}`));
  const byArea = new Map<string, CollectionAssignmentRow[]>();
  for (const row of sorted) byArea.set(row.client.area, [...(byArea.get(row.client.area) ?? []), row]);
  let index = 0;
  let body = "";
  for (const [area, areaRows] of byArea) {
    const subtotal = areaRows.reduce((sum, row) => sum + money(row.client.outstanding), 0);
    body += `<tr class="area"><td colspan="10"><b>${area}</b> &nbsp;·&nbsp; ${areaRows.length} client(s) &nbsp;·&nbsp; ${peso.format(subtotal)}</td></tr>`;
    for (const r of areaRows) {
      index += 1;
      const extensions = (r.client.bills ?? []).flatMap((bill) => bill.extensions ?? []).sort((a, b) => +new Date(b.extensionUntil) - +new Date(a.extensionUntil));
      const extensionNote = extensions[0] ? `<br><small>Extension until ${dateFmt.format(new Date(extensions[0].extensionUntil))}</small>` : "";
      body += `<tr><td>${index}</td><td><b>${r.client.fullName}</b><br><small>${r.client.clientCode}</small></td><td>${r.client.area}${r.client.address ? `<br><small>${r.client.address}</small>` : ""}</td><td>${r.client.primaryMobile ?? "—"}</td><td>${r.client.oldestDueDate ? dateFmt.format(new Date(r.client.oldestDueDate)) : "—"}</td><td>${r.client.openPeriods.join(", ")}</td><td class="num">${peso.format(r.client.outstanding)}</td><td>${r.client.serviceStatus.replaceAll("_", " ")}${extensionNote}</td><td style="min-width:90px"></td><td style="min-width:130px"></td></tr>`;
    }
  }
  const total = rows.reduce((sum, row) => sum + money(row.client.outstanding), 0);
  w.document.write(`<!doctype html><html><head><title>Collection List - ${collectorName}</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#111;font-size:11px}h2{margin:0 0 4px}.meta{display:flex;justify-content:space-between;margin:8px 0 14px}.summary{margin:10px 0;font-weight:bold}table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:5px;vertical-align:top}th{background:#eee}.area td{background:#dfe8f4;font-size:12px}.num{text-align:right;white-space:nowrap}small{color:#555}.foot{margin-top:18px;display:flex;justify-content:space-between}.line{display:inline-block;width:180px;border-bottom:1px solid #333;height:18px}</style></head><body><h2>ISP COLLECTION LIST</h2><div class="meta"><div><b>Collector / Installer:</b> ${collectorName}</div><div><b>Collection Date:</b> ${fmtDateInput(date)}</div></div><div class="summary">Areas: ${byArea.size} &nbsp;&nbsp; Clients: ${rows.length} &nbsp;&nbsp; Expected Outstanding: ${peso.format(total)}</div><table><thead><tr><th>#</th><th>Client</th><th>Area / Address</th><th>Mobile</th><th>Oldest Due</th><th>Open Month(s)</th><th>Balance</th><th>Service</th><th>Collected</th><th>Signature / Remarks</th></tr></thead><tbody>${body}</tbody></table><div class="foot"><div>Collector Signature: <span class="line"></span></div><div>Admin Check: <span class="line"></span></div></div><script>window.print()</script></body></html>`);
  w.document.close();
}

function printSoa(soa: StatementOfAccount) {
  const w = window.open("", "_blank", "width=850,height=900");
  if (!w) return;
  const rows = soa.openBills.map((b) => `<tr><td>${b.periodLabel}</td><td>${dateFmt.format(new Date(b.dueDate))}</td><td>${b.extensions?.[0] ? dateFmt.format(new Date(b.extensions[0].extensionUntil)) : "—"}</td><td style="text-align:right">${peso.format(money(b.amountDue))}</td><td style="text-align:right">${peso.format(money(b.balance))}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>SOA ${soa.client.clientCode}</title><style>body{font-family:Arial;padding:30px;color:#111}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}.r{display:flex;justify-content:space-between;margin:6px 0}.tot{font-size:18px;border-top:2px solid #222;padding-top:10px;margin-top:10px}</style></head><body><h2>STATEMENT OF ACCOUNT</h2><div>${soa.client.fullName} · ${soa.client.clientCode}</div><div>${soa.client.area} · ${soa.client.primaryMobile ?? "No mobile"}</div><table><thead><tr><th>Period</th><th>Billing Due</th><th>Extension Until</th><th style="text-align:right">Bill</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No open bills.</td></tr>'}</tbody></table><div style="max-width:380px;margin:25px 0 0 auto"><div class="r"><span>Outstanding</span><b>${peso.format(soa.outstanding)}</b></div><div class="r"><span>Advance Credit</span><b>-${peso.format(soa.client.creditBalance)}</b></div><div class="r tot"><b>NET AMOUNT DUE</b><b>${peso.format(soa.netDue)}</b></div></div><p style="margin-top:35px;font-size:11px;color:#666">Generated ${dateTimeFmt.format(new Date(soa.generatedAt))}</p><script>window.print()</script></body></html>`);
  w.document.close();
}

function printReceipt(receipt: Receipt) {
  const w = window.open("", "_blank", "width=600,height=800");
  if (!w) return;
  const allocations = receipt.allocations.map((a) => `<div class="r"><span>${a.bill.periodLabel}</span><span>${peso.format(money(a.amount))}</span></div>`).join("");
  const credit = (receipt.creditTransactions ?? []).reduce((sum, c) => sum + money(c.amount), 0);
  w.document.write(`<!doctype html><html><head><title>${receipt.receiptNo}</title><style>body{font-family:Arial;padding:28px;color:#111}.r{display:flex;justify-content:space-between;margin:7px 0}.dash{border-top:1px dashed #999;margin:18px 0}</style></head><body><h2 style="text-align:center">ISP PAYMENT RECEIPT</h2><div class="dash"></div><div class="r"><span>Receipt</span><b>${receipt.receiptNo}</b></div><div class="r"><span>Client</span><b>${receipt.client.fullName}</b></div><div class="r"><span>Date</span><span>${dateTimeFmt.format(new Date(receipt.paidAt))}</span></div><div class="dash"></div>${allocations}${credit > 0 ? `<div class="r"><span>Advance Credit</span><span>${peso.format(credit)}</span></div>` : ""}<div class="dash"></div><div class="r" style="font-size:18px"><b>TOTAL PAID</b><b>${peso.format(money(receipt.amount))}</b></div><div class="r"><span>Method</span><span>${receipt.method.replaceAll("_", " ")}</span></div><div class="r"><span>Received by</span><span>${receipt.receivedBy ?? "—"}</span></div><div class="r"><span>Approved by</span><span>${receipt.approvedBy ?? receipt.receivedBy ?? "Admin"}</span></div><script>window.print()</script></body></html>`);
  w.document.close();
}

export type FieldCollectionView = "ROUTE" | "EXCEPTIONS" | "SHEETS" | "APPROVALS" | "MY_ROUTE" | "MY_SUBMISSIONS";
type Props = { authUser: AuthUser | null; live: boolean; view: FieldCollectionView };
type AreaPlan = { area: string; clients: CollectionCandidate[]; total: number };
type ReviewDecision = "APPROVE" | "REJECT" | "NEEDS_INFO";
type ReviewTarget = { submission: PaymentSubmissionRow; decision: ReviewDecision } | null;

export default function FieldCollectionOps({ authUser, live, view }: Props) {
  const isAdmin = authUser?.role === "ADMIN";
  const [date, setDate] = useState(() => localDate(isAdmin ? 1 : 0));
  const [mode, setMode] = useState<CollectionCandidateMode>("OVERDUE_NEXT_3_DAYS");
  const [dueFrom, setDueFrom] = useState(() => localDate(0));
  const [dueTo, setDueTo] = useState(() => localDate(2));
  const [includeOverdue, setIncludeOverdue] = useState(true);
  const [includeExtended, setIncludeExtended] = useState(true);
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [areaDefaults, setAreaDefaults] = useState<AreaCollectorDefaultRow[]>([]);
  const [areaCollectorPlan, setAreaCollectorPlan] = useState<Record<string, number | "">>({});
  const [includedAreas, setIncludedAreas] = useState<Set<string>>(new Set());
  const [collectorId, setCollectorId] = useState<number | "">("");
  const [candidates, setCandidates] = useState<CollectionCandidate[]>([]);
  const [assignments, setAssignments] = useState<CollectionAssignmentRow[]>([]);
  const [assignedDates, setAssignedDates] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<PaymentSubmissionRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [payClient, setPayClient] = useState<CollectionAssignmentRow["client"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>(null);
  const [removeAssignmentTarget, setRemoveAssignmentTarget] = useState<CollectionAssignmentRow | null>(null);

  async function loadAssignedDates() {
    if (!live || !authUser || isAdmin) return;
    try {
      const dates = await api<string[]>("/field-collection/assignment-dates?limit=60");
      setAssignedDates(dates);
      if (dates.length && !dates.includes(date)) {
        const today = localDate(0);
        const upcoming = [...dates].filter((value) => value >= today).sort((a, b) => a.localeCompare(b))[0];
        const latestPast = [...dates].filter((value) => value < today).sort((a, b) => b.localeCompare(a))[0];
        const preferred = upcoming ?? latestPast;
        if (preferred && preferred !== date) setDate(preferred);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to load assigned collection dates.");
    }
  }

  async function load() {
    if (!live || !authUser) return;
    try {
      const requests: Promise<any>[] = [
        api<CollectionAssignmentRow[]>(`/field-collection/assignments?date=${date}`),
        api<PaymentSubmissionRow[]>("/payment-submissions?limit=200")
      ];
      if (isAdmin) {
        const params = new URLSearchParams({ date, mode, anchorDate: localDate(0), includeOverdue: String(includeOverdue), includeExtended: String(includeExtended) });
        if (mode === "CUSTOM") {
          params.set("dueFrom", dueFrom);
          params.set("dueTo", dueTo);
        }
        requests.push(
          api<OperatorUser[]>("/users"),
          api<CollectionCandidate[]>(`/field-collection/candidates?${params.toString()}`),
          api<AreaCollectorDefaultRow[]>("/field-collection/area-defaults")
        );
      }
      const [a, s, u, c, d] = await Promise.all(requests);
      setAssignments(a);
      setSubmissions(s);
      if (isAdmin) {
        const collectors = (u as OperatorUser[]).filter((x) => x.role === "COLLECTOR" && x.isActive);
        setUsers(u);
        if (!collectorId && collectors[0]) setCollectorId(collectors[0].id);
        setCandidates(c);
        setAreaDefaults(d);
        const savedMap: Record<string, number | ""> = {};
        for (const row of d as AreaCollectorDefaultRow[]) savedMap[row.area] = row.mapping?.collector?.isActive ? row.mapping.collectorId : "";
        setAreaCollectorPlan((previous) => {
          const next = { ...savedMap };
          for (const [areaName, collector] of Object.entries(previous)) if (collector && (c as CollectionCandidate[]).some((client) => client.area === areaName)) next[areaName] = collector;
          return next;
        });
        setIncludedAreas(new Set((c as CollectionCandidate[]).map((client) => client.area)));
        setSelected(new Set());
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to load field collection data.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, mode, dueFrom, dueTo, includeOverdue, includeExtended, live, authUser?.id]);

  useEffect(() => {
    if (!isAdmin) void loadAssignedDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, authUser?.id, isAdmin]);


  const collectors = useMemo(() => users.filter((u) => u.role === "COLLECTOR" && u.isActive), [users]);
  const areas = useMemo(() => [...new Set(candidates.map((c) => c.area))].sort(), [candidates]);
  const filtered = useMemo(() => candidates.filter((c) => (!area || c.area === area) && `${c.clientCode} ${c.fullName} ${c.area} ${c.primaryMobile ?? ""}`.toLowerCase().includes(q.toLowerCase())), [candidates, q, area]);
  const grouped = useMemo(() => {
    const map = new Map<number, CollectionAssignmentRow[]>();
    for (const row of assignments) map.set(row.collectorId, [...(map.get(row.collectorId) ?? []), row]);
    return map;
  }, [assignments]);
  const mySubByClient = useMemo(() => new Map(submissions.map((s) => [s.clientId, s])), [submissions]);
  const collectorAreaGroups = useMemo(() => {
    const map = new Map<string, CollectionAssignmentRow[]>();
    for (const row of assignments) map.set(row.client.area, [...(map.get(row.client.area) ?? []), row]);
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b));
  }, [assignments]);
  const areaPlans = useMemo<AreaPlan[]>(() => {
    const map = new Map<string, CollectionCandidate[]>();
    for (const client of candidates) map.set(client.area, [...(map.get(client.area) ?? []), client]);
    return [...map.entries()].map(([areaName, clients]) => ({ area: areaName, clients, total: clients.reduce((sum, client) => sum + money(client.outstanding), 0) })).sort((a, b) => a.area.localeCompare(b.area));
  }, [candidates]);
  const eligibleTotal = useMemo(() => candidates.reduce((sum, client) => sum + money(client.outstanding), 0), [candidates]);
  const criteriaLabel = useMemo(() => {
    if (mode !== "CUSTOM") return modeLabels[mode];
    return `${includeOverdue ? "Overdue + " : ""}${fmtDateInput(dueFrom)} to ${fmtDateInput(dueTo)}`;
  }, [mode, includeOverdue, dueFrom, dueTo]);

  async function assignSelected() {
    if (!collectorId || !selected.size) return;
    setBusy(true);
    const count = selected.size;
    try {
      await api("/field-collection/assignments", { method: "POST", body: JSON.stringify({ collectionDate: date, collectorId: Number(collectorId), clientIds: [...selected] }) });
      setSelected(new Set());
      setNotice(`Assigned ${count} client(s) to ${collectors.find((x) => x.id === Number(collectorId))?.displayName ?? "collector"}.`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAreaDefaults() {
    setBusy(true);
    try {
      const mappings = areaDefaults.map((row) => ({ area: row.area, collectorId: areaCollectorPlan[row.area] === "" || areaCollectorPlan[row.area] == null ? null : Number(areaCollectorPlan[row.area]) }));
      await api("/field-collection/area-defaults", { method: "PUT", body: JSON.stringify({ mappings }) });
      setNotice("Default collector per area saved. Future collection plans will use these defaults.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to save area defaults.");
    } finally {
      setBusy(false);
    }
  }

  async function assignByArea() {
    const activeAreas = areaPlans.filter((plan) => includedAreas.has(plan.area));
    const missing = activeAreas.filter((plan) => !areaCollectorPlan[plan.area]);
    if (missing.length) {
      setNotice(`Choose a collector for: ${missing.map((x) => x.area).join(", ")}.`);
      return;
    }
    const buckets = new Map<number, number[]>();
    for (const plan of activeAreas) {
      const id = Number(areaCollectorPlan[plan.area]);
      buckets.set(id, [...(buckets.get(id) ?? []), ...plan.clients.map((client) => client.id)]);
    }
    if (!buckets.size) {
      setNotice("Select at least one area to assign.");
      return;
    }
    setBusy(true);
    try {
      await Promise.all([...buckets.entries()].map(([id, clientIds]) => api("/field-collection/assignments", { method: "POST", body: JSON.stringify({ collectionDate: date, collectorId: id, clientIds, notes: `Area route plan · ${criteriaLabel}` }) })));
      const count = [...buckets.values()].reduce((sum, clientIds) => sum + clientIds.length, 0);
      setNotice(`Area route plan assigned ${count} client(s) across ${activeAreas.length} area(s).`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to assign area route plan.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveAssignment() {
    if (!removeAssignmentTarget) return;
    setBusy(true);
    try {
      await api(`/field-collection/assignments/${removeAssignmentTarget.id}`, { method: "DELETE" });
      setNotice(`${removeAssignmentTarget.client.fullName} removed from the collection route.`);
      setRemoveAssignmentTarget(null);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to remove assignment.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!payClient) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(`/clients/${payClient.id}/payment-submissions`, { method: "POST", body: fd });
      setNotice("Payment submitted. It is not official until admin approval.");
      setPayClient(null);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Unable to submit payment.");
    } finally {
      setBusy(false);
    }
  }

  function openReview(submission: PaymentSubmissionRow, decision: ReviewDecision) {
    setReviewTarget({ submission, decision });
  }

  async function submitReview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reviewTarget) return;
    const fd = new FormData(e.currentTarget);
    const { submission, decision } = reviewTarget;
    const reviewNotes = String(fd.get("reviewNotes") || "").trim();
    const approvedAmount = decision === "APPROVE" ? Number(fd.get("approvedAmount")) : undefined;

    if (decision === "APPROVE" && (!Number.isFinite(approvedAmount) || Number(approvedAmount) <= 0)) {
      setNotice("Enter a valid approved amount.");
      return;
    }
    if (decision !== "APPROVE" && !reviewNotes) {
      setNotice(decision === "REJECT" ? "Enter the rejection reason." : "Enter the information requested from the collector.");
      return;
    }

    setBusy(true);
    try {
      await api(`/payment-submissions/${submission.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, approvedAmount, reviewNotes: reviewNotes || undefined })
      });
      setNotice(
        decision === "APPROVE"
          ? "Payment approved and posted to the official ledger."
          : decision === "REJECT"
            ? "Payment submission rejected."
            : "Collector was asked for more information."
      );
      setReviewTarget(null);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function viewProof(s: PaymentSubmissionRow) {
    try {
      const blob = await apiBlob(`/payment-submissions/${s.id}/proof`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to open proof.");
    }
  }

  async function openSoa(clientId: number) {
    try {
      printSoa(await api<StatementOfAccount>(`/clients/${clientId}/soa`));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to load SOA.");
    }
  }

  async function openReceipt(paymentId: number) {
    try {
      printReceipt(await api<Receipt>(`/payments/${paymentId}/receipt`));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to load receipt.");
    }
  }

  if (!live) return <section className="panel"><EmptyState title="Field Collection requires the live database" description="Collector assignments, proof-of-payment, admin approval, and saved area routes are available when the app is connected to MySQL."/></section>;

  return <div className="space-y-5">
    {notice && <Notice>{notice}</Notice>}

    <section className="panel p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><ClipboardList size={18} className="text-slate-400"/><h2 className="text-base font-semibold">{
            view==="ROUTE" ? "Route Planner" :
            view==="EXCEPTIONS" ? "Client Exceptions" :
            view==="SHEETS" ? "Collector Sheets" :
            view==="APPROVALS" ? "Payment Approvals" :
            view==="MY_SUBMISSIONS" ? "My Submissions" : "My Route"
          }</h2></div>
          <p className="mt-1 text-sm text-slate-400">{isAdmin
            ? view==="ROUTE" ? "Choose collection criteria and assign areas to collectors."
              : view==="EXCEPTIONS" ? "Handle one-off client assignment exceptions without changing normal area ownership."
              : view==="SHEETS" ? "Review assigned routes and print collector sheets by collector."
              : "Review payment submissions from collectors before posting them to the official ledger."
            : view==="MY_SUBMISSIONS" ? "Review the payments you submitted for admin approval."
              : `Route for ${fmtDateInput(date)} · only clients assigned to your account are shown.`}</p>
          {!isAdmin && view==="MY_ROUTE" && assignedDates.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-500">Assigned dates:</span>{[...assignedDates].sort((a,b)=>a.localeCompare(b)).slice(0,8).map((assignedDate)=><button key={assignedDate} onClick={()=>setDate(assignedDate)} className={`btn-secondary !min-h-8 !px-2.5 text-xs ${date===assignedDate?"!border-[var(--accent)] !bg-[var(--accent-soft)] !text-[var(--accent)]":""}`}>{fmtDateInput(assignedDate)}</button>)}</div>}
        </div>
        <div className="flex flex-wrap items-end gap-2">{view!=="APPROVALS"&&view!=="MY_SUBMISSIONS"&&<label className="field-label">Collection date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mt-1 block"/></label>}<button onClick={() => void (isAdmin ? load() : Promise.all([load(), loadAssignedDates()]))} className="action-btn"><RefreshCcw size={15}/>Refresh</button></div>
      </div>
      {!isAdmin && view==="MY_ROUTE" && assignedDates.length===0 && <div className="notice notice-info mt-4">No collection dates are currently assigned to your account. Ask the admin to assign your route first.</div>}
    </section>

    {isAdmin && view==="ROUTE" && <>
      <section className="panel p-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div><h3 className="font-semibold">Collection criteria</h3><p className="mt-1 text-sm text-slate-500">Due-date filters are independent of the field collection date, so tomorrow's route can include overdue, due today, and clients due in the next few days.</p></div>
          <div className="text-sm text-slate-400">Current filter: <b className="text-[#8fc8df]">{criteriaLabel}</b></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["OVERDUE_NEXT_3_DAYS", "ALL_UNPAID", "OVERDUE", "TODAY", "TODAY_TOMORROW", "NEXT_3_DAYS", "CUSTOM"] as CollectionCandidateMode[]).map((value) => <button key={value} onClick={() => setMode(value)} className={`btn-secondary !min-h-8 !px-2.5 text-xs ${mode === value ? "!border-[var(--accent)] !bg-[var(--accent-soft)] !text-[var(--accent)]" : ""}`}>{modeLabels[value]}</button>)}
        </div>
        {mode === "CUSTOM" && <div className="subpanel mt-4 grid gap-3 p-3 md:grid-cols-[180px_180px_1fr] md:items-end"><label className="field-label">Due from<input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} className="field mt-1 w-full"/></label><label className="field-label">Due until<input type="date" value={dueTo} min={dueFrom} onChange={(e) => setDueTo(e.target.value)} className="field mt-1 w-full"/></label><label className="flex items-center gap-2 pb-2 text-sm text-slate-300"><input type="checkbox" checked={includeOverdue} onChange={(e) => setIncludeOverdue(e.target.checked)}/>Also include all earlier overdue balances</label></div>}
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={includeExtended} onChange={(e) => setIncludeExtended(e.target.checked)}/><span><b>Include temporarily extended clients</b><span className="mt-0.5 block text-xs text-slate-500">Extension never changes their real billing due date. Turn this off only when you intentionally want to skip them on this collection route.</span></span></label>
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><Metric label="Eligible clients" value={candidates.length}/><Metric label="Areas involved" value={areaPlans.length}/><Metric label="Total open balance" value={peso.format(eligibleTotal)} tone="warning"/></div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="font-semibold">Area route assignment</h3><p className="mt-1 text-sm text-slate-500">Keep nearby clients with the same collector to reduce back-and-forth travel and fuel cost. Save a default owner per area, but you can still change it for any collection day.</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void saveAreaDefaults()} className="action-btn">Save area defaults</button><button disabled={busy || !areaPlans.length} onClick={() => void assignByArea()} className="primary-btn">Assign selected areas</button></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {areaPlans.map((plan) => {
            const selectedArea = includedAreas.has(plan.area);
            const alreadyAssigned = plan.clients.filter((client) => client.assignment).length;
            return <div key={plan.area} className={`subpanel p-3 ${selectedArea ? "border-[var(--border-strong)]" : "opacity-55"}`}>
              <div className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={selectedArea} onChange={(e) => setIncludedAreas((prev) => { const next = new Set(prev); e.target.checked ? next.add(plan.area) : next.delete(plan.area); return next; })}/><div className="min-w-0 flex-1"><div className="font-semibold">{plan.area}</div><div className="mt-1 text-xs text-slate-500">{plan.clients.length} eligible · {alreadyAssigned} already assigned</div><div className="mt-2 text-lg font-bold text-[#e5be6d]">{peso.format(plan.total)}</div></div></div>
              <select value={areaCollectorPlan[plan.area] ?? ""} onChange={(e) => setAreaCollectorPlan((prev) => ({ ...prev, [plan.area]: Number(e.target.value) || "" }))} className="field mt-3 w-full" disabled={!selectedArea}><option value="">Choose collector</option>{collectors.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select>
            </div>;
          })}
          {!areaPlans.length && <div className="md:col-span-2 xl:col-span-3"><EmptyState title="No eligible clients" description="No subscribers match the selected due-date criteria. Change the preset or custom range."/></div>}
        </div>
      </section>

    </>}

    {isAdmin && view==="EXCEPTIONS" && <section className="panel p-4">
        <div><h3 className="font-semibold">Client exceptions</h3><p className="mt-1 text-sm text-slate-500">Use this for exceptions—move one client to the other collector without changing the area's normal route.</p></div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_220px_auto]"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-500"/><input value={q} onChange={(e) => setQ(e.target.value)} className="field w-full pl-9" placeholder="Search eligible clients"/></div><select value={area} onChange={(e) => setArea(e.target.value)} className="field"><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select><select value={collectorId} onChange={(e) => setCollectorId(Number(e.target.value) || "")} className="field"><option value="">Select collector</option>{collectors.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select><button disabled={!collectorId || !selected.size || busy} onClick={() => void assignSelected()} className="primary-btn disabled:opacity-40">Assign {selected.size || ""}</button></div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())}/>Select all shown</label><span className="text-slate-500">Showing {filtered.length} of {candidates.length} eligible clients</span></div>
        <div className="table-shell mt-4 max-h-[430px]"><table className="data-table min-w-[900px]"><thead className="sticky top-0"><tr><th className="px-4 py-3"></th><th>Client</th><th>Area</th><th>Oldest due</th><th>Open months</th><th className="text-right">Outstanding</th><th>Assigned</th></tr></thead><tbody>{filtered.map((c) => <tr key={c.id} ><td className="px-4 py-3"><input type="checkbox" checked={selected.has(c.id)} onChange={(e) => setSelected((prev) => { const next = new Set(prev); e.target.checked ? next.add(c.id) : next.delete(c.id); return next; })}/></td><td className="py-3"><b>{c.fullName}</b><div className="text-xs text-slate-500">{c.clientCode}</div></td><td>{c.area}</td><td>{c.oldestDueDate ? dateFmt.format(new Date(c.oldestDueDate)) : "—"}</td><td>{c.openPeriods.join(", ")}</td><td className="text-right font-semibold text-[#f09aa0]">{peso.format(c.outstanding)}</td><td>{c.assignment?.collector?.displayName ?? "—"}</td></tr>)}{!filtered.length&&<tr><td colSpan={7} className="p-0"><EmptyState title="No clients in this view" description="Adjust the search, area filter, or due-date criteria."/></td></tr>}</tbody></table></div>
      </section>}

    {isAdmin && view==="SHEETS" && <section className="panel p-4"><h3 className="font-semibold">Printable collector sheets</h3><p className="mt-1 text-sm text-slate-500">Each printout is automatically grouped by area, with area subtotals and blank paper fields for collected amount, signature, and remarks.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{collectors.map((u) => { const rows = grouped.get(u.id) ?? []; const collectorAreas = [...new Set(rows.map((r) => r.client.area))]; return <div key={u.id} className="subpanel p-4"><div className="flex items-start justify-between gap-3"><div><b>{u.displayName}</b><div className="mt-1 text-sm text-slate-500">{collectorAreas.length} area(s) · {rows.length} client(s) · {peso.format(rows.reduce((sum, r) => sum + r.client.outstanding, 0))}</div></div><button disabled={!rows.length} onClick={() => printCollectionList(rows, date, u.displayName)} className="action-btn disabled:opacity-40"><Printer size={15}/>Print</button></div>{rows.length > 0 && <div className="mt-3 max-h-44 overflow-auto text-xs text-slate-400">{rows.map((r) => <div key={r.id} className="flex justify-between gap-3 border-t border-[var(--border)] py-2"><span>{r.client.area} · {r.client.fullName}</span><button onClick={() => setRemoveAssignmentTarget(r)} className="btn-ghost !min-h-7 !px-2 !text-[#f09aa0]">Remove</button></div>)}</div>}</div>; })}{!collectors.length && <div className="text-sm text-slate-500">Create collector accounts in User Maintenance first.</div>}</div></section>}

    {!isAdmin && view==="MY_ROUTE" && <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Assigned clients</h3><p className="mt-1 text-sm text-slate-500">Sorted by area so nearby collections stay together.</p></div><div className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]">{assignments.length} client{assignments.length===1?"":"s"}</div></div></div>

      <div className="hidden overflow-x-auto md:block"><table className="data-table min-w-[900px]"><thead><tr><th className="px-5 py-3">Client</th><th>Area / Mobile</th><th>Oldest due</th><th>Open month(s)</th><th className="text-right">Outstanding</th><th>Submission</th><th></th></tr></thead><tbody>{assignments.map((r) => { const sub = mySubByClient.get(r.clientId); return <tr key={r.id}><td className="px-5 py-4"><b>{r.client.fullName}</b><div className="text-xs text-slate-500">{r.client.clientCode}</div></td><td>{r.client.area}<div className="text-xs text-slate-500">{r.client.primaryMobile ?? "No mobile"}</div></td><td>{r.client.oldestDueDate ? dateFmt.format(new Date(r.client.oldestDueDate)) : "—"}</td><td>{r.client.openPeriods.join(", ")}</td><td className="text-right font-semibold text-[#f09aa0]">{peso.format(r.client.outstanding)}</td><td>{sub ? <Badge value={sub.status}/> : <span className="text-slate-500">Not submitted</span>}</td><td className="px-5 py-4"><div className="flex gap-2"><button onClick={() => void openSoa(r.clientId)} className="btn-ghost !min-h-8 !px-2">SOA</button><button disabled={Boolean(sub && ["PENDING", "APPROVING"].includes(sub.status))} onClick={() => setPayClient(r.client)} className="btn-ghost !min-h-8 !px-2 !text-[#039855] disabled:!text-slate-600">Record payment</button></div></td></tr>; })}{!assignments.length && <tr><td colSpan={7} className="p-0"><EmptyState title="No assigned clients" description="Ask the admin to assign an area or client for this collection date."/></td></tr>}</tbody></table></div>

      <div className="collector-route-mobile md:hidden">
        {collectorAreaGroups.map(([areaName, rows])=><section key={areaName} className="collector-area-group">
          <div className="collector-area-header"><div className="flex items-center gap-2"><MapPin size={16}/><b>{areaName}</b></div><span>{rows.length} client{rows.length===1?"":"s"}</span></div>
          <div className="space-y-3">{rows.map((r)=>{const sub=mySubByClient.get(r.clientId);const paymentPending=Boolean(sub&&["PENDING","APPROVING"].includes(sub.status));return <article key={r.id} className="collector-client-card">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-base font-semibold text-slate-900">{r.client.fullName}</h4><div className="mt-1 text-xs text-slate-500">{r.client.clientCode}</div></div>{sub?<Badge value={sub.status}/>:<span className="status-badge status-neutral">Not submitted</span>}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><div className="text-xs text-slate-500">Outstanding</div><div className="mt-0.5 text-lg font-bold text-[#d92d20]">{peso.format(r.client.outstanding)}</div></div><div><div className="text-xs text-slate-500">Oldest due</div><div className="mt-1 font-semibold">{r.client.oldestDueDate?dateFmt.format(new Date(r.client.oldestDueDate)):"—"}</div></div></div>
            {r.client.openPeriods.length>0&&<div className="mt-3 text-xs text-slate-500">Open month(s): <b className="text-slate-700">{r.client.openPeriods.join(", ")}</b></div>}
            {r.client.primaryMobile&&<a href={`tel:${r.client.primaryMobile}`} className="collector-contact mt-3"><PhoneCall size={16}/><span>{r.client.primaryMobile}</span></a>}
            <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={()=>void openSoa(r.clientId)} className="btn-secondary collector-touch"><Printer size={16}/>SOA</button><button disabled={paymentPending} onClick={()=>setPayClient(r.client)} className="primary-btn collector-touch disabled:opacity-45"><WalletCards size={16}/>{paymentPending?"Submitted":"Record Payment"}</button></div>
          </article>})}</div>
        </section>)}
        {!assignments.length&&<EmptyState title="No assigned clients" description="Ask the admin to assign an area or client for this collection date."/>}
      </div>
    </section>}

    {((isAdmin && view==="APPROVALS") || (!isAdmin && view==="MY_SUBMISSIONS")) && <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--border)] p-4 sm:p-5"><div><h3 className="font-semibold">{isAdmin ? "Payment Approval Queue" : "My Payment Submissions"}</h3><p className="mt-1 text-sm text-slate-500">Official client balances change only after admin approval.</p></div><div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{submissions.length}</div></div>
      <div className="hidden overflow-x-auto md:block"><table className="data-table min-w-[1050px]"><thead><tr><th className="px-5 py-3">Client</th><th>Collector</th><th>Submitted</th><th>Method</th><th>Reference</th><th>Proof</th><th>Current due</th><th>Status</th><th></th></tr></thead><tbody>{submissions.map((s) => <tr key={s.id}><td className="px-5 py-4"><b>{s.client.fullName}</b><div className="text-xs text-slate-500">{s.client.clientCode} · {s.client.area}</div></td><td>{s.submittedBy.displayName}</td><td><b>{peso.format(s.amount)}</b><div className="text-xs text-slate-500">{dateTimeFmt.format(new Date(s.submittedAt))}</div></td><td>{s.method.replaceAll("_", " ")}</td><td>{s.referenceNo ?? "—"}</td><td>{s.hasProof ? <button onClick={() => void viewProof(s)} className="btn-ghost !min-h-8 !px-2"><Camera size={14}/>View</button> : <span className="text-slate-600">None</span>}</td><td>{peso.format(s.currentOutstanding)}</td><td><Badge value={s.status}/>{s.reviewNotes && <div className="mt-1 max-w-52 text-xs text-slate-500">{s.reviewNotes}</div>}</td><td className="px-5 py-4">{isAdmin && ["PENDING", "NEEDS_INFO"].includes(s.status) ? <div className="flex gap-2"><button disabled={busy} onClick={() => openReview(s, "APPROVE")} className="icon-btn !text-[#039855]" aria-label="Approve payment" title="Approve payment"><CheckCircle2 size={16}/></button><button disabled={busy} onClick={() => openReview(s, "NEEDS_INFO")} className="icon-btn !text-[#dc6803]" aria-label="Request information" title="Request information"><FileCheck2 size={16}/></button><button disabled={busy} onClick={() => openReview(s, "REJECT")} className="icon-btn !text-[#d92d20]" aria-label="Reject payment" title="Reject payment"><XCircle size={16}/></button></div> : s.status === "APPROVED" && s.paymentId ? <button onClick={() => void openReceipt(s.paymentId!)} className="btn-ghost !min-h-8 !px-2"><Printer size={14}/>Receipt</button> : null}</td></tr>)}{!submissions.length && <tr><td colSpan={9} className="p-0"><EmptyState title="No payment submissions" description={isAdmin ? "Collector payment submissions awaiting or completing review will appear here." : "Payments you submit for admin approval will appear here."}/></td></tr>}</tbody></table></div>
      <div className="space-y-3 p-3 md:hidden">{submissions.map((submission)=><article key={submission.id} className="collector-client-card"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate font-semibold text-slate-900">{submission.client.fullName}</h4><div className="mt-1 text-xs text-slate-500">{submission.client.area} · {submission.client.clientCode}</div></div><Badge value={submission.status}/></div><div className="mt-3 flex items-end justify-between gap-3"><div><div className="text-xs text-slate-500">Submitted amount</div><div className="mt-0.5 text-lg font-bold text-slate-900">{peso.format(submission.amount)}</div></div><div className="text-right text-xs text-slate-500">{dateTimeFmt.format(new Date(submission.submittedAt))}</div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="subpanel p-2"><span className="text-slate-500">Method</span><div className="mt-1 font-semibold">{submission.method.replaceAll("_"," ")}</div></div><div className="subpanel p-2"><span className="text-slate-500">Current due</span><div className="mt-1 font-semibold">{peso.format(submission.currentOutstanding)}</div></div></div>{submission.reviewNotes&&<div className="notice notice-info mt-3">{submission.reviewNotes}</div>}<div className="mt-4 flex flex-wrap gap-2">{submission.hasProof&&<button onClick={()=>void viewProof(submission)} className="btn-secondary collector-touch flex-1"><Camera size={16}/>Proof</button>}{isAdmin&&["PENDING","NEEDS_INFO"].includes(submission.status)&&<><button onClick={()=>openReview(submission,"APPROVE")} className="primary-btn collector-touch flex-1">Approve</button><button onClick={()=>openReview(submission,"NEEDS_INFO")} className="btn-secondary collector-touch flex-1">Needs Info</button><button onClick={()=>openReview(submission,"REJECT")} className="btn-danger collector-touch flex-1">Reject</button></>}{submission.status==="APPROVED"&&submission.paymentId&&<button onClick={()=>void openReceipt(submission.paymentId!)} className="btn-secondary collector-touch flex-1"><Printer size={16}/>Receipt</button>}</div></article>)}{!submissions.length&&<EmptyState title="No payment submissions" description={isAdmin?"Collector payment submissions awaiting or completing review will appear here.":"Payments you submit for admin approval will appear here."}/>}</div>
    </section>}

    <Dialog
      open={Boolean(reviewTarget)}
      title={reviewTarget?.decision==="APPROVE" ? "Approve collector payment" : reviewTarget?.decision==="REJECT" ? "Reject collector payment" : "Request more information"}
      description={reviewTarget ? `${reviewTarget.submission.client.fullName} · ${reviewTarget.submission.submittedBy.displayName} · submitted ${peso.format(reviewTarget.submission.amount)}` : undefined}
      onClose={() => { if (!busy) setReviewTarget(null); }}
    >
      {reviewTarget && <form onSubmit={submitReview} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="subpanel p-3"><div className="text-xs text-slate-500">Payment method</div><div className="mt-1 font-semibold">{reviewTarget.submission.method.replaceAll("_"," ")}</div></div>
          <div className="subpanel p-3"><div className="text-xs text-slate-500">Current outstanding</div><div className="mt-1 font-semibold">{peso.format(reviewTarget.submission.currentOutstanding)}</div></div>
        </div>
        {reviewTarget.decision==="APPROVE" && <label className="field-label block">Approved amount<input name="approvedAmount" type="number" min="0.01" step="0.01" defaultValue={Number(reviewTarget.submission.amount)} className="field mt-1 w-full" required/></label>}
        <label className="field-label block">
          {reviewTarget.decision==="APPROVE" ? "Approval note (optional)" : reviewTarget.decision==="REJECT" ? "Reason for rejection" : "Information needed"}
          <textarea name="reviewNotes" defaultValue={reviewTarget.submission.reviewNotes ?? ""} className="field mt-1 min-h-24 w-full" required={reviewTarget.decision!=="APPROVE"}/>
        </label>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          
          <button disabled={busy} className={reviewTarget.decision==="REJECT" ? "btn-danger" : "primary-btn"}>
            {busy ? "Saving..." : reviewTarget.decision==="APPROVE" ? "Approve payment" : reviewTarget.decision==="REJECT" ? "Reject submission" : "Request information"}
          </button>
        </div>
      </form>}
    </Dialog>

    <Dialog
      open={Boolean(removeAssignmentTarget)}
      title="Remove from collection route"
      description={removeAssignmentTarget ? `${removeAssignmentTarget.client.fullName} will be removed from this collector sheet only.` : undefined}
      onClose={() => { if (!busy) setRemoveAssignmentTarget(null); }}
    >
      <div className="notice notice-warning">This does not change the subscriber billing status or balance.</div>
      <div className="mt-5 flex justify-end gap-2">
        
        <button type="button" onClick={() => void confirmRemoveAssignment()} disabled={busy} className="btn-danger">{busy ? "Removing..." : "Remove assignment"}</button>
      </div>
    </Dialog>

    {payClient && <div className="dialog-backdrop"><div className="dialog max-w-lg"><div className="dialog-header"><div><h3 className="font-bold">Submit Payment for Approval</h3><p className="mt-1 text-sm text-slate-500">{payClient.fullName} · outstanding {peso.format(payClient.outstanding)}</p></div><button onClick={() => setPayClient(null)} className="icon-btn" aria-label="Close payment dialog" title="Close"><X size={17}/></button></div><form onSubmit={submitPayment} className="dialog-body space-y-4"><label className="field-label block">Amount received<input name="amount" type="number" step="0.01" min="0.01" defaultValue={payClient.outstanding} className="field mt-1 w-full" required/></label><label className="field-label block">Payment method<select name="method" className="field mt-1 w-full" defaultValue="CASH"><option value="CASH">Cash</option><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank Transfer</option><option value="OTHER">Other</option></select></label><label className="field-label block">Reference no. (GCash/bank)<input name="referenceNo" className="field mt-1 w-full"/></label><label className="field-label block">Proof of payment<input name="proof" type="file" accept="image/*,application/pdf" capture="environment" className="mt-2 block w-full text-sm text-slate-400"/><span className="mt-1 block text-xs text-slate-500">Required for GCash/bank; optional for cash. Max 5 MB.</span></label><label className="field-label block">Notes<textarea name="notes" className="field mt-1 min-h-20 w-full" placeholder="Cash received, sender name, special note..."/></label><Notice tone="warning">Submitting this does <b>not</b> mark the client paid. Admin must verify and approve it first.</Notice><button disabled={busy} className="primary-btn w-full"><Upload size={16}/>Submit for admin approval</button></form></div></div>}
  </div>;
}
