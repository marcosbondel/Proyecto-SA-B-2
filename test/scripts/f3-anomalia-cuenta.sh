#!/usr/bin/env bash
#
# F3-ACC-02 en vivo: dispara la detección de alta frecuencia de una cuenta y
# muestra, de principio a fin, lo que el requisito pide ver.
#
#   ./test/scripts/f3-anomalia-cuenta.sh                 # contra producción
#   GATEWAY_URL=http://localhost:3000 ./test/scripts/f3-anomalia-cuenta.sh
#
# Qué hace:
#   1. Inicia sesión como cliente y como administrador (usuarios sembrados).
#   2. Hace OPERACIONES transferencias seguidas de MONTO_MINOR centavos,
#      MONETARIA -> AHORRO del mismo cliente. Con 11 se pasa el umbral de 10
#      operaciones en 5 minutos del ConfigMap. El dinero no sale del cliente.
#   3. Espera la notificación `account.anomaly` creada después de empezar, y el
#      evento WARNING de auditoría.
#   4. Hace una transferencia más y comprueba que se completa: la cuenta no se
#      bloquea (ADR-017).
#
# La anomalía se anuncia una vez por ventana. Si la cuenta ya tuvo una en los
# últimos 5 minutos (otra corrida, una carga), no llega otra: espera y repite.
#
# Requisitos: curl, jq y uuidgen (en macOS ya vienen). No usa kubectl ni lee
# ningún secreto: la contraseña de demo ya es pública en las semillas.
set -euo pipefail

GATEWAY="${GATEWAY_URL:-http://34.69.101.197:3000}"
PASSWORD="${SEED_PASSWORD:-BankUsac#2026}"
ORIGEN="${ORIGEN:-b0000000-0000-4000-8000-000000000003}"   # MONETARIA 02-000000008
DESTINO="${DESTINO:-b0000000-0000-4000-8000-000000000004}"  # AHORRO    02-000000009
OPERACIONES="${OPERACIONES:-11}"
MONTO_MINOR="${MONTO_MINOR:-100}"                            # Q1.00
ESPERA_MAX_S="${ESPERA_MAX_S:-90}"

for herramienta in curl jq uuidgen; do
  command -v "$herramienta" >/dev/null || { echo "ERROR: falta $herramienta en el PATH." >&2; exit 1; }
done

paso() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
nuevo_id() { uuidgen | tr '[:upper:]' '[:lower:]'; }

if ! curl -fsS -o /dev/null --max-time 5 "${GATEWAY}/ready"; then
  echo "ERROR: ${GATEWAY}/ready no contesta. El Gateway no está listo." >&2
  exit 1
fi

login() {
  curl -fsS -X POST "${GATEWAY}/api/auth/login" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg email "$1" --arg credential "$PASSWORD" '{email: $email, credential: $credential}')" \
    | jq -r '.token'
}

saldos() {
  curl -fsS "${GATEWAY}/api/accounts" -H "Authorization: Bearer ${TC}" \
    | jq -r --arg o "$ORIGEN" --arg d "$DESTINO" \
      '.accounts[] | select(.accountId == $o or .accountId == $d)
       | "  \(.accountNumber)  \(.accountType)  Q\(.balance.amountMinor / 100)"'
}

# Envía una transferencia y deja en TX_ID y TX_CORR lo que devolvió el Gateway.
transferir() {
  local cabeceras cuerpo codigo
  cabeceras="$(mktemp)"
  cuerpo="$(curl -sS -D "$cabeceras" -o - -w '\n%{http_code}' -X POST "${GATEWAY}/api/transfers" \
    -H "Authorization: Bearer ${TC}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $(nuevo_id)" \
    -d "$(jq -n --arg s "$ORIGEN" --arg t "$DESTINO" --argjson m "$MONTO_MINOR" \
      '{sourceAccount: $s, targetAccount: $t, amount: {amountMinor: $m, currency: "GTQ"}}')")"
  codigo="$(tail -n1 <<<"$cuerpo")"
  if [ "$codigo" != "202" ]; then
    echo "ERROR: la transferencia devolvió ${codigo}: $(sed '$d' <<<"$cuerpo")" >&2
    rm -f "$cabeceras"
    exit 1
  fi
  TX_ID="$(sed '$d' <<<"$cuerpo" | jq -r '.transactionId')"
  TX_CORR="$(grep -i '^x-correlation-id:' "$cabeceras" | tr -d '\r' | awk '{print $2}')"
  rm -f "$cabeceras"
}

