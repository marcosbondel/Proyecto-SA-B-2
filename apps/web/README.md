# `apps/web` — the shared frontend shell

The single browser application of Bank USAC. It talks to **one** thing, the API
Gateway, because constitution V makes that the only external entry point.

T-15 delivers the shell. T-16 to T-20 deliver the modules that live inside it.

## Running it

From the **repository root**, never from this directory:

```bash
pnpm install
turbo run dev  --filter=web   # http://localhost:3010 — builds what it needs first
turbo run test --filter=web   # the pure logic; see "Testing" below
```

The dev server is pinned to **port 3010** in the `dev` script. It is not Nuxt's
default: 3000 belongs to the Gateway, and under `pnpm dev:host` both start at
once.

Copy `.env.example` to `.env`. `NUXT_PUBLIC_API_BASE_URL` is required from T-15
onward — the shell signs in and calls protected routes, so it needs to know
where the Gateway is. It is read through runtime config, never compiled in, so
one build serves every environment.

## What the shell already does, so no module repeats it

| Concern | Where it lives |
| --- | --- |
| Layout, navigation, theme | `app/layouts/`, `app/app.config.ts` |
| Session: sign in, token, expiry | `app/composables/useSession.ts` |
| Every call to the Gateway | `app/composables/useGatewayApi.ts` |
| The seven error types, normalised | `app/lib/gateway-error.ts` |
| Money in `es-GT`, and `amountMinor` | `app/lib/money.ts` |
| Who sees which module (D-06) | `app/lib/navigation.ts` |
| The four shared components | `app/components/shared/` |

**No module implements session.** No sign-in screen, no token handling, no
expiry logic. That is FR-041g, and it is what stops five tickets solving the
same problem five ways.

## Where a module puts its files

```
app/pages/<modulo>/          the screens
app/components/<servicio>/   its own components
```

| Module | Pages | Components | Ticket |
| --- | --- | --- | --- |
| Clientes | `pages/clientes/` | `components/customer/` | T-16 |
| Cuentas | `pages/cuentas/` | `components/account/` | T-17 |
| Transferencias | `pages/transferencias/` | `components/transaction/` | T-19 |
| Auditoría | `pages/auditoria/` | `components/audit/` | T-20 |

Anything shared belongs in `components/shared/`, which **T-15 owns**. A module
that needs a new shared component asks for one rather than adding it — that is
the only way the interface stays one interface.

Adding a module means adding an entry to `app/lib/navigation.ts`, not to a
`.vue` file. The navigation is derived from that data.

## The rules that are easy to break

**A `202` is not a success.** It means the system accepted the request, not that
the operation happened. Show `PENDING` and confirm it with a status query or an
audit lookup (FR-043). Breaking this makes the interface feel faster and makes
the demonstration a lie.

**Hiding a module is a courtesy, not a control.** `app/lib/navigation.ts` stops
the interface offering a button that would fail. The Gateway refuses regardless,
and its refusal is the one that counts.

**Money is an integer of minor units on the wire.** `SharedMoneyInput` converts
for you. A module that sends decimals gets a validation error; a module that
multiplies by a hundred itself will eventually forget to.

## Testing

`pnpm --filter web test` runs the Node test runner over `app/lib/`. There is no
component-test framework here — Jest cannot compile single-file components and a
Nuxt-native runner is deferred (TD-010 in `docs/TECH_DEBT.md`).

That is why anything that **decides** something lives in `app/lib/` as a pure
function: the permission matrix, the money rules, the error normalisation. A
decision inside a template would be untestable by an accident of tooling. A
decision in a plain module is testable today.

Rendering is verified by eye against the feature screens, which exercise the
four shared components and all five asynchronous states in their real context.

## Design

`docs/DESIGN.md` is the contract, currently at the **`bonking. Core`** revision:
monochrome obsidian on a cool paper ground, Inter, an 8px grid, tabular figures
for every amount. The Claude Design project it names is the required visual
reference for every frontend ticket, not just this one.
