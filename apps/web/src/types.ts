export type ServiceStatus = "ACTIVE" | "EXTENDED" | "FOR_CUT" | "CUT" | "RECONNECTED" | "INACTIVE";
export type BillingStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "WAIVED";
export type PaymentMethod = "CASH" | "GCASH" | "BANK_TRANSFER" | "OTHER";
export type UserRole = "ADMIN" | "COLLECTOR" | "VIEWER";
export type RouterEnforcementPolicy = "WITH_CUT" | "NO_AUTO_CUT" | "MANUAL_ONLY";
export type NetworkProvisioningStatus = "FOR_LINKING" | "FOR_ACTIVATION" | "ACTIVE" | "SUSPENDED" | "FAILED" | "MIGRATION_REQUIRED";

export type AuthUser = { id: number; username: string; displayName: string; role: UserRole };
export type AuthResponse = { token: string; user: AuthUser };

export type Dashboard = {
  period?: string; clients: number; billed: number; collected: number; outstanding: number; availableCredit?: number; netReceivable?: number;
  paid: number; unpaid: number; partial: number; extended: number; cut: number; forCut: number;
};

export type ClientRow = {
  id: number; clientCode: string; fullName: string; primaryMobile?: string | null; alternateMobile?: string | null; area: string; address?: string | null;
  dueDay: number; monthlyRate: number; creditBalance?: number; serviceStatus: ServiceStatus; allowNotifications?: boolean; mikrotikAccount?: string | null; mikrotikProfile?: string | null;
  networkStatus?: NetworkProvisioningStatus; mikrotikDeviceId?: number | null; mikrotikDevice?: { id: number; name: string; enforcementPolicy: RouterEnforcementPolicy; isTrustedTier: boolean } | null;
  installedAt?: string | null; notes?: string | null; outstanding: number; openBills: number;
};

