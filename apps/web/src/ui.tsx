import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle } from "lucide-react";
import { Card } from "./components/ui";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const icon = tone === "success" ? <CheckCircle2 size={16}/> : tone === "danger" ? <AlertCircle size={16}/> : null;
  return <div className={`notice notice-${tone}`}>{icon}{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Inbox size={20}/><div><div className="empty-title">{title}</div><div className="empty-description">{description}</div></div>{action}</div>;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="animate-spin" size={17}/>{label}</div>;
}

export function Metric({ label, value, note, tone = "neutral" }: { label: string; value: ReactNode; note?: string; tone?: Tone }) {
  return <Card className={`metric metric-${tone}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{note && <div className="metric-note">{note}</div>}</Card>;
}

const statusTone: Record<string, Tone> = {
  ACTIVE: "success", PAID: "success", APPROVED: "success", SUCCEEDED: "success", SENT: "success", RECONNECTED: "info",
  EXTENDED: "warning", PARTIAL: "warning", QUEUED: "warning", PENDING: "warning", PROCESSING: "info", NEEDS_INFO: "warning", FOR_ACTIVATION: "warning", MIGRATION_REQUIRED: "warning", NO_AUTO_CUT: "info",
  FOR_CUT: "danger", CUT: "danger", OVERDUE: "danger", FAILED: "danger", REJECTED: "danger", SUSPENDED: "danger",
  WITH_CUT: "success", MANUAL_ONLY: "neutral", INACTIVE: "neutral", UNPAID: "neutral", SKIPPED: "neutral"
};

export function StatusBadge({ value }: { value: string }) {
  const tone = statusTone[value] ?? "neutral";
  return <span className={`status-badge status-${tone}`}>{value.replaceAll("_", " ")}</span>;
}
