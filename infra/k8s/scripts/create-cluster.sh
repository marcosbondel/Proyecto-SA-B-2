#!/usr/bin/env bash
#
# Create the local kind cluster for the Bank USAC deployment (ADR-007).
#
#   ./infra/k8s/scripts/create-cluster.sh          # create if absent
#   ./infra/k8s/scripts/create-cluster.sh --recreate
#
# The one thing this script exists for: kind has no field in cluster.yaml that
# attaches nodes to an existing Docker network, so the "share a network with the
# Compose stack" leg of ADR-007 is expressed by an environment variable on the
# create command — KIND_EXPERIMENTAL_DOCKER_NETWORK. It has to be set *before*
# `kind create cluster`; kind fixes the node containers' network at creation and
# cannot move an existing cluster afterwards. Forgetting it used to mean reading
# a 44-line YAML comment to find out why nothing could reach a database.
#
# Written for bash 3.2, the version macOS ships.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CONFIG="${REPO_ROOT}/infra/k8s/kind/cluster.yaml"
NETWORK="bank-usac-local"
CLUSTER="bank-usac"

recreate=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --recreate) recreate=true; shift ;;
    -h|--help) sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 2 ;;
  esac
done

command -v kind >/dev/null 2>&1 || {
  echo "ERROR: kind is not installed. See docs/operations/DEPLOYMENT.md." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker is not running." >&2
  exit 1
}

# Idempotent: docker-compose.yml already declares this network, so this only
# matters the very first time, before anything has created it.
docker network create "$NETWORK" >/dev/null 2>&1 || true

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  if [[ "$recreate" == "true" ]]; then
    echo "Deleting existing cluster '${CLUSTER}'…"
    kind delete cluster --name "$CLUSTER"
  else
    echo "Cluster '${CLUSTER}' already exists — nothing to do."
    echo "Recreate it with --recreate (needed if it was created without"
    echo "KIND_EXPERIMENTAL_DOCKER_NETWORK=${NETWORK}: kind derives its"
    echo "iptables/kindnet setup from the network it saw at creation, so"
    echo "'docker network connect' on a running node does not fix it)."
    exit 0
  fi
fi

echo "Creating kind cluster '${CLUSTER}' on the '${NETWORK}' Docker network…"
KIND_EXPERIMENTAL_DOCKER_NETWORK="$NETWORK" \
  kind create cluster --config "$CONFIG"

echo
echo "──────────────────────────────────────────────────────────────"
echo "Cluster '${CLUSTER}' is up. Next:"
echo "  pnpm dev:infra                          # the out-of-cluster dependencies"
echo "  pnpm images:build -- --kind ${CLUSTER}   # build and load the seven images"
echo "  pnpm k8s:install                        # helm upgrade --install"
