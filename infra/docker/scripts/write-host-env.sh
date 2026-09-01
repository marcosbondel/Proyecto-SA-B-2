#!/usr/bin/env bash
#
# Writes one apps/<name>/.env per application from infra/docker/.env, for the
# `pnpm dev:host` run mode (the applications on your machine, not in Docker).
#
# The values are not new information — they are the credentials already in
# infra/docker/.env, addressed from outside the Compose network: `localhost`
# instead of a container name, and the *published* port instead of the native
# one. So this derives them rather than asking you to retype them.
#
# Idempotent: a .env that already exists is reported and left alone, so it fills
# gaps without overwriting anything you tuned by hand. Needs bash — the `${!var}`
# indirection is not POSIX sh.
#
#   bash infra/docker/scripts/write-host-env.sh
#
set -euo pipefail

[ -f infra/docker/.env ] || {
  echo "infra/docker/.env is missing — copy infra/docker/.env.example and fill it first"
  exit 1
}
set -a
. ./infra/docker/.env
set +a

AMQP="amqp://${RABBITMQ_APP_USER:-bank_app}:${RABBITMQ_APP_PASSWORD:-changeme}@localhost:5673"
S3="OBJECT_STORAGE_ENDPOINT=http://localhost:9002
OBJECT_STORAGE_ACCESS_KEY=$MINIO_APP_USER
OBJECT_STORAGE_SECRET_KEY=$MINIO_APP_PASSWORD
OBJECT_STORAGE_BUCKET=$MINIO_BUCKET
OBJECT_STORAGE_REGION=${MINIO_REGION:-us-east-1}"

write() { # write <path> — body on stdin
  if [ -e "$1" ]; then
    echo "·  $1 — already there, left alone"
    cat >/dev/null
  else
    cat >"$1"
    echo "+  $1"
  fi
}

write apps/gateway/.env <<EOF
NODE_ENV=development
PORT=3000
RABBITMQ_URL=$AMQP
JWT_SECRET=${JWT_SECRET:-dev-only-secret-not-for-any-deployed-environment}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-3600}
GATEWAY_INSTANCE_ID=gateway-dev
REPLY_TIMEOUT_MS=${REPLY_TIMEOUT_MS:-5000}
CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-http://localhost:3010}
$S3
EOF

# The demo seed is on for dev:host too, so a fresh host run is signed-in-able.
# Set SEED_DEMO_DATA=false in infra/docker/.env to turn it off. The lines are in
# each service's heredoc rather than appended, so `write` keeps it idempotent.
SEED="SEED_DEMO_DATA=${SEED_DEMO_DATA:-true}"

# service | port | published PostgreSQL port | prefix in infra/docker/.env
while read -r svc port pgport prefix; do
  u="${prefix}_POSTGRES_USER"
  p="${prefix}_POSTGRES_PASSWORD"
  d="${prefix}_POSTGRES_DB"

  extra=""
  [ "$svc" = "customer-service" ] && extra="$SEED
SEED_PASSWORD=${SEED_PASSWORD:-BankUsac#2026}"
  [ "$svc" = "account-service" ] && extra="$SEED"
  if [ "$svc" = "notification-audit-service" ]; then
    extra="NOTIFICATION_CHANNEL=${NOTIFICATION_CHANNEL:-simulated}
RESEND_API_KEY=${RESEND_API_KEY:-}
EMAIL_FROM="${EMAIL_FROM:-}"
APP_BASE_URL=${APP_BASE_URL:-http://localhost:3010}
RESEND_API_URL=${RESEND_API_URL:-https://api.resend.com/emails}
REVEAL_ACTIVATION_LINKS=${REVEAL_ACTIVATION_LINKS:-false}"
  fi

  write "apps/services/$svc/.env" <<EOF
NODE_ENV=development
PORT=$port
DATABASE_URL=postgresql://${!u}:${!p}@localhost:$pgport/${!d}
RABBITMQ_URL=$AMQP
$S3
$extra
EOF
done <<'SERVICES'
customer-service            3001 5433 CUSTOMER
account-service             3002 5434 ACCOUNT
transaction-service         3003 5435 TRANSACTION
payment-service             3004 5436 PAYMENT
notification-audit-service  3005 5437 NOTIFICATION_AUDIT
SERVICES

write apps/web/.env <<EOF
NUXT_PUBLIC_API_BASE_URL=http://localhost:3000
EOF

echo "done — per-application .env files are in place"
