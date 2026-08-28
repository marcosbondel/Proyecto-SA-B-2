# infra/docker

The local development stack: one PostgreSQL container per service, one
RabbitMQ broker, and one MinIO object-store buffer, run with Docker Compose.
Database engines, the broker, and object storage live here rather than in
Kubernetes because the constitution puts them outside the cluster
(principle III).

## Versions this ticket pins

Fixed so that later tickets do not have to re-litigate them. PostgreSQL and
RabbitMQ were checked for support and known vulnerabilities on 2026-08-12 —
see [research.md](../../specs/002-monorepo-dev-base/research.md). MinIO was
pinned at design time for T-06.

| Image | Version | Support |
| --- | --- | --- |
| `postgres` | 18.4 | Community support until 2030-11-14 |
| `rabbitmq` | 4.3.4-management | Community until 2026-11-30, commercial until 2028-04 |
| `minio/minio` | RELEASE.2024-11-07T00-52-20Z | Stable release channel |

RabbitMQ **must not** be 4.2.x: community support for that series ended on
2026-07-31. A Compose file written with `rabbitmq:4.2` is in debt on day one.

## What belongs here

- One PostgreSQL service per microservice, each with its own database and
  credentials. A shared instance would break constitution II.
- RabbitMQ with the management plugin, and the **four** topic exchanges the
  applications publish to: `bank.commands`, `bank.events`, `bank.replies` and
  `bank.errors`. Commands and events are separate exchanges because they are
  different kinds of statement with different rules — one handler versus many.
  The names, the queues, the bindings and the retry arguments are fixed by
  [`docs/events/topology.md`](../../docs/events/topology.md) (T-05); this ticket
  declares them, it does not decide them.
- MinIO as the S3-compatible transfer buffer for identity-document photos,
  provisioned outside the cluster per [ADR-012](../../docs/architecture/adr/ADR-012-object-storage.md).
- **No broker accounts in `rabbitmq_definitions.json`.** That file declares the
  topology and nothing else; its `users` and `permissions` arrays are empty on
  purpose. Definitions are imported *after* the node has applied its
  environment, so a user named there outranks `RABBITMQ_DEFAULT_PASS` — and a
  developer who changes the password in `.env` would get a new connection URL
  against a broker still expecting the old one, with nothing on either side
  saying so. The administrator comes from the environment, and the
  unprivileged `bank_app` account the applications connect with is created by
  the one-shot `rabbitmq-init` service from `RABBITMQ_APP_USER` and
  `RABBITMQ_APP_PASSWORD`. One password, one place.

  The administrator is the one account this cannot re-set: the image creates it
  only on a **fresh** volume. Changing `RABBITMQ_DEFAULT_PASS` against an
  existing `rabbitmq-data` needs the volume recreated, and `rabbitmq-init` says
  so rather than failing quietly.
- No delayed-message plugin is needed. The retry backoff is built from queues
  with `x-message-ttl` that dead-letter back to the queue that failed, which the
  pinned `rabbitmq:4.3.4-management` image supports as it ships.
- No application containers **in this file**. `docker-compose.yml` is
  infrastructure alone, and stays that way: the deployment ticket builds on it,
  and running only the databases and the broker is still a case worth having.
  The applications live in [`docker-compose.dev.yml`](docker-compose.dev.yml),
  which `include`s this file and adds the seven of them in watch mode, and in
  [`docker-compose.images.yml`](docker-compose.images.yml), which `include`s it
  and adds the same seven **from their built images** (T-21).

## Three ways to run it

| Command | What runs where |
| --- | --- |
| `pnpm dev` | Everything in Docker: infrastructure **and** the seven applications, in watch mode from a bind mount |
| `pnpm dev:host` | Infrastructure in Docker, applications on the host |
| `pnpm images:up` | Infrastructure in Docker, applications **from their built images** — no source mounted, nothing compiled at start-up |

