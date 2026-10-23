# Containers

Every image the system ships, what it needs to run, and how to tell a live
process from a ready one. Built by **T-21**; the values here are the values
**T-22** puts in the Helm chart.

The assignment requires Docker (§4.3), a Dockerfile per microservice and gateway
with local validation (§6, paso 10), and "todos los servicios correctamente
dockerizados" (§8.1). The database-outside-cluster constraint concerns
PostgreSQL. Local kind keeps broker and MinIO in Compose; GKE runs them inside
each namespace using upstream images, separate from the seven bank images.

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

T-46 añade una imagen **auxiliar** `apps/partner-bank-mock/Dockerfile`, fuera
de las siete aplicaciones bancarias. El chart permite desplegarla opcionalmente
y se observó en prod v1.3.6; en dev no está desplegada. El perfil opcional `interbank`
de Compose la inicia en el puerto local 3021 para simular otro banco; expone
`GET /health`; el contrato v1 usa `X-Api-Key` y el mock tiene una API de
administración separada. No intercambiarla con el Bearer de rutas heredadas.
Véase [INTERBANK.md](INTERBANK.md) para sus modos de fallo.

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
| `payment-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` | `PAYMENT_RETRY_DELAYS_MS` `PAYMENT_RETRY_SWEEP_MS` `PAYMENT_RETRY_SWEEP_IDLE_MAX_MS` `PAYMENT_SIM_FAILURE_RATE` `PAYMENT_SIM_TIMEOUT_RATE` `PAYMENT_SIM_LATENCY_MS` `INTERBANK_BANK_CODE` `INTERBANK_PARTNER_BANK_CODE` `INTERBANK_MAX_AMOUNT_MINOR` `INTERBANK_PARTNER_BASE_URL` `INTERBANK_API_KEY_OUTBOUND` `INTERBANK_RESOLVE_RETRY_MS` `INTERBANK_CONFIRMATION_TIMEOUT_MS` (obsolete, validated but unused; see [INTERBANK.md](INTERBANK.md)) |
| `notification-audit-service` | `NODE_ENV` `PORT` `DATABASE_URL` `RABBITMQ_URL` | `REVEAL_ACTIVATION_LINKS` `NOTIFICATION_CHANNEL` `RESEND_API_KEY`¹ `EMAIL_FROM`¹ `APP_BASE_URL`¹ `RESEND_API_URL` |
| `gateway` | `NODE_ENV` `PORT` `RABBITMQ_URL` `JWT_SECRET` `JWT_EXPIRES_IN` `OBJECT_STORAGE_*` | `GATEWAY_INSTANCE_ID` `REPLY_TIMEOUT_MS` `CORS_ALLOWED_ORIGINS` (defaults to `http://localhost:3010`) `ALERT_WEBHOOK_TOKEN` (≥ 32 characters; **a Secret**; without it `POST /api/alerts/slo` refuses every caller) `INTERBANK_PARTNER_TOKEN` (legacy Bearer routes) `INTERBANK_API_KEY_INBOUND` (official v1; ≥ 32 characters) `INTERBANK_BANK_CODE` `INTERBANK_PARTNER_BANK_CODE` `INTERBANK_MAX_AMOUNT_MINOR` |
| `web` | — | `NUXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:3000`) `NUXT_PUBLIC_GRAFANA_URL` (optional trace link origin) |

The Gateway has **no** `DATABASE_URL` and no way to acquire one: it holds no
business data (constitution II and V).

#### Telemetry, the same in six images (T-48)

The five services and the Gateway register the OpenTelemetry SDK through
`@bank/observability` before anything else loads (`src/instrumentation.ts`), and
read the same six variables. **All of them are optional**: with none set, a
container behaves as before T-48, except that its log lines now carry a
`traceId`. `web` does not load this shared SDK; its Nitro Prometheus integration is a separate surface.

| Variable | Default | What it does |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty | Where spans and metrics go, over OTLP/HTTP (`/v1/traces`, `/v1/metrics` are appended). **Empty means record and drop**: the SDK is still registered, so `traceparent` still crosses the broker and log lines with an active valid span can name its trace, but nothing leaves the process and nothing retries a collector that is not there. The chart sets it to the Collector of T-49. |
| `DEPLOYMENT_ENVIRONMENT` | `local` | `deployment.environment(.name)` on every span and metric, `environment` on every log line. `helm-deploy.sh` sets it to the namespace, `dev` or `prod`, so queries can select one environment; a panel without that filter can still mix them. |
| `SERVICE_VERSION` | `dev` | `service.version` and the log line's `version`. The chart sets it to the tag of the image the Deployment runs — the same value as its `image:` — so it cannot drift from the code. The images Compose sets it to `BANK_IMAGE_TAG`. |
| `OTEL_SDK_DISABLED` | `false` | `true` registers nothing at all: no spans, no metrics, no `traceId` in the logs. The standard switch, and the escape hatch if instrumentation is ever the suspect. |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | Milliseconds between metric pushes. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

`HOSTNAME`, which Docker and Kubernetes already set to the container or pod
name, becomes `service.instance.id`, so two replicas are two instances of one
service in a trace rather than two services. None of these is a secret, and
none is baked into an image: `images:smoke` still finds only `NODE_ENV` there.

