---
name: Bank USAC Core
colors:
  surface: '#fbf8ff'
  surface-dim: '#dad9e6'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2ff'
  surface-container: '#eeecfa'
  surface-container-high: '#e8e7f5'
  surface-container-highest: '#e2e1ef'
  on-surface: '#1a1b24'
  on-surface-variant: '#444656'
  inverse-surface: '#2f303a'
  inverse-on-surface: '#f1effd'
  outline: '#747688'
  outline-variant: '#c4c5d9'
  surface-tint: '#1947f3'
  primary: '#002db5'
  on-primary: '#ffffff'
  primary-container: '#053fed'
  on-primary-container: '#c4ccff'
  inverse-primary: '#bac3ff'
  secondary: '#4a59a5'
  on-secondary: '#ffffff'
  secondary-container: '#9dacfe'
  on-secondary-container: '#2d3d88'
  tertiary: '#811500'
  on-tertiary: '#ffffff'
  tertiary-container: '#ab2102'
  on-tertiary-container: '#ffc0b2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dee1ff'
  primary-fixed-dim: '#bac3ff'
  on-primary-fixed: '#001159'
  on-primary-fixed-variant: '#0031c4'
  secondary-fixed: '#dee1ff'
  secondary-fixed-dim: '#b9c3ff'
  on-secondary-fixed: '#001158'
  on-secondary-fixed-variant: '#31408b'
  tertiary-fixed: '#ffdad3'
  tertiary-fixed-dim: '#ffb4a4'
  on-tertiary-fixed: '#3d0500'
  on-tertiary-fixed-variant: '#8c1800'
  background: '#fbf8ff'
  on-background: '#1a1b24'
  surface-variant: '#e2e1ef'
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

## Brand & Style

This design system embodies "Calm Confidence" for modern banking. It prioritizes clarity, operational truth, and financial legibility above all else. The aesthetic is a refined blend of **Minimalism** and **Corporate Modern**, utilizing generous whitespace and a purposeful color palette to ensure that complex financial data remains scannable and unintimidating.

The experience is designed to be:
- **Legible:** Money-related data is the hero of the interface.
- **Explicit:** Asynchronous states and pending workflows are never hidden.
- **Safe:** Destructive actions are contextualized, and validation is local and immediate.
- **Authentic:** The UI reflects the real-time state of distributed banking operations.

## Colors

The palette has transitioned to a deep, trustworthy execution using authoritative blues and professional grays. This shift emphasizes stability, security, and digital-first banking precision.

### Usage Rules:
- **Primary (#2A53FD):** A vibrant digital blue used for primary actions and brand highlights. It represents reliability and the core technological engine of the bank.
- **Secondary (#6372C0):** A muted, periwinkle-leaning blue used for supportive elements, secondary actions, and subtle UI accents.
- **Neutral (#767682):** A cool-toned slate neutral used for borders, secondary text, and structural definition.
- **Tertiary (#AB2102):** A deep, burnt orange/red reserved for specialized alerts, specific high-visibility data points, or "hot" financial states that require a clear departure from the blue-dominant theme.

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
- **Primary:** Solid `#2A53FD` (Blue) with high-contrast white text.
- **Secondary:** Solid `#6372C0` (Slate Blue) or outlined with a neutral border for secondary utility.
- **High-Contrast:** Solid dark neutral with white text.

### Form Fields
Inputs use a white background with a neutral border. On focus, the border transitions to the primary blue. Labels must be visible and placed above the field with 8px spacing.

### Cards
Cards are the primary container for financial data. They must use 20-24px padding. Financial "Hero" cards (e.g., balance displays) can utilize the secondary-container colors or primary blue to stand out from standard neutral data cards.

### Badges & Statuses
Use semantic colors with 10% opacity backgrounds. "Alert" or "Warm" states should utilize the tertiary red (#AB2102) to provide a clear visual departure from the blue-dominant brand colors.

### Tables
Tables are borderless between columns, using only horizontal dividers in neutral tones. All currency columns must be right-aligned and use tabular numbers.