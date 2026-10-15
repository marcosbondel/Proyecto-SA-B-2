#!/usr/bin/env bash
#
# Todo el sistema en local, simulado, de una sola vez: el banco, el stack de
# observabilidad y el banco pareja falso, en el mismo cluster kind.
#
#   ./infra/k8s/scripts/local-up.sh              # el camino completo
#   ./infra/k8s/scripts/local-up.sh --skip-build # sin reconstruir imagenes
#
# QUE LEVANTA, Y DONDE
#
#   En Docker, FUERA del cluster : las cinco bases PostgreSQL, RabbitMQ y MinIO.
#                                  Es la forma del despliegue real (las bases
#                                  viven en VM), no un atajo.
#   En el cluster, namespace
#   `bank-usac`                  : los siete componentes + el banco pareja
#                                  simulado (T-57).
#   En el cluster, namespace
#   `observability`              : Collector, Prometheus, Tempo, Loki y Grafana,
#                                  con las 30 reglas, las 7 alertas y los 9
#                                  dashboards de T-50.
#
# PARA QUE SIRVE. Para avanzar sin nube y sin banco pareja: aqui se puede ver
# una transferencia real como una sola traza, ver las reglas de T-50 calcular
# sobre datos de verdad, hacer que una alerta llegue al webhook del Gateway y
# quede en la bitacora, y ensayar los tres escenarios de fallo de T-51 —
# incluido el del banco pareja, inyectado con el mock propio.
#
# LO QUE NO PRUEBA, y conviene no confundir: el HPA (kind no trae
# metrics-server), el error budget de 7 dias (la retencion local es de 2 h) y la
# IP publica del Gateway. Eso es T-54 contra GCP.
#
# NADA DE ESTO TOCA LA NUBE. Las sobrescrituras locales viven en dos archivos
# bajo infra/k8s/kind/ y los dos scripts de instalacion se niegan a trabajar
# contra un contexto que no sea kind.
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CLUSTER="bank-usac"
CONTEXT="kind-${CLUSTER}"

skip_build=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=true ;;
    -h | --help)
      sed -n '3,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: argumento desconocido '$arg'." >&2
      exit 2
      ;;
  esac
done

paso() { echo; echo "═══ $* ═══"; }

cd "$REPO_ROOT"

paso "0. Lo que tiene que estar"
for binario in docker kind kubectl helm pnpm; do
  command -v "$binario" >/dev/null 2>&1 || {
    echo "ERROR: falta '$binario' en el PATH." >&2
    exit 2
  }
done
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker no responde. Arrancalo y vuelve a intentar." >&2
  exit 2
}
echo "    docker, kind, kubectl, helm y pnpm presentes"

paso "1. Infraestructura en Docker (bases, broker, MinIO)"
pnpm dev:infra

paso "2. Cluster kind"
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "    ${CLUSTER} ya existe"
else
  pnpm k8s:cluster
fi

if [[ "$skip_build" != "true" ]]; then
  paso "3. Imagenes"
  pnpm images:build
else
  paso "3. Imagenes — omitidas (--skip-build)"
  echo "    install.sh cargara en el nodo lo que encuentre construido."
fi

paso "4. Stack de observabilidad en el namespace observability"
"${SCRIPT_DIR}/install-observability.sh"

paso "5. El banco, con la telemetria apuntando al Collector y el mock encendido"
"${SCRIPT_DIR}/install.sh" --values "${REPO_ROOT}/infra/k8s/kind/local.values.yaml"

paso "6. Estado"
kubectl --context "$CONTEXT" get pods -n bank-usac
kubectl --context "$CONTEXT" get pods -n observability

cat <<FIN

═══ Listo ═══

Dos port-forwards, en dos terminales:

  pnpm k8s:forward      # Gateway en :3000 y web en :3010
  pnpm obs:forward      # Grafana en :3002

Para ver que la telemetria llega de verdad:

  1. Haz una transferencia en http://localhost:3010
  2. En Grafana, «Bank USAC · Estado del sistema» — el throughput se mueve
  3. «Bank USAC · Flujo de trazas» — la Saga completa, en una sola traza
  4. «Bank USAC · Logs» — pega el correlationId y salta a su traza

Los escenarios de fallo de T-51, sin apagar nada de nadie. Cada uno mueve la
perilla, corre la carga, mira si el dinero cuadra y deja el clúster como estaba:

  pnpm load:scenario base            # el camino feliz, para comparar
  pnpm load:scenario rechazo         # el banco pareja dice no a todo
  pnpm load:scenario sin-respuesta   # el banco pareja no contesta
  pnpm load:scenario lento           # el banco pareja tarda 12 s
  pnpm load:scenario proveedor       # el proveedor de pagos falla (T-44)
  pnpm load:scenario pod             # se elimina un pod a mitad de carga

Los resultados quedan en tmp/load/<escenario>/ y los postmortems en
docs/sre/postmortems/.

Para apagarlo todo:

  pnpm k8s:down && pnpm k8s:obs:down && pnpm dev:infra:down && pnpm k8s:cluster:down
FIN
