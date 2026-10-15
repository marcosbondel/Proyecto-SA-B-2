#!/usr/bin/env bash
#
# Un escenario de fallo de T-51, de principio a fin y reproducible.
#
#   ./test/load/scenario.sh base            # el camino feliz, para comparar
#   ./test/load/scenario.sh rechazo         # el banco pareja dice no a todo
#   ./test/load/scenario.sh sin-respuesta   # el banco pareja no contesta
#   ./test/load/scenario.sh lento           # el banco pareja tarda
#   ./test/load/scenario.sh proveedor       # el proveedor de pagos falla (T-44)
#   ./test/load/scenario.sh pod             # se elimina un pod a mitad de carga
#
# Qué hace, y por qué no es sólo `k6 run`: un escenario de fallo sin el antes y
# el después no demuestra nada. Lo que hay que poder afirmar no es «k6 dio estos
# números», es **«el dinero volvió»** — y eso son dos consultas al saldo y un
# recuento de estados, no un umbral.
#
# Deja todo en tmp/load/<escenario>/, y deja el clúster como lo encontró: la
# perilla que mueve la devuelve en un `trap`, porque un escenario que se
# interrumpe a mitad no debe dejar al banco pareja rechazando para siempre.
#
# Requisitos: el clúster local de T-57 arriba (`pnpm local:up`), el
# `port-forward` del Gateway en :3000 y k6 en el PATH.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTEXT="${KUBE_CONTEXT:-kind-bank-usac}"
NAMESPACE="${NAMESPACE:-bank-usac}"
GATEWAY="${GATEWAY_URL:-http://localhost:3000}"
RELEASE="${RELEASE:-bank-usac}"
# La cuenta MONETARIA sembrada con saldo: la misma que elige `pickAccounts`.
CUENTA="${CUENTA:-b0000000-0000-4000-8000-000000000003}"

escenario="${1:?Uso: scenario.sh base|rechazo|sin-respuesta|lento|proveedor|pod}"
salida="${REPO_ROOT}/tmp/load/${escenario}"
mkdir -p "$salida"

# El Gateway, antes de nada.
#
# Un `port-forward` muere cuando su pod se reinicia, y un pod se reinicia justo
# en los escenarios que este script existe para provocar. Sin esta
# comprobación, k6 corre contra un puerto cerrado y devuelve sesenta segundos
# de ceros que se parecen mucho a una medición.
if ! curl -fsS -o /dev/null --max-time 5 "${GATEWAY}/health"; then
  cat >&2 <<AVISO
ERROR: nadie contesta en ${GATEWAY}.

El port-forward se cae con el pod. Vuelve a abrirlo y repite:

  pnpm k8s:forward

AVISO
  exit 1
fi

kc() { kubectl --context "$CONTEXT" -n "$NAMESPACE" "$@"; }

# El token de quien se pida. La simulación de pagos es de ADMINISTRADOR (D-06):
# pedirla con el token del cliente devuelve 403, y la primera corrida de este
# escenario salió con 560 transferencias perfectas porque la perilla nunca se
# había movido y nadie miró la respuesta.
token() {
  local quien="${1:-cliente}"
  curl -s --max-time 30 -X POST "${GATEWAY}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${quien}@bankusac.gt\",\"credential\":\"${SEED_PASSWORD:-BankUsac#2026}\"}" |
    python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'
}

saldo() {
  curl -s --max-time 30 "${GATEWAY}/api/accounts" -H "Authorization: Bearer $(token)" |
    python3 -c "
import json,sys
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get('accounts', d.get('items', []))
print(next((a['balance']['amountMinor'] for a in rows if a.get('accountId') == '${CUENTA}'), 'desconocido'))
"
}

