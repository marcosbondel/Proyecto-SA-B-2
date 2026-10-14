#!/usr/bin/env bash
#
# Comprueba que cada consulta de los dashboards de T-50 cita algo que existe.
#
# POR QUE EXISTE. Un panel con un nombre de serie mal escrito no da error: sale
# vacio, para siempre, y parece que el sistema no tiene datos. Es exactamente lo
# que paso con `le="5"` contra una serie que Prometheus guarda como `le="5.0"`.
# `helm lint` no lo ve, `promtool` tampoco —el JSON del dashboard no es una regla—
# y en la calificacion se ve como un dashboard decorativo (§8.3, 25 %).
#
# Lo que comprueba, sin necesitar un cluster:
#   1. Cada JSON de `dashboards/` es JSON valido y trae uid, title y paneles.
#   2. Cada nombre `slo:...` o `sli:...` que aparece en una consulta esta
#      GRABADO en `recording_rules.yml`. Un panel no puede inventarse un SLI.
#   3. Cada `runbook_url` de las alertas apunta a un archivo que existe.
#
# Lo que NO comprueba: que la serie tenga datos. Eso necesita un Prometheus con
# trafico y lo hace `obs-kind.sh` (comprobaciones 8 a 10).
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART="$RAIZ/infra/k8s/helm/bank-observability"
DASH="$CHART/dashboards"

fallos=0
aviso() {
  echo "FALLO: $*" >&2
  fallos=$((fallos + 1))
}

command -v python3 >/dev/null 2>&1 || {
  echo "ERROR: falta python3 en el PATH." >&2
  exit 2
}

echo "== 1. Los dashboards son JSON valido y estan completos"
for f in "$DASH"/*.json; do
  nombre="$(basename "$f")"
  if ! python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
for clave in ('uid', 'title', 'panels', 'templating', 'annotations'):
    if clave not in d:
        raise SystemExit(f'falta \"{clave}\"')
if not d['panels']:
    raise SystemExit('no tiene paneles')
" "$f" 2>/tmp/dash-err; then
    aviso "$nombre: $(cat /tmp/dash-err)"
  else
    echo "   OK  $nombre"
  fi
done

echo
echo "== 2. Cada SLI/SLO que citan los paneles esta grabado"
python3 - "$CHART/values.yaml" "$DASH" <<'PY' || fallos=$((fallos + 1))
import glob, json, os, re, sys

import yaml

values, directorio = sys.argv[1], sys.argv[2]

with open(values, encoding='utf-8') as f:
    v = yaml.safe_load(f)

grabadas = {
    regla['record']
    for grupo in v['prometheus']['serverFiles']['recording_rules.yml']['groups']
    for regla in grupo['rules']
}
print(f'   {len(grabadas)} reglas grabadas')

CITA = re.compile(r'\b(?:slo|sli):[a-z0-9_]+:[a-z0-9_]+\b')
malas = []

for ruta in sorted(glob.glob(os.path.join(directorio, '*.json'))):
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    for nombre in sorted(set(CITA.findall(texto))):
        if nombre not in grabadas:
            malas.append(f'{os.path.basename(ruta)}: {nombre}')

if malas:
    print('   FALLO: paneles que citan una regla que nadie graba:')
    for m in malas:
        print(f'      {m}')
    raise SystemExit(1)

print('   OK  ninguna consulta se inventa un SLI')
PY

echo
echo "== 3. Cada alerta tiene su runbook en disco"
grep -o 'runbooks/[a-z0-9-]*\.md' "$CHART/values.yaml" | sort -u | while read -r r; do
  if [ -f "$RAIZ/docs/operations/$r" ]; then
    echo "   OK  $r"
  else
    echo "   FALLO: $r no existe" >&2
    exit 1
  fi
done || fallos=$((fallos + 1))

echo
if [ "$fallos" -eq 0 ]; then
  echo "RESULTADO: los dashboards citan lo que existe."
else
  echo "RESULTADO: $fallos comprobacion(es) fallaron." >&2
  exit 1
fi
