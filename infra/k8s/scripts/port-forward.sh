#!/usr/bin/env bash
#
# Forward the Gateway and the web shell out of the cluster.
#
#   ./infra/k8s/scripts/port-forward.sh          # 3000 -> gateway, 3010 -> web
#
# This single-node kind cluster has no Ingress controller and no LoadBalancer,
# and cluster.yaml declares no extraPortMappings, so port-forward is the access
# path — which is what the assignment's own §6 paso 11 describes.
#
# The two ports are not arbitrary. The browser resolves web.apiBaseUrl
# (http://localhost:3000) by itself, and the Gateway only accepts
# gateway.corsAllowedOrigins (http://localhost:3010). Forward either one
# somewhere else without overriding both chart values and the result is a CORS
# error in the browser, not a crash in the cluster — so this script pins them.
#
# Ctrl-C stops both.
set -uo pipefail

NAMESPACE="bank-usac"
RELEASE="bank-usac"
KUBE_CONTEXT="${BANK_KUBE_CONTEXT:-kind-bank-usac}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) KUBE_CONTEXT="${2:?--context needs a value}"; shift 2 ;;
    -h|--help) sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 2 ;;
  esac
done

kubectl get ns --context "$KUBE_CONTEXT" "$NAMESPACE" >/dev/null 2>&1 || {
  echo "ERROR: namespace '${NAMESPACE}' not found — is the release installed?" >&2
  echo "  pnpm k8s:install" >&2
  exit 1
}

cleanup() {
  echo
  echo "Stopping port-forwards…"
  kill 0 2>/dev/null
}
trap cleanup EXIT INT TERM

kubectl port-forward --context "$KUBE_CONTEXT" -n "$NAMESPACE" "svc/${RELEASE}-gateway" 3000:3000 &
kubectl port-forward --context "$KUBE_CONTEXT" -n "$NAMESPACE" "svc/${RELEASE}-web" 3010:3010 &

sleep 2
echo "──────────────────────────────────────────────────────────────"
echo "  Gateway  http://localhost:3000   (/health · /ready · /api/…)"
echo "  Web      http://localhost:3010"
echo
echo "Ctrl-C to stop both."
wait
