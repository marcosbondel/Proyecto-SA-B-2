# infra/docker

The local development stack: one PostgreSQL container per service, one
RabbitMQ broker, and one MinIO object-store buffer, run with Docker Compose.
The local kind procedure connects to this external infrastructure. Constitution
principle III requires **databases** outside Kubernetes; the cloud chart runs
RabbitMQ and MinIO in-cluster. Do not project this Compose layout onto GKE.

## Versions this ticket pins

These are **Compose declarations**, not verified support statements as of this
review. GKE has a different RabbitMQ image (`3.13-management`); see TD-097.

Fixed so that later tickets do not have to re-litigate them. PostgreSQL and
RabbitMQ were checked for support and known vulnerabilities on 2026-08-12 —
see [research.md](../../specs/002-monorepo-dev-base/research.md). MinIO was
pinned at design time for T-06.

| Image | Version declared by Compose | Scope of this review |
| --- | --- | --- |
| `postgres` | 18.4 | Configuration inspected; no new CVE/support audit |
| `rabbitmq` | 4.3.4-management | Matches CI; GKE currently differs |
| `minio/minio` | RELEASE.2024-11-07T00-52-20Z | Historical local tag; GKE uses a Chainguard digest |

The cloud MinIO digest is recorded in the dated GKE inventories. This review
does not claim that the old local image can still be downloaded from its public
registry or that an image tag proves the absence of vulnerabilities.

The pinned versions and the 2026-08-12 research are historical decisions.
Before a version change, verify current upstream support, upgrade path and
security advisories; changing an image tag without a persistent-data upgrade
test is not a completed migration.

## What belongs here

- One PostgreSQL service per microservice, each with its own database and
  credentials. A shared instance would break constitution II.
- RabbitMQ with the management plugin, and the **four** topic exchanges the
  applications publish to: `bank.commands`, `bank.events`, `bank.replies` and
  `bank.errors`. Commands and events are separate exchanges because they are
  different kinds of statement with different rules — one handler versus many.
  The names, the queues, the bindings and the retry arguments are fixed by
  [`docs/events/topology.md`](../../docs/events/topology.md) (T-05) and asserted
  by the services themselves on startup, from the `@bank/contracts` catalogue —
  the broker declares them, it does not decide them.
- MinIO as the S3-compatible transfer buffer for identity-document photos,
  provisioned outside the cluster per [ADR-012](../../docs/architecture/adr/ADR-012-object-storage.md).
- **No definitions file, and no broker accounts declared anywhere but `.env`.**
  RabbitMQ 4.x skips seeding `RABBITMQ_DEFAULT_USER` whenever a definitions file
  is loaded — even a users-less one — so loading a topology-only definitions file
  left the `admin` account uncreated and the stack unable to start on a fresh
  volume. The topology is asserted by the services on startup instead (they must
  do so anyway, so a fresh broker works), which lets the image seed `admin` from
  the environment as intended. The unprivileged `bank_app` account the
  applications connect with is then created by the one-shot `rabbitmq-init`
  service from `RABBITMQ_APP_USER` / `RABBITMQ_APP_PASSWORD`. One password, one
  place. See [`rabbitmq/rabbitmq.conf`](rabbitmq/rabbitmq.conf).

  The administrator is the one account this cannot re-set: the image creates it
  only on a **fresh** volume. Changing `RABBITMQ_DEFAULT_PASS` against an existing `rabbitmq-data` does
  not rotate that user. Coordinate a broker-user password change and clients;
  recreating the volume is destructive and is not a safe routine rotation.
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

The host's `node_modules` are never touched. They may target Windows/macOS while
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
T-21 provides the two verification scripts: `smoke-images.sh` is the ticket's
"smoke test por contenedor" and `flow-images.sh` its "registro del flujo completo
ejecutado en contenedores", both re-runnable. A script is a method; an execution claim still requires
version, time and its captured output.

## Revisión documental T-61 — 2026-10-21

La vista consolidada y las diferencias entre local y cloud están en
[el índice de arquitectura](../../docs/architecture/README.md).
Para esta revisión no se ejecutó Terraform apply ni se cambió infraestructura
persistente. GKE observado: `us-central1-c`, tres nodos, prod v1.3.6; bases
dev con sufijo `_dev`. La evidencia y sus límites están en
[T-60 cloud](../../docs/qa/backend/T-60-cloud-evidence.md).
