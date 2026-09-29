# ISP Billing Design System

This file is the single source of truth for the product UI. New UI must reuse these tokens and patterns before introducing a new visual pattern.

## Product visual personality

**Operational, trustworthy, compact, local-business specific.** The product should feel like software used all day by an ISP billing/collection team, not a marketing dashboard. Visual hierarchy comes from typography, alignment, borders, data density, and consistent status language. Decorative effects are intentionally limited.

The interface is light-first and optimized for day-to-day back-office administration. It uses a soft gray application canvas, white navigation and work surfaces, a single blue primary action accent, compact operational tables, and restrained shadows. Status colors are semantic only.

## Typography hierarchy

Use `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

- Page title: 20px / 700 / line-height 1.3
- Section title: 15px / 650 / line-height 1.4
- Table/body: 13px / 400–600 / line-height 1.45
- Form label: 12px / 600
- Supporting/helper text: 12px / 400
- KPI value: 22–24px / 700; avoid display-size numbers
- Micro/meta text: 11px / 500

Use tabular numerals for money, dates, counts, and receipt/reference IDs where practical.

## Spacing scale

Base 4px scale:

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-8`: 32px

Default panel padding is 16–20px. Dense tables use 10–12px row padding. Do not add large whitespace purely for decoration.

## Border radius

- Inputs / buttons / badges: 6px
- Panels / dialogs: 8px
- Small circular controls only when the control is inherently circular
- Avoid 16–24px card radii

## Color tokens

Defined in `apps/web/src/index.css`.

- App background: `--bg-app`
- Sidebar/header: `--bg-chrome`
- Main panel: `--surface-1`
- Secondary/inset panel: `--surface-2`
- Hover/selected surface: `--surface-3`
- Primary text: `--text-1`
- Secondary text: `--text-2`
- Muted text: `--text-3`
- Default border: `--border`
- Strong border: `--border-strong`
- Primary action: `--accent`
- Primary action hover: `--accent-hover`
- Success: `--success`
- Warning: `--warning`
- Danger: `--danger`
- Info: `--info`

Do not introduce page-specific colors without adding a reusable semantic token here first.

## Surface/background hierarchy

1. `--bg-app`: application canvas
2. `--bg-chrome`: navigation/header chrome
3. `.panel`: primary operational sections
4. `.subpanel`: inset summaries, form groups, configuration groups
5. `.table-shell`: data grid container

No gradients in application chrome. No glassmorphism/backdrop blur for ordinary panels.

## Border usage

Borders are the main structural separator. Use 1px neutral borders between navigation, panels, headers, rows, and grouped form sections. Avoid nesting bordered panels more than one level deep unless the inner border represents a real semantic group.

## Shadow usage

Panels may use a barely visible 1px/2px administrative elevation shadow in addition to borders. Dialogs may use one restrained elevation shadow. Focus rings are not considered decorative shadows.

## Button styles

Shared hierarchy:

- `.btn-primary`: one main action in a local context
- `.btn-secondary`: common secondary action
- `.btn-ghost`: low-emphasis utility action
- `.btn-danger`: destructive action
- `.icon-btn`: square icon-only button with accessible title/aria-label

Rules:

- Use sentence case labels.
- Do not use color to create multiple competing primary actions.
- Destructive actions always require explicit wording and confirmation where data/service state changes.
- Disabled controls remain readable but clearly unavailable.

## Input and form styles

Use `.field` with a visible label (`.field-label`). Inputs are 36–38px high on desktop. Helper text follows the field, not placeholder-only instructions. Validation/error text uses danger semantics and must not rely on color alone.

Group related settings under a section title and helper text. Checkbox rows use `.check-row`. Avoid wrapping every field in a card.

## Table styles

Operational tables are a first-class pattern:

- `.data-table` for all primary data grids
- sticky header where long scrolling occurs
- neutral header background
- row dividers instead of card rows
- 12–13px typography
- numeric values aligned right
- identifiers and dates should not wrap unnecessarily
- hover only to aid row tracking
- action columns stay compact

Do not turn table rows into standalone cards on desktop. On narrow mobile screens, horizontal scrolling is acceptable for operational grids; critical actions must remain reachable.

## Card styles

Use cards only for meaningful summaries or grouped workflows, not as a default wrapper for every block.

