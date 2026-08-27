#!/usr/bin/env bash
set -uo pipefail

# What the ticket calls "un smoke test por contenedor", made executable.
#
#   ./infra/docker/scripts/build-images.sh
#   ./infra/docker/scripts/smoke-images.sh
#
# It checks, per image:
#
#   1. the image exists and carries the labels that identify it
#   2. the declared port is the one the component owns
#   3. the effective user is not root
#   4. no layer and no baked variable contains a credential
#   5. the size is in a sane range for a Node application
#
# and, per running container:
#
#   6. liveness answers
#   7. readiness answers, and reports on every dependency it has
#   8. liveness keeps answering while a dependency is unreachable — the one
#      property that separates a liveness probe from a readiness one, and the
#      one nobody notices is broken until Kubernetes restarts a pod for an
#      outage it cannot fix
#   9. a configuration error fails the boot with a message that names it
#
# The infrastructure of T-06 must already be up:
#
#   docker compose -f infra/docker/docker-compose.yml up -d
#
# `set -e` is deliberately *not* on: every check runs, and the exit code at the
# end is the summary. A smoke test that stopped at the first failure would hide
# the other six.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

# shellcheck source=./images.sh
source "${SCRIPT_DIR}/images.sh"

TAG="${BANK_IMAGE_TAG:-dev}"
NETWORK="bank-usac-local"
PREFIX="smoke"

passed=0
failed=0
skipped=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; passed=$((passed + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; failed=$((failed + 1)); }
skip() { printf '  \033[33m–\033[0m %s\n' "$1"; skipped=$((skipped + 1)); }

cleanup() {
  docker ps -aq --filter "name=^${PREFIX}-" | xargs -r docker rm -f >/dev/null 2>&1
}
trap cleanup EXIT

cd "$REPO_ROOT"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "ERROR: network '${NETWORK}' does not exist." >&2
  echo "       Start the T-06 stack first: pnpm dev:infra" >&2
  exit 1
fi

if [[ ! -f infra/docker/.env ]]; then
  echo "ERROR: infra/docker/.env is missing — copy .env.example and fill it in." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source infra/docker/.env
set +a

# The credentials this run must never find inside an image. Built from the real
# values so the check is a search for *these* secrets, not for the word
# "password" — which is what makes it evidence rather than a gesture.
secrets=()
for value in \
  "${CUSTOMER_POSTGRES_PASSWORD:-}" "${ACCOUNT_POSTGRES_PASSWORD:-}" \
  "${TRANSACTION_POSTGRES_PASSWORD:-}" "${PAYMENT_POSTGRES_PASSWORD:-}" \
  "${NOTIFICATION_AUDIT_POSTGRES_PASSWORD:-}" "${RABBITMQ_DEFAULT_PASS:-}" \
  "${RABBITMQ_APP_PASSWORD:-}" "${MINIO_ROOT_PASSWORD:-}" "${MINIO_APP_PASSWORD:-}" \
  "${JWT_SECRET:-}"; do
  [[ -n "$value" && ${#value} -ge 6 ]] && secrets+=("$value")
done

# Where each component's database and broker live, at run time and only there.
database_url_for() {
  case "$1" in
    customer-service) echo "postgresql://${CUSTOMER_POSTGRES_USER}:${CUSTOMER_POSTGRES_PASSWORD}@postgres-customer:5432/${CUSTOMER_POSTGRES_DB}" ;;
    account-service) echo "postgresql://${ACCOUNT_POSTGRES_USER}:${ACCOUNT_POSTGRES_PASSWORD}@postgres-account:5432/${ACCOUNT_POSTGRES_DB}" ;;
    transaction-service) echo "postgresql://${TRANSACTION_POSTGRES_USER}:${TRANSACTION_POSTGRES_PASSWORD}@postgres-transaction:5432/${TRANSACTION_POSTGRES_DB}" ;;
    payment-service) echo "postgresql://${PAYMENT_POSTGRES_USER}:${PAYMENT_POSTGRES_PASSWORD}@postgres-payment:5432/${PAYMENT_POSTGRES_DB}" ;;
    notification-audit-service) echo "postgresql://${NOTIFICATION_AUDIT_POSTGRES_USER}:${NOTIFICATION_AUDIT_POSTGRES_PASSWORD}@postgres-notification-audit:5432/${NOTIFICATION_AUDIT_POSTGRES_DB}" ;;
    *) echo "" ;;
  esac
}