export type BillExtension = { id: number; clientId?: number; billId: number; extensionUntil: string; reason: string; notes?: string | null; approvedBy?: string | null; createdAt: string };
export type LedgerBill = { id: number; periodLabel: string; periodStart: string; originalDueDate: string; dueDate: string; amountDue: number | string; balance: number | string; status: BillingStatus; legacyStatus?: string | null; extensions?: BillExtension[] };
export type LedgerPayment = { id: number; receiptNo: string; paidAt: string; amount: number | string; method: PaymentMethod; referenceNo?: string | null; notes?: string | null; receivedBy?: string | null; approvedBy?: string | null; allocations?: Array<{ id?: number; amount: number | string; bill?: { id: number; periodLabel: string } }> };
export type DueDateChange = { id: number; billId?: number | null; oldDueDate: string; newDueDate: string; reason: string; notes?: string | null; changedBy?: string | null; changedAt: string };
export type ServiceAction = { id: number; type: string; effectiveAt: string; previousStatus: ServiceStatus; nextStatus: ServiceStatus; outstandingAtAction: number | string; reason?: string | null; notes?: string | null; performedBy?: string | null; routerAttempted?: boolean; routerSucceeded?: boolean | null; routerMessage?: string | null };
export type CreditTransaction = { id: number; type: "ADVANCE_PAYMENT" | "AUTO_APPLY" | "MANUAL_ADJUSTMENT"; amount: number | string; balanceAfter: number | string; notes?: string | null; createdAt: string };
export type MessageRow = { id: number; channel: string; destination: string; templateKey?: string | null; body: string; status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED"; errorMessage?: string | null; sentAt?: string | null; createdAt: string; client?: { clientCode: string; fullName: string } };

export type Ledger = ClientRow & { bills: LedgerBill[]; payments: LedgerPayment[]; dueDateChanges: DueDateChange[]; serviceActions: ServiceAction[]; creditTransactions?: CreditTransaction[]; messages?: MessageRow[]; billExtensions?: BillExtension[]; networkMigrations?: NetworkMigrationRow[] };

export type Receipt = {
  id: number; receiptNo: string; paidAt: string; amount: number | string; method: PaymentMethod; referenceNo?: string | null; notes?: string | null; receivedBy?: string | null; approvedBy?: string | null;
  client: { clientCode: string; fullName: string; primaryMobile?: string | null; area: string; address?: string | null; creditBalance?: number | string };
  allocations: Array<{ amount: number | string; bill: { periodLabel: string; amountDue: number | string; balance: number | string } }>;
  creditTransactions?: Array<{ amount: number | string; balanceAfter: number | string }>;
};

export type StatementOfAccount = {
  generatedAt: string;
  client: { id: number; clientCode: string; fullName: string; primaryMobile?: string | null; area: string; address?: string | null; dueDay: number; monthlyRate: number; creditBalance: number; serviceStatus: ServiceStatus; networkStatus?: NetworkProvisioningStatus; mikrotikDevice?: MikrotikDeviceRow | null };
  openBills: LedgerBill[]; recentPayments: LedgerPayment[]; outstanding: number; netDue: number;
};

export type OperatorUser = { id: number; username: string; displayName: string; role: UserRole; isActive: boolean; lastLoginAt?: string | null; createdAt?: string };
export type AuditRow = { id: number; actor?: string | null; action: string; entityType: string; entityId?: string | null; details?: unknown; createdAt: string };

export type SystemConfig = {
  id: number; autoBillingEnabled: boolean; messagingEnabled: boolean; reminderDaysBefore: number; overdueReminderDays: number;
  smsProvider: "LOG_ONLY" | "WEBHOOK"; smsWebhookUrl?: string | null; mikrotikEnabled: boolean; mikrotikBaseUrl?: string | null;
  routerRetryEnabled: boolean; routerRetryMinutes: number; autoReconnectOnPayment: boolean;
  defaultGraceDays: number; dueDateReminderEnabled: boolean; graceReminderEnabled: boolean; finalWarningEnabled: boolean; autoCutAfterGrace: boolean;
  trustedQualificationMonths: number; trustedDowngradeUnpaidMonths: number;
  automaticBackupEnabled: boolean; backupHour: number; backupRetentionDays: number; updatedAt?: string;
};
export type RouterJobRow = {
  id: number; clientId: number; serviceActionId?: number | null; action: "DISABLE_PPPOE" | "ENABLE_PPPOE";
  account: string; status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED"; attempts: number; maxAttempts: number;
  nextAttemptAt: string; lastAttemptAt?: string | null; lastError?: string | null; createdAt: string;
  client?: { clientCode: string; fullName: string };
};
export type BackupFileRow = { fileName: string; sizeBytes: number; modifiedAt: string };

export type PaymentSubmissionStatus = "PENDING" | "APPROVING" | "APPROVED" | "REJECTED" | "NEEDS_INFO";

export type CollectionCandidateMode = "ALL_UNPAID" | "OVERDUE" | "TODAY" | "TODAY_TOMORROW" | "NEXT_3_DAYS" | "OVERDUE_NEXT_3_DAYS" | "CUSTOM";
export type AreaCollectorDefaultRow = {
  area: string;
  mapping?: { id: number; area: string; collectorId: number; updatedBy?: string | null; createdAt: string; updatedAt: string; collector: { id: number; username: string; displayName: string; isActive: boolean; role: UserRole } } | null;
};
export type CollectionCandidate = ClientRow & {
  oldestDueDate?: string | null;
  openPeriods: string[];
  bills?: LedgerBill[];
  assignment?: { id: number; collectorId: number; collector?: { id: number; displayName: string; username: string } } | null;
};
export type CollectionAssignmentRow = {
  id: number; collectionDate: string; collectorId: number; clientId: number; assignedBy?: string | null; notes?: string | null; createdAt: string;
  collector: { id: number; username: string; displayName: string };
  client: CollectionCandidate;
};
export type PaymentSubmissionRow = {
  id: number; clientId: number; submittedByUserId: number; reviewedByUserId?: number | null; paymentId?: number | null;
  amount: number; approvedAmount?: number | null; method: PaymentMethod; referenceNo?: string | null; notes?: string | null;
  proofMime?: string | null; proofFileName?: string | null; hasProof: boolean; status: PaymentSubmissionStatus; reviewNotes?: string | null;
  submittedAt: string; reviewedAt?: string | null; currentOutstanding: number;
  client: { id: number; clientCode: string; fullName: string; area: string; primaryMobile?: string | null; serviceStatus: ServiceStatus };
  submittedBy: { id: number; displayName: string; username: string };
  reviewedBy?: { id: number; displayName: string; username: string } | null;
};


export type MikrotikDeviceRow = {
  id: number; name: string; baseUrl: string; credentialKey: string; enforcementPolicy: RouterEnforcementPolicy; isTrustedTier: boolean; isActive: boolean; notes?: string | null;
  createdAt?: string; updatedAt?: string; _count?: { clients: number };
};
export type AreaRouterDefaultRow = { area: string; mapping?: { id: number; area: string; mikrotikDeviceId: number; mikrotikDevice: MikrotikDeviceRow } | null };
export type NetworkActivationClient = ClientRow & { networkStatus: NetworkProvisioningStatus; mikrotikDevice?: MikrotikDeviceRow | null };
export type NetworkMigrationRow = { id: number; clientId: number; fromDeviceId?: number | null; toDeviceId: number; status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED"; reason: string; performedBy?: string | null; errorMessage?: string | null; startedAt?: string | null; completedAt?: string | null; createdAt: string; client?: { clientCode: string; fullName: string; area: string }; fromDevice?: MikrotikDeviceRow | null; toDevice?: MikrotikDeviceRow };
export type NetworkRecommendations = {
  rules: { trustedQualificationMonths: number; trustedDowngradeUnpaidMonths: number };
  promote: Array<{ clientId: number; clientCode: string; fullName: string; area: string; currentRouter: string; paidStreak: number; targets: Array<{id:number;name:string}> }>;
  downgrade: Array<{ clientId: number; clientCode: string; fullName: string; area: string; currentRouter: string; unpaidMonths: number; outstanding: number; targets: Array<{id:number;name:string}> }>;
};
