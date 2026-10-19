#!/usr/bin/env bash
#
# metrics-server en el cluster kind local, para que los HPA midan CPU.
#
#   ./infra/k8s/scripts/install-metrics-server.sh
#
# Sin metrics-server los siete HPA se quedan en `cpu: <unknown>/80%` y el
# autoescalado bajo carga no se puede ver en local. Este script aplica el
# manifiesto versionado en infra/k8s/kind/metrics-server.yaml y espera a que la
# API `metrics.k8s.io` conteste de verdad — no a que el Deployment diga Ready,
# que llega antes de que el primer raspado exista.
#
# Se niega a trabajar contra un contexto que no sea kind: en GKE metrics-server
# ya viene instalado, y este manifiesto lleva `--kubelet-insecure-tls`.
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CONTEXT="${KUBE_CONTEXT:-kind-bank-usac}"

case "$CONTEXT" in
  kind-*) ;;
  *)
    echo "ERROR: '$CONTEXT' no es un contexto kind; metrics-server de este manifiesto es solo para local." >&2
    exit 2
    ;;
esac

kubectl --context "$CONTEXT" apply -f "${REPO_ROOT}/infra/k8s/kind/metrics-server.yaml" >/dev/null
kubectl --context "$CONTEXT" -n kube-system rollout status deployment/metrics-server --timeout=180s >/dev/null

echo "    esperando a que metrics.k8s.io devuelva datos del nodo..."
for _ in $(seq 1 40); do
  if kubectl --context "$CONTEXT" top nodes >/dev/null 2>&1; then
    kubectl --context "$CONTEXT" top nodes
    echo "    metrics-server listo: los HPA ya pueden medir CPU"
    exit 0
  fi
  sleep 3
done

echo "ERROR: metrics-server esta desplegado pero metrics.k8s.io no devuelve datos." >&2
kubectl --context "$CONTEXT" -n kube-system logs deployment/metrics-server --tail=20 >&2 || true
exit 1