- `.metric`: compact dashboard summary
- `.panel`: workflow/data section
- `.subpanel`: one semantic nested group only

KPI cards should not contain decorative icon boxes.

## Modal/dialog styles

Dialogs use `.dialog-backdrop` + `.dialog` with:

- flat surface
- clear header border
- 8px radius
- maximum viewport height with internal scrolling
- consistent close icon button
- primary action at the end of form flow

Clicking the backdrop may close non-destructive dialogs. Critical destructive confirmations should use explicit buttons.

## Sidebar/navigation styles

Desktop uses a persistent 232–240px white sidebar with a compact product identity, workflow-grouped navigation (Overview, Customer & Billing, Operations, System), and a restrained environment indicator. Active state uses a pale blue surface plus a 2px blue accent edge, not a pill or glow.

Tablet/mobile uses a horizontally scrollable navigation row below the header so all routes remain reachable.

## Tabs

Tabs are text-first with a bottom border/underline or compact segmented container. Avoid pill tabs unless there are only 2–3 mutually exclusive modes.

## Badges/status indicators

Use `.status-badge` plus semantic variants. Badges use muted backgrounds and semantic text/borders. Status vocabulary must remain consistent across tables, client profile, collection queue, and service history.

Network-specific vocabulary follows the same semantic system: `FOR_ACTIVATION` and `MIGRATION_REQUIRED` are warning states; `ACTIVE`/`WITH_CUT` are success/operational states; `NO_AUTO_CUT` is informational; `SUSPENDED`/`FAILED` are danger states; `MANUAL_ONLY` is neutral. Router tier/policy labels must remain textual and must not rely on color alone.

## Search/filter controls

Search and filters live in one compact `.toolbar` directly above the affected data. Keep labels for date/range controls. Preserve active filter context in text. Search icon is allowed only inside the search field; do not add decorative icons to every filter.

## Empty states

Use `.empty-state`: concise title + one sentence explaining why data is empty or what action is next. No illustrations, mascots, or decorative blobs. If the user can resolve the empty state, provide one clear action.

## Loading states

Use inline loading copy or compact skeleton rows where needed. Avoid full-screen spinners after initial authentication. Buttons use disabled state and action-specific progress text.

## Error states

Use `.notice-error` with an explicit error sentence and recovery action if available. Never hide operational/API failures silently when the user needs to act.

## Confirmation states

Use `.notice-success` for successful saves/imports/approvals. Keep confirmations close to the affected workflow. Avoid celebratory animation.

## Toast/notification styles

If transient toasts are added later, they must be top-right on desktop, bottom-safe-area on mobile, max width 360px, 8px radius, no gradients, and use the same semantic notice tokens. Current inline notices remain preferred for workflow-critical feedback.

## Responsive behavior

- Desktop ≥1024px: fixed sidebar, dense tables, max content width 1600px
- Tablet 640–1023px: top/mobile nav, two-column forms where space permits
- Mobile <640px: one-column forms, horizontally scrollable operational tables, sticky/visible primary action where appropriate, no hidden navigation
- Avoid shrinking table text below 12px
- Do not hide financial/status information solely to fit a narrow viewport

## Accessibility rules

- Minimum interactive target: 36px desktop, 40px touch-oriented controls where practical
- Visible `:focus-visible` ring on buttons, links, inputs, selects, and textareas
- Text/background contrast should target WCAG AA
- Icon-only buttons require `title` and/or `aria-label`
- Status must include text, not color alone
- Form inputs have persistent labels
- Native keyboard behavior is preserved
- Respect `prefers-reduced-motion`

## Animation/motion rules

Motion is functional and subtle:

- 120–160ms color/background/border transitions
- no spring/bounce motion
- no decorative page entrance animations
- no animated gradients
- respect `prefers-reduced-motion: reduce`

## Product-specific UI principles

1. Money, due dates, outstanding balances, collection status, and service state are prioritized over decoration.
2. Field Collection is an area/route planning tool first, not a dashboard.
3. Client profile is a ledger workspace: identity + current balance + actions + history.
4. Admin is configuration/operations, so sections should be compact and explicit rather than visually promotional.
5. Printed SOA, receipt, and collector sheet remain clean black-on-white operational documents.
