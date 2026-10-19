#!/usr/bin/env bash
#
# Comprueba que cada consulta de los dashboards, las reglas y las alertas cita
# algo que existe — y, con `--live`, que cada una DEVUELVE algo.
#
#   ./infra/k8s/scripts/check-dashboards.sh            # estatico, sin cluster (CI)
#   ./infra/k8s/scripts/check-dashboards.sh --live \
#       --prometheus http://127.0.0.1:19090 --loki http://127.0.0.1:13100 \
#       --tempo http://127.0.0.1:13200 [--grafana … --grafana-auth admin:…]
#
# POR QUE EXISTE. Un panel con un nombre de serie mal escrito no da error: sale
# vacio, para siempre, y parece que el sistema no tiene datos. Es exactamente lo
# que paso con `le="5"` contra una serie que Prometheus guarda como `le="5.0"`,
# y otra vez en T-60 con cinco defectos de la misma clase (los selectores de
# Loki por una etiqueta que no existe, `result="FAILED"` contra un codigo que
# emite `failed`, dos enlaces de Grafana que llegaban con la URL vacia y la
# anotacion de despliegues que se disparaba con el HPA). `helm lint` no ve
# ninguno.
#
# El trabajo lo hace `check-dashboards.py`, al lado de este archivo; su cabecera
# enumera las trece comprobaciones. Este script anade la UNICA que necesita un
# binario de fuera: `promtool check rules` sobre las reglas grabadas y sobre
# TODA consulta PromQL de los dashboards y las alertas, que el .py escribe como
# reglas de mentira para que promtool valide su sintaxis sin un Prometheus.
#
# promtool se busca en el PATH. Si no esta y `PROMTOOL_DOCKER=1` (lo pone CI),
# se corre desde la imagen `prom/prometheus` de la MISMA version que el subchart
# versionado en `charts/`: validar con otra version es validar otro lenguaje.
# Sin ninguno de los dos, se avisa y se sigue — el resto no depende de el.
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$RAIZ/infra/k8s/helm/bank-observability"

command -v python3 >/dev/null 2>&1 || {
  echo "ERROR: falta python3 en el PATH." >&2
  exit 2
}
python3 -c 'import yaml' 2>/dev/null || {
  echo "ERROR: falta PyYAML (python3 -m pip install pyyaml, o apt-get install python3-yaml)." >&2
  exit 2
}

TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT

rc=0
python3 "$RAIZ/infra/k8s/scripts/check-dashboards.py" \
  --root "$RAIZ" --chart "$CHART" \
  --emit-promql-rules "$TRABAJO/consultas.yml" "$@" || rc=$?

python3 - "$CHART/values.yaml" "$TRABAJO/grabadas.yml" <<'PY'
import sys, yaml
v = yaml.safe_load(open(sys.argv[1], encoding='utf-8'))
yaml.safe_dump(v['prometheus']['serverFiles']['recording_rules.yml'], open(sys.argv[2], 'w'), sort_keys=False)
PY

echo
echo "== promtool: las reglas grabadas y cada consulta PromQL son sintaxis valida"
if command -v promtool >/dev/null 2>&1; then
  promtool check rules "$TRABAJO/grabadas.yml" "$TRABAJO/consultas.yml" || rc=1
elif [ "${PROMTOOL_DOCKER:-0}" = "1" ] && command -v docker >/dev/null 2>&1; then
  version="$(tar -xzOf "$CHART"/charts/prometheus-*.tgz prometheus/Chart.yaml | sed -n 's/^appVersion: *//p')"
  echo "   promtool desde prom/prometheus:${version} (la version del subchart)"
  chmod -R a+rX "$TRABAJO"   # solo reglas y consultas; nada secreto
  # `--user` del host: `mktemp -d` crea el directorio con permisos 700 y la
  # imagen corre como `nobody`, asi que en Linux (CI) promtool no podia leer
  # /w ("permission denied"). En macOS no se veia: Docker Desktop no aplica los
  # permisos del host al montar.
  docker run --rm --user "$(id -u):$(id -g)" --entrypoint promtool \
    -v "$TRABAJO:/w:ro" "prom/prometheus:${version}" \
    check rules /w/grabadas.yml /w/consultas.yml || rc=1
else
  echo "   AVISO: no hay promtool (ni PROMTOOL_DOCKER=1). La sintaxis PromQL no se valido aqui;"
  echo "          CI si la valida."
fi

echo
if [ "$rc" -eq 0 ]; then
  echo "RESULTADO FINAL: todo en orden."
else
  echo "RESULTADO FINAL: hay fallos (ver arriba)." >&2
fi
exit "$rc"
