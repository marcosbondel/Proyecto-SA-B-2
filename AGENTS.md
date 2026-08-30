# Agent Guide

Short map for AI agents working in this repository. Durable knowledge lives in
`docs/` — keep this file short and link to deeper docs instead of expanding it.

## Repo Status

A pnpm workspace with everything under `apps/`: the Gateway and the Nuxt
frontend at the top level, the five domain services under `apps/services/`, and
`@bank/contracts`, `@bank/messaging` and `@bank/tooling` under
`apps/packages/`. All seven applications install, build, lint and test from a
clean checkout.

**The API Gateway is implemented** (T-15, extended by T-17, T-19, T-20 and the
prototype-parity work): twenty-four paths, JWT authentication, role
authorization from decision D-06, request/reply with a five-second ceiling, a
seven-code error contract, the identity-document photo deposited in MinIO, and a
versioned OpenAPI contract in `apps/gateway/openapi/`.

**`apps/web` implements the Claude Design prototype in full** — all thirty-four
screens of `bonking.dc.html`, mapped route by route in
[docs/FRONTEND.md](docs/FRONTEND.md#the-screen-inventory). Beyond the five
original modules it now carries password recovery, Mi perfil with its password
change, the deposit window, the transfer history and the Saga monitor, the
service-payment product, the customer's notification inbox, and the three
per-role dashboards behind one route.

Two Gateway routes are worth knowing about because they are the only ones that
**compose**: `GET /api/accounts` merges Account Service's rows with Customer
Service's names in one extra round trip (closing TD-026), and
`GET /api/dashboard` asks five services at once and returns what each answered,
with every section independently optional. Neither computes anything — holding
several replies is aggregation, which is what an entry point is for.

The Gateway has no `domain/` layer and never will — it holds no business logic
(constitution V), and a test asserts it has no database and no HTTP client
towards any internal service.

**Customer Service is implemented** (T-16): four tables of its own, five message
handlers, idempotency by unique constraint, scrypt credentials, email activation
by hashed token, and the simulated identity validation that recomputes the photo
digest against the object the Gateway uploaded.

**Account Service is implemented** (T-17): four tables of its own, eight message
handlers, money as `NUMERIC(14,2)` read back through exact string arithmetic,
balances protected by `SELECT … FOR UPDATE` plus an optimistic `version` plus a
`CHECK (balance >= 0)`, idempotency evaluated **before** any balance moves, the
Saga's debit / credit / compensation, and the automatic deactivation job with an
injected clock. Its integration suite runs against a real PostgreSQL and is
skipped without `DATABASE_URL`.

**Transaction Service is implemented** (T-18): four tables of its own, nine
message handlers over its two queues, the six-state machine as a single pure
function that refuses every transition not in the diagram, transitions decided
under `SELECT … FOR UPDATE` so two Saga events cannot both be applied,
deduplication by the envelope's `messageId` before any state is touched, and the
alias table that makes a retried `transactionId` resolve to the transfer that
actually exists. It decides no funds and reads no balance — the debit verdict
arrives as an event, which is what criterion 8 asks for and what
`test/isolation.spec.ts` enforces. Its concurrency and constraint tests need a
real PostgreSQL and skip without `DATABASE_URL`.

**Notification & Audit Service is implemented** (T-20): three tables of its own,
five queues rather than one — `audit.customer`, `audit.account`,
`audit.transaction`, `audit.payment` for the event families and `audit.query`
for the two questions it answers — deduplication as the primary key
`(event_id, consumer)` so a redelivery produces neither a second record nor a
second notification, the payload **redacted before the insert** so the one
database that hears every event never stores a document, an address or an
amount, and a simulated delivery channel that never throws. It is the only
service that takes **no** validator from the broker: a message it cannot parse
is recorded `INVALID` rather than parked, because the service whose job is to
record what arrived cannot be the one that never sees it. It publishes replies
and nothing else — `ReplyPublisher` has one method, and
`test/isolation.spec.ts` fails the build if a command or an event is ever put
on an exchange from here.

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

**Six of the debts that blocked screens are closed** (TD-026, TD-027, TD-033,
TD-035, TD-038, TD-041), and none by the remedy its own row proposed — each
turned out to rest on a premise that was wrong:

- The transfer's originator was **already in the envelope**; nothing was missing
  but a column to put it in, which closed the listing and the ownership check
  together.
- A holder's name needed neither a projection nor a per-row lookup: one batch
  query and one composition at the Gateway.
- A service payment is **a transfer to an account the biller holds**, so `G-01`
  needed no second money movement, no nullable target and no branch in the state
  machine.
- The notification's subject was **already being computed** to derive the
  simulated address, and thrown away.

TD-021 (a customer cannot read their own audit trail), TD-032, TD-037, TD-039
and TD-040 stand as recorded. Five deviations from the prototype are now written
down as TD-050 to TD-054 — including TD-054, which is the honest one: the whole
prototype was implemented without opening a browser.

`ARCHITECTURE.md` records the target architecture; the local Kubernetes
deployment is built — a Helm chart over a kind cluster (US1), described in
[infra/k8s/README.md](infra/k8s/README.md).

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

Consult these documents before making decisions or describing the repository:

- [README.md](README.md): project identity, team, layout, and development entry points.
- [ARCHITECTURE.md](ARCHITECTURE.md): system boundaries, stack, constraints, and dependency rules.
- [docs/DESIGN.md](docs/DESIGN.md): **must be read before creating or modifying any interface, page, component, style, or interface text**. It also records the mandatory Claude Design reference and import prompt for frontend work. This link is permanent and must not be removed by a documentation change without an explicit team decision.
- [docs/domain/](docs/domain/README.md): **the domain model as a functional contract** — which service owns which data, which invariants it protects, and which commands and events it handles. Read it before implementing any service, designing an event, or adding a business rule.
- [docs/architecture/adr/](docs/architecture/adr/README.md): **the technology and architecture decisions**, each with the alternatives that were rejected and why. Read it before introducing or changing a technology, or before writing a spec that depends on the stack. These decisions are design constraints — changing one requires a new ADR that supersedes the old, not an edit.
- [docs/OWNERSHIP.md](docs/OWNERSHIP.md): primary owner before changing a component.
- [docs/METHODOLOGY.md](docs/METHODOLOGY.md): milestones, status transitions, evidence, and blockers.
- [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md): users and banking workflows before product-facing changes.
- [docs/FRONTEND.md](docs/FRONTEND.md): verified frontend stack and conventions before frontend work.
- [docs/SECURITY.md](docs/SECURITY.md): data classes and security boundaries before handling sensitive data.
- [docs/RELIABILITY.md](docs/RELIABILITY.md): SRE requirements before service or infrastructure design.
- [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md): current quality assessment at milestone reviews.
- [docs/TECH_DEBT.md](docs/TECH_DEBT.md): open debt before adding or closing follow-up work.
- [docs/DOC_INVENTORY.md](docs/DOC_INVENTORY.md): document class and ownership before editing Markdown.
- [docs/AI_PROJECT_AGENTS.md](docs/AI_PROJECT_AGENTS.md): role capabilities and restrictions before delegating work.
- [docs/AI_PROJECT_SKILLS.md](docs/AI_PROJECT_SKILLS.md): installed skills and stack-specific skill policy.
- [docs/design-docs/index.md](docs/design-docs/index.md): durable design records before recording a new decision.
- [docs/design-docs/core-beliefs.md](docs/design-docs/core-beliefs.md): repository operating beliefs before changing agent practice.
- [docs/operations/CONTAINERS.md](docs/operations/CONTAINERS.md): **the image inventory** — one row per component with its Dockerfile, port, start command, health checks and required variables, plus the tagging scheme T-22 references. Read it before changing a Dockerfile, adding a variable a container needs, or writing the Helm chart.
- [docs/references/README.md](docs/references/README.md): how to add or consult external references.
- [apps/web/README.md](apps/web/README.md): Nuxt starter-level application commands when working inside the web app.
- [.specify/memory/constitution.md](.specify/memory/constitution.md): mandatory architecture principles before writing a spec or plan.

## Commands

Run from the **repository root**, not from an application directory. The
repository is a pnpm workspace driven by **Turborepo**: Node 24.19.0 (`.nvmrc`)
and pnpm 11.21.0 (`packageManager`) are enforced, and `engines.node` refuses
anything older.

```bash
pnpm install        # whole workspace, one lockfile
pnpm build          # turbo: shared packages, then the seven applications
pnpm lint           # includes the executable isolation rules
pnpm test           # unit tests for every application and package
pnpm test:contract  # contract tests over @bank/contracts
pnpm typecheck      # tsc --noEmit everywhere
pnpm format         # prettier
pnpm dev            # the whole stack in Docker, applications included
pnpm dev:down       # stops it
pnpm dev:infra      # only the databases, the broker and MinIO, detached
pnpm dev:host       # turbo: the seven applications on the host, in watch mode
```

pnpm resolves and links the packages; **turbo decides the order**. The graph is
read from the `workspace:*` dependencies already declared in each package.json,
so `@bank/contracts` compiles before `@bank/messaging` compiles before anything
that imports them — no script restates that order.

Per application: `pnpm --filter <name> <command>` still works, and
`turbo run <task> --filter=<name>` is the same thing with the dependency
builds included. `<name>` is `gateway`, `web`, `customer-service`,
`account-service`, `transaction-service`, `payment-service` or
`notification-audit-service`.

Two consequences worth knowing:

- **`^build` replaced the ordering discipline.** `pnpm --filter <app> test` in a
  fresh clone still fails — pnpm alone does not build `dist/` first — but
  `turbo run test --filter=<app>` does not, because the shared packages are a
  declared dependency of the task.
- **Cached tasks do not re-run.** A second `pnpm build` with nothing changed
  reports `FULL TURBO` and finishes in milliseconds. That is a cache hit, not a
  skipped build. `turbo run build --force` bypasses it when you need to see the
  compiler actually work. The cache lives in `.turbo/`, is git-ignored, and is
  local only — no remote cache is configured.

`apps/web` has **no component-level test framework**; that needs a Nuxt-native
runner and is recorded as TD-010. Do not claim component coverage.

What it does have is a real suite over `app/lib/` on the Node test runner: the
D-06 permission matrix, the money rules and the error normalisation. That is
deliberate — anything in this application that **decides** something lives in
`app/lib/` as a pure function precisely so TD-010 cannot make it unverifiable.
A decision written into a template would be untestable by an accident of
tooling.

**Lint enforces architecture, not just style.** A service importing another
service, a `domain` file importing a framework, or an `application` file
importing `infrastructure` fails `pnpm lint`. The rules live in
`apps/packages/tooling/eslint.base.mjs`. See the README for the full list.

## Workflow

Spec-driven work runs on **[Spec Kit](https://github.com/github/spec-kit)**
(`speckit`, v0.12.2), installed under `.specify/`. The previous home-grown
`/spec-*` command set, its state machine, and its enforcement hooks were removed
in favour of it — `/spec-new`, `/spec-approve`, `scripts/agent-checks/`,
`state.yaml`, and `docs/SPEC_WORKFLOW.md` no longer exist.

Two integrations are installed, both driving the same ten workflows:

| Tool | Invocation | Reads |
| --- | --- | --- |
| Claude Code | `/speckit-<name>` (hyphen) | `.claude/skills/speckit-*/` |
| opencode | `/speckit.<name>` (dot) | `.opencode/commands/speckit.*.md` |

The workflows are `constitution`, `specify`, `clarify`, `plan`, `tasks`,
`analyze`, `checklist`, `implement`, `converge`, `taskstoissues`. Phase order and
artifact layout come from Spec Kit's own templates in `.specify/templates/`; this
file does not restate them.

**One eleventh workflow is local to this repository**: `git-branch`
(`/speckit-git-branch`, `/speckit.git.branch`). Spec Kit never creates a git
branch — `create-new-feature.sh` computes a name, creates the spec directory and
stops — so branch creation is registered as a `before_specify` hook in
`.specify/extensions.yml` and does the work in
`.specify/scripts/bash/create-feature-branch.sh`. It runs automatically on every
`/speckit-specify`. Because `specify` does not manage it, a Spec Kit upgrade
leaves it alone; the ten upstream workflows are the ones that need re-collapsing.

**Ticket numbers and spec numbers are different sequences.** Spec `004` is ticket
T-03, spec `003` is T-02. Never derive one from the other: the hook takes the
ticket from `--ticket` or from the request text, and falls back to Spec Kit's
numbering when there is none.

- Every ticket gets its own branch: before starting work on ticket `T-XX`,
  create `feature/T-XX` from the latest `origin/develop`
  (`git fetch origin && git switch -c feature/T-XX origin/develop`) and keep
  every commit for that ticket on it.
- The roles in `.agents/roles/` are independent of any spec tool. They take a
  task and its acceptance criteria as input, wherever those come from.
- Nothing is enforced by a hook any more. The gates that used to block
  unspecced code are gone, so the discipline is now a convention: get the spec
  and the plan agreed before writing production code.
- **Every commit has a human author, and authorship is always confirmed.**
  Before running `git commit`, ask who the author is; if it differs from the
  configured `user.name`/`user.email`, commit with
  `git commit --author="Name <email>"`. Never add `Co-authored-by` trailers
  for AI tools (Claude, opencode, Copilot or any other) — Claude Code's
  default trailer is disabled in `.claude/settings.json`
  (`includeCoAuthoredBy: false`).
- When a skill's advice conflicts with `AGENTS.md`, `ARCHITECTURE.md`, or
  `docs/`, the repository wins.
- Update stale docs in the same change that makes them stale.
- **Never add Claude, or any AI agent, as a co-author on a commit** (no
  `Co-Authored-By: Claude`/similar trailer, no author/committer identity for
  an agent). Only the project's current human members may appear as author or
  committer: Enner Mendizabal, David Barrios (`DavidBarrios45`), and Marcos
  Bonifasi. See the [team-commit-pr](.agents/skills/team-commit-pr/SKILL.md)
  skill for the fixed roster and the explicit-confirmation flow required to
  attribute a commit to one of them.

## Layout Notes

- `.agents/skills/<name>/` is the real skill content (pinned by
  `skills-lock.json`); `.claude/skills/` is relative symlinks into it. Fresh
  clones need no install step. Edit the `.agents/` side only.
- `.agents/roles/<name>.md` holds the real role definitions; `.claude/agents/`
  is symlinks into them.
- **The Spec Kit workflows follow the same rule.** Spec Kit installs per-tool
  copies; they were collapsed into one canonical body each:

  ```
  .agents/skills/speckit-<name>/SKILL.md        ← the only real file
    ├── .claude/skills/speckit-<name>           → symlink to the directory
    └── .opencode/commands/speckit.<name>.md    → symlink to the SKILL.md
  ```

  The repository-local `speckit-git-branch` follows the identical layout, so a
  new workflow is added by writing the `.agents/` file and creating the two
  symlinks by hand.

  The canonical body is Spec Kit's Claude output, which is a superset: it carries
  the instruction to rewrite dotted command names to hyphens, so it reads
  correctly from either tool. The `handoffs:` frontmatter that only opencode
  emits was merged in, so nothing was lost by sharing the file.

  **Cost of this:** `specify integration status` now reports 15 managed files as
  modified, and `specify integration upgrade --force` would overwrite the
  symlinks with regular per-tool copies. After any Spec Kit upgrade, re-collapse
  them or the two tools drift apart. Also note both integrations are installed
  with `--force`, since `opencode` is not declared multi-install safe — the
  `unsafe-multi-install` error in `integration status` is expected, not a
  regression.
- Role restrictions are now only what the frontmatter declares:
  - `design`, `reviewer`, and `security` have no write tools at all
    (`disallowedTools`), so they cannot fix what they find.
  - Every other role is unrestricted. `product-mvp`, `planner`, and `qa` used to
    be limited to one artifact each by a hook; that limit is documented
    behaviour now, not an enforced one.
  - `infra-aws` used to be blocked from running mutating cloud commands by a
    hook. **That block is gone** — it must not run `terraform apply`,
    `aws ... create/delete/update`, or any other mutating command, and hands
    them to a human instead.

## Maintenance Conventions

- Adding a role: write `.agents/roles/<name>.md`, symlink it with
  `ln -s ../../.agents/roles/<name>.md .claude/agents/<name>.md`, and add a row
  to the roster in `docs/AI_PROJECT_AGENTS.md`.
- Adding a skill:
  `npx skills add <owner/repo> --skill <name> -a universal -a claude-code -y`.
  Repeat `--skill` for several skills — a comma-separated list is silently
  ignored while reporting success. Record additions in
  `docs/AI_PROJECT_SKILLS.md`. Repair a drifted tree with
  `npx skills experimental_install`.

## Boundaries

- Do not treat this file as a project encyclopedia; put durable knowledge in
  `docs/`.
- Do not bypass established architecture without updating the relevant docs.
