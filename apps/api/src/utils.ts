export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeKey(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase("en-PH");
}


export function normalizeAreaName(value: unknown): string {
  const raw = normalizeText(value);
  const key = raw.toLocaleLowerCase("en-PH").replace(/[^a-z0-9]+/g, " ").trim();
  const aliases: Record<string, string> = {
    "pob east": "Poblacion East",
    "poblacion east": "Poblacion East",
    "pob west": "Poblacion West",
    "poblacion west": "Poblacion West",
    "cacandungan": "Cacandongan",
    "cacandongan": "Cacandongan",
    "anulid": "Anulid", "nandacan": "Nandacan", "diaz": "Diaz", "vacante": "Vacante",
    "pogo": "Pogo", "palisoc": "Palisoc", "ketegan": "Ketegan", "laoac": "Laoac",
    "bongato": "Bongato", "bongato east": "Bongato East", "manambong": "Manambong"
  };
  return aliases[key] ?? raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = normalizeText(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dueDateFor(year: number, month: number, dueDay: number): Date {
  const maxDay = new Date(year, month, 0).getDate();
  const day = Math.max(1, Math.min(maxDay, dueDay));
  return new Date(year, month - 1, day, 12, 0, 0);
}

export function periodStartFor(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 12, 0, 0);
}

export function periodLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" })
    .format(periodStartFor(year, month));
}

export function receiptNo(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const stamp = String(now.getTime()).slice(-7);
  return `OR-${y}${m}${d}-${stamp}`;
}
