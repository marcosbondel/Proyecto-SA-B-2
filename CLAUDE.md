# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start Here

**[AGENTS.md](AGENTS.md) is the operational source of truth for agents working in
this repository.** Read it before acting. It carries the repo status, the
workflow, the layout rules, and the maintenance conventions, and it is shared
with every AI tool — not just Claude Code. This file only adds Claude-specific
context on top of it.

When AGENTS.md and this file disagree, AGENTS.md wins. When a skill's advice
conflicts with either, the repository wins.

## Repo Status

A pnpm workspace with all code under `apps/`: Gateway and the Nuxt frontend at
the top level, the five domain services under `apps/services/`, and
`@bank/contracts`, `@bank/messaging`, `@bank/tooling` under `apps/packages/`.
Seven applications, all of them building, linting and testing. The Gateway
carries twenty-five paths, JWT authentication, D-06 role authorization,
request/reply with a five-second ceiling, seven error codes and a versioned
OpenAPI contract; it has no `domain/` layer and never will.

**`apps/web` implements the Claude Design prototype in full** — all thirty-four
screens of `bonking.dc.html`, mapped route by route in
[docs/FRONTEND.md](docs/FRONTEND.md#the-screen-inventory). Beyond the five
original modules (`app/components/<module>/` + `app/pages/<module>/`) it carries
password recovery, Mi perfil, the deposit window, the transfer history and Saga
monitor, the service-payment product, the customer's notification inbox, and the
three per-role dashboards behind one route — `/` is `A-01`, `D-01` and `D-02`,
picked by `dashboardFor`, because "where do I land" must not be a URL somebody
can be sent to by mistake.

Two Gateway routes **compose** and are the only ones that do:
`GET /api/accounts` merges Account Service's rows with Customer Service's names
in one extra round trip, and `GET /api/dashboard` asks five services at once
with every section independently optional. Neither computes anything.

**Customer Service is implemented** (T-16) — its own PostgreSQL schema, the five
message handlers, idempotency enforced by a unique constraint, scrypt
credentials, activation by hashed token, and the simulated identity validation.

**Account Service is implemented** (T-17) — its own schema, eight message
handlers, money as `NUMERIC(14,2)` never touched by a float, balances protected
by a row lock plus an optimistic version plus a column `CHECK`, idempotency
evaluated before any balance moves, the Saga's three movements, and the
automatic deactivation job with an injected clock. Its concurrency and
idempotency tests need a real PostgreSQL and skip without `DATABASE_URL`.

**Transaction Service is implemented** (T-18) — its own schema, nine message
handlers over the two queues it owns, the six-state machine as one pure function
that refuses every transition outside the diagram, transitions decided under a
row lock, consumption deduplicated by the envelope's `messageId` before any
state is touched, and an alias table so a retried `transactionId` resolves to
the transfer that exists. **It decides no funds**: the debit verdict arrives as
an event, and `test/isolation.spec.ts` fails the build if this service ever
queries another's table or makes an HTTP call. Its concurrency and constraint
tests need a real PostgreSQL and skip without `DATABASE_URL`.

**Notification & Audit Service is implemented** (T-20) — its own schema, five
queues instead of one (`audit.customer`, `audit.account`, `audit.transaction`,
`audit.payment`, and `audit.query` for the two questions), deduplication as the
primary key `(event_id, consumer)`, the payload redacted **before** the insert
so the one database that hears every event stores no document, address or
amount, and a simulated delivery channel that never throws. It takes no
validator from the broker **on purpose** — a message it cannot parse is recorded
`INVALID` rather than parked, because the service whose job is to record what
arrived must not be the one that never sees it. It is the only service where the
omission is deliberate, not the only one where it happens: `payment-service` is
the sole caller that passes `validateMessage`, and customer, account and
transaction simply never did (TD-046). It publishes replies and nothing else, and
`test/isolation.spec.ts` fails the build if that changes.
Its concurrency and constraint tests need a real PostgreSQL and skip without
`DATABASE_URL`.

**Payment Service is implemented** (the backend half of T-19, built in T-21):
two tables of its own, three message handlers over `payment.commands`, the
provider as a single pure function that decides an attempt with no clock and no
database in sight, attempts serialised by `SELECT … FOR UPDATE` plus a check
that the attempt number follows the row — so a redelivered command and the retry
sweeper cannot both charge — and a retry ladder whose due time is a **column
rather than a timer**, so a rescheduled pod does not forget a transfer
mid-payment. It publishes `payment.attempt.failed.v1` for every failed attempt
including the last, which is what makes the ladder observable while it is being
climbed, and only the terminal event closes the Saga. It orders nothing from
anybody: there is no `send` on its publisher and `test/isolation.spec.ts` fails
the build if one appears.

**The Saga now runs end to end, in all three of its shapes.**
`pnpm images:flow` executes them against the built images and checks the
balances before and after each: a transfer that COMPLETES, a refused payment
that COMPENSATES on the first attempt, and one that climbs the ladder to its end
and then COMPENSATES. The compensation is asserted as a fact about the money,
not as a status somebody wrote down.

Six of the debts that blocked screens are **closed** (TD-026, TD-027, TD-033,
TD-035, TD-038, TD-041), and none by the remedy its own row proposed: the
transfer's originator was already in the envelope, a holder's name needed one
batch query rather than a projection, a service payment turned out to be a
transfer to the biller's own account, and the notification's subject was already
being computed and discarded. TD-021, TD-032, TD-037, TD-039 and TD-040 stand.
Five deviations from the prototype are recorded as TD-050 to TD-054 — the last
of which is that **the whole prototype was implemented without opening a
browser**: lint, tests, typecheck and build are green, and that is not the
evidence `docs/DESIGN.md` asks for.

TD-020 and TD-023 (the Clientes read path and the
teller identity-validation flow) are **closed** by the audit-remediation feature
(`specs/008-audit-remediation`), which also added the Kubernetes deployment: a
Helm chart at `infra/k8s/helm/bank-usac` plus a kind cluster config. The live
`helm upgrade --install` **has happened** (T014/T015, commit `57dd88d`,
2026-08-28): on kind v0.33.0 the seven pods reached `1/1 Ready` against the
PostgreSQL, RabbitMQ and MinIO outside the cluster, the port-forwarded Gateway
answered, and a transfer ran the Saga end to end to a terminal state. Two
caveats belong with that sentence. The transfer ended `FAILED` via
`DEBIT_REJECTED` on a zero-balance account — the failure-handling shape, not
`COMPLETED` — so the cluster has demonstrated the Saga's error path and not its
happy one. And **no evidence of the run was captured in the repository**:
`specs/008-audit-remediation/quickstart.md` holds expectations, not output. The
run also found two real defects that `helm lint` and `helm template` could not:
a bash 4 associative array that broke on macOS's bash 3.2, and `values.yaml`
database defaults that pointed every pod at the wrong role and database.

**Every component is containerised** (T-21): seven multi-stage images, one
Dockerfile each and no generic one, all running as `node` (uid 1000), with
nothing but `NODE_ENV` baked in and every credential arriving at run time.
`/health` and `/ready` answer different questions in all seven — the port now
opens *before* the migrations and the broker, so a database that is briefly away
no longer turns a liveness probe into a restart loop. `pnpm images:build` tags
each image with the commit inside it, which is the value T-22 puts in
`values.yaml`; `pnpm images:smoke` asserts the labels, the port, the user, the
absence of secrets in any layer, and the degraded cases; `pnpm images:flow` runs
the assignment's own flow — register, open accounts, transfer — through the
images end to end. The inventory, the required variables per component and the
base-image bump procedure are in
[docs/operations/CONTAINERS.md](docs/operations/CONTAINERS.md).

## Project Documentation

Read [docs/DESIGN.md](docs/DESIGN.md) before creating or modifying any
interface, page, component, style, or interface text. This link is permanent
and must not be removed by a documentation change without an explicit team
decision. Read [docs/operations/CONTAINERS.md](docs/operations/CONTAINERS.md) before
changing a Dockerfile, adding a variable a container needs at run time, or
touching a health check: it is the image inventory and the contract T-22 builds
the Helm chart against.

The complete project-documentation index is maintained in
[AGENTS.md](AGENTS.md), including [docs/DOC_INVENTORY.md](docs/DOC_INVENTORY.md)
for Markdown classification and [docs/OWNERSHIP.md](docs/OWNERSHIP.md) for
component ownership.

## Commands

Run from the **repository root**, never from an application directory. Node
24.19.0 (`.nvmrc`) and pnpm 11.21.0 (`packageManager`) are enforced. The task
runner is **Turborepo** (`turbo.json`); pnpm still owns resolution and linking.

```bash
pnpm install        # whole workspace, one lockfile
pnpm build          # shared packages, then the seven applications
pnpm lint           # style *and* the executable isolation rules
pnpm test           # unit tests everywhere
pnpm test:contract  # contract tests over @bank/contracts
pnpm typecheck
pnpm format
pnpm dev            # whole stack in Docker (infra/docker/docker-compose.dev.yml)
pnpm dev:infra      # only the databases, the broker and MinIO, detached
pnpm dev:host       # turbo run dev — the applications on the host, watch mode

pnpm images:build   # the seven Docker images, tagged with the commit inside them
pnpm images:up      # the stack from those images (also stops the infra on :down)
pnpm images:smoke   # labels, port, user, secrets, liveness, readiness, degraded cases
pnpm images:flow    # register, open accounts, transfer — through the images
```

Per application: `turbo run <task> --filter=<name>`, which brings the
dependencies' builds with it. `pnpm --filter <name> <command>` still works but
builds nothing, so it needs a `pnpm build` first in a fresh clone — the shared
packages are consumed from `dist/`.

Three things worth knowing before you claim anything passed:

- **A green run may not have run.** Turbo reports `FULL TURBO` when every task
  hit the cache. That is a real pass — the inputs are identical — but if you
  need to see the command actually execute, use `turbo run <task> --force`.
- **Lint enforces architecture.** A cross-service import, a framework import in
  `domain`, or an `infrastructure` import in `application` fails `pnpm lint`.
  The rules live in `apps/packages/tooling/eslint.base.mjs`. If one blocks you,
  the design is wrong — do not add an exception to make it pass.
- **`apps/web` has no component test framework.** Its `test` script is one
  `node --test` suite over `app/lib/`, not a Vue suite (TD-010). Do not claim
  component coverage — but note that everything in the shell that *decides*
  something lives in `app/lib/` as a pure function precisely so it stays
  testable despite TD-010. The six NestJS applications use Jest and do have real tests.

## Spec Workflow

Spec-driven work runs on **[Spec Kit](https://github.com/github/spec-kit)**
(`speckit` v0.12.2, under `.specify/`). The home-grown `/spec-*` command set that
used to live here was removed: its commands, its `spec-state.sh` state machine,
its `state.yaml` gates, its enforcement hooks under `scripts/agent-checks/`,
`docs/SPEC_WORKFLOW.md`, and the `docs/templates/spec/` templates are all gone.
Do not reference or recreate them.

The ten workflows are available here as skills: `/speckit-constitution`,
`/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`,
`/speckit-analyze`, `/speckit-checklist`, `/speckit-implement`,
`/speckit-converge`, `/speckit-taskstoissues`. **Claude uses hyphens**; the same
workflows are invoked with dots (`/speckit.plan`) from opencode, which shares the
identical file. When a skill body names a command with a dot, convert it.

Their real content lives in `.agents/skills/speckit-<name>/SKILL.md` —
`.claude/skills/` only symlinks to it. Edit the `.agents/` side.

## The Harness

Two altitudes still hold, and they are worth keeping when Spec Kit lands: work
that is archived when it ships lives with the spec, and knowledge that must stay
true lives in `docs/`. Promoting the second out of the first is what keeps the
repo from going stale.

**What is still enforced.** Only what a role's frontmatter declares:

- `design`, `reviewer`, `security` have `disallowedTools: Write, Edit,
  NotebookEdit` — no write tools at all. A reviewer that could fix what it finds
  would stop reviewing and start implementing.

**What is no longer enforced** — these were hooks, and the hooks were deleted
with the scripts they called. They are conventions now, and nothing will stop an
agent from breaking them:

- Implementing roles (`backend`, `frontend`, `mobile`, `infra-aws`) could not
  write production code without an approved task list. That gate is gone.
- `product-mvp`, `planner`, and `qa` were each limited to the single spec
  artifact they own. That limit is documentation now.
- `infra-aws` was blocked from running mutating cloud commands. **Treat this as
  a hard rule anyway**: it plans, it never applies, and mutating commands go to
  a human.

**Traceability.** Acceptance-criteria IDs still tie intent to proof: `spec.md`
defines them → the plan says how each is verified → a task advances it →
evidence shows the real command output → `reviewer` checks the diff against it.
Nothing validates that chain automatically any more.

## Editing The Scaffolding

`.agents/` holds the real files; `.claude/agents/` and `.claude/skills/` are
relative symlinks into it — all 24 skills, including the ten from Spec Kit.
**Always edit the `.agents/` side.** Adding a role means writing the `.agents/`
file and creating the symlink by hand
(`ln -s ../../.agents/roles/<name>.md .claude/agents/<name>.md`); new roles also
get a row in [docs/AI_PROJECT_AGENTS.md](docs/AI_PROJECT_AGENTS.md).

A Spec Kit upgrade replaces those symlinks with per-tool copies. If
`specify integration upgrade` ever runs, re-collapse the ten speckit skills into
`.agents/skills/` and re-link both `.claude/skills/` and `.opencode/commands/`,
or Claude and opencode silently drift apart. See AGENTS.md for the layout.
