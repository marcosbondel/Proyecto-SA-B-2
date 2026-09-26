# Bank USAC

**Software Avanzado | Second Semester 2026 | Section B | Group 2**

Bank USAC is a distributed banking system built as an academic project. It
uses five independently owned microservices, an API Gateway, asynchronous
RabbitMQ messaging, separate PostgreSQL databases outside a local Kubernetes
cluster, and a Nuxt frontend. The architecture applies Clean Architecture and
Saga choreography so distributed operations remain observable and resilient.

## Team

| Member | Student ID | Role |
| --- | --- | --- |
| Enner Esai Mendizabal Castro | 202302220 | AI Engineer; Customer and Account Services |
| David Estuardo Barrios Ramirez | 202300670 | AI Engineer; Transaction and Payment Services |
| Marcos Daniel Bonifasi de Leon | 202202410 | AI Project Manager and Tech Lead; Gateway, frontend, infrastructure, SRE, Notification & Audit, and documentation |

All three members share responsibility for event contracts, integration,
testing, and final review. See [docs/OWNERSHIP.md](docs/OWNERSHIP.md) for the
single primary owner of every component.

## Table of Contents

- [Team](#team)
- [**Quick Start — run the app**](#quick-start--run-the-app) — one command, test
  users, where to go next
  - [Configuration](#configuration) — `.env`, real email (Resend), demo seed
  - [Running It Locally](#running-it-locally) — the full guide (Docker or host)
  - [Ports](#ports) · [Check it came up](#check-it-came-up) ·
    [What you can see](#what-you-can-actually-see) · [Stopping](#stopping)
- [What This Is](#what-this-is)
- [**Phase II — the deployed system**](#phase-ii--the-deployed-system) — the
  live URLs, the pipeline, the cloud infrastructure
- [Repository Layout](#repository-layout)
- [**Kubernetes deployment, locally**](docs/operations/DEPLOYMENT.md) — the
  runbook: four commands from a clean machine to a running cluster
- [**Deployment to GCP**](docs/operations/CLOUD.md) — from an empty project to
  a system that answers
- [Documentation](#documentation)
- [Development](#development) —
  [prerequisites](#prerequisites) · [commands](#commands) ·
  [Turborepo](#the-task-runner--turborepo) · [isolation rules](#isolation-rules)

## Quick Start — run the app

Everything runs in Docker; nothing to configure per application. You need
**Docker** installed and running.

```bash
git clone <this-repo> && cd Proyecto-SA-B-2
cp infra/docker/.env.example infra/docker/.env   # then fill in the credentials
pnpm dev                                         # infra + all 7 apps, in watch mode
```

Then open **<http://localhost:3010>**. First start takes a few minutes (it
installs inside the containers); later starts take seconds. `pnpm dev:down`
stops it.

**Test users** — seeded automatically at boot (the dev stack sets
`SEED_DEMO_DATA=true`), one per role, all sharing the password
`BankUsac#2026`:

| Role | Email | Ready to use |
| --- | --- | --- |
| `ADMINISTRADOR` | `admin@bankusac.gt` | Auditoría, Pagos, staff management |
| `CAJERO_RECEPTOR` | `cajero@bankusac.gt` | identity validation, counter operations |
| `CLIENTE` | `cliente@bankusac.gt` | two accounts (one funded with Q5000) — transfer at once |

Sign in at <http://localhost:3010/login>. To register your own account instead,
see [Getting a session](#getting-a-session).

> The whole Saga runs end to end: a transfer **completes**, a refused payment
> **compensates**, and a retry ladder that runs out **compensates** — all
> visible in the **Transferencias** screen and the **Auditoría** trail. `pnpm
> images:flow` proves the three shapes against the built images.

**Working from Claude Code?** The **`/run` skill** brings the whole stack up
in one go, with no manual steps: it checks Docker and the toolchain, starts the
infrastructure and waits for it to be healthy, writes the per-application
`.env` files, launches the seven applications on the host, and verifies they
actually answer. If something is missing — Docker off, wrong Node version, a
failed install — it reports exactly what and how to fix it. It also leaves a
log watcher running: any error the stack throws while you work is caught,
checked, and reported in the chat. Under the hood it is `pnpm dev:infra` +
`pnpm dev:host` with the setup those two assume; see
[Applications on the host](#applications-on-the-host--pnpm-devhost). (Launched
this way there is no Turborepo terminal UI — for that, run `pnpm dev:host` in
your own terminal.)

### Configuration

- **Local credentials** live in `infra/docker/.env` (git-ignored). Copy
  `infra/docker/.env.example` and fill it in — that one file feeds the whole
  Docker stack.
- **Demo seed** — `SEED_DEMO_DATA` (on in `pnpm dev`, off in the images stack)
  inserts the three test users and the client's accounts at boot. Set
  `SEED_PASSWORD` to change their shared password.
- **Real email** — notifications are *simulated* by default (the activation link
  is printed to the log). To send the real activation email through Resend with
  a Route 53 domain, set `NOTIFICATION_CHANNEL=resend` and follow
  [docs/operations/EMAIL_RESEND.md](docs/operations/EMAIL_RESEND.md).
- **Running one service alone, or with a debugger** — use `pnpm dev:host`; it
  needs one `.env` per application, generated by the script in
  [Applications on the host](#applications-on-the-host--pnpm-devhost).

The detailed guide — both run modes, ports, health probes, and troubleshooting
— is in [Running It Locally](#running-it-locally).

## What This Is

The system models the core flows of a banking platform:

- Customer registration and identity validation.
- Bank account creation, balance queries, and account state changes.
- Transfers between accounts through an asynchronous Saga.
- Internal and external payment processing.
- Notifications, audit events, and distributed observability foundations.

All seven applications and three shared packages install, build, lint and test
from a clean checkout, and every component is containerised (T-21).

**The API Gateway is implemented** (T-15): seventeen HTTP routes over fourteen
paths, plus the `/health` and `/ready` probes; JWT authentication, D-06 role
authorization, CORS for the browser frontend, asynchronous request/reply with a
five-second ceiling, a seven-code error contract, and a versioned OpenAPI
contract in `apps/gateway/openapi/`. It holds no business logic, no database and
no HTTP client towards any internal service — and a test suite asserts all three
rather than asking to be believed.

**`apps/web` is the frontend**: layout, role-filtered navigation, a session that
survives a reload, a single API client and shared components, carrying all five
feature modules — **Clientes** (T-16, with public registration at `/registro`),
**Cuentas** (T-17), **Transferencias** (T-18), **Pagos** (T-19) and
**Auditoría** (T-20).

**All five domain services are implemented**: Customer (T-16), Account (T-17),
Transaction (T-18), Payment (T-19) and Notification & Audit (T-20) — a schema
each, message handlers, idempotency enforced in the database, money as
`NUMERIC(14,2)` that no float ever touches, and the transfer's six-state machine
as one pure function that refuses every transition outside the diagram.

**The Saga runs end to end, in all three shapes**: a transfer that completes, a
refused payment that compensates on the first attempt, and one that climbs the
retry ladder to its end and then compensates — each asserted as a fact about the
money by `pnpm images:flow`.

**The system is deployed to Kubernetes**: one Helm chart, all seven workloads
reaching `1/1 Ready`, and the five PostgreSQL databases running *outside* the
cluster by design. The **same chart** installs on a local kind cluster and on
GKE — bring the local one up with `pnpm k8s:cluster && pnpm k8s:install`
([docs/operations/DEPLOYMENT.md](docs/operations/DEPLOYMENT.md)), and see
[Phase II](#phase-ii--the-deployed-system) below for the cloud one, which is
where the system actually runs today.

## Phase II — the deployed system

Phase II adds five functional extensions, a complete CI/CD pipeline,
infrastructure as code and a cloud deployment. **The system is running.**

| | |
| --- | --- |
| **Frontend** | <https://bank-usac-web-771155413874.us-central1.run.app> — Google Cloud Run |
| **API Gateway** | `http://34.27.60.211:3000` — GKE, namespace `prod` (`/health`, `/ready`) |
| **Cloud** | Google Cloud Platform, `us-central1` ([ADR-014](docs/architecture/adr/ADR-014-cloud-provider.md)) |
| **Environments** | `prod` and `dev`, two namespaces of one GKE cluster |

### What was added to the services

| Service | Extension |
| --- | --- |
| Customer | **KYC status** — `PENDING` / `VERIFIED` / `REJECTED`, and only a verified customer may start a transfer |
| Account | **Account-type rules** — `AHORRO` opens with Q100.00 minimum and charges a Q3.00 commission per debit; `MONETARIA` charges none |
| Transaction | **History** — per account, filtered by date range and status, with the assignment's `PENDING` / `APPROVED` / `FAILED` as a projection of the Saga's six real states |
| Payment | **Simulated external payments** — success, failure and **timeout**, over the 1 s / 5 s / 30 s retry ladder |
| Notification & Audit | **Event classification** — `INFO`, `WARNING`, `ERROR`, filterable and driving the notification |

All five live **inside** the transfer Saga, in that order: KYC gate → account-type
rule → history → external payment → final notification. The sequence diagram is
[`07-uml-secuencia-transferencia.png`](docs/architecture/diagrams/07-uml-secuencia-transferencia.png)
and the detail is
[TECHNICAL_DOCUMENT.md §12](docs/TECHNICAL_DOCUMENT.md#12-fase-ii--extensión-funcional-por-microservicio).

### The pipeline

Four workflows in [`.github/workflows/`](.github/workflows/), explained in
[docs/operations/CI.md](docs/operations/CI.md):

```
feature/<name>  ──push──►  CI: Build → Test → Validación   (three jobs, chained)
      └──PR──►  develop  ──►  CI: Build → Test
                   └──►  CD: builds only what changed, deploys to namespace dev
      tag vX.Y.Z  ──►  Release: formal version + seven versioned images
                   └──merge──►  main  ──►  CD: rolling update in prod
```

Production never builds an image: it deploys the ones the release phase
published. No tag is ever `latest`. A deploy that does not reach `Ready` rolls
itself back.

### The infrastructure

One Terraform module,
[`infra/terraform/gcp/`](infra/terraform/gcp/README.md): a VPC with a subnet for
the cluster and a private subnet for data, **five Compute Engine VMs with no
public IP** running one PostgreSQL database each, a zonal GKE cluster of three
nodes, and Cloud Run for the frontend. The seven workloads carry an HPA at
**80 % CPU** with CPU and memory requests and limits.

The procedure, from an empty GCP project to a system that answers — including
the three steps that are still manual — is
[docs/operations/CLOUD.md](docs/operations/CLOUD.md).

### What is not finished, stated plainly

- `dev` and `prod` **share the five databases** ([TD-070](docs/TECH_DEBT.md)).
  Compute and messaging are separated; data is not.
- Three cloud resources are still created by hand: the Artifact Registry
  repository, the Gateway's public `LoadBalancer` and the Cloud Run revision
  that serves the frontend ([TD-079, TD-080, TD-081](docs/TECH_DEBT.md)).


## Repository Layout

Every unit of code lives under `apps/`. The repository root holds
configuration only.

```text
apps/
├── gateway/                         # API Gateway — the only external entry point
├── web/                             # Nuxt frontend
├── services/
│   ├── customer-service/            # port 3001
│   ├── account-service/             # port 3002
│   ├── transaction-service/         # port 3003
│   ├── payment-service/             # port 3004
│   └── notification-audit-service/  # port 3005
└── packages/
    ├── contracts/                   # @bank/contracts — message envelope and transport DTOs
    ├── messaging/                   # @bank/messaging — RabbitMQ adapter
    └── tooling/                     # @bank/tooling — shared TS/ESLint/Prettier/Jest config
infra/docker/                        # local stack: PostgreSQL, RabbitMQ, MinIO (T-06)
                                     #   + docker-compose.dev.yml, the whole app in watch mode
                                     #   + docker-compose.images.yml, the whole app from
                                     #     its built images (T-21)
infra/k8s/                           # the local Kubernetes deployment
                                     #   + helm/bank-usac, one chart for all seven
                                     #     workloads and the out-of-cluster deps
                                     #   + kind/, the single-node cluster config
                                     #   + scripts/, create · install · evidence
docs/                                # durable project documentation
                                     #   + README.md, the index: every document
                                     #     by what it answers
                                     #   + architecture/, the diagrams, the ADRs
                                     #     and one reading per diagram
                                     #   + domain/ and events/, the model and
                                     #     the messages it travels in
                                     #   + operations/ and sre/, the runbooks
                                     #     and the reliability targets
                                     #   + manual/, the user guides and the
                                     #     78-step visual walkthrough
                                     #   + qa/, the test evidence and its
                                     #     screenshots
context/                             # how AI agents build this: roles, skills,
                                     #   prompts. Separate from docs/ on purpose
specs/                               # Spec Kit artifacts for feature work
```

Each of the five services carries the four Clean Architecture layers —
`domain`, `application`, `infrastructure`, `interfaces` — and dependencies
point inward. That direction is enforced by lint, not by convention: see
[Isolation rules](#isolation-rules).

The rest of the scaffolding: `.specify/` holds Spec Kit workflow state,
templates and the constitution; `.agents/` holds the canonical role and skill
definitions; `.claude/` and `.opencode/` link to them; `docs/references/` holds
the assignment statements.

Those dot-directories are configuration the AI tools **execute**, and each tool
looks for its own at the repository root, so they stay there. The documentation
*about* them — which roles exist, what each may not do, which skills are
installed — is [`context/`](context/README.md). The rule between the two written
directories is by audience: `docs/` explains the banking system, `context/`
explains how agents build it.

## Documentation

- [Architecture](ARCHITECTURE.md) - system shape, constraints, stack, and
  dependency rules.
- [Design system](docs/DESIGN.md) - visual tokens, components, states, and
  domain formats.
- [Technical document](docs/TECHNICAL_DOCUMENT.md) - the consolidated
  deliverable: where every required artifact lives, the diagrams read one by
  one, and the Phase II sections (§12 functional extensions, §13 CI/CD, §14
  infrastructure as code).
- [Kubernetes deployment, locally](docs/operations/DEPLOYMENT.md) - the runbook:
  from a clean machine to a running kind cluster, and what each failure looks
  like.
- [Deployment to GCP](docs/operations/CLOUD.md) - the Phase II procedure: from
  an empty project to a system that answers, and which steps are still manual.
- [Continuous integration and delivery](docs/operations/CI.md) - the four
  workflows, what each phase verifies, and what a green run does not prove.
- [Monorepo strategy](docs/operations/MONOREPO.md) - one directory per
  component, and how a change redeploys only that component.
- [Containers](docs/operations/CONTAINERS.md) - the seven images, their ports,
  health checks and runtime variables.
- [Ownership](docs/OWNERSHIP.md) - primary owners and shared work.
- [Methodology](docs/METHODOLOGY.md) - sprints, milestones, evidence, and
  blockers.
- [Product sense](docs/PRODUCT_SENSE.md) - users and core workflows.
- [Frontend](docs/FRONTEND.md) - verified frontend stack and conventions.
- [Security](docs/SECURITY.md) - data classes and security scope.
- [Reliability](docs/RELIABILITY.md) - SRE requirements and observability.
- [Quality score](docs/QUALITY_SCORE.md) - current quality assessment.
- [Technical debt](docs/TECH_DEBT.md) - actionable open debt.
- [Documentation inventory](docs/DOC_INVENTORY.md) - classification and
  coverage rules for every Markdown file.
- [Documentation index](docs/README.md) - every document in `docs/`, grouped by
  what it answers. **Start here.**
- [Agent context](context/README.md) - how this repository is built with AI
  agents: the [roles](context/AI_PROJECT_AGENTS.md) and what each may not do,
  and the [skills](context/AI_PROJECT_SKILLS.md) installed.

## Development

### Prerequisites

| Tool | Version | Why pinned here |
| --- | --- | --- |
| Node.js | 24.19.0 (LTS Krypton) | `.nvmrc`; `engines.node` refuses anything older |
| pnpm | 11.21.0 | `packageManager` in the root `package.json` |

```bash
nvm use            # reads .nvmrc
corepack enable    # or: npm i -g pnpm@11.21.0
```

### Commands

Run all of them from the **repository root**.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs the whole workspace — nine packages, one lockfile |
| `pnpm build` | Builds the shared packages, then the seven applications |
| `pnpm lint` | Lints everything, including the isolation rules below |
| `pnpm test` | Unit tests for every application and package |
| `pnpm test:contract` | The contract tests over `@bank/contracts` |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm format` | Prettier over the repository |
| `pnpm dev` | The whole stack in Docker: infrastructure and all seven applications, in watch mode |
| `pnpm dev:down` | Stops it |
| `pnpm dev:logs` | Follows its logs |
| `pnpm dev:infra` | Only the infrastructure in Docker — five databases, the broker, MinIO — detached |
| `pnpm dev:infra:down` | Stops the infrastructure |
| `pnpm dev:host` | The seven applications in watch mode on your machine — infrastructure still has to be up |
| `pnpm images:build` | Builds the seven Docker images, tagged with the commit inside them |
| `pnpm images:up` | The stack from those images — no source mounted, nothing compiled at start-up |
| `pnpm images:down` | Stops it, **and the infrastructure it includes** |
| `pnpm images:logs` | Follows its logs |
| `pnpm images:smoke` | Every check T-21 asks of an image and of a running container |
| `pnpm images:flow` | Register a customer, open two accounts, transfer — through the images |

### The task runner — Turborepo

Everything in that table except `format` and the `dev:*` and `images:*` entries
is [Turborepo](https://turborepo.com) running a task across the
workspace. pnpm still resolves and links the nine packages from one lockfile;
turbo only decides **what order** the tasks run in, **what runs in parallel**,
and **what can be skipped** because none of its inputs moved.

It reads the order from the `workspace:*` dependencies already declared in each
package.json, so nothing restates it: `^build` in
[`turbo.json`](turbo.json) means *every internal dependency builds first*, and
that one rule is why `@bank/contracts/dist` exists before the Gateway imports
it.

```bash
pnpm build          # 9 tasks, in dependency order, the independent ones at once
pnpm build          # again, unchanged: FULL TURBO — a cache hit, in milliseconds
turbo run build --force   # bypass the cache when you want to watch it compile
```

The cache is in `.turbo/`, git-ignored, and **local only** — no remote cache is
configured, and none should be added without deciding first what a shared cache
would be allowed to see.

#### The task view

`turbo.json` sets `"ui": "tui"`, so a run in an interactive terminal opens
Turbo's terminal interface instead of a single interleaved column: a sidebar
listing every task, and one scrollable log pane for whichever is selected.

```text
Tasks (/ - Search)              │ gateway#dev > cache bypass, force executing …
 » @bank/contracts#dev          │ [Nest] LOG [NestApplication] Nest application …
 » @bank/messaging#dev          │ …
 » gateway#dev                  │
 » customer-service#dev         │
 » account-service#dev          │
 » transaction-service#dev      │
 » payment-service#dev          │
 » notification-audit-service#dev
 » web#dev                      │ u/d - Scroll logs   U/D - Page logs   m - More binds
```

`↑`/`↓` select a task, `/` searches, `u`/`d` scroll the selected log, `U`/`D`
page it, `t`/`b` jump to top or bottom, `m` lists the remaining bindings, and
`Ctrl-C` stops every task.

Turbo 2.10 still defaults to `stream` — the prefixed, interleaved output — which
is why the key is set explicitly. It is a preference and not a requirement:
outside an interactive terminal (a pipe, a container, CI) Turbo falls back to
`stream` on its own, so `pnpm dev:host | tee dev.log` and the Compose stack
behave exactly as before. `turbo run <task> --ui=stream` forces it for one run.

Filters take a task to one application and bring its dependencies with it,
which is the difference that matters in a fresh clone:

```bash
turbo run test --filter=customer-service   # builds the shared packages first
turbo run dev  --filter=gateway            # the Gateway alone, watchers included
turbo run build --filter=web

pnpm --filter customer-service test        # still works — but builds nothing
```

Application names are `gateway`, `web`, `customer-service`, `account-service`,
`transaction-service`, `payment-service`, `notification-audit-service`. The
shared packages are `@bank/contracts`, `@bank/messaging` and `@bank/tooling`.

**`pnpm --filter <app> <task>` builds nothing.** The shared packages are
consumed from `dist/`, so on a fresh clone that form needs a `pnpm build` first.
`turbo run <task> --filter=<app>` does not — the build is a declared dependency
of the task.

### Isolation rules

Three architectural rules are executable, not advisory. Breaking one fails
`pnpm lint`:

- A service never imports another service. Data owned elsewhere arrives as an
  event.
- Inside a service, dependencies point inward. `domain` imports nothing —
  not another layer, not a framework. `application` never imports
  `infrastructure` or `interfaces`. Wiring lives in `src/main.ts`, which sits
  outside every layer on purpose.
- The gateway never links against service code, and a shared package never
  imports a service domain.

### Generated files — do not edit by hand

| Path | Produced by |
| --- | --- |
| `pnpm-lock.yaml` | `pnpm install` |
| `**/dist/` | `pnpm build` |
| `**/coverage/` | `pnpm test` |
| `**/node_modules/` | `pnpm install` |
| `apps/web/.nuxt/`, `apps/web/.output/` | `nuxt prepare` (postinstall) and `nuxt build` |

Shared dependency versions are not declared per package. They live once in the
`catalog` of `pnpm-workspace.yaml`, and each `package.json` refers to them with
`catalog:`. Before changing one, query OSV and run `pnpm audit`: a dependency
with an open vulnerability does not enter the catalog.

Spec-driven work uses [Spec Kit](https://github.com/github/spec-kit) under
`.specify/`. The available workflows are documented in [AGENTS.md](AGENTS.md).

## Running It Locally

### Quick start

Everything in Docker — nothing to configure per application, one command:

```bash
cp infra/docker/.env.example infra/docker/.env   # then fill in the credentials
pnpm dev
```

Open <http://localhost:3010>. `pnpm dev:down` stops it.

The applications on your machine instead — which is what you want for a
debugger, for running one service alone, or for the Turborepo task view:

```bash
pnpm install
pnpm dev:infra     # databases, broker and MinIO in Docker; the rest is yours
                   # then the .env script in step 3 below, once
pnpm dev:host      # the seven applications in watch mode
```

The two are detailed below. They are not equivalent — pick by what you have
installed and by what you are about to do.

| | `pnpm dev` | `pnpm dev:host` |
| --- | --- | --- |
| Infrastructure | Docker | Docker |
| The seven applications | Docker, watch mode | your machine, watch mode |
| You need installed | Docker | Docker, Node 24.19.0, pnpm 11.21.0 |
| The task runner | Compose, one container per application | Turborepo, one process per application |
| Per-application `.env` | none | one for each |
| First start | minutes — it installs inside the containers | as fast as your last `pnpm install` |
| Attaching a debugger, running one application alone | awkward | natural |

Both arrive at the same place. The [ports](#ports), the probes, and what a
`504` means are identical either way.

### What runs today

The **API Gateway**, the **frontend**, and all five domain services —
**Customer**, **Account**, **Transaction**, **Payment** and **Notification &
Audit** — are implemented and containerised. Registering a customer, signing in,
and every screen works end to end.

A transfer runs its full Saga: it is debited from the source account, the
payment is attempted, and it settles as **`COMPLETED`** — or, when the payment
is refused or its retry ladder runs out, it **compensates** and the money
returns to the source account. The **Transferencias** screen shows the state as
it moves, and the **Auditoría** trail answers a lookup by `correlationId` with
the ordered events of the whole flow. Notifications are *simulated* by default
(the activation link is printed to the log; see
[Getting a session](#getting-a-session)) and can be sent for real through Resend
([docs/operations/EMAIL_RESEND.md](docs/operations/EMAIL_RESEND.md)).

### Everything in Docker — `pnpm dev`

```bash
cp infra/docker/.env.example infra/docker/.env   # then fill in the credentials
pnpm dev
```

That is the whole setup. [`infra/docker/docker-compose.dev.yml`](infra/docker/docker-compose.dev.yml)
brings up the five PostgreSQL instances, RabbitMQ, MinIO and the seven
applications in watch mode. It `include`s the infrastructure file rather than
restating it, under the same project name — so it adopts containers that are
already running instead of starting a second copy of every database.

| Command | |
| --- | --- |
| `pnpm dev` | Starts everything and stays attached to the logs |
| `pnpm dev:down` | Stops it |
| `pnpm dev:logs` | Follows the logs without holding the terminal that started it |

**No per-application `.env` is needed.** The Compose file supplies every
variable, and inside its network the hosts are `postgres-account`, `rabbitmq`
and `minio` on their **native** ports — the remapping in the table below exists
only for the host. `JWT_SECRET` has a development-only default so that a fresh
clone boots; override it in `infra/docker/.env`, and never let that value near
anything deployed.

Saving a file rebuilds the container that owns it: the workspace is
bind-mounted, not copied, and the watchers poll it because a bind mount does
not deliver filesystem events reliably. Measured end to end, an edit to a
service reaches a restarted process in about six seconds.

The containers carry no dependencies of their own. A one-shot `deps` service
installs the workspace into named volumes and builds `@bank/contracts` and
`@bank/messaging`; every application waits for it to exit cleanly, which is
what guarantees the shared packages exist before anything imports them. One
rule follows from that:

> A change to `pnpm-lock.yaml` needs `pnpm dev:down && pnpm dev`, because
> `deps` runs once per start. Nothing else does — a change to a shared package
> is picked up by the `packages` watcher, and a change to application code by
> that application's own.

Your host `node_modules` are never read or written. They were resolved for your
operating system and the containers are Linux, so each one is shadowed by a
volume; `pnpm install` on the host and `pnpm dev` can share a single clone
without fighting. The first start installs the whole workspace inside the
containers and takes a few minutes. Later ones reuse the volumes and take
seconds.

### Applications on the host — `pnpm dev:host`

#### 1. Toolchain and dependencies

```bash
nvm use            # Node 24.19.0, from .nvmrc
corepack enable    # pnpm 11.21.0
pnpm install
```

No build step here. `@bank/contracts` and `@bank/messaging` are consumed from
`dist/`, so they do have to exist before anything imports them — but `dev`
declares them as a dependency (`^build` in `turbo.json`), so `pnpm dev:host`
compiles them itself on the way up. Run `pnpm build` when you want the seven
applications built too, not to make `dev` work.

#### 2. Local infrastructure

RabbitMQ, MinIO and five PostgreSQL instances, from `infra/docker/`:

```bash
cp infra/docker/.env.example infra/docker/.env   # then fill in the credentials
pnpm dev:infra                                   # detached
docker compose -f infra/docker/docker-compose.yml ps   # wait for "healthy"
```

`pnpm dev:infra` is `docker compose -f infra/docker/docker-compose.yml up -d` —
the infrastructure file only, without the seven application containers that
`pnpm dev` adds on top. `pnpm dev:infra:down` stops it.

Credentials live in `infra/docker/.env`, which is git-ignored. The Gateway is
the one application with no `DATABASE_URL` and no way to add one: it owns no
data (constitution II and V).

#### 3. Environment files

Every application reads its own `apps/<name>/.env` at boot. The values are not
new information — they are the credentials already in `infra/docker/.env`,
addressed from outside the Compose network: `localhost` instead of a container
name, and the **published** port instead of the native one. So derive them
rather than typing them, with the script that ships for exactly this:

```bash
bash infra/docker/scripts/write-host-env.sh
```

It writes one `apps/<name>/.env` per application from `infra/docker/.env`,
including the Gateway's `CORS_ALLOWED_ORIGINS` and the demo-seed variables
(`SEED_DEMO_DATA`, `SEED_PASSWORD`) so a host run is signed-in-able too.

It is safe to re-run: a `.env` that already exists is reported and left alone,
so it fills gaps without overwriting anything you tuned by hand. It needs
`bash` — the `${!var}` indirection is not POSIX `sh`. (The `/run` skill runs
this for you — see [Quick Start](#quick-start--run-the-app).)

What it deliberately does not decide for you: `JWT_SECRET` falls back to the
same development-only value the Compose file uses, which satisfies the
32-character minimum and must never reach anything deployed. Account Service's
`DEACTIVATION_*` and `INACTIVITY_*` knobs are left out entirely — they default
in code to the assignment's own numbers, and are only worth setting when you
want to watch the deactivation job do something without waiting six months.

The five `OBJECT_STORAGE_*` lines go to every service, not only the two that
read them today. An unused variable in a `.env` costs nothing; a missing one
fails the boot.

By hand instead: copy each `.env.example` to `.env` **in the same directory**
and fill it in against `infra/docker/.env`, remembering the non-default ports —
from the host the broker is on 5673 and each database on its own port between
5433 and 5437. Never commit a `.env`.

Either way, a missing or malformed variable fails the boot immediately and
**names the variable**, rather than surfacing later as a runtime error:

```text
Invalid environment for "gateway". Offending variables: JWT_SECRET
  - JWT_SECRET: JWT_SECRET must be longer than or equal to 32 characters
```

#### 4. Start the applications

```bash
pnpm dev:host                 # the seven applications + the two package watchers
```

That is `turbo run dev`. It compiles `@bank/contracts` and `@bank/messaging`
once, then starts nine watchers at once — the six NestJS applications, Nuxt, and
a `tsc --watch` over each shared package so a change to a contract reaches
everything that imports it without a restart.

In an interactive terminal this opens the [task view](#the-task-view): a sidebar
of the nine tasks, one scrollable log pane for the selected one. `Ctrl-C` stops
all of them.

It does **not** start the databases or the broker. Without `pnpm dev:infra`
running first, every pane fills with `ECONNREFUSED`.

Or a subset, which is what `--filter` is for:

```bash
turbo run dev --filter=gateway              # http://localhost:3000
turbo run dev --filter=web                  # http://localhost:3010
turbo run dev --filter=gateway --filter=customer-service --filter=account-service
```

Start them in any order. `apps/web`'s `dev` script pins `--port 3010`, so Nuxt
cannot default to 3000 and take the port the Gateway needs — a collision that
shows up as a browser which loads but reaches no API, and which starting
everything at once would otherwise turn into a race.

> **Running the production build instead of `dev`?** `node .output/server/index.mjs`
> does **not** read `apps/web/.env`, so the port has to be passed in:
> `PORT=3010 node .output/server/index.mjs`. Without it Nuxt binds 3000 and
> takes the Gateway's port.

### Ports

One per application, none of them overlapping. The infrastructure ports are
deliberately **not** the defaults, so the stack coexists with any other
RabbitMQ or PostgreSQL already on your machine.

| | Port on the host | Where |
| --- | --- | --- |
| `gateway` | `3000` | <http://localhost:3000> |
| `customer-service` | `3001` | — |
| `account-service` | `3002` | — |
| `transaction-service` | `3003` | — |
| `payment-service` | `3004` | — |
| `notification-audit-service` | `3005` | — |
| `web` | `3010` | <http://localhost:3010> |
| RabbitMQ (AMQP) | `5673` | — |
| RabbitMQ (management UI) | `15673` | <http://localhost:15673> |
| PostgreSQL — customer, account, transaction, payment, notification-audit | `5433`–`5437` | one instance each, never shared |
| MinIO (S3 API) | `9002` | — |
| MinIO (console) | `9003` | <http://localhost:9003> |

`web` sits at 3010 rather than 3001 on purpose: 3001 belongs to
`customer-service`.

Under `pnpm dev` these are host-side mappings only. Between containers the
applications reach each other by service name on the native port —
`postgres-account:5432`, `rabbitmq:5672`, `minio:9000`.

### Check it came up

```bash
curl http://localhost:3000/health   # {"status":"ok","application":"gateway"}
curl http://localhost:3000/ready    # {"status":"ready",...,"broker":"connected"}
```

Every application answers both on its own port, so `3001` through `3005` are
worth the same two calls.

The two questions are different. `/health` says the process is alive, and keeps
answering even with RabbitMQ down — a restart would not fix a broker outage, so
reporting itself dead would only cause a restart loop. `/ready` answers `503`
while the broker is unreachable, which is what takes an instance out of
rotation.

If `/ready` returns `503`, the broker is the thing to look at, not the
application.

Under `pnpm dev` the same answer is in `docker compose ps`: every application
carries a `HEALTHCHECK`, so the status column reads `healthy` once it is
serving. Give it up to three minutes on a cold start — the first compilation
inside a fresh container is slow.

### What you can actually see

| Page | Needs a session | What it shows |
| --- | --- | --- |
| <http://localhost:3010/registro> | no | Public customer registration |
| <http://localhost:3010/login> | no | Sign-in |
| <http://localhost:3010/activar> | no | The verdict of an emailed activation link |
| <http://localhost:3010/clientes> | **yes** | The Clientes module (T-16) |
| <http://localhost:3010/cuentas> | **yes** | The Cuentas module (T-17) |
| <http://localhost:3010/transferencias> | **yes** | The Transferencias module (T-18) — a transfer runs its Saga to `COMPLETED` or compensates |
| <http://localhost:3010/pagos> | **yes** | The Pagos module (T-19) — payment monitoring and the retry ladder |
| <http://localhost:3010/auditoria> | **yes** (admin) | The Auditoría module (T-20) — the event trail by `correlationId` |
| Everything else | **yes** | Redirects to `/login` |

### Getting a session

The fastest way in is a **seeded test user** — the dev stack sets
`SEED_DEMO_DATA=true`, so `admin@bankusac.gt`, `cajero@bankusac.gt` and
`cliente@bankusac.gt` exist at boot, all with the password `BankUsac#2026`. Sign
in at <http://localhost:3010/login>. See
[Quick Start](#quick-start--run-the-app) for what each can do.

To register your own account instead:

1. Open <http://localhost:3010/registro> and fill the form.
2. The account is created **inactive**. Activation is triggered by
   `customer.activation.requested.v1`, which carries the clear token exactly
   once. Notification & Audit consumes it and its delivery channel is
   *simulated* — no mail is sent — so the link is printed instead:

   ```sh
   docker compose -f infra/docker/docker-compose.dev.yml \
     logs notification-audit-service | grep activationLink
   ```

3. Open `http://localhost:3010<the activationLink>`.
4. Sign in at <http://localhost:3010/login>.

**The link is printed only outside production** (`NODE_ENV !== 'production'`),
which is the behaviour of every local mail catcher and is recorded as TD-043.
The token is never stored: the audit trail redacts it, and `customers` holds
only its digest. Before T-20 the token was readable in RabbitMQ's management UI
because nothing consumed the audit queue; now `audit.customer` is drained, so
this log line is the way in.

### Exercising the Gateway without a frontend

Routes that only publish are observable in RabbitMQ rather than in a screen:

```bash
curl -i -X POST localhost:3000/api/customers \
  -F 'fullName=Ana López' -F 'identityDocument=1234567890101' \
  -F 'email=ana@example.com' -F 'dateOfBirth=1995-04-12' \
  -F 'address=Zona 1, Guatemala' -F 'role=CLIENTE' \
  -F 'credential=una-contrasena-larga'
# 202 {"customerId":"...","correlationId":"..."}
```

Then open <http://localhost:15673> and look at `customer.commands`: the
`customer.register.v1` message is there, carrying that same `correlationId`.

Routes that need a token are reachable by minting one against the same
`JWT_SECRET` — the Gateway is the only signer and the only validator, so
nothing else has to agree with it.

`specs/007-api-gateway-web-shell/evidence/` records a full pass of this against
real infrastructure, including what the messages looked like on the wire.

### Stopping

```bash
pnpm dev:down                              # everything, if you started it with pnpm dev
```

If the applications were running on the host instead, `Ctrl-C` in the terminal
holding `pnpm dev:host` stops all nine tasks at once. Then:

```bash
pnpm dev:infra:down                        # the databases, the broker, MinIO
```

Only if something survived the `Ctrl-C` — a task started outside turbo, or a
terminal that was killed rather than interrupted:

```bash
pkill -f 'dist/main.js'                    # the NestJS applications
pkill -f 'output/server/index.mjs'         # web, if running the built output
```

`pnpm dev:down` removes the application containers but keeps the named volumes,
so the next start does not reinstall the workspace. Databases keep their data
either way — that lives in the volumes declared by the infrastructure file, and
only `docker compose down -v` discards it.
