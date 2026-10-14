#!/usr/bin/env bash
#
# Comprueba que los subcharts versionados de `bank-observability` concuerden con
# lo que declaran `Chart.yaml` y `Chart.lock` — sin tocar la red.
#
# Por qué existe. El stack de observabilidad trae sus motores (Collector,
# Prometheus, Tempo, Loki, Grafana) de sus charts oficiales, y los `.tgz` están
# **commiteados** en `charts/`. Eso hace que el despliegue no dependa de que los
# repositorios de Grafana, Prometheus y OpenTelemetry respondan: el día de la
# calificación eso importa más que el ahorro de 372 KB.
#
# El precio de versionarlos es que `Chart.yaml`, `Chart.lock` y `charts/` pueden
# separarse: alguien sube una versión en `Chart.yaml` y olvida
# `helm dependency update`, y el despliegue sigue usando la vieja sin decir
# nada. `helm lint` no lo ve y `helm template` tampoco — renderiza felizmente
# con el `.tgz` que haya. Esto sí.
#
# Deliberadamente NO ejecuta `helm dependency build`: ese comando refresca el
# índice de los repositorios por red, que es justo lo que versionar los `.tgz`
# pretendía evitar.
set -euo pipefail

chart_dir="${1:-infra/k8s/helm/bank-observability}"

[[ -f "$chart_dir/Chart.yaml" ]] || {
  echo "ERROR: no hay Chart.yaml en $chart_dir" >&2
  exit 1
}

python3 - "$chart_dir" <<'PY'
import sys, os, re

chart_dir = sys.argv[1]


def parse_block(path, key):
    """Lee la lista `dependencies:` sin depender de PyYAML.

    El repositorio no garantiza PyYAML en el entorno de nadie, y esto se
    ejecuta tanto en CI como en la máquina de quien despliega. Las dos claves
    que hacen falta — `name` y `version` — están en una lista plana, así que un
    lector de líneas es suficiente y no añade una dependencia.
    """
    entries = []
    current = None
    inside = False
    indent = None

    with open(path, encoding='utf-8') as handle:
        for raw in handle:
            line = raw.rstrip('\n')
            stripped = line.strip()

            if not inside:
                if stripped == f'{key}:':
                    inside = True
                continue

            if stripped == '' or stripped.startswith('#'):
                continue

            leading = len(line) - len(line.lstrip())

            if stripped.startswith('- '):
                indent = leading
                current = {}
                entries.append(current)
                stripped = stripped[2:]
            elif indent is None or leading <= indent:
                # Salimos del bloque: una clave al mismo nivel o menos.
                break

            match = re.match(r'([A-Za-z_]+):\s*(.*)$', stripped)
            if match and current is not None:
                current[match.group(1)] = match.group(2).strip().strip('"\'')

    return entries


declared = parse_block(os.path.join(chart_dir, 'Chart.yaml'), 'dependencies')
if not declared:
    print('ERROR: Chart.yaml no declara dependencias', file=sys.stderr)
    sys.exit(1)

lock_path = os.path.join(chart_dir, 'Chart.lock')
if not os.path.exists(lock_path):
    print('ERROR: falta Chart.lock. Ejecuta `helm dependency update` y commitéalo.', file=sys.stderr)
    sys.exit(1)

locked = parse_block(lock_path, 'dependencies')

problems = []

# 1. Cada dependencia declarada tiene su .tgz exactamente en esa versión.
charts_dir = os.path.join(chart_dir, 'charts')
present = set(os.listdir(charts_dir)) if os.path.isdir(charts_dir) else set()

for dep in declared:
    name, version = dep.get('name'), dep.get('version')
    if not name or not version:
        problems.append(f'dependencia sin name o version: {dep}')
        continue
    expected = f'{name}-{version}.tgz'
    if expected not in present:
        problems.append(
            f'falta charts/{expected} — Chart.yaml pide {name} {version}. '
            f'Ejecuta `helm dependency update {chart_dir}` y commitea charts/ y Chart.lock.'
        )

# 2. Chart.lock coincide con Chart.yaml, por par (nombre, versión).
#    `alias` permite la misma dependencia dos veces, así que se comparan
#    multiconjuntos y no conjuntos.
def pairs(entries):
    out = {}
    for item in entries:
        key = (item.get('name'), item.get('version'))
        out[key] = out.get(key, 0) + 1
    return out


if pairs(declared) != pairs(locked):
    problems.append(
        f'Chart.lock no concuerda con Chart.yaml.\n'
        f'    Chart.yaml: {sorted(pairs(declared).items())}\n'
        f'    Chart.lock: {sorted(pairs(locked).items())}\n'
        f'    Ejecuta `helm dependency update {chart_dir}`.'
    )

# 3. Ningún .tgz de sobra: uno viejo que nadie usa es una versión que alguien
#    va a creer desplegada.
expected_files = {f"{d['name']}-{d['version']}.tgz" for d in declared if d.get('name') and d.get('version')}
for extra in sorted(present - expected_files):
    if extra.endswith('.tgz'):
        problems.append(f'charts/{extra} no lo declara ningún Chart.yaml. Bórralo.')

if problems:
    print('Los subcharts versionados no concuerdan con lo declarado:\n', file=sys.stderr)
    for problem in problems:
        print(f'  - {problem}', file=sys.stderr)
    sys.exit(1)

print(f'{len(declared)} dependencias declaradas, versionadas y con el lock al día:')
for dep in declared:
    alias = f" (alias {dep['alias']})" if dep.get('alias') else ''
    print(f"  {dep['name']} {dep['version']}{alias}")
PY
