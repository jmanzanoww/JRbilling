# ISP Billing & Collection System v0.7.2

Local/LAN-first ISP billing, collection, subscriber management, payment approval, messaging, multi-MikroTik provisioning, grace-period enforcement, and route-based field collection.


## v0.7.2 Router Topology Correction

Actual topology correction:

- **MikroTik 1 · WITH_CUT** — Anulid, Nandacan, Diaz, Vacante, Poblacion East, Poblacion West.
- **MikroTik 2 · WITH_CUT** — Pogo, Palisoc, Ketegan, Cacandongan, Laoac.
- **MikroTik 3 · NO_AUTO_CUT / Trusted** — good-payer destination; no fixed area mapping by default.

Good-payer promotion may recommend moving a qualified subscriber from MikroTik 1 or 2 to MikroTik 3. Trusted-watchlist downgrade may recommend moving a delinquent MikroTik 3 subscriber back to an Admin-selected **WITH_CUT** router. No client is moved automatically.

For databases that already loaded v0.7.1 real data, startup applies this topology correction once without reimporting clients or changing billing history.

## v0.7.1 Real-Data Pilot + Existing PPPoE Linking

This release bundles the approved migration snapshot from the uploaded **`paid for this month`** worksheet (September 2026) and adds a safe workflow for existing subscribers.

### Real-data migration summary

- **268** complete unique client records are ready to load.
- **11** incomplete rows are intentionally held in Import Review because due day, monthly rate, or area is missing. No values are guessed.
- Duplicate rows are consolidated by normalized `area + client name`; the later complete row is treated as the current snapshot.
- Paid rows are marked `PAID` with zero balance, but the system does **not fabricate payment dates or receipts** that were not present in the workbook.
- Existing subscribers are assigned `FOR_LINKING`, not `FOR_ACTIVATION`.

### Approved area → MikroTik defaults

**MikroTik 1 · WITH_CUT**
- Anulid
- Nandacan
- Diaz
- Vacante
- Poblacion East
- Poblacion West

**MikroTik 2 · WITH_CUT**
- Pogo
- Palisoc
- Ketegan
- Cacandongan (normalizes workbook spelling `cacandungan`)
- Laoac

**MikroTik 3 · NO_AUTO_CUT / Trusted** has no default area mapping; it is reserved for approved good-payer migrations.

The current workbook also contains **Bongato, Bongato East, and Manambong**. These clients are imported but intentionally have no default MikroTik until Admin assigns one in **Network → Area → default MikroTik**. All mappings remain editable.

### Existing client network linking

Real clients should already have a PPPoE secret on a router. For safety, imported clients appear in **Network → Existing Subscribers to Link**. Admin chooses/confirms the router and existing PPPoE username; the system verifies that the secret exists and stores the router/profile link without creating or modifying the secret. An optional current PPPoE password can be stored encrypted to support future automated router migration.

New subscribers created inside the app continue to use **FOR_ACTIVATION** and the explicit Create/Activate PPPoE flow.

## v0.7.0 Multi-MikroTik + Grace / Extension Enforcement

This release builds on v0.6.2. Existing billing, payment approval, collection routing, receipt/SOA, users/permissions, backup, messaging, and UI behavior are preserved.

### New subscriber / network lifecycle

Saving a subscriber **does not automatically create a MikroTik account**.

1. Save the subscriber in Client Master.
2. The subscriber receives network status **FOR ACTIVATION**.
3. The area's saved MikroTik mapping can preselect/suggest a router.
4. Admin opens **Network → For Activation**.
5. Admin chooses/confirms the MikroTik, PPPoE username, PPP profile, and password (or lets the system generate one).
6. Only after successful RouterOS provisioning does the network status become **ACTIVE**.
7. Failed provisioning remains visible and can be retried without losing the billing/client record.

The PPPoE password is encrypted before being stored in MySQL. Router credentials are never stored in the browser/client record; each router points to server-side environment variables through its `credentialKey`.

### Multiple MikroTik devices

Admin can register multiple routers with independent:

- Name and REST base URL
- Credential key
- Active/inactive state
- Area default mapping
- Enforcement policy
- Trusted/good-payer tier flag

Supported enforcement policies:

- **WITH_CUT** — normal router; automatic cut may occur after grace/extension if global auto-cut is enabled.
- **NO_AUTO_CUT** — trusted/good-payer router; billing continues and reminders still work, but the automation never cuts the subscriber.
- **MANUAL_ONLY** — service suspension is an explicit admin action.

### Trusted / good-payer migration

Network includes two recommendation queues. They **do not move clients automatically**:

- **Eligible for trusted router** — subscriber is on a With Cut router, has no past-due balance, and meets the configured consecutive-paid-month threshold. Bills that are not due yet do not break the streak.
- **Trusted watchlist** — subscriber is on a No Auto Cut router and reaches the configured **past-due unpaid-month** threshold. Bills that are not due yet are ignored.

Admin approves the migration. The migration workflow provisions the same PPPoE credentials/profile on the destination router, disables the old account, enables the destination account, removes the old secret after success, and records migration history. Billing history, receipts, balances, due day, and client identity are unchanged.

If an active subscriber's area is edited and that area's default MikroTik differs from the current router, the system marks the network account **MIGRATION REQUIRED**. It appears in a dedicated queue; the client is never silently moved.

### Grace period rule

Grace period affects **service enforcement only**. It never changes the billing due date and never changes who appears in due-date-based collection printing.

Example with a 3-day grace period:

- Billing due: **September 30**
- Grace days: Oct 1, Oct 2, Oct 3
- Eligible cut date: **October 4**

