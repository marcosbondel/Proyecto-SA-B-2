#!/usr/bin/env bash
set -uo pipefail

# Write one row in each PostgreSQL database, restart the stack without -v,
# and verify all five rows are still present.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

# `source`, never a read/eval loop: eval runs whatever the file contains, so a
# password holding a backtick would be executed rather than read.
set -a
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/../.env"
set +a

services=(
  "customer:${CUSTOMER_POSTGRES_USER}:${CUSTOMER_POSTGRES_PASSWORD}:postgres-customer:${CUSTOMER_POSTGRES_DB}"
  "account:${ACCOUNT_POSTGRES_USER}:${ACCOUNT_POSTGRES_PASSWORD}:postgres-account:${ACCOUNT_POSTGRES_DB}"
  "transaction:${TRANSACTION_POSTGRES_USER}:${TRANSACTION_POSTGRES_PASSWORD}:postgres-transaction:${TRANSACTION_POSTGRES_DB}"
  "payment:${PAYMENT_POSTGRES_USER}:${PAYMENT_POSTGRES_PASSWORD}:postgres-payment:${PAYMENT_POSTGRES_DB}"
  "notification_audit:${NOTIFICATION_AUDIT_POSTGRES_USER}:${NOTIFICATION_AUDIT_POSTGRES_PASSWORD}:postgres-notification-audit:${NOTIFICATION_AUDIT_POSTGRES_DB}"
)

marker="persistence-test-$(date +%s)"

for svc in "${services[@]}"; do
  IFS=':' read -r name user pass container db <<< "$svc"
  docker exec -e PGPASSWORD="$pass" "$container" \
    psql -U "$user" -d "$db" -c "CREATE TABLE IF NOT EXISTS persistence_check (marker TEXT PRIMARY KEY); INSERT INTO persistence_check (marker) VALUES ('${marker}-${name}') ON CONFLICT (marker) DO NOTHING;"
  echo "Wrote marker to ${name}"
done

echo "Restarting stack (stop/start) ..."
docker compose -f "${REPO_ROOT}/infra/docker/docker-compose.yml" stop
sleep 2
docker compose -f "${REPO_ROOT}/infra/docker/docker-compose.yml" start
sleep 15

missing=0
for svc in "${services[@]}"; do
  IFS=':' read -r name user pass container db <<< "$svc"
  if docker exec -e PGPASSWORD="$pass" "$container" \
    psql -U "$user" -d "$db" -tc "SELECT 1 FROM persistence_check WHERE marker = '${marker}-${name}';" | grep -q 1; then
    echo "FOUND marker in ${name}"
  else
    echo "MISSING marker in ${name}"
    missing=1
  fi
done

if [[ "$missing" -eq 0 ]]; then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
