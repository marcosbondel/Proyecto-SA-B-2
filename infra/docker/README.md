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
- No application containers: those are built by the deployment ticket.

## Quick start

See [`specs/006-local-dev-infra/quickstart.md`](../../specs/006-local-dev-infra/quickstart.md)
for the full validation guide. The short version is:

```bash
cp infra/docker/.env.example infra/docker/.env
# edit infra/docker/.env with local values
./infra/docker/scripts/validate-env.sh && \
  docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d
```

## Evidence

Executable evidence for T-06 is saved under
[`specs/006-local-dev-infra/evidence/`](../../specs/006-local-dev-infra/evidence/).
