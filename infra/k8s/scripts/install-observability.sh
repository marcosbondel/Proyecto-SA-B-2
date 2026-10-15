#!/usr/bin/env bash
#
# Instala el stack de observabilidad EN EL MISMO cluster kind que el banco.
#
#   ./infra/k8s/scripts/install-observability.sh            # instalar o actualizar
#   ./infra/k8s/scripts/install-observability.sh --print    # solo imprimir el comando
#   ./infra/k8s/scripts/install-observability.sh --down     # desinstalar
#
# POR QUE EN EL MISMO CLUSTER, y no en el desechable de `obs-kind.sh`.
# `obs-kind.sh` valida el stack contra telemetria sintetica: sirve para saber si
# el pipeline funciona, no para ver el banco. Aqui el banco es el productor, asi
# que por primera vez se puede comprobar en local lo que la nube tendria que
# demostrar:
#
#   - una transferencia real aparece como UNA traza que cruza el broker;
#   - las reglas de grabacion de T-50 calculan sobre datos de verdad;
#   - una alerta de Grafana llega al webhook del Gateway y queda en la bitacora
#     de auditoria — el ultimo salto que el cluster desechable no puede probar,
#     porque alli no hay Gateway;
#   - y el banco pareja simulado responde desde dentro del cluster.
#
# NO TOCA LA NUBE, y se niega a poder hacerlo: solo acepta un contexto `kind-*`.
# La nube despliega este mismo chart desde `cd.yml` con los valores del chart,
# sin este archivo de sobrescrituras.
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CHART="${REPO_ROOT}/infra/k8s/helm/bank-observability"
VALORES="${REPO_ROOT}/infra/k8s/kind/observability.values.yaml"
ENV_FILE="${REPO_ROOT}/infra/docker/.env"
RELEASE="bank-observability"
NAMESPACE="observability"
KUBE_CONTEXT="${BANK_KUBE_CONTEXT:-kind-bank-usac}"
# Solo existe mientras viva un cluster local. No es un secreto.
GRAFANA_PASS="${BANK_LOCAL_GRAFANA_PASSWORD:-kind-solo-para-probar-123}"

accion=instalar
for arg in "$@"; do
  case "$arg" in
    --print) accion=imprimir ;;
    --down) accion=bajar ;;
    -h | --help)
      sed -n '3,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: argumento desconocido '$arg'." >&2
      exit 2
      ;;
  esac
done

k() { kubectl --context "$KUBE_CONTEXT" "$@"; }

if ! kubectl config get-contexts -o name 2>/dev/null | grep -qx "$KUBE_CONTEXT"; then
  echo "ERROR: el contexto '${KUBE_CONTEXT}' no existe." >&2
  echo "  Crea el cluster primero:  pnpm k8s:cluster" >&2
  exit 2
fi

# La barrera que hace esto seguro. Un `helm upgrade` de este release contra GKE
# cambiaria el monitoreo de produccion por el de una laptop: retencion de dos
# horas, sin volumenes y con una contrasena publica.
if [[ "$KUBE_CONTEXT" != kind-* ]]; then
  echo "ERROR: '${KUBE_CONTEXT}' no es un contexto de kind." >&2
  echo "  Este script instala el stack con las sobrescrituras LOCALES" >&2
  echo "  (sin volumenes, 2 h de retencion, contrasena de juguete)." >&2
  echo "  La nube lo despliega desde cd.yml con los valores del chart." >&2
  exit 2
fi

if [[ "$accion" == "bajar" ]]; then
  helm --kube-context "$KUBE_CONTEXT" uninstall "$RELEASE" --namespace "$NAMESPACE" || true
  # Los PVC de un StatefulSet no los borra `helm uninstall` nunca. En kind no
  # cuestan dinero, pero dejarlos hace que la siguiente instalacion arranque con
  # datos de la anterior y eso confunde una demo.
  k delete pvc -n "$NAMESPACE" --all --ignore-not-found >/dev/null 2>&1 || true
  echo "Stack de observabilidad desinstalado de ${KUBE_CONTEXT}."
  exit 0
fi

"${REPO_ROOT}/infra/k8s/scripts/check-chart-deps.sh" "$CHART"

set -- upgrade --install "$RELEASE" "$CHART" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$NAMESPACE" --create-namespace \
  -f "$VALORES"

if [[ "$accion" == "imprimir" ]]; then
  echo "helm $*"
  exit 0
fi

echo "Namespace y secretos de ${NAMESPACE}…"
k create namespace "$NAMESPACE" --dry-run=client -o yaml | k apply -f - >/dev/null
k create secret generic grafana-admin --namespace "$NAMESPACE" \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$GRAFANA_PASS" \
  --dry-run=client -o yaml | k apply -f - >/dev/null

# El token del webhook de alertas: el MISMO que el banco, o la alerta llega al
# Gateway y este responde 401. Sale de infra/docker/.env, el mismo archivo de
# credenciales que usan Compose y el chart del banco, asi que las dos mitades no
# pueden desincronizarse.
token=""
if [[ -f "$ENV_FILE" ]]; then
  token="$(grep -E '^ALERT_WEBHOOK_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi

if [[ -n "$token" ]]; then
  k create secret generic grafana-alert-webhook --namespace "$NAMESPACE" \
    --from-literal=token="$token" \
    --dry-run=client -o yaml | k apply -f - >/dev/null
  echo "  grafana-alert-webhook creado desde infra/docker/.env"
else
  k delete secret grafana-alert-webhook --namespace "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
  echo "  AVISO: ALERT_WEBHOOK_TOKEN no esta en infra/docker/.env."
  echo "         Grafana arrancara igual y las alertas se veran en su consola,"
  echo "         pero el Gateway las rechazara con 401 y no quedaran en la"
  echo "         bitacora de auditoria. Anade la variable y vuelve a correr esto."
fi

echo
echo "helm $*"
helm "$@"

echo
k get pods -n "$NAMESPACE"
cat <<FIN

Listo. Dos cosas para mirarlo:

  pnpm obs:forward      # Grafana en http://localhost:3000 — admin / ${GRAFANA_PASS}
  pnpm k8s:forward      # el banco: Gateway en 3000 y web en 3010

Y para que el banco le hable a este Collector, instala el chart del banco con
las sobrescrituras locales:

  pnpm k8s:install -- --values infra/k8s/kind/local.values.yaml

o haz todo el camino de una vez con:  pnpm local:up
FIN
