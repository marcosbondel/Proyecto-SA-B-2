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
`PaymentMonitorTable`, and `app/pages/pagos/`. TD-034 is closed. The fifth and
last module arrived with T-20: `app/components/audit/` — `AuditQueryForm`,
`AuditEventTable`, `AuditEventDetail`, `AuditNotificationList`,
`AuditNotificationCard` — plus `app/pages/auditoria/index.vue` and
`app/pages/auditoria/notificaciones.vue`. Every module the shell was built for
now exists.

### The Auditoría module shows a payload it is not allowed to compute

`AuditEventDetail` is the prototype's `N-03` panel, and the payload it prints is
**already redacted when it arrives**. That is the load-bearing property of the
whole module. `audit.query.replied.v1` was defined by T-05 with metadata and no
payload at all, because Notification & Audit hears every event in the bank and a
trail of verbatim payloads would reassemble in one screen the data five separate
databases exist to keep apart. T-20 added the payload back as an optional field
that the owning service redacts *before the insert* — so the raw value is never
stored, never travels, and this component has nothing to hide. A drawer that
received the real payload and hid fields in CSS would be a leak with a
stylesheet over it. Recorded as TD-039.

### What T-45 added: the trace of every operation, and the audit filters

Every screen that starts an operation already showed its correlation id through
`SharedCorrelationIdBadge`. T-45 makes the same badge show the **trace** that
operation ran under, without a screen being told about it: `useGatewayApi`
remembers the `X-Trace-Id` of every response — a refusal's too — in a bounded
ledger keyed by the correlation id (`lib/trace.ts`, `composables/useTraces.ts`),
and the badge looks its own correlation up. A header that is empty, all zeros or
otherwise not a W3C trace id is discarded rather than shown, because somebody
would search for it. **While no OpenTelemetry SDK is registered in the Gateway
(T-48) there is no header, no ledger entry and no second line**: the badge is what
it always was.

`/auditoria` gains the four filters §4.1 names — correlation, trace, service and
level — over the paginated recent-events listing. A malformed identifier is
explained beside its field and not searched (the Gateway would answer `400`); an
empty box is a filter left off and is not sent; a trace pasted in capitals is
lowercased. "No event matches" and "the audit service did not answer" are
different messages. The trace column shows eight characters, with the whole id in
the tooltip and in the detail panel, because thirty-two would make that one column
wider than the screen. The operator-facing alert and the customer's anomaly warning
have names in the trail and the inbox (`lib/audit.ts`).

### What T-20 did not build from the Claude Design prototype

Módulo 5 draws four screens. `N-02` is a **global** event list with a free-text
search over every event the bank ever published; `GET /api/audit` takes a
`correlationId` and answers that flow, and no route lists the trail across
correlations — `audit_events` is the one table where every service's activity
sits together, and an unfiltered listing of it is a different security question
from a lookup by an identifier somebody already holds. So the search became the
query and the filters moved to narrowing what came back (TD-042). `N-01` is a
**customer's** inbox with read/unread state; no service holds a per-customer
notification list, nothing records that anybody read anything, and D-06 grants
the notifications to `ADMINISTRADOR` alone — so what got built is the staff
console those three facts allow, in the prototype's card idiom, with the dot
kept and given the one meaning the data supports (TD-041).

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
module. `app/lib/navigation.ts` holds the six rail entries — the landing page and the
five modules — and the public routes;
`middleware/auth.global.ts` applies them. A module that needs a screen a role
should not see filters it **in the page**, not by adding an entry to `MODULES` —
the five are fixed and asserted by a test.

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

**A screen a role should not see is filtered in the page**, never by adding an
entry to `MODULES` — the modules are fixed and asserted by a test. The decision
itself still lives in `app/lib/` so it is testable and so
`test/navigation-parity.test.mjs` can hold it against the Gateway's own `@Roles`
decorator. There are three worked examples now, in `app/lib/account.ts` and
`app/lib/payment.ts`: `mayManageAccounts` (the manual status change),
`mayTakeDeposits` (the window) and `mayMonitorPayments` (Payment Service's own
listing).

**Exactly one module is restricted by role**: Auditoría, which is the only thing
D-06 restricts that way. Pagos was a second for one ticket, because the module
*was* the unscoped payment listing; it stopped being one when the service-payment
product arrived and that listing became a screen inside the module.

## The screen inventory

The Claude Design prototype (`bonking.dc.html`) draws thirty-four screens across
eight modules, and every one of them has a route. What follows is the map, so a
reviewer can go from a prototype code to a file without guessing.