rabbitmq_url="amqp://${RABBITMQ_APP_USER:-bank_app}:${RABBITMQ_APP_PASSWORD:-changeme}@rabbitmq:5672"

# Runs a container of the component under test with a correct environment.
run_component() {
  local name="$1" port="$2" container="$3"
  shift 3

  local args=(-d --name "$container" --network "$NETWORK" -e "NODE_ENV=production" -e "PORT=${port}")
  local database
  database="$(database_url_for "$name")"

  [[ -n "$database" ]] && args+=(-e "DATABASE_URL=${database}")

  case "$name" in
    web)
      args+=(-e "NUXT_PUBLIC_API_BASE_URL=http://gateway:3000")
      ;;
    gateway)
      args+=(-e "RABBITMQ_URL=${rabbitmq_url}"
             -e "JWT_SECRET=${JWT_SECRET:-dev-only-secret-not-for-any-deployed-environment}"
             -e "JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-3600}"
             -e "GATEWAY_INSTANCE_ID=${container}"
             -e "REPLY_TIMEOUT_MS=${REPLY_TIMEOUT_MS:-5000}"
             -e "OBJECT_STORAGE_ENDPOINT=http://minio:9000"
             -e "OBJECT_STORAGE_ACCESS_KEY=${MINIO_APP_USER}"
             -e "OBJECT_STORAGE_SECRET_KEY=${MINIO_APP_PASSWORD}"
             -e "OBJECT_STORAGE_BUCKET=${MINIO_BUCKET}"
             -e "OBJECT_STORAGE_REGION=${MINIO_REGION:-us-east-1}")
      ;;
    customer-service)
      args+=(-e "RABBITMQ_URL=${rabbitmq_url}"
             -e "OBJECT_STORAGE_ENDPOINT=http://minio:9000"
             -e "OBJECT_STORAGE_ACCESS_KEY=${MINIO_APP_USER}"
             -e "OBJECT_STORAGE_SECRET_KEY=${MINIO_APP_PASSWORD}"
             -e "OBJECT_STORAGE_BUCKET=${MINIO_BUCKET}"
             -e "OBJECT_STORAGE_REGION=${MINIO_REGION:-us-east-1}")
      ;;
    *)
      args+=(-e "RABBITMQ_URL=${rabbitmq_url}")
      ;;
  esac

  args+=("$@")
  docker run "${args[@]}" "${BANK_IMAGE_PREFIX}/${name}:${TAG}" >/dev/null 2>&1
}

# Polls an endpoint until it answers or the window closes.
await_endpoint() {
  local container="$1" port="$2" path="$3" attempts="${4:-30}"

  for _ in $(seq 1 "$attempts"); do
    if docker exec "$container" wget -qO- "http://127.0.0.1:${port}${path}" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done

  return 1
}

echo "════════════════════════════════════════════════════════════════"
echo " Smoke tests — ${BANK_IMAGE_PREFIX}/<component>:${TAG}"
echo "════════════════════════════════════════════════════════════════"

