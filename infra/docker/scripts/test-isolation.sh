#!/usr/bin/env bash
set -uo pipefail

# Test that each PostgreSQL application user can only connect to its own
# database. Expected outcome: 5 own connections succeed, 20 cross connections
# fail.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

own_ok=0
own_total=0
cross_rejected=0
cross_total=0

for src in "${services[@]}"; do
  IFS=':' read -r src_name src_user src_pass src_container src_db <<< "$src"

  for dst in "${services[@]}"; do
    IFS=':' read -r dst_name dst_user dst_pass dst_container dst_db <<< "$dst"

    if docker exec -e PGPASSWORD="$src_pass" "$dst_container" \
      psql -U "$src_user" -d "$dst_db" -c "SELECT 1;" > /dev/null 2>&1; then
      if [[ "$src_name" == "$dst_name" ]]; then
        echo "OWN OK: $src_user -> $dst_db"
        ((own_ok++))
      else
        echo "CROSS ALLOWED (FAIL): $src_user -> $dst_db"
      fi
    else
      if [[ "$src_name" == "$dst_name" ]]; then
        echo "OWN REJECTED (FAIL): $src_user -> $dst_db"
      else
        echo "CROSS REJECTED OK: $src_user -> $dst_db"
        ((cross_rejected++))
      fi
    fi

    if [[ "$src_name" == "$dst_name" ]]; then
      ((own_total++))
    else
      ((cross_total++))
    fi
  done
done

echo ""
echo "Summary:"
echo "  Own connections accepted:     $own_ok / $own_total"
echo "  Cross connections rejected:   $cross_rejected / $cross_total"

if [[ "$own_ok" -eq "$own_total" && "$cross_rejected" -eq "$cross_total" ]]; then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
