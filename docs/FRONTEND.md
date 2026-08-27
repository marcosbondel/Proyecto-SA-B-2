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

The shell arrived with T-15 (layout, role-filtered navigation, session,
`useGatewayApi`, and the four `Shared*` components); the first feature module
with T-16 (`app/components/customer/` plus its pages), the second with T-17
(`app/components/account/` plus `app/pages/cuentas/`) and the third with T-18
(`app/components/transaction/` plus `app/pages/transferencias/`). T-18 also
built two components in `app/components/payment/`; T-19 took ownership of them
on 2026-08-27, reshaped both, and added the rest of the module —
`PaymentStatusBadge`, `PaymentAttemptTrail`, `PaymentIdentifiersCard`,
`PaymentMonitorTable`, and `app/pages/pagos/`. TD-034 is closed. Auditoría is
still a titled skeleton.

### The Pagos module is the one restricted module that is not restricted by D-06

Every other module is visible to every role, because D-06 restricts almost
everything by **scope** and the owning service applies it. Pagos is visible only
to `CAJERO_RECEPTOR` and `ADMINISTRADOR`, and the reason is a property of the
service rather than a policy: Payment Service holds a `transactionId` and no
customer reference, so it cannot narrow a listing to "yours" without reading
another service's tables (§8.2, 2.3). A `CLIENTE` therefore sees their payment
where it is already scoped — inside the transfer that created it, through
`PaymentResultPanel`. Recorded as TD-037; `test/navigation-parity.test.mjs`
holds the frontend matrix against the Gateway's `@Roles`.

### What T-19 did not build from the Claude Design prototype

The prototype's Módulo 4 draws nine payment screens. Four of them — "Nuevo
pago", its validation state, and the customer's own payment history with its
empty state — describe a bill-payment product this system does not have: no
service holds a biller, a reference or an external provider, and no route mints
a payment, because a payment is step 4 of the transfer Saga. `DESIGN.md` says to
keep the repository rule and record the discrepancy rather than invent a third
variant. Implemented: `/pagos` (from G-04 merged with G-03's table) and
`/pagos/[id]` (from G-02a–G-02d as one polling screen). Recorded as TD-038.

**Nuxt derives a component's name from its path, and it drops a directory
prefix the filename already repeats.** `account/AccountCreateForm.vue` is
`<AccountCreateForm>`, but `transaction/TransferForm.vue` would be
`<TransactionTransferForm>` — a tag that does not match its own filename, which
is the one thing that makes a component hard to find. Every component in this
application is therefore named with its owning service's prefix, so the file
name and the tag are the same string. T-18's two are
`TransactionTransferForm.vue` and `TransactionStatusTimeline.vue`; the ticket
calls them `TransferForm` and `TransferStatusTimeline`.

## Styling

Use the tokens, responsive layout, typography, component mapping, and state
conventions in [DESIGN.md](DESIGN.md). The shell uses Nuxt UI components and
Tailwind utilities. No local style value should contradict the design system.
For every frontend ticket, first import and inspect the Claude Design reference
documented in [DESIGN.md](DESIGN.md), focusing on `bonking.dc.html` and its
`support.js` import. Use it to reproduce the intended composition and
interactions; use `DESIGN.md` as the final authority for repository tokens and
domain rules. Record a screenshot or review note as ticket evidence.

## Accessibility

Every screen follows the accessibility requirements in [DESIGN.md](DESIGN.md):
associated labels, visible focus, AA contrast, adjacent errors, keyboard
access, and meaningful mobile layouts.

## Routing And State

Routes follow the Nuxt file convention under `app/pages/`, one directory per
module. `app/lib/navigation.ts` holds the four modules and the public routes;
`middleware/auth.global.ts` applies them. A module that needs a screen a role
should not see filters it **in the page**, not by adding an entry to `MODULES` —
the four are fixed and asserted by a test.

State follows two rules that exist because of TD-010:

- **Anything that decides something lives in `app/lib/` as a pure function**, so
  it can be asserted by `node --test`. `customer.ts` is the worked example: the
  username preview, the age policy, the photo limits, the audit verdict.
- **Every call to the Gateway goes through `useGatewayApi`.** It attaches the
  session, normalises the seven error types and ends an expired session once,
  centrally. No module calls `$fetch` directly, and none touches RabbitMQ or a
  database.

Asynchronous commands answer `202`. **`useCommandOutcome` is the pattern** for
turning that into an outcome: it starts at `PENDING`, never at `SUCCESS`, and
polls `GET /api/audit` only when the session may read it (see TD-021). Retries
reuse the same idempotency key, which is why `SharedIdempotencyKeyField` stays
mounted for the life of a form.

The only thing a module supplies is *which message names end its command*, as a
pure function in `app/lib/`. `useCustomerOutcome` and `useAccountOutcome` are
three-line wrappers over it; T-16 wrote the engine and T-17 extracted it rather
than copying it a second time.

**A screen a role should not see is filtered in the page**, never by adding a
fifth entry to `MODULES` — the four are fixed and asserted by a test. The
decision itself still lives in `app/lib/` so it is testable and so
`test/navigation-parity.test.mjs` can hold it against the Gateway's own `@Roles`
decorator; `mayManageAccounts` in `app/lib/account.ts` is the worked example.

## Verification

From the repository root:

```sh
pnpm --filter web lint     # eslint, through @nuxt/eslint
pnpm --filter web test     # node --test over app/lib/
pnpm --filter web build
pnpm --filter web dev
```

`test` covers `app/lib/` only. There is still no component-level runner, so no
change may claim component coverage; that gap is TD-010 in
[TECH_DEBT.md](TECH_DEBT.md).