| Prototype | Screen | Route |
| --- | --- | --- |
| `P-01`–`P-01c` | Sign in, and its failures | `/login` |
| `P-02`–`P-05` | Registration, three steps and its confirmation | `/registro` |
| `P-06a`, `P-06b` | Activation link, opened | `/activar` |
| `P-07`, `P-07b` | Recover a password | `/recuperar` |
| — | Choose the new password *(not drawn; the flow needs it)* | `/restablecer` |
| `C-01`–`C-01c` | Mi perfil, and changing your password | `/perfil` |
| `C-02`, `C-02b` | The teller's validation queue | `/clientes/validaciones` |
| `C-03`, `C-03b` | One identity, and the rejection modal | `/clientes/validaciones/[id]` |
| `A-01`, `A-01b` | The client's landing page | `/` |
| `A-02`, `A-02b` | Mis cuentas | `/cuentas` |
| `A-03`, `A-03b` | One account, and the deactivation warning | `/cuentas/[id]` |
| `A-04`–`A-04c` | Open an account | `/cuentas/nueva` |
| `A-05`–`A-05e` | The deposit window | `/cuentas/deposito` |
| `A-06` | Account management | `/cuentas/administracion` |
| `T-01`, `T-02` | New transfer, and its confirmation | `/transferencias/nueva` |
| `T-03a`–`T-03d` | Tracking, in its four states | `/transferencias/[id]` |
| `T-04`, `T-04b` | The history | `/transferencias` |
| `T-05`, `T-05b` | The Saga monitor | `/transferencias/monitor` |
| — | **Depósito a otro banco** (T-47) | `/transferencias/interbancaria` |
| — | Los depósitos enviados a otro banco, con su filtro de seis estados (T-60, TD-090) | `/transferencias/interbancarias` |
| — | Un depósito a otro banco: estado, motivo, historial y reverso (T-60, TD-090) | `/transferencias/interbancarias/[id]` |
| `G-01`, `G-01b` | Nuevo pago | `/pagos/nuevo` |
| `G-02a`–`G-02d` | One payment's state | `/pagos/[id]` |
| `G-03`, `G-03b` | The payment history | `/pagos` |
| `G-04` | Payment monitoring | `/pagos/monitor` |
| `N-01`, `N-01b` | The notification centre | `/notificaciones` |
| `N-02`, `N-03` | The audit trail, and one event's payload | `/auditoria` |
| — | The staff notifications console | `/auditoria/notificaciones` |
| `D-01` | The teller's dashboard | `/` |
| `D-02` | The administrator's dashboard | `/` |
| `X-01` | Not found, or not yours | `app/error.vue` |

Three rows are worth reading twice.

**`/` is three screens.** `A-01`, `D-01` and `D-02` are one route, because "where
do I land" must not be a URL somebody can be sent to by mistake. `dashboardFor`
picks; it is a pure function and it is tested.

**`/restablecer` is not in the prototype.** `P-07b` ends at "revisa tu correo",
which is where a prototype can stop and an implementation cannot — somebody has
to type the new password somewhere (§4.1: "el estudiante deberá complementar
cualquier funcionalidad faltante").

**`/notificaciones` and `/auditoria/notificaciones` are two screens over one
table**, and deliberately so: the first is a person's inbox, the second is the
operational console that carries the simulated recipient of every delivery in
the system. D-06 grants the second to `ADMINISTRADOR` alone.

Deviations from the prototype are recorded as TD-050 to TD-053 in
[TECH_DEBT.md](TECH_DEBT.md), as `docs/DESIGN.md` requires — the repository rule
wins, and the discrepancy is written down rather than resolved by inventing a
third variant.

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

**What the prototype-parity work verified, and what it did not.** Every pure
function the new screens depend on is tested — `dashboardFor` and `alertsFrom`
for the dashboards, `directionOf` and `statusFilterOptions` for the transfer
tables, `holderLabel` and `holderIsName` for the account tables,
`notificationLink` and `notificationLabel` for the inbox, `searchDestinations`
and `initialsOf` for the shell, `mayTakeDeposits` for the window. That is
deliberate under TD-010: anything that decides something is a function, so the
deciding is covered even though the drawing is not.

**No screen was opened in a browser.** `pnpm lint`, `pnpm test`,
`pnpm -r typecheck` and `pnpm build` are green across the workspace, and static
checks are not the evidence `docs/DESIGN.md` asks for — a template that compiles
can still be wrong. That gap is TD-054, and closing it means running the stack
and walking the thirty-four screens against `bonking.dc.html`.
