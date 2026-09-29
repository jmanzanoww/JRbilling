# Anti-Vibe-Code UI Review — v0.6.2

## Scope

Reviewed the existing v0.6.1 UI without changing billing rules, API behavior, database models, routes, permissions, payment approval, proof storage, collector assignments, MikroTik behavior, backup behavior, or messaging logic.

## Visual consistency

**Updated**

- Removed the radial-gradient application background.
- Removed glassmorphism/backdrop blur from application panels and navigation.
- Replaced oversized 16–24px card radii with a 6–8px radius system.
- Removed default panel shadows; dialog elevation is the only material shadow.
- Standardized application surfaces and borders through CSS tokens.
- Reduced cyan decoration and icon-box usage; blue is now reserved primarily for action/selection emphasis.
- Dashboard KPI values are intentionally compact rather than display-sized.

## UX consistency

**Updated**

- Added mobile/tablet primary navigation; the previous UI hid the desktop sidebar without a complete replacement.
- Unified primary, secondary, ghost, destructive, and icon-only button behavior.
- Standardized statuses with one `StatusBadge` component and semantic tones.
- Standardized loading, notice, metric, and empty-state patterns.
- Kept operational tables as tables instead of converting rows to cards.
- Client detail is structured as identity/actions → compact financial summary → ledger → history.
- Billing screen now explains actual billing rules beside the generation action instead of presenting generic feature cards.
- Field Collection remains area-first because route/fuel efficiency is its primary workflow.

## Component reuse

Shared in `apps/web/src/ui.tsx`:

- `StatusBadge`
- `Metric`
- `Notice`
- `EmptyState`
- `LoadingState`

The redesign intentionally avoids a large abstract component library. Existing workflow-specific JSX remains local when abstraction would make the code harder to follow.

## Typography

- One system font stack.
- Page/section/body/helper hierarchy documented in `DESIGN.md`.
- Money/counts use compact, tabular-oriented presentation.
- Removed display-scale dashboard numbers.

## Spacing

- Consolidated around a 4px base scale.
- Main content padding reduced for desktop productivity.
- Panel padding is normally 16–20px.
- Dense table rows use consistent vertical rhythm.

## Responsive behavior

- Desktop: fixed sidebar, wider 1600px operational canvas.
- Tablet/mobile: horizontally scrollable module navigation below the header.
- Forms collapse to one column where needed.
- Operational tables remain horizontally scrollable rather than hiding financial/status columns.
- Dialogs become bottom-aligned sheets on small screens while preserving full content.

## Accessibility

- Added `:focus-visible` treatment.
- Icon-only approval/reject/close/header actions have labels/titles.
- Status always includes text, not only color.
- Form labels remain persistent.
- Added reduced-motion handling.
- Interactive controls maintain practical minimum heights.

## Loading / error / empty / confirmation states

- Initial auth loading uses the shared loading state.
- Key Subscriber, Collections, Service, Field Collection, and Payment Submission empty states now explain the next step.
- Existing workflow notices use consistent semantic notice styling.
- Existing API/business error messages are preserved rather than replaced with generic messages.

## Code cleanliness

- Root `DESIGN.md` is the source of truth for UI tokens and rules.
- Primary CSS variables and reusable classes are centralized in `index.css`.
- Reused statuses/metrics/notices/empty/loading patterns are centralized in `ui.tsx`.
- No new state-management framework or UI dependency was introduced.
- No API contract, database field, permission, route, validation, or business-rule rename was introduced.

## Removed AI/template-like patterns

- glass panels
- radial/marketing-style background gradient
- oversized dashboard KPI cards
- decorative icon boxes beside most headings
- repeated nested cards for small history rows
- tutorial-style feature-card grid on the Billing page
- desktop-only navigation behavior
- inconsistent one-off status badges
- emoji functional icons (none introduced; Lucide remains the sole functional icon family)

## Remaining UI inconsistencies / follow-up

1. `App.tsx` is still dense because the original application keeps several modules in one file. A later maintainability-only refactor can split page components without changing routes or behavior.
2. Admin contains many configuration concerns on one long page. The visual system is consistent, but future growth may justify internal tabs such as Users, Automation, Messaging, Router, and Backups.
3. Some legacy table cells still carry Tailwind padding utilities; the centralized `.data-table` rules override the visual density, but those legacy utility classes can be removed during a code-only cleanup.
4. Print documents intentionally retain their separate black-on-white styles because they are operational paper outputs, not application chrome.
5. Full browser visual-regression snapshots are not included in this source package; add them later if Playwright screenshot baselines become part of CI.
