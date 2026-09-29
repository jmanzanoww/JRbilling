# Changelog

## v0.7.2 — MikroTik 3 Trusted Router Correction

- Corrected real topology: MikroTik 1 and MikroTik 2 are standard `WITH_CUT` area routers.
- Added/seeds MikroTik 3 as the dedicated `NO_AUTO_CUT` trusted/good-payer router.
- Kept Pogo/Palisoc/Ketegan/Cacandongan/Laoac mapped to MikroTik 2; trusted-router eligibility now targets MikroTik 3 through the existing generic trusted-target logic.
- Added one-time backward-compatible startup correction for databases that already imported v0.7.1; no client billing data or area mapping is reimported.
- No linked subscriber is automatically migrated during the correction.


## v0.7.1 — Real Data Pilot & Existing PPPoE Linking

- Bundled cleaned September 2026 client snapshot from the uploaded `paid for this month` sheet.
- Added one-click Admin preview/import of **268** complete unique clients; **11** incomplete rows remain visible for manual review instead of guessed values.
- Normalized area aliases including `pob.east` → `Poblacion East` and `cacandungan` → `Cacandongan`.
- Seeded editable defaults: MikroTik 1 = WITH_CUT for Anulid/Nandacan/Diaz/Vacante/Poblacion East/Poblacion West; MikroTik 2 = WITH_CUT for Pogo/Palisoc/Ketegan/Cacandongan/Laoac; MikroTik 3 = NO_AUTO_CUT trusted with no fixed area mapping.
- Bongato, Bongato East, and Manambong are intentionally imported with no default router until Admin assigns them.
- Added `FOR_LINKING` network state for migrated existing subscribers so real data cannot accidentally create duplicate PPPoE secrets.
- Added Existing Subscribers to Link queue and RouterOS verification flow for existing PPPoE usernames.
- Optional existing PPPoE password storage is encrypted and enables future automated router migration; linking works without storing the password.
- New subscribers still use `FOR_ACTIVATION`; imported existing subscribers use `FOR_LINKING`.
- Area mappings and MikroTik base URL/credential keys remain editable from Network.
- Paid legacy rows are marked paid without inventing historical payment dates/receipts.

## v0.7.0 — Multi-MikroTik Provisioning, Grace Period & Trusted Router Workflow

- Added multiple MikroTik device registry with independent REST URL, credential key, active state, enforcement policy, and trusted-tier flag.
- Added area → default MikroTik mapping.
- New subscribers are saved first and remain **FOR ACTIVATION** until an Admin explicitly provisions PPPoE.
- Added encrypted subscriber PPPoE password storage using `NETWORK_SECRET_KEY`; router credentials remain server-side in per-device environment variables.
- Added Network page with device testing, policy editing, For Activation queue, area mapping, trusted candidates/watchlist, and migration history.
- Added controlled router migration preserving billing/client history and PPPoE credentials/profile.
- Added **WITH_CUT**, **NO_AUTO_CUT**, and **MANUAL_ONLY** router enforcement policies.
- Added configurable default grace days, due-date reminder, grace reminder, final warning, and auto-cut-after-grace behavior.
- Grace period affects service enforcement only; bill due dates and collection print eligibility are unchanged.
- Reworked temporary extension to create a `BillExtension`; it no longer mutates `Bill.dueDate` or the subscriber recurring `dueDay`.
- Added Field Collection option to include/exclude temporarily extended clients without changing their due date.
- Added trusted-router promotion recommendations based on consecutive paid due periods and downgrade/watchlist recommendations based on past-due unpaid months; not-yet-due bills are ignored.
- Added per-router queue targeting so cut/reconnect jobs execute against the subscriber's assigned MikroTik.
- Updated reminder templates to distinguish billing due date, grace/extension protection, final cut warning, and No Auto Cut accounts.
- Backup/restore now includes MikroTik devices, area router defaults, bill extensions, network migrations, and router-device job references.
- Preserved v0.6.2 UI system and all existing payment approval, partial payment, proof, SOA/receipt, collection route, user/permission, audit, messaging, and backup workflows.

## v0.6.2 — Professional Operations UI / Anti-Vibe-Code Pass

- Added root `DESIGN.md` as the single source of truth for the visual system.
- Replaced gradient/glassmorphism styling with flat operational surfaces, neutral borders, compact spacing, and restrained semantic color.
- Added shared status badge, metric, notice, empty-state, and loading components.
- Redesigned Dashboard around collection/service operations instead of generic feature cards.
- Improved Subscriber Master and client ledger density/hierarchy without changing payment or billing behavior.
- Simplified Billing UI around bill generation and the actual billing rules.
- Preserved the v0.6.1 area-first Collection Route Builder while standardizing controls, tables, approval actions, and empty states.
- Added mobile/tablet navigation so all permitted routes remain reachable when the desktop sidebar is hidden.
- Standardized buttons, inputs, tables, dialogs, statuses, focus styles, and responsive behavior.
- Added `UI-REVIEW.md` documenting the Anti-Vibe-Code review and remaining cleanup opportunities.
- No API, database, permission, route, validation, billing, collection, payment-approval, messaging, backup, or MikroTik behavior was intentionally changed.

## v0.6.1 — Flexible Collection Route Builder

- Added flexible collection eligibility presets: all unpaid, overdue, due today, today + tomorrow, next 3 days, overdue + next 3 days, and custom ranges.
- Separated collection date from due-date selection criteria.
- Added area-first route planning with eligible-client count and collectible balance per area.
- Added persistent default collector assignment per area/barangay.
- Added per-day area assignment override without changing saved defaults.
- Kept manual individual-client reassignment for exceptions.
- Added ability to exclude entire areas from a day's route.
- Printable collector sheets are now grouped and subtotaled by area and sorted by area/address/client.
- Backup/restore now includes area collector defaults.
- Preserved v0.6 payment submission, proof-of-payment, partial payment, admin approval, SOA, official receipt, messaging, backup, and MikroTik flows.

## v0.6 — Field Collection & Payment Approval

- Collector assignment lists, proof of payment, admin approval, partial payment, SOA and official receipt workflow.
