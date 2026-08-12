# Bank USAC Design System

This document is the visual and interaction source of truth for Bank USAC.
The baseline was supplied and approved by Marcos Bonifasi for T-01 on
2026-08-11. Future UI work MUST use these tokens and conventions instead of
introducing local values.

## Principles

- **Make money legible.** Amounts, balances, fees, and transaction states are
  visually distinct and easy to scan.
- **Make asynchronous state explicit.** Accepted work is not completed work;
  the interface never hides a pending Saga behind a generic spinner.
- **Prefer calm confidence.** Use clear hierarchy, restrained motion, and
  direct labels for actions that affect money or identity.
- **Prevent accidental actions.** Primary actions are obvious, destructive
  actions require context, and validation errors appear where they occur.
- **Design for operational truth.** Feedback reflects the actual state of the
  distributed workflow, including timeout, retry, and eventual completion.

## Color

Tokens map directly to the Nuxt UI theme applied by T-13.

| Token | Value | Use |
| --- | --- | --- |
| `primary` | `#8CE071` | Primary actions, active navigation, progress, and positive metrics. |
| `primary-contrast` | `#1A201D` | Text or dark controls paired with the primary accent. |
| `surface` | `#FFFFFF` | Main background and card surfaces. |
| `surface-muted` | `#F7F9F8` | Sidebar, subsections, disabled or inactive surfaces. |
| `border` | `#E5E7EB` | Input borders, table rules, and component boundaries. |
| `text` | `#111827` | Headings, values, and primary body text. |
| `text-muted` | `#6B7280` | Metadata, placeholders, subtitles, and table headers. |
| `success` | `#2F9E44` | Completed operations and positive outcomes. |
| `warning` | `#F59E0B` | Pending actions, warnings, and attention states. |
| `error` | `#EF4444` | Failed transactions, destructive actions, and validation errors. |
| `info` | `#6366F1` | Neutral administrative and informational states. |

Status backgrounds use a light tint of the corresponding semantic token, with
the semantic token as the foreground. Text on `primary` uses
`primary-contrast`; text on `primary-contrast` uses `surface`.

## Typography

The primary family is **Inter**, with the system sans-serif stack as a loading
fallback: `Inter, ui-sans-serif, system-ui, sans-serif`. Use weights 400
(regular), 500 (medium), 600 (semibold), and 700 (bold).

| Role | Size | Weight | Use |
| --- | ---: | ---: | --- |
| Hero number | 48px | 700 | Dashboard totals and high-priority metrics. |
| H1 | 32px | 700 | Page titles. |
| H2 | 20px | 600 | Section and card titles. |
| Body | 16px | 400 or 500 | Main content and list items. |
| Small | 14px | 400 or 500 | Controls, table values, and supporting copy. |
| Caption | 12px | 400 | Metadata, labels, dates, and chart axes. |

Amounts, balances, identifiers, and tabular transaction values MUST use
`font-variant-numeric: tabular-nums lining-nums` so columns align and values
remain easy to compare.

## Spacing & Layout

The spacing system uses an 8px base grid: `8px`, `16px`, `24px`, `32px`,
`40px`, `48px`, and `64px`. Use `8px` for compact label-control groupings,
`16px` for component internals, and `16px` to `24px` between related sections.
Cards use `20px` to `24px` internal padding.

The application uses a fixed left navigation rail on desktop, a top header for
search, context actions, notifications, and profile, and a fluid central
content area.

| Layout token | Value |
| --- | --- |
| Content max width | `1200px` |
| Mobile side padding | `16px` |
| Desktop side padding | `24px` |
| Mobile | `< 768px`; collapse the sidebar and use a single content column. |
| Tablet | `768px - 1023px`; use a compact navigation rail and one or two columns. |
| Desktop | `>= 1024px`; show the full navigation rail and card grid. |
| Wide desktop | `>= 1280px`; allow the full `1200px` content container. |

Use a 3-column metric grid only when each card remains readable; use a 2-column
main-content and auxiliary-panel split for detailed banking workflows.

## Components

Use the Nuxt UI 4.10 components already selected by the team:

- **Forms:** `UForm` and `UFormField`, with one associated label and one local
  validation message per field.
- **Tables:** `UTable`, with generous row padding, no vertical dividers, and
  action menus aligned to the right.
- **Statuses:** `UBadge` for compact state labels, `UAlert` for explanatory
  feedback, and `USkeleton` for loading placeholders.
- **Feedback:** `useToast` for transient confirmation or system feedback; do
  not use a toast as the only place for an important error.
- **Modals:** `UModal` for confirmation, focused detail, or destructive-action
  context. Keep the triggering action visible in the dialog.
- **File uploads:** `UFileUpload` for identity documents and future evidence
  files; show accepted formats, size constraints, progress, and failure state.
- **Buttons:** solid `primary` for the main action, outlined `surface` plus
  `border` for secondary actions, and `primary-contrast` with `surface` text
  for high-contrast actions. Use 8px to 12px corner radius; use pill shapes
  only for compact secondary actions and badges.
- **Cards:** white surfaces with 16px to 24px radius and either a subtle shadow
  or a 1px border, never both at strong intensity.
- **Icons and avatars:** line icons for navigation and actions; filled icons
  only for categories or file types; avatars are circular at 24px to 40px.

Charts use rounded bar tops, exact-value hover tooltips, and clean donut gaps.
Use related green, dark-green, and neutral hues so data visualization does not
compete with transaction status colors.

## UI States

Every data-bearing screen and action defines these states where applicable:

1. **Initial:** explain the task and show the primary action without implying
   that data already exists.
2. **Empty:** explain why the collection is empty and provide the next useful
   action.
3. **Local validation:** identify the field, explain the correction, and keep
   valid input intact.
4. **Sending:** disable duplicate submission, show progress, and retain the
   entered context.
5. **Pending:** the request was accepted but the distributed operation is not
   complete. Show the tracking or transaction identifier when available.
6. **Success:** show only after the owning workflow confirms completion, with a
   concise summary and next action.
7. **Business error:** explain the domain reason, such as insufficient funds,
   without exposing implementation details.
8. **Timeout:** state that completion is unknown, preserve the identifier, and
   offer status refresh rather than claiming failure.
9. **Retry:** provide a safe retry action that is idempotent or explicitly
   explains what will be retried.

Pending MUST remain visually and textually distinct from success. An HTTP 202
or an accepted event is not a completed banking operation.

## Accessibility

- Every form control has an associated visible label or an equivalent announced
  accessible name.
- Focus indicators remain visible and use the primary or contrast token with
  sufficient contrast.
- Text and controls meet WCAG AA contrast targets; color is never the only
  signal for transaction state.
- Validation and business errors appear adjacent to the relevant field or
  action and are announced to assistive technology when dynamically inserted.
- Keyboard users can reach every action, modal control, table action, and file
  upload control in a logical order.
- Responsive layouts preserve readable text, usable touch targets, and the
  distinction between pending and completed operations on mobile.

## Domain Formats

- **Currency:** display Guatemalan quetzales with a `Q` prefix, a space, comma
  thousands separators, and exactly two decimal places: `Q 1,250.00`.
- **Amounts:** use a decimal-safe domain value and format only at the UI
  boundary. Negative values retain the sign before the amount.
- **Dates:** use the `es-GT` locale through the platform date formatter and
  include the timezone when a timestamp represents an event.
- **Identifiers:** preserve the original case and never truncate a value that
  a user must copy or compare; provide a copy action for long identifiers.
