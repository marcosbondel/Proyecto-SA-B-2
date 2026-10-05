# Containers

Every image the system ships, what it needs to run, and how to tell a live
process from a ready one. Built by **T-21**; the values here are the values
**T-22** puts in the Helm chart.

The assignment requires Docker (§4.3), a Dockerfile per microservice and gateway
with local validation (§6, paso 10), and "todos los servicios correctamente
dockerizados" (§8.1). Databases and the broker stay **outside** the cluster
(§8.1, constitution III), so nothing here builds one into an image.

## The seven images

One Dockerfile per component. There is no generic one, deliberately: the port,
the health check, the start-up ordering and the required variables differ per
component, and a shared file would hide exactly those differences.

Every build context is the **repository root**, because pnpm resolves the
workspace through the lockfile there. `.dockerignore` is what keeps that from
meaning "send the whole clone" — and it is the reason `**/node_modules` carries
`**/`: without it the pattern matches the root only, and the host's
macOS-compiled dependencies travel into a Linux image.

| Component | Dockerfile | Port | Start command | Liveness | Readiness |
| --- | --- | --- | --- | --- | --- |
| `customer-service` | `apps/services/customer-service/Dockerfile` | 3001 | `node dist/main.js` | `GET /health` | `GET /ready` |
| `account-service` | `apps/services/account-service/Dockerfile` | 3002 | `node dist/main.js` | `GET /health` | `GET /ready` |
| `transaction-service` | `apps/services/transaction-service/Dockerfile` | 3003 | `node dist/main.js` | `GET /health` | `GET /ready` |
| `payment-service` | `apps/services/payment-service/Dockerfile` | 3004 | `node dist/main.js` | `GET /health` | `GET /ready` |
| `notification-audit-service` | `apps/services/notification-audit-service/Dockerfile` | 3005 | `node dist/main.js` | `GET /health` | `GET /ready` |
| `gateway` | `apps/gateway/Dockerfile` | 3000 | `node dist/main.js` | `GET /health` | `GET /ready` |
| `web` | `apps/web/Dockerfile` | 3010 | `node .output/server/index.mjs` | `GET /health` | `GET /ready` |

Only the Gateway and the frontend publish a port outside the network. The five
services do not: the Gateway is the system's only entry point (§4.1,
constitution V), and a published 3001-3005 would be five ways around the one
door the design has.

### Variables each image requires at run time

Nothing is baked in. The only variables an image carries are `NODE_ENV`, which
selects code paths rather than a deployment, and `web`'s `NITRO_HOST` /
`NITRO_PORT`, which tell the preset to bind a container's interface instead of
loopback. Everything else arrives at start-up, which is what lets one image
serve Compose, kind and a demonstration alike.

| Component | Required | Optional |
| --- | --- | --- |
| `customer-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` `OBJECT_STORAGE_ENDPOINT` `OBJECT_STORAGE_ACCESS_KEY` `OBJECT_STORAGE_SECRET_KEY` `OBJECT_STORAGE_BUCKET` `OBJECT_STORAGE_REGION` | `SEED_DEMO_DATA` `SEED_PASSWORD` |
| `account-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` | `DEACTIVATION_ENABLED` `DEACTIVATION_INTERVAL_MS` `INACTIVITY_MONTHS` `INACTIVITY_MIN_BALANCE_MINOR` `ANOMALY_MAX_OPERATIONS` `ANOMALY_WINDOW_MINUTES` `SEED_DEMO_DATA` |
| `transaction-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` | — |
| `payment-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` | `PAYMENT_RETRY_DELAYS_MS` `PAYMENT_RETRY_SWEEP_MS` `PAYMENT_SIM_FAILURE_RATE` `PAYMENT_SIM_TIMEOUT_RATE` `PAYMENT_SIM_LATENCY_MS` |
| `notification-audit-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` | `REVEAL_ACTIVATION_LINKS` `NOTIFICATION_CHANNEL` `RESEND_API_KEY`¹ `EMAIL_FROM`¹ `APP_BASE_URL`¹ `RESEND_API_URL` |
| `gateway` | `NODE_ENV` `PORT` `RABBITMQ_URL` `JWT_SECRET` `JWT_EXPIRES_IN` `OBJECT_STORAGE_*` | `GATEWAY_INSTANCE_ID` `REPLY_TIMEOUT_MS` `CORS_ALLOWED_ORIGINS` (defaults to `http://localhost:3010`) |
| `web` | — | `NUXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:3000`) |

