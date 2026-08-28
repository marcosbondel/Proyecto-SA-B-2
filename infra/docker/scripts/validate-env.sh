#!/usr/bin/env bash
set -euo pipefail

# Fail-fast validation for the local development stack environment variables.
# Every variable referenced by infra/docker/docker-compose.yml MUST be defined
# and non-empty.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/../.env}"

if [[ -f "$ENV_FILE" ]]; then
  # `source` rather than a read/eval loop: eval would execute any command the
  # file happens to contain, and a credential holding a backtick or a `$(` is
  # enough to turn reading configuration into running it.
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: Environment file not found: $ENV_FILE" >&2
  exit 1
fi

required_vars=(
  CUSTOMER_POSTGRES_DB
  CUSTOMER_POSTGRES_USER
  CUSTOMER_POSTGRES_PASSWORD
  CUSTOMER_POSTGRES_PORT
  ACCOUNT_POSTGRES_DB
  ACCOUNT_POSTGRES_USER
  ACCOUNT_POSTGRES_PASSWORD
  ACCOUNT_POSTGRES_PORT
  TRANSACTION_POSTGRES_DB
  TRANSACTION_POSTGRES_USER
  TRANSACTION_POSTGRES_PASSWORD
  TRANSACTION_POSTGRES_PORT
  PAYMENT_POSTGRES_DB
  PAYMENT_POSTGRES_USER
  PAYMENT_POSTGRES_PASSWORD
  PAYMENT_POSTGRES_PORT
  NOTIFICATION_AUDIT_POSTGRES_DB
  NOTIFICATION_AUDIT_POSTGRES_USER
  NOTIFICATION_AUDIT_POSTGRES_PASSWORD
  NOTIFICATION_AUDIT_POSTGRES_PORT
  RABBITMQ_DEFAULT_USER
  RABBITMQ_DEFAULT_PASS
  RABBITMQ_APP_USER
  RABBITMQ_APP_PASSWORD
  RABBITMQ_AMQP_PORT
  RABBITMQ_MANAGEMENT_PORT
  MINIO_ROOT_USER
  MINIO_ROOT_PASSWORD
  MINIO_APP_USER
  MINIO_APP_PASSWORD
  MINIO_API_PORT
  MINIO_CONSOLE_PORT
  MINIO_BUCKET
  MINIO_RETENTION_HOURS
)

missing=0
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable is missing or empty: $var" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "ERROR: Set the missing variables in infra/docker/.env and try again." >&2
  exit 1
fi

echo "Environment validation passed."
