# Frontend

## Stack

The current frontend is a Nuxt 4.5.2 application using Vue 3.5.41,
`@nuxt/ui` 4.10.0, Tailwind CSS 4.3.3, and TypeScript 6.0.3. Package
installation and production builds use pnpm from `apps/web/`.

## Component Organization

The frontend will use a shared Nuxt shell and organize feature components by
microservice ownership: Customer, Account, Transaction, Payment, and
Notification & Audit. Shared components consume the tokens and component
conventions in [DESIGN.md](DESIGN.md), rather than redefining them per service.

The repository currently contains only the starter `app/app.vue`; the Bank USAC
feature surfaces have not been implemented yet.

## Styling

Use the tokens, responsive layout, typography, component mapping, and state
conventions in [DESIGN.md](DESIGN.md). The shell uses Nuxt UI components and
Tailwind utilities. No local style value should contradict the design system.

## Accessibility

Every screen follows the accessibility requirements in [DESIGN.md](DESIGN.md):
associated labels, visible focus, AA contrast, adjacent errors, keyboard
access, and meaningful mobile layouts.

## Routing And State

> **Blocked**: Route names, navigation structure, and the shared state
> conventions depend on the Gateway contract and frontend shell. Owner: Marcos
> Bonifasi. Arrives with: T-13.

## Verification

The commands currently available from `apps/web/` are:

```sh
pnpm install
pnpm build
pnpm generate
```

There is no test or lint script yet; that gap is tracked as TD-004 in
[TECH_DEBT.md](TECH_DEBT.md).
