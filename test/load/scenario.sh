#!/usr/bin/env bash
#
# Un escenario de fallo de T-51, de principio a fin y reproducible.
#
#   ./test/load/scenario.sh base            # el camino feliz, para comparar
#   ./test/load/scenario.sh rechazo         # el banco pareja dice no a todo
#   ./test/load/scenario.sh sin-respuesta   # el banco pareja no contesta
#   ./test/load/scenario.sh lento           # el banco pareja tarda
#   ./test/load/scenario.sh indisponible    # el banco pareja contesta 503
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

escenario="${1:?Uso: scenario.sh base|rechazo|sin-respuesta|lento|indisponible|proveedor|pod}"
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

# Llamar a la API de administración del banco pareja simulado, **desde dentro de
# su pod**.
#
# Desde T-60 el mock cambia de modo EN CALIENTE (`PUT /admin/config`) y ya no
# hace falta reiniciarlo. Eso elimina de raíz el fallo que costó una medición
# entera en T-51: `kubectl set env` + `rollout status` decía que el despliegue
# había terminado mientras el pod anterior seguía en los Endpoints, y la mitad
# de la carga se medía contra el modo viejo. Aquí no hay pod nuevo que esperar.
#
# Se ejecuta con `kubectl exec` y `node` (la imagen ya lo trae) para que el
# token de administración se lea del propio entorno del pod y nadie tenga que
# llevarlo en un archivo o en el historial de la shell.
#
#   mock_admin METODO RUTA [CUERPO_JSON]
mock_admin() {
  kc exec "deploy/${RELEASE}-partner-bank-mock" -c app -- node -e '
    const [method, path, body] = process.argv.slice(1);
    const token = process.env.PARTNER_MOCK_ADMIN_TOKEN;
    if (!token) { console.error("PARTNER_MOCK_ADMIN_TOKEN vacío: instala el release con partnerMock.adminToken"); process.exit(2); }
    fetch("http://127.0.0.1:" + (process.env.PARTNER_MOCK_PORT ?? 3021) + path, {
      method,
      headers: { "x-admin-token": token, "content-type": "application/json" },
      body: body || undefined,
    }).then(async (res) => { console.log(await res.text()); process.exit(res.ok ? 0 : 1); })
      .catch((error) => { console.error(String(error)); process.exit(1); });
  ' "$@"
}

# Armar el fallo en el banco pareja simulado y **comprobar que se armó**.
#
# Se confirma por el `/health` del mock —sin token, el mismo que usa el probe—,
# que dice el modo vigente: es la pregunta que se hace cualquiera que vea un
# depósito rechazado («¿está el mock en REJECT o es el otro banco?»), y la única
# garantía de que la carga no arranca contra el modo anterior.
#
#   modo_del_mock MODO [CAMPOS_JSON_EXTRA]     p. ej.  modo_del_mock SLOW '"slowMs":12000'
modo_del_mock() {
  local modo="$1" extra="${2:-}"
  local cuerpo="{\"mode\":\"${modo}\"${extra:+,${extra}}}"

  if ! mock_admin PUT /admin/config "$cuerpo" >"${salida}/mock-config.json"; then
    echo "ERROR: el mock no aceptó la configuración ${cuerpo}: $(cat "${salida}/mock-config.json")" >&2
    exit 1
  fi

  local visto
  for _ in $(seq 1 15); do
    visto="$(kc exec "deploy/${RELEASE}-partner-bank-mock" -c app -- \
      node -e 'fetch("http://127.0.0.1:"+(process.env.PARTNER_MOCK_PORT??3021)+"/health").then(r=>r.json()).then(b=>console.log(b.callbackMode))' 2>/dev/null || true)"
    if [[ "$visto" == "$modo" ]]; then
      echo "banco pareja en modo ${modo}${extra:+ (${extra})}, confirmado por su /health"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: el mock no confirmó el modo ${modo} (su /health dice: ${visto:-nada})" >&2
  exit 1
}

# Devolver al mock a su estado normal, **sin reiniciarlo y sin borrar lo que
# recibió** (`/admin/reset` lo borraría: la evidencia del escenario se quedaría
# sin sus registros).
restaurar_mock() {
  mock_admin PUT /admin/config \
    '{"mode":"ACCEPT","delayMs":1000,"ackDelayMs":0,"failCount":0,"failureRate":0,"statusBehavior":"PROCESSING","honorExpiry":true,"reversal":"COMPLETE"}'
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
  rechazo)       modo_del_mock REJECT '"rejectReason":"ACCOUNT_NOT_FOUND"'; restaurar+=("restaurar_mock") ;;
  # El banco recibe el depósito (202) y no contesta jamás. El contrato manda
  # esperar los 180 s de `expiresAt`, consultar (PROCESSING), cancelar y sólo
  # entonces compensar: la Saga tarda minutos, no segundos. Por eso la carga es
  # menor y la espera por Saga mayor, y los dos son sobrescribibles.
  sin-respuesta) modo_del_mock TIMEOUT; restaurar+=("restaurar_mock")
                 export TASA="${TASA:-0.5}" SAGA_WAIT_MS="${SAGA_WAIT_MS:-260000}" SAGA_P95_MS="${SAGA_P95_MS:-260000}"
                 ESPERA_FINAL="${ESPERA_FINAL:-30}" ;;
  lento)         modo_del_mock SLOW '"slowMs":12000'; restaurar+=("restaurar_mock") ;;
  # Todo el contrato responde 503 con Retry-After: el emisor debe reintentar con
  # espera creciente y no perder ni duplicar el dinero.
  indisponible)  modo_del_mock UNAVAILABLE; restaurar+=("restaurar_mock") ;;
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
echo "esperando ${ESPERA_FINAL:-45} s a que cierre lo que quedó en vuelo…"
sleep "${ESPERA_FINAL:-45}"

# Lo que el mock vio, según el mock: la otra mitad de la evidencia. Falla en
# silencio a propósito (`|| true`): sin esto el resumen sigue siendo válido.
mock_admin GET /admin/received >"${salida}/mock-recibidos.json" 2>/dev/null || true

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