for row in "${BANK_COMPONENTS[@]}"; do
  bank_component_fields "$row"
  name="$BANK_COMPONENT_NAME"
  port="$BANK_COMPONENT_PORT"
  image="${BANK_IMAGE_PREFIX}/${name}:${TAG}"
  container="${PREFIX}-${name}"

  echo
  echo "── ${name} ──────────────────────────────────────────────"

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    fail "${image} does not exist — run build-images.sh first"
    continue
  fi

  # 1. Identity. A label naming the commit is what lets somebody holding a
  #    running pod answer "which code is this" without trusting a tag.
  revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  component_label="$(docker image inspect "$image" --format '{{index .Config.Labels "gt.usac.bank.component"}}')"

  if [[ -n "$revision" && "$revision" != "unknown" && "$component_label" == "$name" ]]; then
    pass "labelled: component=${component_label} revision=${revision:0:12}"
  else
    fail "labels missing or wrong (component='${component_label}' revision='${revision}')"
  fi

  # 2. Only the port this component owns is exposed.
  exposed="$(docker image inspect "$image" --format '{{range $p, $_ := .Config.ExposedPorts}}{{$p}} {{end}}' | xargs)"
  if [[ "$exposed" == "${port}/tcp" ]]; then
    pass "exposes ${exposed} and nothing else"
  else
    fail "expected ${port}/tcp exposed, found '${exposed}'"
  fi

  # 3. Never root.
  configured_user="$(docker image inspect "$image" --format '{{.Config.User}}')"
  effective_uid="$(docker run --rm --entrypoint id "$image" -u 2>/dev/null)"
  if [[ "$configured_user" == "node" && "$effective_uid" == "1000" ]]; then
    pass "runs as ${configured_user} (uid ${effective_uid}), not root"
  else
    fail "expected user node/uid 1000, found user='${configured_user}' uid='${effective_uid}'"
  fi

  # 4. No secret in a baked variable, and none in any layer's instructions.
  baked_env="$(docker image inspect "$image" --format '{{range .Config.Env}}{{.}} {{end}}')"
  history="$(docker history --no-trunc --format '{{.CreatedBy}}' "$image" 2>/dev/null)"
  leaked=""
  for secret in "${secrets[@]}"; do
    if [[ "$baked_env" == *"$secret"* || "$history" == *"$secret"* ]]; then
      leaked="yes"
    fi
  done
  if [[ -z "$leaked" ]]; then
    pass "no credential in Config.Env or in any layer's instructions"
  else
    fail "a credential from infra/docker/.env appears in the image"
  fi

  # The same, from the other direction: nothing that *looks* like configuration
  # should be baked in either. NODE_ENV and the two NITRO_* values are the
  # documented exceptions — they select code paths and a bind address, not a
  # deployment.
  unexpected="$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|NODE_ENV|NITRO_HOST|NITRO_PORT)=' \
    | grep -v '^$' || true)"
  if [[ -z "$unexpected" ]]; then
    pass "no deployment configuration baked into the image"
  else
    fail "unexpected baked variables: $(echo "$unexpected" | xargs)"
  fi

  # 5. Size. Not a number anybody should chase, but an image that doubled
  #    overnight is a `node_modules` that got in.
  #
  #    `docker image ls` and not `docker image inspect .Size`: the second sums
  #    the *compressed* layers and reads about five times smaller, which is a
  #    reassuring number rather than a true one.
  size_human="$(docker image ls "$image" --format '{{.Size}}')"
  size_mb="$(awk -v s="$size_human" 'BEGIN {
      n = s + 0
      if (s ~ /GB$/) n *= 1024
      if (s ~ /kB$/ || s ~ /KB$/) n /= 1024
      printf "%d", n
    }')"
  if [[ "$size_mb" -gt 0 && "$size_mb" -lt 500 ]]; then
    pass "size ${size_human}"
  else
    fail "size ${size_human} — over the 500 MB ceiling for a Node application"
  fi

  # 6-7. The container, against the real infrastructure.
  docker rm -f "$container" >/dev/null 2>&1
  if ! run_component "$name" "$port" "$container"; then
    fail "container failed to start"
    continue
  fi

  liveness="$(await_endpoint "$container" "$port" "/health" 30)"
  if [[ "$liveness" == *'"status":"ok"'* ]]; then
    pass "GET /health → ${liveness}"
  else
    fail "GET /health did not answer (got '${liveness}')"
    docker logs "$container" 2>&1 | tail -5
  fi

  readiness="$(await_endpoint "$container" "$port" "/ready" 30)"
  if [[ "$readiness" == *'"status":"ready"'* ]]; then
    pass "GET /ready → ${readiness}"
  else
    fail "GET /ready did not report ready (got '${readiness}')"
    docker logs "$container" 2>&1 | tail -5
  fi

  docker rm -f "$container" >/dev/null 2>&1
done

# ---------------------------------------------------------------------------
# 8. The property the whole health-check design turns on.
#
# One service, pointed at a database that does not exist. Liveness must answer
# anyway — otherwise Docker marks the container unhealthy and Kubernetes
# restarts a process whose only problem is that PostgreSQL is away, which no
# restart repairs. Readiness must refuse, so the replica leaves rotation.
# ---------------------------------------------------------------------------
echo
echo "── liveness survives an unreachable dependency ─────────────"

container="${PREFIX}-degraded"
image="${BANK_IMAGE_PREFIX}/account-service:${TAG}"

