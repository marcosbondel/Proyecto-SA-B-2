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
shared packages that install, build, lint and test from a clean checkout.

**The API Gateway is implemented** (T-15): eleven HTTP routes, JWT
authentication, role authorization, asynchronous request/reply with a
five-second ceiling, a seven-code error contract, and a versioned OpenAPI
contract in `apps/gateway/openapi/`. It holds no business logic, no database
and no HTTP client towards any internal service — and a test suite asserts all
three rather than asking to be believed.

**`apps/web` is the shared frontend shell**: layout, role-filtered navigation,
session, a single API client and four shared components, with the four modules
as titled skeletons for T-16 to T-20 to fill in.

The **five domain services are still scaffolding** — health checks, environment
validation, and empty `domain` and `application` layers. No banking rule is
implemented yet, which is why signing in does not work: see
[Running It Locally](#running-it-locally).

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

<!-- test: verifying PR authorship attribution via feature branch, safe to remove -->

## Running It Locally

What runs today is the **API Gateway** and the **frontend shell**. The five
domain services are still scaffolding — they boot and answer `/health`, and
nothing else. That shapes everything below, so it is worth knowing before you
start rather than discovering it at a login screen.

### 1. Toolchain and dependencies

```bash
nvm use            # Node 24.19.0, from .nvmrc
corepack enable    # pnpm 11.21.0
pnpm install
pnpm build         # shared packages first, then the seven applications
```

`pnpm build` is not optional on a fresh clone. `@bank/contracts` and
`@bank/messaging` are consumed from `dist/`, so anything that imports them
fails until they have been built at least once.

### 2. Local infrastructure

RabbitMQ, MinIO and five PostgreSQL instances, from `infra/docker/`:

```bash
cd infra/docker
cp .env.example .env      # then fill in the credentials
docker compose up -d
docker compose ps         # wait for every service to read "healthy"
```

The ports are deliberately **not** the defaults, so the stack coexists with any
other RabbitMQ or PostgreSQL already on your machine:

| Service | Port | Where |
| --- | --- | --- |
| RabbitMQ (AMQP) | `5673` | — |
| RabbitMQ (management UI) | `15673` | <http://localhost:15673> |
| MinIO (S3 API) | `9002` | — |
| MinIO (console) | `9003` | <http://localhost:9003> |
| PostgreSQL, one per service | `5433`–`5437` | Unused until T-16 |

Credentials live in `infra/docker/.env`, which is git-ignored. The Gateway
never touches PostgreSQL — those five instances are there for the services that
do not exist yet.

### 3. Environment files

Copy each `.env.example` to `.env` **in the same directory** and fill in local
values. Never commit a `.env`.

For the Gateway, `RABBITMQ_URL` and the `OBJECT_STORAGE_*` values must match
what you put in `infra/docker/.env` — including the non-default ports:

```bash
# apps/gateway/.env
PORT=3000
RABBITMQ_URL=amqp://<app-user>:<app-password>@localhost:5673
JWT_SECRET=<at least 32 characters>
OBJECT_STORAGE_ENDPOINT=http://localhost:9002
OBJECT_STORAGE_BUCKET=customer-identity-documents
# ...and the rest, see apps/gateway/.env.example
```

A missing or malformed variable fails the boot immediately and **names the
variable**, rather than surfacing later as a runtime error:

```text
Invalid environment for "gateway". Offending variables: JWT_SECRET
  - JWT_SECRET: JWT_SECRET must be longer than or equal to 32 characters
```

### 4. Start the applications

```bash
pnpm --filter gateway dev     # http://localhost:3000
pnpm --filter web dev         # http://localhost:3010
```

Start the Gateway **first**. It owns port 3000, and Nuxt defaults to 3000 too —
start them the other way round and the frontend takes the port the Gateway
needs, which shows up as a browser that loads but cannot reach any API.

Ports are one per application, and none of them overlap:

| Application | Port |
| --- | --- |
| `gateway` | `3000` |
| `customer-service` | `3001` |
| `account-service` | `3002` |
| `transaction-service` | `3003` |
| `payment-service` | `3004` |
| `notification-audit-service` | `3005` |
| `web` | `3010` |

`web` sits at 3010 rather than 3001 on purpose: 3001 belongs to
`customer-service`, and the collision would only appear once T-16 lands.

> **Running the production build instead of `dev`?** `node .output/server/index.mjs`
> does **not** read `apps/web/.env`, so the port has to be passed in:
> `PORT=3010 node .output/server/index.mjs`. Without it Nuxt binds 3000 and
> takes the Gateway's port.

### 5. Check it came up

```bash
curl http://localhost:3000/health   # {"status":"ok","application":"gateway"}
curl http://localhost:3000/ready    # {"status":"ready",...,"broker":"connected"}
```

The two answer different questions. `/health` says the process is alive and
keeps answering even with RabbitMQ down — a restart would not fix a broker
outage, so reporting itself dead would only cause a restart loop. `/ready`
answers `503` while the broker is unreachable, which is what takes the instance
out of rotation.

If `/ready` returns `503`, the broker is the thing to look at, not the Gateway.

### What you can actually see right now

| Page | Needs a session | What it shows |
| --- | --- | --- |
| <http://localhost:3010/demo> | no | The four shared components and all five asynchronous states, with no broker |
| <http://localhost:3010/login> | no | Sign-in |
| <http://localhost:3010/activar> | no | The verdict of an emailed activation link |
| Everything else | **yes** | Redirects to `/login` |

**There are no demo credentials, and signing in cannot work yet.** The Gateway
publishes `customer.authenticate.v1` and waits for a reply; Customer Service is
T-16 and does not exist, so nobody answers and the request ends in a `504`
after five seconds. That is the system behaving correctly — it is not a bug,
and it is why `/demo` is the page worth opening first.

The same applies to every query route: balances, transaction status and the
audit trail all time out, because the services that would answer them are not
built.

### Exercising the Gateway without a frontend

The routes that only publish are fully working today — you just observe the
result in RabbitMQ rather than in a screen:

```bash
curl -i -X POST localhost:3000/api/customers \
  -F 'fullName=Ana López' -F 'identityDocument=1234567890101' \
  -F 'email=ana@example.com' -F 'dateOfBirth=1995-04-12' \
  -F 'address=Zona 1, Guatemala' -F 'role=CLIENTE' \
  -F 'credential=una-contrasena-larga'
# 202 {"customerId":"...","correlationId":"..."}
```

Then open <http://localhost:15673>, look at `customer.commands`, and you will
find `customer.register.v1` carrying that same `correlationId`.

Routes that need a token are reachable by minting one against the same
`JWT_SECRET` — the Gateway is the only signer and the only validator, so
nothing else has to agree with it.

`specs/007-api-gateway-web-shell/evidence/` records a full pass of this against
real infrastructure, including what the messages looked like on the wire.

### Stopping

```bash
pkill -f 'dist/main.js'                    # gateway
pkill -f 'output/server/index.mjs'         # web, if running the built output
docker compose -f infra/docker/docker-compose.yml stop
```
