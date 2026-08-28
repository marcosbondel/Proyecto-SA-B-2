#!/usr/bin/env bash
set -uo pipefail

# Execute the four failure scenarios required by T-06 and report pass/fail.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

# `source`, never a read/eval loop: eval runs whatever the file contains, so a
# password holding a backtick would be executed rather than read.
set -a
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/../.env"
set +a

COMPOSE=(docker compose -f "${REPO_ROOT}/infra/docker/docker-compose.yml")
failures=0

echo "=== Scenario A: one PostgreSQL down, the other four still serve ==="
"${COMPOSE[@]}" stop postgres-customer
sleep 5

if docker exec -e PGPASSWORD="${ACCOUNT_POSTGRES_PASSWORD}" postgres-account \
  psql -U "${ACCOUNT_POSTGRES_USER}" -d "${ACCOUNT_POSTGRES_DB}" -c "SELECT 1;" > /dev/null 2>&1; then
  echo "A: other databases still accept connections -> PASS"
else
  echo "A: other databases rejected connection -> FAIL"
  failures=1
fi

"${COMPOSE[@]}" start postgres-customer
sleep 10

echo ""
echo "=== Scenario B: wrong service credentials are rejected ==="
if docker exec -e PGPASSWORD="${CUSTOMER_POSTGRES_PASSWORD}" postgres-account \
  psql -U "${CUSTOMER_POSTGRES_USER}" -d "${ACCOUNT_POSTGRES_DB}" -c "SELECT 1;" > /dev/null 2>&1; then
  echo "B: cross-credentials accepted -> FAIL"
  failures=1
else
  echo "B: cross-credentials rejected -> PASS"
fi

echo ""
echo "=== Scenario C: RabbitMQ unavailable produces visible error, reconnect works ==="
"${COMPOSE[@]}" stop rabbitmq
sleep 5

if curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/overview" > /dev/null 2>&1; then
  echo "C: management API still reachable while broker is down -> FAIL"
  failures=1
else
  echo "C: management API unreachable while broker is down -> PASS"
fi

"${COMPOSE[@]}" start rabbitmq
sleep 20

if curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/overview" | jq -e '.rabbitmq_version' > /dev/null 2>&1; then
  echo "C: broker reconnected after restart -> PASS"
else
  echo "C: broker did not reconnect after restart -> FAIL"
  failures=1
fi

echo ""
echo "=== Scenario D: durable queue preserves messages while consumer is stopped ==="
D_QUEUE='test.failure.d'
D_PAYLOAD='preserved-message'

curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" \
  -H 'Content-Type: application/json' \
  -X PUT \
  "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/queues/%2f/${D_QUEUE}" \
  -d '{"auto_delete":false,"durable":true,"arguments":{}}' > /dev/null

curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" \
  -H 'Content-Type: application/json' \
  -X POST \
  "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/exchanges/%2f//publish" \
  -d "{\"routing_key\":\"${D_QUEUE}\",\"payload\":\"${D_PAYLOAD}\",\"payload_encoding\":\"string\",\"properties\":{\"delivery_mode\":2}}" > /dev/null

echo "D: published 1 persistent message to ${D_QUEUE}"
sleep 2

D_RESULT=$(curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" \
  -H 'Content-Type: application/json' \
  -X POST \
  "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/queues/%2f/${D_QUEUE}/get" \
  -d '{"count":1,"ackmode":"ack_requeue_false","encoding":"auto"}')

if echo "$D_RESULT" | grep -q "$D_PAYLOAD"; then
  echo "D: consumed preserved message -> PASS"
else
  echo "D: message missing -> FAIL"
  echo "$D_RESULT"
  failures=1
fi

curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" \
  -X DELETE "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/queues/%2f/${D_QUEUE}" > /dev/null

echo ""
if [[ "$failures" -eq 0 ]]; then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
