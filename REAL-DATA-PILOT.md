# Real Data Pilot — September 2026

Source workbook: `list of client (1).xlsx` → sheet `paid for this month`.

## Import result

- 268 complete unique client records ready for database import
- 210 rows marked paid in the current snapshot
- 54 open/unpaid rows in the current snapshot
- 3 cut rows
- 1 `balance 1 month` row preserved for review
- 11 incomplete client rows held for manual review

No missing due day, rate, area, payment date, receipt number, mobile number, or PPPoE username was invented.

## Router mapping approved by owner

### MikroTik 1 — WITH_CUT
Anulid, Nandacan, Diaz, Vacante, Poblacion East, Poblacion West.

### MikroTik 2 — WITH_CUT
Pogo, Palisoc, Ketegan, Cacandongan, Laoac.

### MikroTik 3 — NO_AUTO_CUT / Trusted
No fixed area mapping. Good-payer clients from MikroTik 1 or 2 may be moved here after Admin approval.

### Not yet assigned
Bongato, Bongato East, Manambong.

## Imported client counts by routing group

- MikroTik 1 mapped areas: 182 clients
- MikroTik 2 mapped areas: 70 clients
- Unassigned areas: 16 clients

## Safety rule

Imported subscribers are **FOR_LINKING** because they already exist in the real ISP network. The system must verify/link their existing RouterOS PPPoE secret. It must not create a second secret. New subscribers added later are **FOR_ACTIVATION** and may be provisioned normally.
