---
name: bonking. Core
colors:
  surface: '#f6f6f7'
  surface-dim: '#dcdce0'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f0f2'
  surface-container: '#e9e9ec'
  surface-container-high: '#e2e2e6'
  surface-container-highest: '#dcdce0'
  on-surface: '#23242a'
  on-surface-variant: '#5a5b63'
  inverse-surface: '#17191f'
  inverse-on-surface: '#f2f2f4'
  outline: '#75767f'
  outline-variant: '#c6c6cc'
  surface-tint: '#2e313c'
  primary: '#0b0c10'
  on-primary: '#ffffff'
  primary-container: '#17191f'
  on-primary-container: '#c3c4cc'
  primary-sheen: '#2e313c'
  inverse-primary: '#b9bac4'
  secondary: '#5a5b63'
  on-secondary: '#ffffff'
  secondary-container: '#a8a9b2'
  on-secondary-container: '#23242a'
  tertiary: '#7c2a10'
  on-tertiary: '#ffffff'
  tertiary-container: '#8e2a0e'
  on-tertiary-container: '#e9a98c'
  error: '#b01b1b'
  on-error: '#ffffff'
  error-container: '#f7dcd7'
  on-error-container: '#8a1010'
  success: '#1e7a3c'
  on-success-container: '#186a32'
  warning: '#b4740a'
  on-warning-container: '#7a4f06'
  primary-fixed: '#e4e4e8'
  primary-fixed-dim: '#b9bac4'
  on-primary-fixed: '#05060a'
  on-primary-fixed-variant: '#23252e'
  background: '#f6f6f7'
  on-background: '#23242a'
  surface-variant: '#dcdce0'
typography:
  hero-number:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  h1:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  h2:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-medium:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  small:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  compact: 8px
  default: 16px
  loose: 24px
  section: 32px
  container-max: 1200px
  margin-mobile: 16px
  margin-desktop: 24px
---

> **Revisión `bonking. Core`, adoptada el 2026-08-24 (T-15).** Este documento
> era una revisión anterior, `Bank USAC Core`, con una paleta azul
> (`primary: #002db5`, prosa que hablaba de "authoritative blues" y de un
> primario `#2A53FD`). El proyecto de Claude Design que este mismo archivo
> declara como referencia obligatoria contiene su propia copia de DESIGN.md, ya
> en la revisión monocroma, y el prototipo `bonking.dc.html` la implementa:
> `#2A53FD` no aparece ni una vez en sus 215 KB.
>
> Con las dos revisiones en el repositorio, ninguna captura de T-15 a T-20 podía
> coincidir con la referencia. El responsable decidió implementar únicamente la
> de Claude Design y traer este documento a esa revisión. **Solo cambiaron las
> secciones de color** —frontmatter, Colors, Buttons, Form Fields, Cards,
> Badges—; tipografía, rejilla de 8 px, radios, cifras tabulares y formato
> `es-GT` eran ya idénticos palabra por palabra.

## Claude Design Reference

The product owner's visual source is the Claude Design project below. It is the
required reference for implementing and reviewing the frontend across all
tickets, not only the shell ticket:

- Project: <https://claude.ai/design/p/4a48d652-297f-4351-9170-d8049427e897?file=bonking.dc.html>
- Primary file: `bonking.dc.html`
- Also read the imported supporting file: `support.js`
- MCP endpoint: `https://api.anthropic.com/v1/design/mcp`
- Authentication: `/design-login` (never commit credentials or session data)

Before implementing or reviewing a frontend ticket, import the project and
inspect the whole project, with special focus on `bonking.dc.html` and
`support.js`. If the Claude Design MCP is unavailable, report a blocker rather
than silently substituting another visual reference. The implementation prompt
is:

> Use the claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via
> /design-login) to import this project:
> https://claude.ai/design/p/4a48d652-297f-4351-9170-d8049427e897?file=bonking.dc.html
>
> Focus on these files (the whole project is readable):
> - `bonking.dc.html`
>
> Also read these files the selection imports:
> - `support.js`
>
> Implement: `bonking.dc.html`

The repository tokens and product/domain rules in this file remain the
implementation contract. Claude Design supplies visual composition, interaction
details, responsive treatment, and component intent. If the imported design
conflicts with a repository token or an architectural rule, keep the repository
rule and record the discrepancy in the ticket or spec instead of silently
inventing a third variant.

Every frontend ticket must include evidence that the implemented screen was
compared with this reference: a screenshot or review note naming the imported
file, the relevant states, and any intentional deviation.

### Where the prototype stands against the build