# Los recuentos salen de las bases de datos y no del Gateway a propósito: lo que
# se está comprobando es que el dinero cuadra, y la única autoridad sobre eso es
# la fila, no una respuesta que podría estar sirviendo una proyección atrasada.
envios()      { docker exec postgres-payment     psql -U payment_app     -d payment     -t -A -F'=' -c "SELECT state, count(*) FROM interbank_sends WHERE created_at >= '$1' GROUP BY state ORDER BY 1" | tr '\n' ' '; echo; }
interbanco()  { docker exec postgres-transaction psql -U transaction_app -d transaction -t -A -F'=' -c "SELECT status, count(*) FROM transactions WHERE created_at >= '$1' AND interbank IS NOT NULL GROUP BY status ORDER BY 1" | tr '\n' ' '; echo; }
internas()    { docker exec postgres-transaction psql -U transaction_app -d transaction -t -A -F'=' -c "SELECT status, count(*) FROM transactions WHERE created_at >= '$1' AND interbank IS NULL GROUP BY status ORDER BY 1" | tr '\n' ' '; echo; }

restaurar=()
limpiar() {
  for comando in "${restaurar[@]:-}"; do
    [[ -n "$comando" ]] && eval "$comando" >/dev/null 2>&1 || true
  done
}
trap limpiar EXIT

# Armar el fallo en el banco pareja simulado.
#
# **No alcanza con `rollout status`**, y eso costó una medición entera: dice que
# el despliegue terminó mientras el pod anterior sigue en los Endpoints del
# Service, así que la carga arranca y la mitad se mide contra el modo viejo. La
# primera corrida del escenario «rechazo» salió con 113 aceptados y 120
# rechazados por esto.
#
# Lo que sí es determinista: esperar a que quede **un solo pod**, Ready, y que
# su propio `/health` diga el modo que se pidió. Lo dice sin token justamente
# para que se pueda preguntar desde aquí.
modo_del_mock() {
  local modo="$1" retraso="${2:-}"
  kc set env "deploy/${RELEASE}-partner-bank-mock" "PARTNER_CALLBACK_MODE=${modo}"     ${retraso:+"PARTNER_CALLBACK_DELAY_MS=${retraso}"} >/dev/null
  kc rollout status "deploy/${RELEASE}-partner-bank-mock" --timeout=180s >/dev/null

  local pods
  for _ in $(seq 1 60); do
    pods="$(kc get pods -l app.kubernetes.io/component=partner-bank-mock       -o jsonpath='{range .items[*]}{.metadata.name}{"="}{.status.containerStatuses[0].ready}{" "}{end}')"
    if [[ "$(echo "$pods" | wc -w | tr -d ' ')" == "1" && "$pods" == *"=true"* ]]; then
      local visto
      visto="$(kc exec "deploy/${RELEASE}-partner-bank-mock" -c app --         node -e 'fetch("http://127.0.0.1:"+(process.env.PARTNER_MOCK_PORT??3021)+"/health").then(r=>r.json()).then(b=>console.log(b.callbackMode))' 2>/dev/null || true)"
      if [[ "$visto" == "$modo" ]]; then
        echo "banco pareja en modo ${modo}${retraso:+ con ${retraso} ms de retraso}, confirmado por su /health"
        return 0
      fi
    fi
    sleep 2
  done

  echo "ERROR: el mock no confirmó el modo ${modo} (pods: ${pods})" >&2
  exit 1
}

# Mover la perilla de T-44, y **comprobar que se movió**.
simulacion() {
  local codigo destino="${2:-simulacion.json}"
  codigo="$(curl -s -o "${salida}/${destino}" -w '%{http_code}' --max-time 30 \
    -X PUT "${GATEWAY}/api/payments/simulation" \
    -H "Authorization: Bearer $(token admin)" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $(uuidgen)" -d "$1")"
  if [[ "$codigo" != "200" && "$codigo" != "202" ]]; then
    echo "ERROR: la simulación no se aplicó (HTTP ${codigo}): $(cat "${salida}/${destino}")" >&2
    exit 1
  fi
  echo "simulación aplicada: $(cat "${salida}/${destino}" | head -c 200)"
}

