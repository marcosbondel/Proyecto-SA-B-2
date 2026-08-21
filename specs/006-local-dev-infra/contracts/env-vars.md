# Contract: Environment Variables

All variables used by `infra/docker/docker-compose.yml`, its init scripts, and the documented application connection strings. Every variable MUST appear in `infra/docker/.env.example` with a placeholder, and real values MUST be supplied through an uncommitted `infra/docker/.env`.

## PostgreSQL (one block per service)

| Variable | Service | Example | Used in |
|---|---|---|---|
| `CUSTOMER_POSTGRES_DB` | Customer | `customer` | `postgres-customer` service |
| `CUSTOMER_POSTGRES_USER` | Customer | `customer_app` | `postgres-customer` service |
| `CUSTOMER_POSTGRES_PASSWORD` | Customer | `changeme` | `postgres-customer` service |
| `CUSTOMER_POSTGRES_PORT` | Customer | `5433` | host port mapping |
| `ACCOUNT_POSTGRES_DB` | Account | `account` | `postgres-account` service |
| `ACCOUNT_POSTGRES_USER` | Account | `account_app` | `postgres-account` service |
| `ACCOUNT_POSTGRES_PASSWORD` | Account | `changeme` | `postgres-account` service |
| `ACCOUNT_POSTGRES_PORT` | Account | `5434` | host port mapping |
| `TRANSACTION_POSTGRES_DB` | Transaction | `transaction` | `postgres-transaction` service |
| `TRANSACTION_POSTGRES_USER` | Transaction | `transaction_app` | `postgres-transaction` service |
| `TRANSACTION_POSTGRES_PASSWORD` | Transaction | `changeme` | `postgres-transaction` service |
| `TRANSACTION_POSTGRES_PORT` | Transaction | `5435` | host port mapping |
| `PAYMENT_POSTGRES_DB` | Payment | `payment` | `postgres-payment` service |
| `PAYMENT_POSTGRES_USER` | Payment | `payment_app` | `postgres-payment` service |
| `PAYMENT_POSTGRES_PASSWORD` | Payment | `changeme` | `postgres-payment` service |
| `PAYMENT_POSTGRES_PORT` | Payment | `5436` | host port mapping |
| `NOTIFICATION_AUDIT_POSTGRES_DB` | Notification & Audit | `notification_audit` | `postgres-notification-audit` service |
| `NOTIFICATION_AUDIT_POSTGRES_USER` | Notification & Audit | `notification_audit_app` | `postgres-notification-audit` service |
| `NOTIFICATION_AUDIT_POSTGRES_PASSWORD` | Notification & Audit | `changeme` | `postgres-notification-audit` service |
| `NOTIFICATION_AUDIT_POSTGRES_PORT` | Notification & Audit | `5437` | host port mapping |

## RabbitMQ

| Variable | Example | Used in |
|---|---|---|
| `RABBITMQ_DEFAULT_USER` | `admin` | Management UI / admin user |
| `RABBITMQ_DEFAULT_PASS` | `changeme` | Management UI / admin user |
| `RABBITMQ_APP_USER` | `bank_app` | Application connections |
| `RABBITMQ_APP_PASSWORD` | `changeme` | Application connections |
| `RABBITMQ_AMQP_PORT` | `5672` | AMQP host port mapping |
| `RABBITMQ_MANAGEMENT_PORT` | `15672` | Management UI host port mapping |

## MinIO

| Variable | Example | Used in |
|---|---|---|
| `MINIO_ROOT_USER` | `minioadmin` | Console / root user |
| `MINIO_ROOT_PASSWORD` | `changeme` | Console / root user |
| `MINIO_APP_USER` | `bank_app` | Application connections |
| `MINIO_APP_PASSWORD` | `changeme` | Application connections |
| `MINIO_API_PORT` | `9000` | S3 API host port mapping |
| `MINIO_CONSOLE_PORT` | `9001` | Web console host port mapping |
| `MINIO_BUCKET` | `customer-identity-documents` | Bucket created at init |
| `MINIO_RETENTION_HOURS` | `24` | Object lifecycle rule |

## Application connection strings (documented only)

These values are not exported as Compose variables; they are documented in `quickstart.md` so each service ticket can copy them into its own `.env.example`.

| Service | `DATABASE_URL` template |
|---|---|
| Customer | `postgresql://${CUSTOMER_POSTGRES_USER}:${CUSTOMER_POSTGRES_PASSWORD}@localhost:${CUSTOMER_POSTGRES_PORT}/${CUSTOMER_POSTGRES_DB}` |
| Account | `postgresql://${ACCOUNT_POSTGRES_USER}:${ACCOUNT_POSTGRES_PASSWORD}@localhost:${ACCOUNT_POSTGRES_PORT}/${ACCOUNT_POSTGRES_DB}` |
| Transaction | `postgresql://${TRANSACTION_POSTGRES_USER}:${TRANSACTION_POSTGRES_PASSWORD}@localhost:${TRANSACTION_POSTGRES_PORT}/${TRANSACTION_POSTGRES_DB}` |
| Payment | `postgresql://${PAYMENT_POSTGRES_USER}:${PAYMENT_POSTGRES_PASSWORD}@localhost:${PAYMENT_POSTGRES_PORT}/${PAYMENT_POSTGRES_DB}` |
| Notification & Audit | `postgresql://${NOTIFICATION_AUDIT_POSTGRES_USER}:${NOTIFICATION_AUDIT_POSTGRES_PASSWORD}@localhost:${NOTIFICATION_AUDIT_POSTGRES_PORT}/${NOTIFICATION_AUDIT_POSTGRES_DB}` |

| Component | Connection string |
|---|---|
| All services → broker | `amqp://${RABBITMQ_APP_USER}:${RABBITMQ_APP_PASSWORD}@localhost:${RABBITMQ_AMQP_PORT}` |
| Gateway / Customer → MinIO | `http://localhost:${MINIO_API_PORT}` / bucket `${MINIO_BUCKET}` |

## Validation contract

`validate-env.sh` MUST fail with a clear message if any of the following is empty or unset:

- All `*_POSTGRES_DB`, `*_POSTGRES_USER`, `*_POSTGRES_PASSWORD`, `*_POSTGRES_PORT` variables.
- All `RABBITMQ_*` variables listed above.
- All `MINIO_*` variables listed above.
- Any variable referenced by `docker-compose.yml` that is not in this contract.