The Gateway has **no** `DATABASE_URL` and no way to acquire one: it holds no
business data (constitution II and V).

Two of the optional ones are worth reading before a deployment.

`PAYMENT_RETRY_DELAYS_MS` is the ladder between payment attempts, defaulting to
the 1 s / 5 s / 30 s that `docs/events/topology.md` fixed for the broker's own
retries. `docker-compose.images.yml` shortens it, and only there: a
demonstration cannot spend thirty-six seconds watching a compensation everybody
in the room already understands.

`REVEAL_ACTIVATION_LINKS` writes working account-activation URLs into a
container's log. It defaults to **closed** in production and open elsewhere, and
it is a flag of its own rather than a reading of `NODE_ENV` because these are
the production images: with it closed the activation link exists nowhere — it is
redacted in the audit trail and hashed in the customer's own table — so nobody
can complete a sign-up. `docker-compose.images.yml` turns it on for the
demonstration; anything a stranger can reach must not.

`SEED_DEMO_DATA` inserts, at boot and right after the migrations, three
ready-to-use users — one per role, `admin@bankusac.gt`, `cajero@bankusac.gt` and
`cliente@bankusac.gt`, all sharing `SEED_PASSWORD` (default `BankUsac#2026`) —
and, in `account-service`, two accounts for the client with one funded. It is
**off by default in code**, and on in both `docker-compose.dev.yml` and the
images stack. It is the standard way to bootstrap a first administrator, which
anonymous registration can no longer create — and that is also why
`pnpm images:flow` needs it: the flow funds its source account through the
deposit window instead of writing to the database, a deposit needs a
`CAJERO_RECEPTOR`, and the Gateway will not mint one for a caller who is not
already an administrator. The seeded users do not pollute the run, which
registers its own customer and asserts only against the accounts it opens. Idempotent: fixed ids and an UPSERT, so a restart refreshes the same
rows. Each service seeds only its own database against the shared demo client
id — neither reads the other's table (constitution II).