A due-date reminder can be queued on September 30. Grace/final warning messages are configurable. Automatic cut occurs only when:

- the cut date has arrived,
- global **Auto cut after grace** is enabled,
- the assigned router policy is **WITH_CUT**, and
- the subscriber has a provisioned active network account.

On `NO_AUTO_CUT`, the balance remains overdue but the internet is not automatically suspended.

### Temporary extension rule

An extension is a **one-time payment/service protection for one unpaid bill**. It does not modify `Client.dueDay` and does not rewrite the bill's billing due date.

Example:

- Regular due day: 30
- September billing due: Sep 30
- Admin approves extension until: Oct 5
- September billing still displays due **Sep 30**
- Network protection is extended through **Oct 5**
- Next regular bill remains due **Oct 30**

A permanent due-day change remains a separate, explicit admin operation.

### Collection print behavior

Field Collection continues to select clients by the **real billing due date / previous unpaid balances**, not grace/cut dates.

The Collection Route Builder now also has **Include temporarily extended clients**:

- ON (default): extended clients remain eligible according to their original due date.
- OFF: admin can intentionally skip them for this field route while their approved temporary extension is active.

This toggle only affects the route list. It does not modify billing or due dates.

### Setup / upgrade

1. Back up the existing v0.6.x database.
2. Update `apps/api/.env` from the new `.env.example` and set a permanent `NETWORK_SECRET_KEY`.
3. Add per-router credentials such as `MIKROTIK_MT1_USER` / `MIKROTIK_MT1_PASSWORD`.
4. Run `npm install` if dependencies are not already installed.
5. Run `npm run db:push` to add the v0.7 tables/columns without rebuilding the database.
6. Run the application and open **Network** as Admin.
7. Add each MikroTik device, test the connection, set the enforcement policy, and map areas to their normal router.
8. Existing/imported subscribers that are not confirmed against a router can be processed from **For Activation**.

> Keep `NETWORK_SECRET_KEY` private and stable. It is used to decrypt stored subscriber PPPoE secrets for future router migration.

---

## v0.6.2 Professional Operations UI

This release is a UI/UX redesign on top of the stable v0.6.1 workflow. It does **not** rebuild the application or intentionally change business rules.

- Root `DESIGN.md` defines the product visual system.
- Flat, mature operations UI replaces gradient/glass/template-like styling.
- Dashboard, subscriber master/detail, billing, collection/service tables, Field Collection, Admin, dialogs, forms, and login styling were standardized.
- Mobile/tablet navigation was added so hidden desktop navigation no longer makes modules unreachable.
- Shared `StatusBadge`, `Metric`, `Notice`, `EmptyState`, and `LoadingState` components reduce duplicated visual logic.
- `UI-REVIEW.md` contains the Anti-Vibe-Code review and known follow-up cleanup items.

The v0.6.1 route planning and v0.6 payment approval behavior below remain intact.

## v0.6.1 Collection Route Builder

The field collection list is no longer fixed to "due on/before tomorrow." Admin can choose exactly which clients should be prepared for a collection day.

### Flexible eligibility presets

- **Overdue + next 3 days** (recommended everyday preset)
- **All unpaid**
- **All overdue**
- **Due today**
- **Due today + tomorrow**
- **Due in next 3 days**
- **Custom due range**, with an option to include every older overdue balance

The **collection date** and the **billing due-date filter** are independent. Example: on September 29, Admin can prepare a September 30 route containing older unpaid accounts plus clients due September 29, September 30, and October 1.

## Area-first collection planning

Because the same two staff work as installer + collector, v0.6.1 prioritizes route efficiency:

1. Eligible clients are grouped by **Area/Barangay**.
2. Each area card shows client count and total open balance.
3. Admin chooses Collector 1 or Collector 2 for the entire area.
4. Admin can save that choice as the **default collector for that area**.
5. For a particular day, the area can be temporarily assigned to the other collector without changing the saved default.
6. Individual clients can still be manually reassigned as exceptions.
7. Areas can be unchecked entirely when the team does not want to visit that area on that collection day.

This prevents random client splitting that causes unnecessary motorcycle travel and fuel cost.

## Printable paper collection sheets

One printout is generated per collector/installer and is automatically grouped by area. It includes:

- Area heading and area subtotal
- Client name / client ID
- Address and mobile number
- Oldest due date
- Open billing months
- Total outstanding balance
- Service status
- Blank **Collected Amount** field
- Blank **Signature / Remarks** field
- Collector and Admin signature lines

Clients are sorted by **Area → Address → Client Name** to keep the paper route organized even when phones or network access are unavailable.

## v0.6 payment approval workflow retained

- Collectors see only assigned clients for the selected collection date.
- Collector can print the client's Statement of Account.
- Full and partial payments can be submitted.
- Cash proof is optional; GCash/bank proof is required.
- Collector submissions remain **Pending Approval** and do not change the official ledger.
- Admin approves/rejects/requests information.
- Only approved payments update balances, payment allocation, official collection totals, receipt, and optional reconnect logic.
- Receipt keeps **Received by** and **Approved by** separately.

## Upgrade / setup

1. Install Node.js and MySQL.
2. Configure `apps/api/.env` from `.env.example`.
3. Run `npm install`.
4. Run `npm run db:push` to add the new `AreaCollectorDefault` table without rebuilding the existing database.
5. Run `npm run dev`, or use the existing production Windows-service scripts.
6. In **Field Collection**, set the normal collector for each area and click **Save area defaults**.

> Existing v0.6 clients, bills, payments, proofs, collector assignments, service history, SMS queue, MikroTik jobs, and backups remain compatible. v0.6.1 backups also include saved area-to-collector defaults.
