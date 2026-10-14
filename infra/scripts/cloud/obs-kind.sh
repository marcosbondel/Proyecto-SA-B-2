#!/usr/bin/env bash
#
# Valida el stack de observabilidad (T-49) en un kind desechable, gratis, y
# comprueba la cadena que la rubrica califica: un log JSON del banco -> su
# traza, por el mismo traceId.
#
#   ./infra/scripts/cloud/obs-kind.sh            # crear, desplegar y verificar
#   ./infra/scripts/cloud/obs-kind.sh --verify    # solo verificar lo ya desplegado
#   ./infra/scripts/cloud/obs-kind.sh --down      # borrar el cluster desechable
#
# POR QUE AQUI Y NO EN LA NUBE. Casi todo lo que puede romperse del stack es
# comportamiento de cluster, no de nube: que `transform/parse_bank_json` abra el
# JSON, que Loki lo indexe con DOS etiquetas y no con veinte, que `traceId` sea
# consultable sin ser etiqueta, que Tempo reciba la traza, que Prometheus raspe
# al Collector y que Grafana cargue sus tres datasources. Nada de eso necesita
# GCP, y en GCP cuesta ~0.50 USD/hora averiguarlo.
#
# NO necesita el banco. Un pod de busybox que escribe el formato exacto de
# `@bank/observability` en stdout y una traza OTLP enviada por curl bastan para
# probar la correlacion. Levantar siete servicios y cinco bases de datos para
# comprobar un pipeline de telemetria es pagar por lo que no se esta midiendo.
#
# Usa su PROPIO cluster (`bank-obs-test`), no el `bank-usac` del flujo local,
# para no interferir con una sesion de desarrollo en curso.
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CHART="${REPO_ROOT}/infra/k8s/helm/bank-observability"

CLUSTER="${BANK_OBS_KIND_CLUSTER:-bank-obs-test}"
CTX="kind-${CLUSTER}"
NS=observability
# Solo existe mientras vive un cluster de prueba local. No es un secreto.
GRAFANA_PASS="kind-solo-para-probar-123"

accion=todo
for arg in "$@"; do
  case "$arg" in
    --verify) accion=verificar ;;
    --down) accion=bajar ;;
    -h | --help)
      sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $arg" >&2
      exit 2
      ;;
  esac
done

k() { kubectl --context "$CTX" "$@"; }
paso() { echo; echo "=== $* ==="; }

if [[ "$accion" == "bajar" ]]; then
  paso "Borrando el cluster desechable ${CLUSTER}"
  kind delete cluster --name "$CLUSTER"
  echo "Listo. Esto no tenia coste: kind corre en Docker, en tu maquina."
  exit 0
fi

for binario in kind kubectl helm python3; do
  command -v "$binario" >/dev/null 2>&1 || {
    echo "ERROR: falta '$binario' en el PATH." >&2
    exit 2
  }
done

if [[ "$accion" == "todo" ]]; then
  paso "1. Cluster desechable"
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    echo "    ${CLUSTER} ya existe."
  else
    kind create cluster --name "$CLUSTER" --wait 180s
  fi

  paso "2. Namespace y Secret de Grafana"
  k create namespace "$NS" --dry-run=client -o yaml | k apply -f -
  k create secret generic grafana-admin --namespace "$NS" \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$GRAFANA_PASS" \
    --dry-run=client -o yaml | k apply -f -

  paso "3. Desplegar el stack"
  "${REPO_ROOT}/infra/k8s/scripts/check-chart-deps.sh" "$CHART"
  helm --kube-context "$CTX" upgrade bank-observability "$CHART" \
    --install --namespace "$NS" --wait --timeout 15m >/dev/null
  k get pods -n "$NS"

  paso "4. Un servicio del banco, falso, con un traceId conocido"
  TRACE_ID="$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
  SPAN_ID="$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
  echo "    traceId = ${TRACE_ID}"

  # El formato es el de `@bank/observability` (apps/packages/observability/src/logger.ts):
  # timestamp, level, serviceName, environment, version, message, correlationId,
  # traceId, spanId y los campos propios del componente.
  #
  # La segunda linea NO es JSON a proposito: comprueba que el guardia
  # `where IsMatch(body, "^\\s*\\{")` del procesador deja pasar sin parsear lo
  # que no entiende, en vez de descartarlo. Un log que el recolector no entiende
  # sigue siendo evidencia.
  k apply -f - >/dev/null <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fake-bank-service
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels: { app: fake-bank-service }
  template:
    metadata:
      labels: { app: fake-bank-service }
    spec:
      containers:
        - name: emisor
          image: busybox:1.37
          command: ['sh', '-c']
          args:
            - |
              while true; do
                echo '{"timestamp":"'\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'","level":"info","serviceName":"transaction-service","environment":"prod","version":"abc123","message":"transfer state changed","correlationId":"corr-obs-kind","traceId":"${TRACE_ID}","spanId":"${SPAN_ID}","fromState":"PENDING","toState":"DEBITED"}'
                echo 'esta linea NO es JSON y debe guardarse sin parsear'
                sleep 5
              done
          resources:
            requests: { cpu: 10m, memory: 16Mi }