All thirty-four screens of `bonking.dc.html` have a route, mapped one by one in
[FRONTEND.md](FRONTEND.md#the-screen-inventory).

Five intentional deviations are recorded as TD-050 to TD-054 in
[TECH_DEBT.md](TECH_DEBT.md), which is what this document asks for — the
repository rule wins and the discrepancy is written down rather than resolved by
inventing a third variant. Four of them are places where the prototype should
change rather than the code:

| Deviation | Which side is right |
| --- | --- |
| `C-01` edits the email; the build shows it read-only | The build. Email is the sign-in identifier (D-05) and changing it needs a verify-the-new-address flow. |
| `P-07b` says the reset link lasts 24 hours; the build says one | The build. This link replaces a credential; the activation link's 24 hours only prove an address was reachable. |
| `A-05`'s receipt says `transactionId`; the build says `operationId` | The build. A deposit belongs to no transaction. |
| `G-03` is drawn as a payment list; the build reads the transfer list | The build. A service payment *is* a transfer to the biller's collection account. |
| Nothing was checked in a browser | **The prototype.** TD-054 — static checks are not this evidence. |

The last row is the one that matters. Lint, tests, typecheck and build are green
across the workspace and every pure function the screens depend on is asserted.

A live run of `pnpm dev:host` has since exercised the **API**: the migrations
land, the billers seed, and a service payment completes end to end with the
money on the biller's collection account, the row in the customer's history and
the notification unread in their inbox. That run found a defect no test could —
a stats handler that was never registered, which showed as an empty dashboard
tile rather than as an error.

**No screen has been rendered.** Closing TD-054 means walking the thirty-four in
a browser and attaching the notes.

## Brand & Style

This design system embodies "Calm Confidence" for modern banking. It prioritizes clarity, operational truth, and financial legibility above all else. The aesthetic is a refined blend of **Minimalism** and **Corporate Modern**, utilizing generous whitespace and a purposeful color palette to ensure that complex financial data remains scannable and unintimidating.

The experience is designed to be:
- **Legible:** Money-related data is the hero of the interface.
- **Explicit:** Asynchronous states and pending workflows are never hidden.
- **Safe:** Destructive actions are contextualized, and validation is local and immediate.
- **Authentic:** The UI reflects the real-time state of distributed banking operations.

## Colors

The palette is monochrome: obsidian black on a cool paper ground, with color reserved almost entirely for operational state. Nothing decorative competes with money and status.

### Lacquered black, not flat black
The primary is not a single flat hex. Solid primary surfaces (buttons, the brand mark, the hero balance card) carry a top-lit vertical gradient from **#2E313C** down to **#17191F** (or to **#0B0C10** for brand surfaces), plus a 1px inner highlight of `rgba(255,255,255,.14)` along the top edge. The effect is anodized or lacquered: the object reads as a physical surface catching light, not as a black rectangle. Every other surface stays matte — flat fills, hairline borders, no gloss. That contrast between one lit object and a matte field is the brand's signature.

### Usage Rules:
- **Primary (#0B0C10 · Obsidiana):** brand mark, hero balance surfaces. The deepest tone in the system.
- **Action (#17191F):** primary buttons and interactive accents, always with the sheen gradient.
- **Graphite (#5A5B63):** secondary text, supporting labels and metadata.
- **Silver (#A8A9B2):** disabled and in-flight controls; never for text on white.
- **Semantics:** success #1E7A3C, warning #B4740A, error #B01B1B, tertiary #8E2A0E. Deepened one step from the usual bright values so they sit correctly against a cool near-white ground and never outshout the black.

Because the brand color is black, interactive text cannot rely on hue alone: inline actions use weight 600 plus an arrow or underline, and every focus state is a 2px obsidian ring.

## Typography

The design system uses **Inter** for all roles to maintain a clean, utilitarian aesthetic. 

### Tabular Figures
For all financial values (balances, amounts, transaction lists), the CSS property `font-variant-numeric: tabular-nums lining-nums` is **mandatory**. This ensures vertical alignment of currency digits, which is critical for scanning lists of transactions and comparing balances.

### Formatting
- **Currency:** Prefix with `Q `, use comma separators for thousands, and always show two decimal places (e.g., `Q 1,250.00`).
- **Locale:** All dates and numbers follow `es-GT` formatting.

## Layout & Spacing

This design system uses an **8px base grid** to maintain strict alignment and mathematical rhythm. 

### Layout Model
- **Desktop (>= 1024px):** Fixed left navigation rail with a fluid central content area capped at 1200px.
- **Tablet (768px - 1023px):** Compact icon-only navigation rail.
- **Mobile (< 768px):** Single column content with a collapsed sidebar (hamburger menu) and 16px side margins.

### Sectional Spacing
- **Internal Card Padding:** 20px to 24px.
- **Label-to-Control:** 8px.
- **Component-to-Component:** 16px.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and clean lines. The UI relies on subtle shifts in surface-container colors and crisp borders to define structure.

- **Cards:** Use a 1px border or a very subtle ambient shadow (low opacity, 4-8px blur). Against the neutral background, structural definition comes from subtle surface tints.
- **Modals:** Use a centered overlay with a soft backdrop blur to maintain focus while keeping the underlying context visible.
- **Interaction:** Buttons and interactive cards may lift slightly (increased shadow) on hover to indicate clickability.

## Shapes

The shape language balances approachability with professional structure.
- **Cards & Surfaces:** Use large radii between **16px and 24px** to create a modern, friendly banking feel.
- **Interactive Elements:** Buttons and Input fields use a tighter radius of **8px (0.5rem)**.
- **Secondary Pills:** Only used for badges and small secondary tags/actions.

## Components

### Buttons
- **Primary:** Lacquered obsidian — `linear-gradient(180deg, #2E313C 0%, #17191F 58%)` with a `rgba(255,255,255,.14)` inner top highlight and white text.
- **Secondary:** White with a `#C6C6CC` border and `#23242A` text.
- **Disabled / in-flight:** Solid `#A8A9B2` with white text, no sheen.

### Form Fields
Inputs use a white background with a `#C6C6CC` border. On focus, the border transitions to obsidian with a 2px ring. Labels must be visible and placed above the field with 8px spacing.

### Cards
Cards are the primary container for financial data. They must use 20-24px padding. Financial "Hero" cards (e.g. balance displays) use the lacquered obsidian surface to stand out from standard neutral data cards.

### Badges & Statuses
Use semantic colors with 10% opacity backgrounds. "Alert" or "Warm" states use the tertiary burnt red (#8E2A0E) — the only warm note in an otherwise monochrome interface.

### Tables
Tables are borderless between columns, using only horizontal dividers in neutral tones. All currency columns must be right-aligned and use tabular numbers.