`pnpm dev` is `docker-compose.dev.yml`. Its containers hold no application code
and no dependencies: the workspace arrives as a bind mount, `node_modules` live
in named volumes filled by the one-shot `deps` service, and the watchers poll
the mount so an edit in the editor rebuilds inside the container. The image
they share is [`dev/Dockerfile`](dev/Dockerfile) — Node and pnpm, nothing else.

The host's `node_modules` are never touched. They were resolved for macOS and
the containers are Linux, which is exactly why every one of them is shadowed by
a volume; `pnpm install` on the host and `pnpm dev` here coexist on one clone.

Two consequences worth knowing. A change to `@bank/contracts` or
`@bank/messaging` is picked up by the `packages` watcher, but a change to
`pnpm-lock.yaml` is not — that needs `pnpm dev:down && pnpm dev` so `deps` runs
again. And `JWT_SECRET` has a development-only default in the dev file, so the
gateway boots on a clone that has not set one; override it in `.env` and never
let that default near a deployment.

## Running the built images

`docker-compose.images.yml` is what makes the deployment artefacts testable
before there is a cluster to test them in. A bind mount can hide a file missing
from an image; this cannot.

```bash
pnpm images:build       # seven images, tagged with the commit
pnpm images:up          # the stack, from those images
pnpm images:smoke       # every check T-21 asks for, per image and per container
pnpm images:flow        # register a customer, open accounts, transfer
pnpm images:down
```

Only the Gateway and the frontend publish a port — the Gateway is the system's
only entry point, so a published 3001-3005 would be five ways around it. Both
published ports are overridable, because a developer running `pnpm dev:host`
already holds 3000 and 3010:

```bash
BANK_GATEWAY_PORT=3100 BANK_WEB_PORT=3110 pnpm images:up
```

The image inventory, the required variables per component, the tagging scheme
T-22 references and the base-image bump procedure are in
[`docs/operations/CONTAINERS.md`](../../docs/operations/CONTAINERS.md).

> **`down` takes the infrastructure with it.** `docker-compose.images.yml`
> `include`s `docker-compose.yml`, so `pnpm images:down` stops the databases and
> the broker too. Named volumes survive — no data is lost — but anything running
> on the host against them stops working until `pnpm dev:infra` brings them back.

## Quick start

See [`specs/006-local-dev-infra/quickstart.md`](../../specs/006-local-dev-infra/quickstart.md)
for the full validation guide. The short version is:

```bash
cp infra/docker/.env.example infra/docker/.env
# edit infra/docker/.env with local values
./infra/docker/scripts/validate-env.sh && \
  docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d
```

That is the infrastructure alone. To add the applications, run `pnpm dev` from
the repository root instead — same project name, so it reuses whatever is
already up rather than starting a second copy of every database.

## The scripts

| Script | What it does |
| --- | --- |
| `validate-env.sh` | Refuses to start with a variable `docker-compose.yml` needs missing (T-06) |
| `init-minio.sh` | Provisions the bucket, the application user and the retention policy (T-06) |
| `init-rabbitmq.sh` | Creates the `bank_app` broker account from `.env`, so no password is written down twice |
| `test-broker.sh`, `test-isolation.sh`, `test-persistence.sh`, `test-failures.sh` | The four T-06 infrastructure checks |
| `images.sh` | The seven components and their Dockerfiles, sourced by the two below so they cannot disagree (T-21) |
| `build-images.sh` | Builds and tags every image, and optionally loads them into kind (T-21) |
| `smoke-images.sh` | Labels, ports, user, secrets, size, liveness, readiness, and the degraded cases (T-21) |
| `flow-images.sh` | The assignment's flow, end to end, through the images (T-21) |

## Evidence

Executable evidence for T-06 is saved under
[`specs/006-local-dev-infra/evidence/`](../../specs/006-local-dev-infra/evidence/).
T-21's evidence is the two scripts themselves: `smoke-images.sh` is the ticket's
"smoke test por contenedor" and `flow-images.sh` its "registro del flujo completo
ejecutado en contenedores", both re-runnable rather than pasted.