**Every log line is JSON with a fixed head**, in this order: `timestamp`,
`level`, `serviceName`, `environment`, `version`, `message`, then
`correlationId`, `traceId` and `spanId` when there are any, then the component's
own fields. A field whose name suggests a secret or personal data (`password`,
`token`, `authorization`, `jwt`, `email`, `document`, `dpi`, `photo`,
`recipient`, `phone`, `address`, …) is dropped, and a JWT, a `Bearer` token or an
email address is masked wherever it appears in a value. Nest's own lines go
through the same logger. Logs are written to stdout only: the collection agent
of T-49 ships them, and no service sends its logs anywhere itself.

Two of the optional ones are worth reading before a deployment.

`PAYMENT_RETRY_DELAYS_MS` is the ladder between payment attempts, defaulting to
the 1 s / 5 s / 30 s that `docs/events/topology.md` fixed for the broker's own
retries. `docker-compose.images.yml` shortens it, and only there: a
demonstration cannot spend thirty-six seconds watching a compensation everybody
in the room already understands.

`REVEAL_ACTIVATION_LINKS` writes working account-activation URLs into a
container's log. It defaults to **closed** in production and open elsewhere, and
it is a flag of its own rather than a reading of `NODE_ENV` because these are
the production images: with the simulated channel and link revelation closed, no real mailbox
receives an activation link. For normal delivery configure Resend; the audit
trail remains redacted and Customer stores the token digest. `docker-compose.images.yml` turns it on for the
demonstration; anything a stranger can reach must not.

`SEED_DEMO_DATA` inserts, at boot and right after the migrations, four
ready-to-use users — administrator, teller and two customers. `SEED_PASSWORD`
(default `BankUsac#2026`) supplies staff credentials; the two demo clients
currently declare their own fixed demo password in the seed. The documented
admin/teller/client users all use that default in a standard demo —
and, in `account-service`, the demo accounts for the two clients. It is
**off by default in code**, and on in both `docker-compose.dev.yml` and the
images stack. It is the standard way to bootstrap a first administrator, which
anonymous registration can no longer create — and that is also why
`pnpm images:flow` needs it: the flow funds its source account through the
deposit window instead of writing to the database, a deposit needs a
`CAJERO_RECEPTOR`, and the Gateway will not mint one for a caller who is not
already an administrator. The seeded users do not pollute the run, which
registers its own customer and asserts only against the accounts it opens. Idempotent: fixed ids and `INSERT ... ON CONFLICT DO NOTHING`; a restart
creates what is missing and does not reset a changed password, KYC or balance. Each service seeds only its own database against the shared demo client
id — neither reads the other's table (constitution II).

`NOTIFICATION_CHANNEL` selects how notifications are delivered. It defaults to
`simulated` — a log line and no mail, which is what the assignment asks for
(§4.1) and what `pnpm images:flow` reads to finish a sign-up. Set it to `resend`
to send eligible **real emails** through [Resend](https://resend.com); ¹the
three marked variables become required in that mode: `RESEND_API_KEY`,
`EMAIL_FROM` (a verified sender such as `bonking <no-reply@mail.tudominio.com>`)
and `APP_BASE_URL` (the frontend origin, so the emailed link is absolute).
`RESEND_API_URL` defaults to `https://api.resend.com/emails` and exists only so
a test can point elsewhere. The domain permits real addresses on activation, password-reset issued,
identity rejection and password-changed events; `deliverableEmailFrom` selects
those four when `payload.email` exists. Other notifications use the simulated
fallback. A configured channel is not evidence of successful mail delivery. With `resend` on, set `REVEAL_ACTIVATION_LINKS` to
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

**Local kind:** `kind load docker-image` avoids a registry. **Cloud:** release
publishes versioned images to Artifact Registry and CD deploys `v*` in prod or
`dev-<sha>` in dev. The observed bank version is v1.3.6 (2026-10-21); tags alone
do not prove image immutability unless registry policy/digests enforce it.

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
pnpm images:trace                    # one transfer is one trace (needs the telemetry profile)
pnpm images:down
```

`images:trace` needs somewhere for the spans to go. The images Compose carries a
Jaeger behind the `telemetry` profile — off unless asked for, in-memory, and on
the loopback only — and the services export to it when told to:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318 \
  docker compose -f infra/docker/docker-compose.images.yml --profile telemetry up -d
SEED_DEMO_DATA=true pnpm images:flow
pnpm images:trace                    # Jaeger's UI is at http://localhost:16686
```

It is a check for a laptop, not the cluster's tracing backend; that is Tempo,
in T-49.

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

Historical smoke result at commit `9c13929`, against the T-06 stack (not a
fresh run of the T-61 branch):
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

**Funding uses the API.** `flow-images.sh` logs in as the seeded teller and
posts to `/api/accounts/{id}/deposit`, with an idempotency key. It does not
fund the source by SQL. The flow also proves rejection before KYC with no
money movement. Activation is completed through the simulated delivery link;
it is not marked verified by writing the database directly.

## Telemetría y estado observado — Fase III

Los seis procesos NestJS usan `@bank/observability`: SDK OpenTelemetry,
contexto W3C HTTP/AMQP, exportación OTLP y logs JSON. Web usa instrumentación
de Nitro y `/metrics`. Los secretos siguen llegando en runtime; no dibujar
claves ni copiar `.env` en evidencia. Ver [catálogo](../sre/telemetry-catalog.md).
GKE prod sirve siete imágenes bancarias v1.3.6. RabbitMQ observado es
`3.13-management` con PVC 2Gi, distinto del objetivo local/CI `4.3.4`.
El inventario de [cloud](CLOUD.md) distingue declaración y ejecución.
