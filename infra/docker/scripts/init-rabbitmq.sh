#!/usr/bin/env bash
set -euo pipefail

# Create the application's broker account from the environment.
#
# rabbitmq_definitions.json declares the topology and no users at all — see the
# comment in rabbitmq.conf for why. The administrator is created by the image
# from RABBITMQ_DEFAULT_USER / RABBITMQ_DEFAULT_PASS; this script creates the
# unprivileged account the seven applications actually connect with, so that
# RABBITMQ_APP_PASSWORD in infra/docker/.env is the only place it is decided.
#
# `declare user` is an upsert (PUT /api/users/{name}), so re-running this after
# changing the password in .env re-sets it rather than failing. That is what
# makes the file authoritative on every `up`, not only on a fresh volume.
#
# Variables may be supplied through the environment (Compose) or by sourcing
# infra/docker/.env when running the script directly.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [[ -f "${ENV_FILE}" ]]; then
  # `source`, never a read/eval loop: eval runs whatever the file contains, so a
  # password holding a backtick would be executed rather than read.
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

: "${RABBITMQ_DEFAULT_USER:?}" "${RABBITMQ_DEFAULT_PASS:?}" \
  "${RABBITMQ_APP_USER:?}" "${RABBITMQ_APP_PASSWORD:?}"

# Passed as environment rather than as flags so no password reaches a command
# line that `ps` can read.
export RABBITMQADMIN_TARGET_HOST="${RABBITMQ_HOST:-rabbitmq}"
export RABBITMQADMIN_TARGET_PORT=15672
export RABBITMQADMIN_USERNAME="${RABBITMQ_DEFAULT_USER}"
export RABBITMQADMIN_PASSWORD="${RABBITMQ_DEFAULT_PASS}"
export RABBITMQADMIN_NON_INTERACTIVE_MODE=true

wait_for_management_api() {
  echo "Waiting for the RabbitMQ management API at ${RABBITMQADMIN_TARGET_HOST}:${RABBITMQADMIN_TARGET_PORT} ..."
  for _ in $(seq 1 30); do
    if rabbitmqadmin show overview > /dev/null 2>&1; then
      echo "Management API is answering"
      return 0
    fi
    sleep 2
  done

  # Distinguish the two ways this fails, because the fixes are different.
  echo "ERROR: could not authenticate against the management API as '${RABBITMQ_DEFAULT_USER}'." >&2
  echo "       If the broker is up, RABBITMQ_DEFAULT_PASS in infra/docker/.env no longer" >&2
  echo "       matches the administrator stored in the rabbitmq-data volume: the image" >&2
  echo "       only creates that account on a *fresh* volume. Recreate it with" >&2
  echo "       'docker compose -f infra/docker/docker-compose.yml down -v' (this drops the" >&2
  echo "       broker's data, not the databases' — they are separate volumes)." >&2
  return 1
}

wait_for_management_api

echo "Declaring application user ${RABBITMQ_APP_USER}"
rabbitmqadmin declare user \
  --name "${RABBITMQ_APP_USER}" \
  --password "${RABBITMQ_APP_PASSWORD}" \
  --tags "" > /dev/null

# Full access on the default vhost, and no administrator tag: the applications
# publish and consume across every exchange the topology defines, but none of
# them has any business reading the management UI.
rabbitmqadmin declare permissions \
  --vhost "/" \
  --username "${RABBITMQ_APP_USER}" \
  --configure ".*" \
  --write ".*" \
  --read ".*" > /dev/null

echo "RabbitMQ initialization complete"
