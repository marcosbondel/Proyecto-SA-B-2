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

**`apps/web` is the frontend**: layout, role-filtered navigation, session, a
single API client and four shared components, carrying two working modules —
**Clientes** (T-16, with public registration at `/registro`) and **Cuentas**
(T-17). The remaining modules are titled skeletons for T-18 to T-20.

**Customer Service and Account Service are implemented** (T-16, T-17): their own
schemas, message handlers, idempotency enforced in the database, and — in
Account Service — money as `NUMERIC(14,2)` that no float ever touches.

The **other three domain services are still scaffolding** — health checks,
environment validation, and empty `domain` and `application` layers. Transfers,
payments and the audit trail therefore time out rather than answering: see
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
infra/docker/                        # local stack: PostgreSQL, RabbitMQ, MinIO (T-06)
                                     #   + docker-compose.dev.yml, the whole app in watch mode
infra/k8s/                           # kind manifests
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
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm format` | Prettier over the repository |
| `pnpm dev` | The whole stack in Docker: infrastructure and all seven applications, in watch mode |
| `pnpm dev:down` | Stops it |
| `pnpm dev:logs` | Follows its logs |
| `pnpm dev:infra` | Only the infrastructure in Docker — five databases, the broker, MinIO — detached |
| `pnpm dev:infra:down` | Stops the infrastructure |
| `pnpm dev:host` | The seven applications in watch mode on your machine — infrastructure still has to be up |

### The task runner — Turborepo

Everything in that table except `dev`, `dev:down`, `dev:logs`, `dev:infra` and
`format` is [Turborepo](https://turborepo.com) running a task across the
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

There are two ways to run this, and they are not equivalent. Pick by what you
have installed and by what you are about to do.

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

The **API Gateway**, the **frontend**, **Customer Service**, **Account Service**
and **Transaction Service** are implemented. **Payment** and **Notification &
Audit** are still scaffolding — they boot, validate their environment, answer
`/health`, and consume nothing.

That asymmetry is visible from the first screen, so it is worth knowing before
you meet it. Registering a customer, signing in, and everything under
**Clientes** and **Cuentas** works end to end. A transfer starts its Saga, is
debited from the source account, and **stops at `PAYMENT_PENDING`** — Payment
Service is the next link and there is nothing there to answer, so the money has
left the source account and will not arrive until T-19 exists. The
**Transferencias** screen shows exactly that rather than a spinner or a
success. The audit trail still ends in a `504` after five seconds, because the
Gateway publishes the query and no service answers. All of that is the system
behaving as designed, not a fault to debug.

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
rather than typing them. From the repository root:

```bash
#!/usr/bin/env bash
# Writes one .env per application from infra/docker/.env.
# A file that already exists is never touched.
set -euo pipefail
[ -f infra/docker/.env ] || { echo "infra/docker/.env is missing — copy .env.example and fill it first"; exit 1; }
set -a; . ./infra/docker/.env; set +a

AMQP="amqp://${RABBITMQ_APP_USER:-bank_app}:${RABBITMQ_APP_PASSWORD:-changeme}@localhost:5673"
S3="OBJECT_STORAGE_ENDPOINT=http://localhost:9002
OBJECT_STORAGE_ACCESS_KEY=$MINIO_APP_USER
OBJECT_STORAGE_SECRET_KEY=$MINIO_APP_PASSWORD
OBJECT_STORAGE_BUCKET=$MINIO_BUCKET
OBJECT_STORAGE_REGION=${MINIO_REGION:-us-east-1}"

write() { # write <path> — body on stdin
  if [ -e "$1" ]; then echo "·  $1 — already there, left alone"; cat >/dev/null
  else cat >"$1"; echo "+  $1"; fi
}

write apps/gateway/.env <<EOF
NODE_ENV=development
PORT=3000
RABBITMQ_URL=$AMQP
JWT_SECRET=${JWT_SECRET:-dev-only-secret-not-for-any-deployed-environment}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-3600}
GATEWAY_INSTANCE_ID=gateway-dev
REPLY_TIMEOUT_MS=${REPLY_TIMEOUT_MS:-5000}
$S3
EOF

# service | port | published PostgreSQL port | prefix in infra/docker/.env
while read -r svc port pgport prefix; do
  u="${prefix}_POSTGRES_USER"; p="${prefix}_POSTGRES_PASSWORD"; d="${prefix}_POSTGRES_DB"
  write "apps/services/$svc/.env" <<EOF
NODE_ENV=development
PORT=$port
DATABASE_URL=postgresql://${!u}:${!p}@localhost:$pgport/${!d}
RABBITMQ_URL=$AMQP
$S3
EOF
done <<'SERVICES'
customer-service            3001 5433 CUSTOMER
account-service             3002 5434 ACCOUNT
transaction-service         3003 5435 TRANSACTION
payment-service             3004 5436 PAYMENT
notification-audit-service  3005 5437 NOTIFICATION_AUDIT
SERVICES

write apps/web/.env <<EOF
NUXT_PUBLIC_API_BASE_URL=http://localhost:3000
EOF
```

It is safe to re-run: a `.env` that already exists is reported and left alone,
so it fills gaps without overwriting anything you tuned by hand. It needs
`bash` — the `${!var}` indirection is not POSIX `sh`.

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
| <http://localhost:3010/demo> | no | The four shared components and all five asynchronous states, with no broker |
| <http://localhost:3010/registro> | no | Public customer registration |
| <http://localhost:3010/login> | no | Sign-in |
| <http://localhost:3010/activar> | no | The verdict of an emailed activation link |
| <http://localhost:3010/clientes> | **yes** | The Clientes module (T-16) |
| <http://localhost:3010/cuentas> | **yes** | The Cuentas module (T-17) |
| Everything else | **yes** | Redirects to `/login` |

### Getting a session

There are no seeded credentials — the way in is to register one:

1. Open <http://localhost:3010/registro> and fill the form.
2. The account is created **inactive**. Activation is triggered by
   `customer.activation.requested.v1`, which carries the clear token exactly
   once and is delivered by Notification & Audit — which is not built. So read
   the token off the wire instead: open <http://localhost:15673>, go to the
   `audit.all` queue, *Get messages*, and find the event for your email.
3. Open `http://localhost:3010/activar?token=<the token>`.
4. Sign in at <http://localhost:3010/login>.

Step 2 disappears when T-20 lands and the mail is actually sent.

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

If the applications were running on the host instead:

```bash
pkill -f 'dist/main.js'                    # the NestJS applications
pkill -f 'output/server/index.mjs'         # web, if running the built output
docker compose -f infra/docker/docker-compose.yml stop
```

`pnpm dev:down` removes the application containers but keeps the named volumes,
so the next start does not reinstall the workspace. Databases keep their data
either way — that lives in the volumes declared by the infrastructure file, and
only `docker compose down -v` discards it.