# Espera a que una transferencia llegue a un estado final y lo imprime.
estado_final() {
  local estado=""
  for _ in $(seq 1 30); do
    estado="$(curl -fsS "${GATEWAY}/api/transfers/$1" -H "Authorization: Bearer ${TC}" | jq -r '.status')"
    case "$estado" in COMPLETED | COMPENSATED | FAILED) echo "$estado"; return 0 ;; esac
    sleep 1
  done
  echo "${estado:-DESCONOCIDO} (sin estado final en 30 s)"
}

paso "Sesiones"
TC="$(login cliente@bankusac.gt)"
TA="$(login admin@bankusac.gt)"
echo "  cliente y administrador: OK"

paso "Saldos iniciales"
saldos

INICIO="$(date -u +%Y-%m-%dT%H:%M:%S)"
paso "${OPERACIONES} transferencias de Q$((MONTO_MINOR / 100)) MONETARIA -> AHORRO (inicio ${INICIO}Z)"
for i in $(seq 1 "$OPERACIONES"); do
  transferir
  printf '  %2d  %s  código de seguimiento %s\n' "$i" "$TX_ID" "$TX_CORR"
  ULTIMA="$TX_ID"
done
echo "  la última: $(estado_final "$ULTIMA")"

paso "Esperando la notificación account.anomaly (hasta ${ESPERA_MAX_S} s)"
notificacion=""
for _ in $(seq 1 $((ESPERA_MAX_S / 3))); do
  notificacion="$(curl -fsS "${GATEWAY}/api/audit/notifications?type=account.anomaly&limit=10" \
    -H "Authorization: Bearer ${TA}" \
    | jq -c --arg desde "$INICIO" '[.notifications[] | select(.createdAt >= $desde)] | first // empty')"
  [ -n "$notificacion" ] && break
  sleep 3
done

if [ -z "$notificacion" ]; then
  cat >&2 <<AVISO
  No llegó ninguna notificación nueva de anomalía.
  Lo más probable: la cuenta ya tuvo una anomalía en los últimos 5 minutos y
  se anuncia una vez por ventana. Espera 5 minutos y vuelve a correr el script.
AVISO
  exit 1
fi
jq -r '"  asunto:      \(.subject)\n  severidad:   \(.severity // "-")\n  estado:      \(.status)\n  creada:      \(.createdAt)\n  seguimiento: \(.correlationId)"' <<<"$notificacion"

paso "Evento de auditoría WARNING de account-service"
curl -fsS "${GATEWAY}/api/audit/recent?severity=WARNING&service=account-service&limit=5" \
  -H "Authorization: Bearer ${TA}" \
  | jq -r '[.events[] | select(.messageType | startswith("account.anomaly"))] | first
           | if . == null then "  (todavía no aparece; revisa Auditoría en unos segundos)"
             else "  \(.messageType)  \(.severity)  \(.occurredAt)\n  payload: \(.payload | tojson)" end'

paso "Una transferencia más: la cuenta sigue operando"
transferir
echo "  ${TX_ID}: $(estado_final "$TX_ID")"

paso "Saldos finales"
saldos

cat <<SIGUIENTE

Ahora revisa en la web (F3-ACC-02 y F3-ACC-03):
  - Cliente: campana -> Notificaciones -> «Actividad inusual en la cuenta», insignia Advertencia.
  - Admin:   avatar -> Consola de notificaciones -> la tarjeta de account.anomaly.
  - Admin:   Auditoría -> Servicio account-service, Nivel Advertencia -> Buscar.
  - Grafana: Loki   {service_name="account-service", deployment_environment="prod"} |= "account anomaly detected"
  - Grafana: Bank USAC · Errores en tiempo real -> «Anomalías de cuenta detectadas (última hora)».
SIGUIENTE