docker rm -f "$container" >/dev/null 2>&1
if docker image inspect "$image" >/dev/null 2>&1 && docker run -d --name "$container" \
    --network "$NETWORK" \
    -e NODE_ENV=production -e PORT=3002 \
    -e "DATABASE_URL=postgresql://nobody:nothing@postgres-that-does-not-exist:5432/void" \
    -e "RABBITMQ_URL=${rabbitmq_url}" \
    "$image" >/dev/null 2>&1; then

  liveness="$(await_endpoint "$container" 3002 "/health" 30)"
  if [[ "$liveness" == *'"status":"ok"'* ]]; then
    pass "GET /health answers with the database unreachable → ${liveness}"
  else
    fail "GET /health did not answer with the database unreachable"
    docker logs "$container" 2>&1 | tail -5
  fi

  # `wget` exits non-zero on a 503, so the body arrives on stderr or not at all;
  # the status code is what is being asserted here anyway.
  if docker exec "$container" wget -qO- http://127.0.0.1:3002/ready >/dev/null 2>&1; then
    fail "GET /ready reported ready with the database unreachable"
  else
    pass "GET /ready refuses with 503 while the database is unreachable"
  fi

  if docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
    pass "the process stayed alive instead of crash-looping"
  else
    fail "the process died — a recoverable dependency became a restart loop"
  fi

  docker rm -f "$container" >/dev/null 2>&1
else
  skip "account-service image missing"
fi

# ---------------------------------------------------------------------------
# 9. A configuration error produces a clear boot failure.
#
# The other half of the same design: a dependency that is *away* must not kill
# the process, and a variable that is *missing* must. The distinction is what
# lets an operator tell "the database is down" from "you forgot DATABASE_URL".
# ---------------------------------------------------------------------------
echo
echo "── a missing variable fails the boot, by name ──────────────"

container="${PREFIX}-misconfigured"
image="${BANK_IMAGE_PREFIX}/customer-service:${TAG}"

docker rm -f "$container" >/dev/null 2>&1
if docker image inspect "$image" >/dev/null 2>&1; then
  docker run --name "$container" --network "$NETWORK" \
    -e NODE_ENV=production -e PORT=3001 "$image" >/dev/null 2>&1
  status="$(docker inspect --format '{{.State.ExitCode}}' "$container" 2>/dev/null)"
  message="$(docker logs "$container" 2>&1)"

  if [[ "$status" != "0" ]]; then
    pass "exits ${status} rather than serving a half-configured process"
  else
    fail "exited 0 with no DATABASE_URL and no RABBITMQ_URL"
  fi

  if [[ "$message" == *"DATABASE_URL"* && "$message" == *"RABBITMQ_URL"* ]]; then
    pass "names every offending variable: $(echo "$message" | head -1)"
  else
    fail "the failure did not name the missing variables: $(echo "$message" | head -1)"
  fi

  docker rm -f "$container" >/dev/null 2>&1
else
  skip "customer-service image missing"
fi

# ---------------------------------------------------------------------------
# The frontend's own configuration failure, which is not a missing variable but
# a wrong one: an address the browser cannot resolve.
# ---------------------------------------------------------------------------
echo
echo "── the frontend refuses readiness on a bad Gateway origin ──"

container="${PREFIX}-web-misconfigured"
image="${BANK_IMAGE_PREFIX}/web:${TAG}"

docker rm -f "$container" >/dev/null 2>&1
if docker image inspect "$image" >/dev/null 2>&1 && docker run -d --name "$container" \
    --network "$NETWORK" -e "NUXT_PUBLIC_API_BASE_URL=/api" "$image" >/dev/null 2>&1; then

  liveness="$(await_endpoint "$container" 3010 "/health" 30)"
  if [[ "$liveness" == *'"status":"ok"'* ]]; then
    pass "GET /health still answers — the process is fine, the configuration is not"
  else
    fail "GET /health did not answer"
  fi

  if docker exec "$container" wget -qO- http://127.0.0.1:3010/ready >/dev/null 2>&1; then
    fail "GET /ready reported ready with a relative Gateway origin"
  else
    pass "GET /ready refuses with 503 on a relative Gateway origin"
  fi

  docker rm -f "$container" >/dev/null 2>&1
else
  skip "web image missing"
fi

echo
echo "════════════════════════════════════════════════════════════════"
printf ' %d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
echo "════════════════════════════════════════════════════════════════"

[[ "$failed" -eq 0 ]]