YAML
  k rollout status deployment/fake-bank-service -n "$NS" --timeout 120s

  paso "5. Una traza OTLP con el MISMO traceId"
  # Se envia desde DENTRO del cluster. `kubectl port-forward` al Collector no
  # funciona: los receptores escuchan en `${env:MY_POD_IP}`, no en localhost, y
  # un port-forward entra por localhost. El trafico real llega por el Service,
  # que es lo que esto reproduce.
  python3 - "$TRACE_ID" "$SPAN_ID" > /tmp/obs-kind-trace.json <<'PY'
import json, sys, time
t, s = sys.argv[1], sys.argv[2]
now = int(time.time() * 1e9)
print(json.dumps({"resourceSpans": [{
    "resource": {"attributes": [
        {"key": "service.name", "value": {"stringValue": "transaction-service"}},
        {"key": "deployment.environment", "value": {"stringValue": "prod"}}]},
    "scopeSpans": [{"scope": {"name": "bank.saga"}, "spans": [{
        "traceId": t, "spanId": s, "name": "bank.transfer.state_changed", "kind": 1,
        "startTimeUnixNano": str(now), "endTimeUnixNano": str(now + 50_000_000),
        "attributes": [{"key": "bank.correlation_id",
                        "value": {"stringValue": "corr-obs-kind"}}]}]}]}]}))
PY
  k create configmap otlp-payload -n "$NS" \
    --from-file=trace.json=/tmp/obs-kind-trace.json \
    --dry-run=client -o yaml | k apply -f - >/dev/null

  k delete job otlp-sender -n "$NS" --ignore-not-found >/dev/null
  # El argumento del curl va como escalar de bloque (|) y no como elemento en
  # linea: lleva la cabecera Content-Type, con dos puntos, y YAML leeria el
  # elemento de la lista como un mapa — «cannot unmarshal object into ... args
  # of type string».
  #
  # Y este comentario vive AQUI, fuera del heredoc, porque dentro llevaba la
  # cabecera entre acentos graves y un heredoc sin comillas los trata como
  # sustitucion de comandos: bash intentaba ejecutar 'Content-Type:' y lo
  # decia en medio de la salida del script.
  k apply -f - >/dev/null <<YAML
apiVersion: batch/v1
kind: Job
metadata: { name: otlp-sender, namespace: ${NS} }
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      volumes:
        - name: payload
          configMap: { name: otlp-payload }
      containers:
        - name: curl
          image: curlimages/curl:8.11.1
          volumeMounts: [{ name: payload, mountPath: /payload }]
          command: ['sh', '-c']
          args:
            - |
              curl -sS -w 'HTTP %{http_code}\n' -X POST \
                http://otel-gateway:4318/v1/traces \
                -H 'Content-Type: application/json' \
                --data @/payload/trace.json
YAML
  k wait --for=condition=complete job/otlp-sender -n "$NS" --timeout 120s >/dev/null
  k logs -n "$NS" job/otlp-sender | sed 's/^/    /'

  echo "$TRACE_ID" > /tmp/obs-kind-trace-id.txt
  echo "    Esperando 20 s a que Loki y Tempo ingieran…"
  sleep 20
fi

# ---------------------------------------------------------------------------
# Verificacion. Corre dentro del cluster: los Service son nombres DNS internos.
# ---------------------------------------------------------------------------
paso "6. Verificacion"
TRACE_ID="$(cat /tmp/obs-kind-trace-id.txt 2>/dev/null || true)"
if [[ -z "$TRACE_ID" ]]; then
  echo "ERROR: no se de que traceId verificar. Corre el script sin --verify." >&2
  exit 2
fi

