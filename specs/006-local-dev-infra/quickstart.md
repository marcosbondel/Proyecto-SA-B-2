# Quickstart: Local Development Infrastructure (T-06)

Validation guide for the local Docker Compose stack. For the full specification see [spec.md](spec.md); for the data model see [data-model.md](data-model.md); for the contracts see [contracts/](contracts/).

## Prerequisites

- Docker Engine / Docker Desktop with Compose v2.
- (Optional) `jq` for inspecting exported broker definitions.
- (Optional) `psql` or any PostgreSQL client for manual checks.
- (For broker adapter test) Node 24.19.0 and pnpm 11.21.0, with `pnpm install && pnpm build` already run.

## 1. Configure the environment

```bash
cp infra/docker/.env.example infra/docker/.env
# Edit infra/docker/.env and replace every placeholder with local values.
```

## 2. Validate the Compose file

```bash
docker compose -f infra/docker/docker-compose.yml config > specs/006-local-dev-infra/evidence/docker-compose-config.yml
```

**Expected outcome**: exit code 0 and a non-empty rendered Compose file.

## 3. Start the stack

```bash
./infra/docker/scripts/validate-env.sh && \
  docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d
```

**Expected outcome**: seven containers (`postgres-*` × 5, `rabbitmq`, `minio`) reach `healthy` within 60 seconds.

```bash
docker compose -f infra/docker/docker-compose.yml ps
```

## 4. Verify database isolation

```bash
./infra/docker/scripts/test-isolation.sh > specs/006-local-dev-infra/evidence/test-isolation.log
```

**Expected outcome**:
- 5 own connections: all succeed.
- 20 cross connections: all rejected.

## 5. Verify broker topology

Export the broker configuration and compare it with [contracts/broker-topology.md](contracts/broker-topology.md):

```bash
curl -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" \
  http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/definitions \
  > specs/006-local-dev-infra/evidence/rabbitmq-definitions.json
```

**Expected outcome**: four `topic` exchanges, six work queues, 18 retry queues, six DLQs, and bindings matching `docs/events/topology.md`.

## 6. Run the broker adapter test

This closes TD-014 by exercising `@bank/messaging` against the live broker.

```bash
export RABBITMQ_URL="amqp://${RABBITMQ_APP_USER}:${RABBITMQ_APP_PASSWORD}@localhost:${RABBITMQ_AMQP_PORT}"
pnpm --filter @bank/messaging test -- broker.integration \
  > specs/006-local-dev-infra/evidence/test-broker.log
```

**Expected outcome**:
- A test message is published and consumed with a visible `correlationId`.
- A message that fails three times lands in the DLQ with `x-attempt`, `x-failure-reason`, `x-failed-at`, and `x-original-routing-key`.
- Reconnection behavior after broker restart is exercised.

## 7. Verify object storage

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env \
  run --rm minio-init "/init-minio.sh --check-only"
```

**Expected outcome**:
- Bucket `customer-identity-documents` exists.
- Lifecycle rule expires objects after the configured retention window.
- Application user `bank_app` exists and has `app-bucket-policy` attached.

## 8. Verify persistence across restarts

```bash
./infra/docker/scripts/test-persistence.sh \
  > specs/006-local-dev-infra/evidence/test-persistence.log
```

**Expected outcome**: after `docker compose stop && docker compose start`, all five databases still contain the rows written before the restart.

## 9. Run the four failure scenarios

```bash
./infra/docker/scripts/test-failures.sh \
  > specs/006-local-dev-infra/evidence/test-failures.log
```

**Expected outcomes**:
1. Stopping one PostgreSQL container does not prevent the other four from accepting connections.
2. Connecting with the wrong service credentials is rejected.
3. Stopping RabbitMQ causes the adapter to retry visibly and error cleanly; reconnecting restores operation.
4. Publishing to a queue whose consumer is stopped preserves messages; they are delivered when the consumer returns.

## 10. Connect from the host and from kind

### From the host

Use `localhost` and the published ports documented in [contracts/env-vars.md](contracts/env-vars.md).

### From a kind pod

Use the Docker network `bank-usac-local` as the primary mechanism. In T-22, dependencies are exposed through selectorless Services backed by endpoints on this network. The fallback is `host.docker.internal` with the documented host alias.

## 11. Stop and clean up

### Standard stop (keeps data)

```bash
docker compose -f infra/docker/docker-compose.yml down
```

### Restart without losing data

```bash
docker compose -f infra/docker/docker-compose.yml stop
docker compose -f infra/docker/docker-compose.yml start
```

### Destructive clean-up (removes volumes)

```bash
docker compose -f infra/docker/docker-compose.yml down -v
```

> ⚠️ This deletes all development data. It is the only command that removes volumes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose config` fails | Missing or malformed `.env` | Run `validate-env.sh` |
| Port already in use | Local PostgreSQL/RabbitMQ/MinIO | Change the port in `.env` |
| Container unhealthy | Slow first start | Wait 60 s; check logs with `docker compose logs <service>` |
| `host.docker.internal` unreachable from kind | OS-specific DNS | Use the shared Docker network `bank-usac-local` instead |
| MinIO bucket missing | Init container ran before MinIO was ready | Restart the stack; dependencies are declared in Compose |

## Evidence checklist

Before closing T-06, the following evidence files must exist:

- [x] `specs/006-local-dev-infra/evidence/docker-compose-config.yml`
- [x] `specs/006-local-dev-infra/evidence/containers-healthy.log`
- [x] `specs/006-local-dev-infra/evidence/test-isolation.log`
- [x] `specs/006-local-dev-infra/evidence/rabbitmq-definitions.json`
- [x] `specs/006-local-dev-infra/evidence/test-broker.log`
- [x] `specs/006-local-dev-infra/evidence/test-minio.log`
- [x] `specs/006-local-dev-infra/evidence/test-persistence.log`
- [x] `specs/006-local-dev-infra/evidence/test-failures.log`
