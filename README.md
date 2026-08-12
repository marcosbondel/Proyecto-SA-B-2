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
| David Estuardo Barrios Ramirez | 202300769 | AI Engineer; Transaction and Payment Services |
| Marcos Daniel Bonifasi de Leon | 202202410 | AI Project Manager and Tech Lead; Gateway, frontend, infrastructure, SRE, Notification & Audit, and documentation |

All three members share responsibility for event contracts, integration,
testing, and final review. See [docs/OWNERSHIP.md](docs/OWNERSHIP.md) for the
single primary owner of every component.

## What This Is

The system models the core flows of a banking platform:

- Customer registration and identity validation.
- Bank account creation, balance queries, and account state changes.
- Transfers between accounts through an asynchronous Saga.
- Internal and external payment processing.
- Notifications, audit events, and distributed observability foundations.

The monorepo and its development base exist: seven applications and three
shared packages that install, build, lint and test from a clean checkout. What
they contain is scaffolding — health checks, environment validation and the
shared message envelope. No banking rule is implemented yet.

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
infra/docker/                        # local PostgreSQL and RabbitMQ stack (T-06)
infra/k8s/                           # kind manifests (T-16)
docs/                                # durable project documentation
specs/                               # Spec Kit artifacts for feature work
```

Each of the five services carries the four Clean Architecture layers —
`domain`, `application`, `infrastructure`, `interfaces` — and dependencies
point inward. That direction is enforced by lint, not by convention: see
[Isolation rules](#isolation-rules).

The rest of the scaffolding: `.specify/` holds Spec Kit workflow state,
templates and the constitution; `.agents/` holds the canonical role and skill
definitions; `.claude/` and `.opencode/` link to them; `docs/references/` holds
assignment material.

## Documentation

- [Architecture](ARCHITECTURE.md) - system shape, constraints, stack, and
  dependency rules.
- [Design system](docs/DESIGN.md) - visual tokens, components, states, and
  domain formats.
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
- [AI project agents](docs/AI_PROJECT_AGENTS.md) - agent roles and boundaries.
- [AI project skills](docs/AI_PROJECT_SKILLS.md) - installed and deferred
  skills.
- [Design documents](docs/design-docs/index.md) - durable design records.

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
| `pnpm format` | Prettier over the repository |
| `pnpm dev` | Every application in watch mode, in parallel |

Every command has a per-application form:

```bash
pnpm --filter customer-service test
pnpm --filter gateway lint
pnpm --filter web build
```

Application names are `gateway`, `web`, `customer-service`, `account-service`,
`transaction-service`, `payment-service`, `notification-audit-service`. The
shared packages are `@bank/contracts`, `@bank/messaging` and `@bank/tooling`.

**Build the shared packages before running one application on its own.** They
are consumed from `dist/`, so a fresh clone needs a `pnpm build` first — or use
`pnpm --filter gateway... build` (three dots) to build an application together
with its dependencies.

### Local startup order

1. `pnpm install`
2. Copy each `.env.example` to `.env` in the same directory and fill in local
   values. Never commit a `.env`.
3. Start the local infrastructure — PostgreSQL and RabbitMQ.
   **Blocked until T-06.** Until then the applications boot in health-check
   mode with no broker connection, which is enough to develop against.
4. `pnpm dev`, or `pnpm --filter <app> dev` for a single application.

Every application answers `GET /health` on its own port once running:

```bash
curl http://localhost:3001/health
# {"status":"ok","application":"customer-service"}
```

A missing required variable fails the boot immediately and names it, rather
than surfacing later as a runtime error:

```text
Invalid environment for "customer-service". Offending variables: DATABASE_URL
  - DATABASE_URL: DATABASE_URL should not be empty; DATABASE_URL must be a string
```

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

<!-- test: verifying commit authorship attribution, safe to remove -->
