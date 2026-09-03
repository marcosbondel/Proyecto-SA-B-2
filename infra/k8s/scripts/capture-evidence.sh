#!/usr/bin/env bash
#
# Capture what the running cluster actually looks like, into
# specs/008-audit-remediation/evidence/.
#
#   ./infra/k8s/scripts/capture-evidence.sh
#   ./infra/k8s/scripts/capture-evidence.sh --label before-rebuild
#
# Every command here only reads. Nothing is created, scaled, restarted or
# deleted, so this is safe to run against a cluster minutes before it is graded.
#
# The repository prefers evidence that can be re-run over evidence that was
# pasted (infra/docker/README.md, "Evidence"). This script is the T-014/T-015
# artifact that was specified and never produced: `helm upgrade --install`
# happened on 2026-08-28, and nothing in the repository recorded it.
#
# Written for bash 3.2, the version macOS ships.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUT_DIR="${REPO_ROOT}/specs/008-audit-remediation/evidence"
NAMESPACE="bank-usac"
RELEASE="bank-usac"

label=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) label="-${2:?--label needs a value}"; shift 2 ;;
    -h|--help) sed -n '3,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT_DIR"
OUT="${OUT_DIR}/cluster-state${label}.log"

command -v kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not installed." >&2; exit 1; }
kubectl cluster-info --request-timeout=5s >/dev/null 2>&1 || {
  echo "ERROR: no reachable cluster. Is the kind cluster up?" >&2
  echo "  kind get clusters && kubectl config current-context" >&2
  exit 1
}

# Each block is prefixed with the command that produced it, the convention
# specs/006-local-dev-infra/evidence/*.log established.
run() {
  echo "\$ $*" >>"$OUT"
  "$@" >>"$OUT" 2>&1
  echo >>"$OUT"
}

{
  echo "Bank USAC — Kubernetes deployment evidence"
  echo "Captured: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Commit:   $(git -C "$REPO_ROOT" rev-parse --short=12 HEAD) on $(git -C "$REPO_ROOT" branch --show-current)"
  echo "Tooling:  $(kind version 2>/dev/null | head -1) · helm $(helm version --short 2>/dev/null) · kubectl $(kubectl version --client -o yaml 2>/dev/null | awk '/gitVersion/ {print $2; exit}')"
  echo "=========================================================================="
  echo
} >"$OUT"

run kubectl config current-context
run kubectl get nodes -o wide
run helm list --namespace "$NAMESPACE"
run helm status "$RELEASE" --namespace "$NAMESPACE" --show-desc
run kubectl get pods -n "$NAMESPACE" -o wide
run kubectl get deployments -n "$NAMESPACE"
run kubectl get svc -n "$NAMESPACE"
run kubectl get endpoints -n "$NAMESPACE"
run kubectl get configmap,secret -n "$NAMESPACE"

# The images actually running, which is how a reader confirms the cluster is on
# the commit the repository claims.
echo "\$ kubectl get pods -n ${NAMESPACE} -o custom-columns=POD,IMAGE" >>"$OUT"
kubectl get pods -n "$NAMESPACE" \
  -o custom-columns='POD:.metadata.name,IMAGE:.spec.containers[0].image' >>"$OUT" 2>&1
echo >>"$OUT"

# The assignment's hard requirement (§8.1): the databases are NOT in the cluster.
# Scoped to the bank-usac-local network rather than to a name prefix, so an
# unrelated project's `postgres-*` container cannot wander into the evidence.
echo "\$ docker ps --filter network=bank-usac-local  # the dependencies, outside the cluster" >>"$OUT"
docker ps --filter "network=bank-usac-local" \
  --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' >>"$OUT" 2>&1
echo >>"$OUT"

# Every component's own answer to "are you ready, and to what".
echo "# Per-component /ready, asked from inside each pod" >>"$OUT"
for row in \
  "customer-service:3001" "account-service:3002" "transaction-service:3003" \
  "payment-service:3004" "notification-audit-service:3005" \
  "gateway:3000" "web:3010"; do
  component="${row%%:*}"
  port="${row##*:}"
  deploy="${RELEASE}-${component}"
  echo "\$ kubectl exec deploy/${deploy} -- wget -qO- http://127.0.0.1:${port}/ready" >>"$OUT"
  kubectl exec -n "$NAMESPACE" "deploy/${deploy}" --request-timeout=10s \
    -- wget -qO- "http://127.0.0.1:${port}/ready" >>"$OUT" 2>&1
  echo >>"$OUT"
done

echo "──────────────────────────────────────────────────────────────"
echo "Wrote ${OUT}"
echo
grep -E '^(NAME|bank-usac|postgres-|rabbitmq|minio)' "$OUT" | head -30
