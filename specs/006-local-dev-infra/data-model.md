# Data Model: Local Development Infrastructure (T-06)

This feature has no business domain entities; its "data model" is the set of infrastructure resources the local stack manages and the relationships between them.

## Entity: DevelopmentStack

The top-level resource that groups all local infrastructure.

| Field | Value | Notes |
|---|---|---|
| `name` | `bank-usac-local` | Compose project name and Docker network name. |
| `composeFile` | `infra/docker/docker-compose.yml` | Single source of truth for the stack. |
| `envFile` | `infra/docker/.env` | Created from `.env.example`; never committed. |
| `network` | `bank-usac-local` | Fixed bridge network that kind nodes join. |
| `components` | 7 services + 7 named volumes | See below. |

**Validation rules**:
- `docker compose config` must exit with code 0.
- All required variables in `.env` must be non-empty (`validate-env.sh`).

## Entity: ServiceDatabase

One per bounded context. Five instances, isolated by credentials and volume.

| Field | Description | Example |
|---|---|---|
| `composeService` | Name in `docker-compose.yml` | `postgres-customer` |
| `hostPort` | Published port on localhost | `5433` |
| `databaseName` | PostgreSQL database | `customer` |
| `applicationUser` | Service-specific user | `customer_app` |
| `applicationPassword` | From `.env` | `$CUSTOMER_POSTGRES_PASSWORD` |
| `volumeName` | Named Docker volume | `pgdata-customer` |
| `healthCheck` | `pg_isready -U <user> -d <db>` | Must report healthy. |

**Validation rules**:
- Each `applicationUser` is created with `CREATEDB` only on its own database.
- Grants are limited to the owned database; no `SUPERUSER` or cross-database access.
- The isolation test proves 5 own connections succeed and 20 cross connections fail.

## Entity: Broker

Single RabbitMQ node that hosts the topology from `docs/events/topology.md`.

| Field | Description | Value |
|---|---|---|
| `composeService` | `rabbitmq` | — |
| `image` | `rabbitmq:4.3.4-management` | Pinned. |
| `amqpPort` | Client connections | `5672` |
| `managementPort` | Web UI | `15672` |
| `adminUser` | Full management access | From `RABBITMQ_DEFAULT_USER` |
| `appUser` | Publish/consume only | From `RABBITMQ_APP_USER` |
| `volumeName` | Named Docker volume | `rabbitmq-data` |
| `healthCheck` | `rabbitmq-diagnostics ping` | Must report healthy. |

**State transitions**:
- `starting` → `definitions loaded` → `healthy`.
- Topology is loaded from `rabbitmq_definitions.json` at boot; no runtime mutation is required.

## Entity: BrokerTopology

The exchanges, queues, bindings, and retry ladder declared by the broker.

| Field | Description |
|---|---|
| `exchanges` | `bank.commands`, `bank.events`, `bank.replies`, `bank.errors`; all `topic` and durable. |
| `workQueues` | `customer.commands`, `account.commands`, `transaction.commands`, `transaction.saga`, `payment.commands`, `audit.all`; all durable. |
| `retryQueues` | For each work queue `Q`: `Q.retry.1s`, `Q.retry.5s`, `Q.retry.30s` with `x-message-ttl` and dead-letter back to `Q`. |
| `deadLetterQueues` | For each work queue `Q`: `Q.dlq`; terminal. |
| `bindings` | As defined in `docs/events/topology.md`. |

**Validation rules**:
- Exported broker configuration equals the source topology (no extra/missing objects).
- Gateway reply queue is **not** declared here; it is runtime-only and exclusive.

## Entity: ObjectStore

MinIO instance that acts as a transfer buffer for identity-document photos.

| Field | Description | Value |
|---|---|---|
| `composeService` | `minio` | — |
| `image` | Pinned release | `minio/minio:RELEASE.2024-11-07T00-52-20Z` |
| `apiPort` | S3 API | `9000` |
| `consolePort` | Web console | `9001` |
| `adminUser` | Console and root access | From `MINIO_ROOT_USER` |
| `appUser` | Application access | From `MINIO_APP_USER` |
| `bucket` | `customer-identity-documents` | Created at init. |
| `retentionWindowHours` | Default object lifetime | `24` |
| `volumeName` | Named Docker volume | `minio-data` |

**Validation rules**:
- Bucket exists after startup.
- Lifecycle rule expires objects after the configured window.
- Application user policy allows only `s3:GetObject` and `s3:PutObject` on the bucket.

## Entity: NetworkAttachment

The bridge between the Compose stack and the kind cluster.

| Field | Description |
|---|---|
| `name` | `bank-usac-local` |
| `driver` | `bridge` |
| `kindNodes` | Joined via `kind create cluster` configuration in T-22. |
| `fallback` | `host.docker.internal` documented for hosts where shared network is unavailable. |

## Relationships

```text
DevelopmentStack
├── ServiceDatabase × 5
├── Broker
│   └── BrokerTopology
├── ObjectStore
└── NetworkAttachment
```

- Each `ServiceDatabase` owns exactly one `volumeName`.
- `Broker` depends only on its own volume and network; it does not depend on databases.
- `ObjectStore` depends only on its own volume and network.
- `NetworkAttachment` is shared by all components and is joinable by kind nodes.
