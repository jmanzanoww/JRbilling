import type { ClientRow, Dashboard, Ledger } from "./types";

export const demoDashboard: Dashboard = {
  period: "2026-09",
  clients: 283,
  billed: 264600,
  collected: 209800,
  outstanding: 54800,
  availableCredit: 1500,
  netReceivable: 53300,
  paid: 215,
  unpaid: 64,
  partial: 1,
  extended: 7,
  cut: 3,
  forCut: 11
};

export const demoClients: ClientRow[] = [
  { id: 1, clientCode: "ISP-00001", fullName: "Sample Client A", primaryMobile: "09171230123", area: "Anulid", dueDay: 2, monthlyRate: 1000, creditBalance: 0, serviceStatus: "ACTIVE", networkStatus: "ACTIVE", mikrotikDeviceId: 1, mikrotikDevice: { id: 1, name: "MT-01 Standard", enforcementPolicy: "WITH_CUT", isTrustedTier: false }, outstanding: 0, openBills: 0, allowNotifications: true },
  { id: 2, clientCode: "ISP-00002", fullName: "Sample Client B", primaryMobile: "09184404401", area: "Vacante", dueDay: 15, monthlyRate: 1000, creditBalance: 0, serviceStatus: "CUT", networkStatus: "SUSPENDED", mikrotikDeviceId: 1, mikrotikDevice: { id: 1, name: "MT-01 Standard", enforcementPolicy: "WITH_CUT", isTrustedTier: false }, outstanding: 2000, openBills: 2, allowNotifications: true },
  { id: 3, clientCode: "ISP-00003", fullName: "Sample Client C", primaryMobile: "09202872871", area: "Palisoc", dueDay: 25, monthlyRate: 1000, creditBalance: 1500, serviceStatus: "EXTENDED", networkStatus: "ACTIVE", mikrotikDeviceId: 2, mikrotikDevice: { id: 2, name: "MikroTik 2", enforcementPolicy: "WITH_CUT", isTrustedTier: false }, outstanding: 1000, openBills: 1, allowNotifications: true },
  { id: 4, clientCode: "ISP-00004", fullName: "Sample Client D", primaryMobile: "09957227220", area: "Diaz", dueDay: 15, monthlyRate: 1000, creditBalance: 0, serviceStatus: "ACTIVE", networkStatus: "FOR_ACTIVATION", outstanding: 500, openBills: 1, allowNotifications: true },
  { id: 5, clientCode: "ISP-00005", fullName: "Sample Client E", primaryMobile: "09369919914", area: "Ketegan", dueDay: 14, monthlyRate: 800, creditBalance: 0, serviceStatus: "FOR_CUT", networkStatus: "ACTIVE", mikrotikDeviceId: 1, mikrotikDevice: { id: 1, name: "MT-01 Standard", enforcementPolicy: "WITH_CUT", isTrustedTier: false }, outstanding: 1600, openBills: 2, allowNotifications: false }
];

const iso = (value: string) => new Date(value).toISOString();