`NOTIFICATION_CHANNEL` selects how notifications are delivered. It defaults to
`simulated` — a log line and no mail, which is what the assignment asks for
(§4.1) and what `pnpm images:flow` reads to finish a sign-up. Set it to `resend`
to send the **real activation email** through [Resend](https://resend.com); ¹the
three marked variables become required in that mode: `RESEND_API_KEY`,
`EMAIL_FROM` (a verified sender such as `bonking <no-reply@mail.tudominio.com>`)
and `APP_BASE_URL` (the frontend origin, so the emailed link is absolute).
`RESEND_API_URL` defaults to `https://api.resend.com/emails` and exists only so
a test can point elsewhere. Only the activation email carries a real address, so
only it is delivered for real; every other notification has no real inbox by
design and stays simulated. With `resend` on, set `REVEAL_ACTIVATION_LINKS` to
`false`: the link belongs in the recipient's inbox, not in a log. The full
Resend + Route 53 setup is in
[docs/operations/EMAIL_RESEND.md](EMAIL_RESEND.md).

A missing or malformed variable is fatal at boot, by name, on the first line of
the log:

```
Invalid environment for "customer-service". Offending variables: DATABASE_URL, RABBITMQ_URL, …
```

That is deliberate and it is the opposite of how an unreachable dependency is
treated — see below.

## Liveness is not readiness

The distinction the ticket asks for, and the one that was broken until T-21.

**Liveness** asks whether the process is alive. It must not fail for anything a
restart would not fix: a database that is down does not come back because this
process died. **Readiness** asks whether the replica can do its job, and refuses
with `503` when it cannot, because an orchestrator reads the status code and a
`200` carrying a "degraded" body keeps the replica in rotation.

```
GET /health  → {"status":"ok","application":"account-service"}
GET /ready   → {"status":"ready","application":"account-service",
                "broker":"connected","database":"reachable","queues":"consuming"}
```

`queues` is the third signal, and it exists because of the boot order below: a
replica can have reached its database and its broker and still be consuming
nothing.

### What T-21 changed in the boot order

Until this ticket the four implemented services ran their migrations and
attached to their queues **before** `app.listen()`. With PostgreSQL or RabbitMQ
briefly unavailable, the process therefore never opened its port — so the Docker
`HEALTHCHECK` reported it unhealthy and Kubernetes restarted it. A crash loop
caused by a recoverable dependency is precisely what a liveness probe must never
cause.

Now the port opens first and the dependency-bound work happens behind it,
retried rather than fatal. A pod with a wrong `DATABASE_URL` is `Running` and
never `Ready` — which names the problem — instead of `CrashLoopBackOff`, which
hides it.

The Gateway answers the same question differently and keeps its own shape: it
bounds its wait for the broker at ten seconds and comes up degraded. The
difference is deliberate — the Gateway has a caller holding an HTTP connection,
so a few seconds spent reaching the broker saves a burst of `BROKER_UNAVAILABLE`
at cold start. Nothing waits on a domain service over HTTP.

### The frontend's readiness does not probe the Gateway

`web`'s `/ready` checks that `NUXT_PUBLIC_API_BASE_URL` is an absolute
`http`/`https` origin, and stops there. It deliberately does not check that the
Gateway answers: that value is **public runtime config resolved by the browser**,
from the user's machine, so the server would be measuring a path that is not the
one that matters — and would take the interface out of rotation during an API
outage, which is exactly when a person needs it up to be told the bank is not
answering.

The decision lives as a pure function in `apps/web/server/utils/gateway-config.ts`
so it can be tested despite TD-010.

> `@artmizu/nuxt-prometheus` registers its own `GET /health` and its handler
> wins over `server/routes/`. It is turned off in `nuxt.config.ts` so one
> question has one answer across all seven images. `/metrics` is untouched.

## Image rules, and where each one is satisfied

| Rule (from the ticket) | Where |
| --- | --- |
| Multi-stage build | Every Dockerfile: a `build` stage that compiles, a `runtime` stage that carries only the result. |
| Non-root user | `USER node` (uid 1000, already in the base image) before any `COPY`. Asserted by the smoke tests. |
| No `.env`, credential, volume or temporary artefact | `.dockerignore`, with `**/` on every nested pattern. Asserted by the smoke tests against the real values in `infra/docker/.env`. |
| Pinned base versions, documented bump | `node:24.19.0-alpine` everywhere — see below. |
| Unambiguous entrypoint | `CMD` in exec form, so PID 1 is node and `SIGTERM` reaches the shutdown handler rather than a shell. |
| Only the necessary port | One `EXPOSE` per image; only Gateway and frontend publish. Asserted by the smoke tests. |
| Configuration at run time, not build time | Only `NODE_ENV` and `web`'s two `NITRO_*` are baked. Asserted by the smoke tests. |
| Labels with service name and version/commit | `org.opencontainers.image.*` plus `gt.usac.bank.component` and `gt.usac.bank.ticket`. |

### Bumping the base image

Pinned by tag, not by digest. A tag can in principle be re-published, so this is
weaker than a digest — the trade was made because a digest pin means seven files
to edit and a `docker buildx imagetools inspect` to run for every Node patch,
and this repository already fixes the Node version in two other places that a
digest would silently disagree with.

To bump:

1. Change `.nvmrc` and `engines.node` in the root `package.json`.
2. Replace `node:<old>-alpine` in all seven Dockerfiles **and** the
   `org.opencontainers.image.base.name` label beside each one.
3. Update `infra/docker/dev/Dockerfile`, which is the development toolchain and
   is not one of the seven.
4. `./infra/docker/scripts/build-images.sh && ./infra/docker/scripts/smoke-images.sh`.

pnpm moves the same way, through `packageManager` and the `corepack prepare`
line in each Dockerfile.

## Tags

```
bank-usac/<component>:<short-commit>   immutable — the tag T-22 references
bank-usac/<component>:dev              moving — what docker-compose.images.yml names by default
```

The short commit, because it is the only string that answers "which code is in
this image" without trusting somebody to have bumped a number. The same commit
is also a label, so `docker inspect` answers it without trusting the tag either.
A dirty working tree is refused rather than tagged with a commit it does not
match; `--allow-dirty` appends `-dirty` and says so.

No registry. The assignment's cluster is a local kind (§6, paso 11), so an image
reaches it with `kind load docker-image` and never needs a push, a login or a
credential.

**T-22 reads these two values per service:**

```yaml
image:
  repository: bank-usac/<component>
  tag: <short-commit>
  pullPolicy: IfNotPresent   # the image is loaded into the node, never pulled
```

## Commands

```bash
pnpm images:build                    # the seven images, tagged with the commit
pnpm images:build -- gateway web     # only these
pnpm images:build -- --kind bank-usac  # and load them into a kind cluster

pnpm images:up                       # the stack, from the built images
pnpm images:smoke                    # every check the ticket asks for
pnpm images:flow                     # register, open accounts, transfer
pnpm images:down
```

`infra/docker/docker-compose.images.yml` is the third of three Compose files and
they answer three different questions:

| File | What it runs |
| --- | --- |
| `docker-compose.yml` | The databases, the broker and MinIO. Nothing else — T-06. |
| `docker-compose.dev.yml` | The same, plus every application in watch mode from a bind mount. Nothing is built. |
| `docker-compose.images.yml` | The same, plus every application **from its image**. No source mounted, nothing compiled at start-up. |

A developer already running `pnpm dev:host` holds 3000 and 3010, so the two
published ports are overridable:

```bash
BANK_GATEWAY_PORT=3100 BANK_WEB_PORT=3110 pnpm images:up
```

## What the smoke tests assert

`infra/docker/scripts/smoke-images.sh`, per image: the identifying labels, that
the exposed port is the component's and the only one, that the effective user is
`node`/uid 1000, that no credential from `infra/docker/.env` appears in
`Config.Env` or in any layer's instructions, that nothing but the documented
exceptions is baked in, and the size.

Per container: liveness answers, readiness answers and reports on every
dependency, and then the three properties the design turns on:

- liveness **keeps** answering with the database unreachable, and the process
  stays alive rather than crash-looping;
- readiness refuses with `503` in the same state;
- a missing variable **does** kill the boot, naming every offending variable.

Last run, on the seven images at commit `9c13929`, against the T-06 stack:
**63 passed, 0 failed**.

## What the flow proves

`infra/docker/scripts/flow-images.sh` runs the assignment's own flow through the
Gateway — register a customer, activate from the link the notification channel
produced, sign in, open two accounts, transfer — entirely against built images.
It crosses six of them and is recorded by the seventh, and it does it three
times:

| Scenario | Ends | The money |
| --- | --- | --- |
| no `paymentScenario` | `COMPLETED` | debited once, credited to the target |
| `REJECT` | `COMPENSATED` | debited, then given back on the first refusal |
| `TRANSIENT_FAILURE` | `COMPENSATED` | debited, four attempts, then given back |

The balances are read before and after each one and asserted, so the
compensation is a fact about the money rather than a status somebody wrote down.
That is §6 paso 12 — "validar escenarios de fallo, no solo casos exitosos" —
executed against the artefacts rather than described.

**One step is seeded, and it is labelled where it happens.** The source account
is given a starting balance with SQL, because nothing in this system can put
money into an account: a credit only ever happens as step 3 of a transfer Saga,
and cash deposit is not modelled at all (TD-018). Activation is **not** seeded
any more — see TD-044, closed by T-21.
