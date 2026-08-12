# infra/docker

The local development stack: one PostgreSQL container per service and one
RabbitMQ broker, run with Docker Compose. Database engines live here rather
than in Kubernetes because the constitution puts them outside the cluster
(principle III).

## Versions this ticket pins

Fixed so that the ticket that writes the Compose file does not have to
re-litigate them. Both were checked for support and known vulnerabilities on
2026-08-12 — see [research.md](../../specs/002-monorepo-dev-base/research.md).

| Image | Version | Support |
| --- | --- | --- |
| `postgres` | 18.4 | Community support until 2030-11-14 |
| `rabbitmq` | 4.3.4-management | Community until 2026-11-30, commercial until 2028-04 |

RabbitMQ **must not** be 4.2.x: community support for that series ended on
2026-07-31. A Compose file written with `rabbitmq:4.2` is in debt on day one.

## What belongs here

- One PostgreSQL service per microservice, each with its own database and
  credentials. A shared instance would break constitution II.
- RabbitMQ with the management plugin, and the topic exchange the applications
  publish to (`bank.events`).
- No application containers: those are built by the deployment ticket.

> **Blocked**: The Compose file, the per-service databases and the broker topology are not written yet. Owner: Marcos Bonifasi. Arrives with: T-06.