apagar_simulacion() {
  # En otro archivo: escribir aquí `simulacion.json` borraría la evidencia de
  # lo que de verdad se inyectó, dejando los ceros del restablecimiento como si
  # hubieran sido los valores de la corrida.
  simulacion '{"failureRatePercent":0,"timeoutRatePercent":0,"latencyMs":0}' 'simulacion-restablecida.json'
}

script="interbank.js"
case "$escenario" in
  base)          modo_del_mock ACCEPT;  restaurar+=("true") ;;
  rechazo)       modo_del_mock REJECT;  restaurar+=("kubectl --context $CONTEXT -n $NAMESPACE set env deploy/${RELEASE}-partner-bank-mock PARTNER_CALLBACK_MODE=ACCEPT") ;;
  sin-respuesta) modo_del_mock TIMEOUT; restaurar+=("kubectl --context $CONTEXT -n $NAMESPACE set env deploy/${RELEASE}-partner-bank-mock PARTNER_CALLBACK_MODE=ACCEPT") ;;
  lento)         modo_del_mock SLOW 12000; restaurar+=("kubectl --context $CONTEXT -n $NAMESPACE set env deploy/${RELEASE}-partner-bank-mock PARTNER_CALLBACK_MODE=ACCEPT PARTNER_CALLBACK_DELAY_MS=1000") ;;
  proveedor)
    script="transfer.js"
    # En caliente y por la ruta de administración de T-44: sin reinicio, que es
    # justo lo que hace a esta perilla usable durante una carga en curso.
    simulacion '{"failureRatePercent":30,"timeoutRatePercent":10,"latencyMs":0}'
    restaurar+=("apagar_simulacion")
    ;;
  pod)           script="transfer.js" ;;
  *) echo "Escenario desconocido: $escenario" >&2; exit 2 ;;
esac

desde="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
saldo_antes="$(saldo)"
echo "=== $escenario — desde $desde, saldo $saldo_antes, script $script ==="

if [[ "$escenario" == "pod" ]]; then
  # El pod se elimina a mitad de la ventana, no al principio: lo que se mide es
  # una Saga partida por la mitad, no un arranque en frío.
  ( sleep 25
    victima="$(kc get pods -l app.kubernetes.io/component=transaction-service -o jsonpath='{.items[0].metadata.name}')"
    echo "eliminando $victima" | tee "${salida}/pod-eliminado.txt"
    kc delete pod "$victima" --grace-period=0 --force >>"${salida}/pod-eliminado.txt" 2>&1
  ) &
fi

set +e
k6 run --summary-export "${salida}/k6.json" "${REPO_ROOT}/test/load/${script}" 2>&1 | tee "${salida}/k6.txt"
veredicto=$?
set -e
wait 2>/dev/null || true

# Treinta segundos: el plazo de confirmación del banco pareja es de 30 s y el
# barrido corre después. Mirar antes de eso es contar compensaciones que todavía
# no tocaba hacer.
echo "esperando 45 s a que cierre lo que quedó en vuelo…"
sleep 45

{
  echo "escenario:      $escenario"
  echo "carga:          ${TASA:-4}/s durante ${DURACION:-60s}"
  echo "desde:          $desde"
  echo "script:         $script"
  echo "k6:             $([[ $veredicto -eq 0 ]] && echo 'todos los umbrales' || echo 'algún umbral cruzado')"
  echo "saldo antes:    $saldo_antes"
  echo "saldo después:  $(saldo)"
  echo "envíos:         $(envios "$desde")"
  echo "interbancarias: $(interbanco "$desde")"
  echo "internas:       $(internas "$desde")"
  echo "reinicios:"
  kc get pods -o custom-columns='POD:.metadata.name,LISTO:.status.containerStatuses[0].ready,REINICIOS:.status.containerStatuses[0].restartCount' --no-headers | grep -v trafico
} | tee "${salida}/resumen.txt"