export const demoLedgers: Record<number, Ledger> = {
  1: {
    ...demoClients[0],
    bills: [
      { id: 101, periodLabel: "September 2026", periodStart: iso("2026-09-01"), originalDueDate: iso("2026-09-02"), dueDate: iso("2026-09-02"), amountDue: 1000, balance: 0, status: "PAID" }
    ],
    payments: [
      { id: 501, receiptNo: "OR-20260902-0001", paidAt: iso("2026-09-02T08:15:00+08:00"), amount: 1000, method: "CASH", allocations: [{ amount: 1000, bill: { id: 101, periodLabel: "September 2026" } }] }
    ],
    dueDateChanges: [],
    serviceActions: [],
    creditTransactions: []
  },
  2: {
    ...demoClients[1],
    bills: [
      { id: 203, periodLabel: "September 2026", periodStart: iso("2026-09-01"), originalDueDate: iso("2026-09-15"), dueDate: iso("2026-09-15"), amountDue: 1000, balance: 1000, status: "OVERDUE" },
      { id: 202, periodLabel: "August 2026", periodStart: iso("2026-08-01"), originalDueDate: iso("2026-08-15"), dueDate: iso("2026-08-15"), amountDue: 1000, balance: 1000, status: "OVERDUE" },
      { id: 201, periodLabel: "July 2026", periodStart: iso("2026-07-01"), originalDueDate: iso("2026-07-15"), dueDate: iso("2026-07-15"), amountDue: 1000, balance: 0, status: "PAID" }
    ],
    payments: [
      { id: 502, receiptNo: "OR-20260715-0002", paidAt: iso("2026-07-15T10:20:00+08:00"), amount: 1000, method: "GCASH", referenceNo: "GC-072615", allocations: [{ amount: 1000, bill: { id: 201, periodLabel: "July 2026" } }] }
    ],
    dueDateChanges: [],
    serviceActions: [
      { id: 801, type: "CUT", effectiveAt: iso("2026-09-20T09:00:00+08:00"), previousStatus: "FOR_CUT", nextStatus: "CUT", outstandingAtAction: 2000, reason: "Unpaid previous and current month" }
    ],
    creditTransactions: []
  },
  3: {
    ...demoClients[2],
    bills: [
      { id: 303, periodLabel: "September 2026", periodStart: iso("2026-09-01"), originalDueDate: iso("2026-09-25"), dueDate: iso("2026-09-25"), amountDue: 1000, balance: 1000, status: "OVERDUE", extensions: [{ id: 1001, clientId: 3, billId: 303, extensionUntil: iso("2026-09-30"), reason: "Client requested 5 more days", approvedBy: "Admin", createdAt: iso("2026-09-25T08:30:00+08:00") }] },
      { id: 302, periodLabel: "August 2026", periodStart: iso("2026-08-01"), originalDueDate: iso("2026-08-25"), dueDate: iso("2026-08-25"), amountDue: 1000, balance: 0, status: "PAID" }
    ],
    payments: [{ id: 503, receiptNo: "OR-20260824-0003", paidAt: iso("2026-08-24T17:11:00+08:00"), amount: 1000, method: "CASH", allocations: [{ amount: 1000, bill: { id: 302, periodLabel: "August 2026" } }] }],
    dueDateChanges: [],
    billExtensions: [{ id: 1001, clientId: 3, billId: 303, extensionUntil: iso("2026-09-30"), reason: "Client requested 5 more days", approvedBy: "Admin", createdAt: iso("2026-09-25T08:30:00+08:00") }],
    serviceActions: [{ id: 802, type: "EXTEND", effectiveAt: iso("2026-09-25T08:30:00+08:00"), previousStatus: "ACTIVE", nextStatus: "EXTENDED", outstandingAtAction: 1000, reason: "Temporary payment extension to Sep 30" }],
    creditTransactions: [{ id: 901, type: "ADVANCE_PAYMENT", amount: 1500, balanceAfter: 1500, notes: "Advance payment", createdAt: iso("2026-09-26T09:00:00+08:00") }]
  },
  4: {
    ...demoClients[3],
    bills: [
      { id: 403, periodLabel: "September 2026", periodStart: iso("2026-09-01"), originalDueDate: iso("2026-09-15"), dueDate: iso("2026-09-15"), amountDue: 1000, balance: 500, status: "PARTIAL" }
    ],
    payments: [{ id: 504, receiptNo: "OR-20260915-0004", paidAt: iso("2026-09-15T12:01:00+08:00"), amount: 500, method: "CASH", allocations: [{ amount: 500, bill: { id: 403, periodLabel: "September 2026" } }] }],
    dueDateChanges: [],
    serviceActions: [],
    creditTransactions: []
  },
  5: {
    ...demoClients[4],
    bills: [
      { id: 503, periodLabel: "September 2026", periodStart: iso("2026-09-01"), originalDueDate: iso("2026-09-14"), dueDate: iso("2026-09-14"), amountDue: 800, balance: 800, status: "OVERDUE" },
      { id: 502, periodLabel: "August 2026", periodStart: iso("2026-08-01"), originalDueDate: iso("2026-08-14"), dueDate: iso("2026-08-14"), amountDue: 800, balance: 800, status: "OVERDUE" }
    ],
    payments: [],
    dueDateChanges: [],
    serviceActions: [{ id: 803, type: "MARK_FOR_CUT", effectiveAt: iso("2026-09-22T13:00:00+08:00"), previousStatus: "ACTIVE", nextStatus: "FOR_CUT", outstandingAtAction: 1600, reason: "2 months unpaid" }],
    creditTransactions: []
  }
};
