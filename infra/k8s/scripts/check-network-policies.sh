#!/usr/bin/env bash
#
# Comprueba que las NetworkPolicy de `bank-observability` apunten a pods que
# existen de verdad.
#
# Por qué existe. Una NetworkPolicy con un `podSelector` que no coincide con
# nada **no es un error**: es una política que no autoriza a nadie. Y como la
# primera política del archivo es un `default-deny`, el resultado de una sola
# etiqueta mal escrita no es un aviso en el log — es el componente incomunicado.
# `helm lint` y `helm template` no lo ven: el YAML es válido, el `kind` existe y
# el selector es sintácticamente correcto.
#
# Lo que hace frágil el acierto es que las etiquetas no se eligen aquí: las
# ponen los subcharts. Los dos Collectors, por ejemplo, se etiquetan con su
# ALIAS de `Chart.yaml` (`otlpGateway`, `logAgent`) y no con el nombre del chart
# (`opentelemetry-collector`), que es lo que uno escribiría de memoria. Una
# subida de versión de cualquiera de los seis subcharts puede renombrar una
# etiqueta y dejar la política apuntando al vacío.
#
# Esto comprueba las dos direcciones del desacuerdo:
#
#   1. que toda etiqueta que las políticas NOMBRAN exista en el render, y
#   2. que todo pod del namespace esté cubierto por alguna política,
#
# más las cuatro reglas cuya ausencia rompe el stack sin dar la cara: el DNS,
# el `default-deny`, los dos puertos del raspado del Collector y el 443 del
# sidecar de Grafana.
#
# No necesita un clúster, ni red, ni Python: sólo `helm`. Se ejecuta en CI junto
# a `check-chart-deps.sh`.
set -euo pipefail

chart="${1:-infra/k8s/helm/bank-observability}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Las políticas, encendidas. En un despliegue normal `enabled` es `false` —ver
# el comentario en `values.yaml`— así que hay que forzarlo para verlas.
helm template obs "$chart" --namespace observability \
  --set networkPolicies.enabled=true \
  --show-only templates/network-policies.yaml > "$tmp/pol.yaml"

# El chart completo SIN las políticas: así el único origen de una línea
# `app.kubernetes.io/name:` son los subcharts, y la comparación de abajo no se
# confirma a sí misma.
helm template obs "$chart" --namespace observability > "$tmp/todo.yaml"

fallos=0
mal() { echo "  FALLO: $*" >&2; fallos=$((fallos + 1)); }

# --- 1. nueve políticas ------------------------------------------------------
n="$(grep -c '^kind: NetworkPolicy' "$tmp/pol.yaml" || true)"
if [[ "$n" != "9" ]]; then
  mal "se esperaban 9 NetworkPolicy y el render trae $n"
else
  echo "  ok  9 NetworkPolicy"
fi

# --- 2. toda etiqueta nombrada existe en el render ---------------------------
# Los siete componentes del stack. La lista es explícita a propósito: si un
# subchart deja de rendir uno, esto falla en vez de proteger un pod inexistente.
esperados=(otlpGateway logAgent tempo loki prometheus grafana kube-state-metrics)

nombrados="$(grep -o 'app\.kubernetes\.io/name: [A-Za-z0-9-]*' "$tmp/pol.yaml" |
  awk '{print $2}' | sort -u)"

for etiqueta in $nombrados; do
  # ¿La nombra la política y no la pone nadie? Selector al vacío.
  if ! grep -q "app\.kubernetes\.io/name: ${etiqueta}$" "$tmp/todo.yaml"; then
    mal "las políticas seleccionan '${etiqueta}' y ningún recurso del chart lleva esa etiqueta"
  fi
  # ¿La nombra y no está en la lista de arriba? Erratas y componentes nuevos.
  if [[ ! " ${esperados[*]} " == *" ${etiqueta} "* ]]; then
    mal "las políticas nombran '${etiqueta}', que no es ninguno de los siete componentes"
  fi
done
echo "  ok  etiquetas nombradas: $(echo "$nombrados" | tr '\n' ' ')"

# --- 3. todo componente tiene su política ------------------------------------
# El otro lado del error: un pod en un namespace con `default-deny` y sin
# política propia queda aislado. Añadir un subchart y olvidar su política es
# exactamente esto.
for c in "${esperados[@]}"; do
  if ! grep -q "app\.kubernetes\.io/name: ${c}$" "$tmp/pol.yaml"; then
    mal "el componente '${c}' no aparece en ninguna política: con el default-deny queda aislado"
  fi
done
echo "  ok  los siete componentes están cubiertos"

# --- 4. las cuatro reglas que se olvidan -------------------------------------
# El DNS. Sin el 53 nada resuelve y el síntoma parece que Tempo no existe.
grep -q 'port: 53' "$tmp/pol.yaml" || mal "no hay salida al DNS en el puerto 53"

# El default-deny, sin el cual las demás políticas no restringen nada.
grep -q 'name: default-deny' "$tmp/pol.yaml" || mal "falta la política default-deny"

# Los dos puertos del Collector: 8888 son sus métricas propias, 8889 las del
# banco que reexporta. Abrir sólo uno deja medio dashboard en blanco.
grep -q 'port: 8888' "$tmp/pol.yaml" || mal "Prometheus no puede raspar el 8888 del Collector"
grep -q 'port: 8889' "$tmp/pol.yaml" || mal "Prometheus no puede raspar el 8889 del Collector"

# El 443 del sidecar de Grafana: sin él el stack arranca entero y sin un solo
# dashboard, que es el artefacto que se califica.
grep -q 'port: 443' "$tmp/pol.yaml" || mal "el sidecar de Grafana no alcanza el API server en el 443"
echo "  ok  DNS, default-deny, 8888/8889 y el 443 del sidecar"

if ((fallos > 0)); then
  echo "" >&2
  echo "$fallos problema(s) en las NetworkPolicy de $chart" >&2
  exit 1
fi
echo "  Las NetworkPolicy de $chart concuerdan con los pods que el chart despliega."
