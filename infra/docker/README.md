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
- No delayed-message plugin is needed. The retry backoff is built from queues
  with `x-message-ttl` that dead-letter back to the queue that failed, which the
  pinned `rabbitmq:4.3.4-management` image supports as it ships.
- No application containers **in this file**. `docker-compose.yml` is
  infrastructure alone, and stays that way: the deployment ticket builds on it,
  and running only the databases and the broker is still a case worth having.
  The applications live in [`docker-compose.dev.yml`](docker-compose.dev.yml),
  which `include`s this file and adds the seven of them in watch mode.

## Two ways to run it

| Command | What runs where |
| --- | --- |
| `pnpm dev` | Everything in Docker: infrastructure **and** the seven applications |
| `pnpm dev:host` | Infrastructure in Docker, applications on the host |

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

## Evidence

Executable evidence for T-06 is saved under
[`specs/006-local-dev-infra/evidence/`](../../specs/006-local-dev-infra/evidence/).
