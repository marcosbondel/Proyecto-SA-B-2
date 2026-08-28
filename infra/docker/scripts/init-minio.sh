#!/usr/bin/env bash
set -euo pipefail

# Initialize MinIO for the local development stack:
# - Create the customer-identity-documents bucket.
# - Set a lifecycle rule that expires objects after MINIO_RETENTION_HOURS.
# - Create the application user with read/write access to that bucket only.
#
# Variables may be supplied through the environment (Compose) or by sourcing
# infra/docker/.env when running the script directly.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [[ -f "${ENV_FILE}" ]]; then
  # `source` rather than a read/eval loop: eval would execute any command the
  # file happens to contain, and a credential holding a backtick or a `$(` is
  # enough to turn reading configuration into running it.
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${MINIO_APP_USER:?}" "${MINIO_APP_PASSWORD:?}" "${MINIO_BUCKET:?}" "${MINIO_RETENTION_HOURS:?}"

MINIO_ENDPOINT="http://minio:9000"

wait_for_minio() {
  echo "Waiting for MinIO at ${MINIO_ENDPOINT} ..."
  for _ in $(seq 1 30); do
    if mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" > /dev/null 2>&1; then
      echo "MinIO is healthy"
      return 0
    fi
    sleep 2
  done
  echo "MinIO did not become healthy"
  return 1
}

init() {
  mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" > /dev/null

  if ! mc ls local/"${MINIO_BUCKET}" > /dev/null 2>&1; then
    echo "Creating bucket ${MINIO_BUCKET}"
    mc mb local/"${MINIO_BUCKET}" > /dev/null
  else
    echo "Bucket ${MINIO_BUCKET} already exists"
  fi

  # Convert the retention window from hours to days (ceil) because mc only accepts
  # whole-day expiration windows.
  EXPIRE_DAYS=$(( (MINIO_RETENTION_HOURS + 23) / 24 ))
  ILM_OUTPUT=$(mc ilm rule list local/"${MINIO_BUCKET}" 2>&1 || true)
  if [[ "${ILM_OUTPUT}" == *"${EXPIRE_DAYS}"* && "${ILM_OUTPUT}" == *"Expiration"* ]]; then
    echo "Lifecycle rule already exists"
  else
    echo "Setting lifecycle rule: expire after ${MINIO_RETENTION_HOURS} hours (${EXPIRE_DAYS} day(s))"
    mc ilm rule add local/"${MINIO_BUCKET}" \
      --expire-days "${EXPIRE_DAYS}" > /dev/null 2>&1 || true
  fi

  if ! mc admin user info local "${MINIO_APP_USER}" > /dev/null 2>&1; then
    echo "Creating application user ${MINIO_APP_USER}"
    mc admin user add local "${MINIO_APP_USER}" "${MINIO_APP_PASSWORD}" > /dev/null
  else
    echo "Application user ${MINIO_APP_USER} already exists"
  fi

  echo '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject"],
        "Resource": ["arn:aws:s3:::'"${MINIO_BUCKET}"'/*"]
      }
    ]
  }' > /tmp/minio-app-policy.json

  mc admin policy create local app-bucket-policy /tmp/minio-app-policy.json > /dev/null 2>&1 || true
  mc admin policy attach local app-bucket-policy --user "${MINIO_APP_USER}" > /dev/null 2>&1 || true

  echo "MinIO initialization complete"
}

check_only() {
  mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" > /dev/null

  if mc ls local/"${MINIO_BUCKET}" > /dev/null 2>&1; then
    echo "Bucket ${MINIO_BUCKET}: OK"
  else
    echo "Bucket ${MINIO_BUCKET}: MISSING"
    return 1
  fi

  echo "Lifecycle rules for ${MINIO_BUCKET}:"
  mc ilm rule list local/"${MINIO_BUCKET}"

  EXPIRE_DAYS=$(( (MINIO_RETENTION_HOURS + 23) / 24 ))
  ILM_OUTPUT=$(mc ilm rule list local/"${MINIO_BUCKET}" 2>&1 || true)
  if [[ "${ILM_OUTPUT}" == *"${EXPIRE_DAYS}"* && "${ILM_OUTPUT}" == *"Expiration"* ]]; then
    echo "Lifecycle rule: OK"
  else
    echo "Lifecycle rule: MISSING"
    return 1
  fi

  echo "Application user info:"
  mc admin user info local "${MINIO_APP_USER}"
}

wait_for_minio

if [[ "${1:-}" == "--check-only" ]]; then
  check_only
else
  init
fi