k delete job verificar-obs -n "$NS" --ignore-not-found >/dev/null
k apply -f - >/dev/null <<YAML
apiVersion: batch/v1
kind: Job
metadata: { name: verificar-obs, namespace: ${NS} }
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: curl
          image: curlimages/curl:8.11.1
          command: ['sh', '-c']
          args:
            - |
              T=${TRACE_ID}
              fin=\$(date +%s)000000000
              ini=\$(( \$(date +%s) - 86400 ))000000000
              fallos=0

              echo "1. Tempo tiene la traza"
              if curl -s "http://tempo:3200/api/traces/\$T" | grep -q 'bank.transfer.state_changed'; then
                echo "   OK"
              else
                echo "   FALLO: la traza no esta en Tempo"; fallos=\$((fallos+1))
              fi

              echo "2. Loki indexa SOLO las etiquetas de la lista cerrada"
              etiquetas=\$(curl -s -G 'http://loki:3100/loki/api/v1/labels' \\
                --data-urlencode "start=\$ini" --data-urlencode "end=\$fin")
              echo "   \$etiquetas"
              if echo "\$etiquetas" | grep -q 'k8s_pod_name\\|log_file_path\\|traceId'; then
                echo "   FALLO: hay etiquetas de alta cardinalidad en el indice"; fallos=\$((fallos+1))
              else
                echo "   OK"
              fi

              echo "3. El JSON del banco se parseo: filtrar por traceId encuentra la linea"
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode "query={service_name=\"fake-bank-service\"} | traceId=\"\$T\"" \\
                   --data-urlencode 'limit=1' | grep -q '"transfer state changed"'; then
                echo "   OK"
              else
                echo "   FALLO: transform/parse_bank_json no abrio el JSON"; fallos=\$((fallos+1))
              fi

              echo "4. correlationId tambien es consultable"
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode 'query={service_name="fake-bank-service"} | correlationId="corr-obs-kind"' \\
                   --data-urlencode 'limit=1' | grep -q '"totalEntriesReturned":[1-9]'; then
                echo "   OK"
              else
                echo "   FALLO: correlationId no es consultable"; fallos=\$((fallos+1))
              fi

              echo "5. La linea que NO es JSON se guardo igual"
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode 'query={service_name="fake-bank-service"} |= "NO es JSON"' \\
                   --data-urlencode 'limit=1' | grep -q 'guardarse sin parsear'; then
                echo "   OK"
              else
                echo "   FALLO: un log ilegible se perdio en vez de guardarse"; fallos=\$((fallos+1))
              fi

              echo "6. Prometheus raspa al Collector"
              if curl -s 'http://prometheus-server/api/v1/targets?state=active' | grep -q '"job":"otel-gateway"'; then
                echo "   OK"
              else
                echo "   FALLO: sin este objetivo ninguna metrica llega a un panel"; fallos=\$((fallos+1))
              fi

              echo "7. Grafana cargo los tres datasources y los derivedFields"
              ds=\$(curl -s -u "admin:${GRAFANA_PASS}" 'http://grafana/api/datasources')
              if echo "\$ds" | grep -q 'bank-prometheus' && echo "\$ds" | grep -q 'bank-loki' \\
                 && echo "\$ds" | grep -q 'bank-tempo' && echo "\$ds" | grep -q 'TraceID'; then
                echo "   OK"
              else
                echo "   FALLO: falta un datasource o el enlace log -> traza"; fallos=\$((fallos+1))
              fi

              echo
              if [ "\$fallos" -eq 0 ]; then
                echo "RESULTADO: 7 de 7. El stack mide lo que dice medir."
              else
                echo "RESULTADO: \$fallos comprobacion(es) fallaron."
                exit 1
              fi
YAML

if k wait --for=condition=complete job/verificar-obs -n "$NS" --timeout 180s >/dev/null 2>&1; then
  k logs -n "$NS" job/verificar-obs | sed 's/^/    /'
  rc=0
else
  k logs -n "$NS" job/verificar-obs 2>/dev/null | sed 's/^/    /' || true
  rc=1
fi

paso "Como mirarlo con los ojos"
cat <<FIN
    kubectl --context ${CTX} port-forward -n ${NS} svc/grafana 3000:80
    # http://localhost:3000 — admin / ${GRAFANA_PASS}
    # Explore > Loki > {service_name="fake-bank-service"} y abre una linea:
    # el boton "Ver la traza" salta a Tempo con el mismo traceId.

    Cuando termines, y recuerda que esto NO cuesta nada mientras exista:
      ./infra/scripts/cloud/obs-kind.sh --down
FIN

exit $rc
