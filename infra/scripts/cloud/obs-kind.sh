#!/usr/bin/env bash
#
# Valida el stack de observabilidad (T-49) en un kind desechable, gratis, y
# comprueba las dos cadenas que la rubrica califica: un log JSON del banco -> su
# traza, por el mismo traceId; y una metrica OTLP -> la serie de Prometheus con
# la que esta escrita cada consulta del catalogo (T-58).
#
#   ./infra/scripts/cloud/obs-kind.sh            # crear, desplegar y verificar
#   ./infra/scripts/cloud/obs-kind.sh --verify    # solo verificar lo ya desplegado
#   ./infra/scripts/cloud/obs-kind.sh --down      # borrar el cluster desechable
#
# POR QUE AQUI Y NO EN LA NUBE. Casi todo lo que puede romperse del stack es
# comportamiento de cluster, no de nube: que `transform/parse_bank_json` abra el
# JSON, que Loki lo indexe con DOS etiquetas y no con veinte, que `traceId` sea
# consultable sin ser etiqueta, que Tempo reciba la traza, que Prometheus raspe
# al Collector, que una metrica salga con el nombre que el catalogo promete y
# que Grafana cargue sus tres datasources. Nada de eso necesita GCP, y en GCP
# cuesta ~0.50 USD/hora averiguarlo.
#
# La comprobacion 8 existe por un defecto real: el exportador estuvo con
# `add_metric_suffixes: false`, asi que las series se llamaban
# `bank_transfer_finished` y toda consulta escrita en `docs/sre/` —todas con
# `_total` y `_seconds`— no devolvia nada. Las siete comprobaciones anteriores
# pasaban: ninguna preguntaba por el nombre de una serie.
#
# NO necesita el banco. Un pod de busybox que escribe el formato exacto de
# `@bank/observability` en stdout y una traza OTLP enviada por curl bastan para
# probar la correlacion. Levantar siete servicios y cinco bases de datos para
# comprobar un pipeline de telemetria es pagar por lo que no se esta midiendo.
#
# Usa su PROPIO cluster (`bank-obs-test`), no el `bank-usac` del flujo local,
# para no interferir con una sesion de desarrollo en curso.
#
# DESDE T-60 hace dos cosas mas, y las dos salieron de defectos que las once
# comprobaciones de abajo dejaban pasar:
#
#   - Ejecuta CADA consulta de los nueve dashboards (PromQL, LogQL, TraceQL,
#     variables y anotaciones) contra el stack y falla si alguna sale vacia
#     (`check-dashboards.sh --live`). Para eso los productores falsos emiten una
#     de cada metrica del catalogo (`obs-kind-payloads.py`), logs de cuatro
#     servicios, un RabbitMQ de mentira que publica el consumer lag y un HPA:
#     un panel vacio por falta de productor no se distinguiria de uno roto.
#     Los productores viven en el namespace `prod`, porque es el que los
#     paneles de plataforma filtran.
#   - Manda un span y una linea de log con `?token=abc123` (y un JWT, un
#     Bearer y un correo) y comprueba que ni Tempo ni Loki guardan `abc123`,
#     y que SI guardaron el span y la linea que lo llevaban.
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
# Donde viven los productores falsos: el namespace que los paneles filtran.
NS_BANCO=prod
# El secreto de la prueba de redaccion, y la marca que permite encontrar la
# linea y el span que lo llevaban. Tampoco son secretos: son el cebo.
SECRETO=abc123
MARCA=obs-kind-redaccion
PAYLOADS="${SCRIPT_DIR}/obs-kind-payloads.py"

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

# Manda al Collector la traza ya generada y UNA metrica de cada fila del
# catalogo. Es una funcion y no un paso en linea porque `--verify` tambien
# tiene que llamarla: el exportador de Prometheus del Collector olvida una serie
# que no se vuelve a reportar (`metric_expiration`, cinco minutos por defecto),
# asi que verificar sin volver a empujar daria un falso rojo — y un falso rojo
# en la prueba que vigila los nombres es peor que no tenerla.
enviar_otlp() {
  # DOS instantaneas y no una, con los contadores subiendo entre ellas.
  #
  # `rate()` necesita pendiente: un unico empujon deja el contador constante,
  # `rate` vale 0 y todas las reglas de grabacion de T-50 salen NaN. Con un
  # valor que crece, la regla produce un numero y la comprobacion 10 puede
  # exigir que lo produzca — que es la diferencia entre «la regla esta cargada»
  # y «la regla calcula».
  #
  # Que metricas, con que etiquetas y por que: la cabecera de
  # `obs-kind-payloads.py`. Hablan como el codigo, no como los paneles.
  for n in 1 2; do
    python3 "$PAYLOADS" metrics "$n" > "/tmp/obs-kind-metrics-$n.json"
  done

  k create configmap otlp-payload -n "$NS" \
    --from-file=trace.json=/tmp/obs-kind-trace.json \
    --from-file=metrics-1.json=/tmp/obs-kind-metrics-1.json \
    --from-file=metrics-2.json=/tmp/obs-kind-metrics-2.json \
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
              curl -sS -w 'HTTP %{http_code}\n' -X POST \
                http://otel-gateway:4318/v1/metrics \
                -H 'Content-Type: application/json' \
                --data @/payload/metrics-1.json
              sleep 20
              curl -sS -w 'HTTP %{http_code}\n' -X POST \
                http://otel-gateway:4318/v1/metrics \
                -H 'Content-Type: application/json' \
                --data @/payload/metrics-2.json
YAML
  k wait --for=condition=complete job/otlp-sender -n "$NS" --timeout 180s >/dev/null
  k logs -n "$NS" job/otlp-sender | sed 's/^/    /'
}

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

  paso "2. Namespaces y Secrets de Grafana"
  k create namespace "$NS" --dry-run=client -o yaml | k apply -f -
  k create namespace "$NS_BANCO" --dry-run=client -o yaml | k apply -f -
  # El del webhook de alertas, como lo crea el pipeline (T-60, A3): sin el,
  # Grafana arranca igual y el contact point manda un Bearer vacio.
  k create secret generic grafana-alert-webhook --namespace "$NS" \
    --from-literal=token=kind-token-de-prueba-de-32-caracteres \
    --dry-run=client -o yaml | k apply -f -
  k create secret generic grafana-admin --namespace "$NS" \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$GRAFANA_PASS" \
    --dry-run=client -o yaml | k apply -f -

  paso "3. Desplegar el stack"
  "${REPO_ROOT}/infra/k8s/scripts/check-chart-deps.sh" "$CHART"
  helm --kube-context "$CTX" upgrade bank-observability "$CHART" \
    --install --namespace "$NS" --wait --timeout 15m >/dev/null
  k get pods -n "$NS"

  paso "4. Un banco falso en ${NS_BANCO}, con un traceId conocido"
  TRACE_ID="$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
  SPAN_ID="$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
  TRACE_REDACCION="$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
  echo "    traceId = ${TRACE_ID}   (redaccion: ${TRACE_REDACCION})"

  # Lo de un intento anterior en `observability`, de antes de T-60.
  k delete deployment fake-bank-service -n "$NS" --ignore-not-found >/dev/null

  # El formato es el de `@bank/observability` (apps/packages/observability/src/logger.ts):
  # timestamp, level, serviceName, environment, version, message, correlationId,
  # traceId, spanId y los campos propios del componente.
  #
  # UN CONTENEDOR POR SERVICIO, y no uno que escriba por los cuatro: el agente
  # fija `service.name` en el RECURSO, y todas las lineas de un mismo archivo de
  # log comparten recurso. Con un solo contenedor, la ultima linea del lote
  # renombraba a las demas y las cuatro salian como `gateway` (medido en la
  # primera corrida de T-60). Un pod real del banco es un servicio por
  # contenedor, que es lo que esto reproduce.
  #
  # Cuatro servicios porque cuatro paneles de logs los nombran: el de errores
  # (`level="error"`), el del banco pareja (`payment-service` con «interbank»),
  # el de logs por servicio y el de redaccion. La linea del gateway con
  # `?token=` es el cebo de la prueba 13: el agente la tiene que guardar, pero
  # sin el secreto.
  #
  # La ultima linea NO es JSON a proposito: comprueba que el guardia
  # `where IsMatch(body, "^\\s*\\{")` del procesador deja pasar sin parsear lo
  # que no entiende, en vez de descartarlo. Un log que el recolector no entiende
  # sigue siendo evidencia.
  k apply -f - >/dev/null <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fake-bank-service
  namespace: ${NS_BANCO}
spec:
  replicas: 1
  selector:
    matchLabels: { app: fake-bank-service }
  template:
    metadata:
      labels: { app: fake-bank-service }
    spec:
      containers:
        - name: transaction-service
          image: busybox:1.37
          command: ['sh', '-c']
          args:
            - |
              while true; do
                t=\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
                echo '{"timestamp":"'\$t'","level":"info","serviceName":"transaction-service","environment":"prod","version":"1.0.0-obs-kind","message":"transfer state changed","correlationId":"corr-obs-kind","traceId":"${TRACE_ID}","spanId":"${SPAN_ID}","fromState":"PENDING","toState":"DEBITED"}'
                echo 'esta linea NO es JSON y debe guardarse sin parsear'
                sleep 5
              done
          resources:
            requests: { cpu: 5m, memory: 8Mi }
        - name: payment-service
          image: busybox:1.37
          command: ['sh', '-c']
          args:
            - |
              while true; do
                t=\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
                echo '{"timestamp":"'\$t'","level":"info","serviceName":"payment-service","environment":"prod","version":"1.0.0-obs-kind","message":"interbank deposit state changed","correlationId":"corr-obs-kind","status":"ACCEPTED"}'
                sleep 5
              done
          resources:
            requests: { cpu: 5m, memory: 8Mi }
        - name: account-service
          image: busybox:1.37
          command: ['sh', '-c']
          args:
            - |
              while true; do
                t=\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
                echo '{"timestamp":"'\$t'","level":"error","serviceName":"account-service","environment":"prod","version":"1.0.0-obs-kind","message":"debit refused","correlationId":"corr-obs-kind","stage":"debit"}'
                sleep 5
              done
          resources:
            requests: { cpu: 5m, memory: 8Mi }
        - name: gateway
          image: busybox:1.37
          command: ['sh', '-c']
          args:
            - |
              while true; do
                t=\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
                echo '{"timestamp":"'\$t'","level":"warn","serviceName":"gateway","environment":"prod","version":"1.0.0-obs-kind","message":"${MARCA} GET /api/customers/verify-email?token=${SECRETO}","deliveryLink":"https://bank.example/activar?token=${SECRETO}&next=/","authorization":"Bearer ${SECRETO}${SECRETO}${SECRETO}","contact":"cliente.${SECRETO}@example.com"}'
                sleep 5
              done
          resources:
            requests: { cpu: 5m, memory: 8Mi }
---
# Un HPA de verdad sobre el Deployment falso: kube-state-metrics publica
# kube_horizontalpodautoscaler_* en cuanto el objeto existe, aunque kind no
# tenga metrics-server para decidir nada. Es lo que el dashboard 06 grafica.
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: fake-bank-service
  namespace: ${NS_BANCO}
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: fake-bank-service }
  minReplicas: 1
  maxReplicas: 2
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 80 } }
---
# Un RabbitMQ de mentira: sólo su endpoint de métricas, en el nombre y el
# puerto que raspan los jobs rabbitmq y rabbitmq-detailed del chart. Python
# y no busybox httpd porque Prometheus 3 rechaza una respuesta sin un
# Content-Type de texto de Prometheus, y httpd no deja ponerlo a un archivo sin
# extensión.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rabbitmq
  namespace: ${NS_BANCO}
spec:
  replicas: 1
  selector:
    matchLabels: { app: fake-rabbitmq }
  template:
    metadata:
      labels: { app: fake-rabbitmq }
    spec:
      containers:
        - name: metricas
          image: python:3.13-alpine
          command: ['python3', '-c']
          args:
            - |
              import http.server
              CUERPO = (
                  "# TYPE rabbitmq_detailed_queue_messages_ready gauge\n"
                  'rabbitmq_detailed_queue_messages_ready{vhost="/",queue="audit.transaction"} 7\n'
                  'rabbitmq_detailed_queue_messages_ready{vhost="/",queue="payment.commands"} 2\n'
                  "# TYPE rabbitmq_detailed_queue_messages_unacked gauge\n"
                  'rabbitmq_detailed_queue_messages_unacked{vhost="/",queue="audit.transaction"} 1\n'
                  'rabbitmq_detailed_queue_messages_unacked{vhost="/",queue="payment.commands"} 0\n'
              ).encode()
              class H(http.server.BaseHTTPRequestHandler):
                  def do_GET(self):
                      self.send_response(200)
                      self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                      self.end_headers()
                      self.wfile.write(CUERPO)
                  def log_message(self, *a):
                      pass
              http.server.HTTPServer(("0.0.0.0", 15692), H).serve_forever()
          ports: [{ containerPort: 15692 }]
          resources:
            requests: { cpu: 10m, memory: 32Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq
  namespace: ${NS_BANCO}
spec:
  selector: { app: fake-rabbitmq }
  ports: [{ name: prometheus, port: 15692, targetPort: 15692 }]
YAML
  k rollout status deployment/fake-bank-service -n "$NS_BANCO" --timeout 120s
  k rollout status deployment/rabbitmq -n "$NS_BANCO" --timeout 180s

  paso "5. Una traza OTLP con el MISMO traceId"
  # Se envia desde DENTRO del cluster. `kubectl port-forward` al Collector no
  # funciona: los receptores escuchan en `${env:MY_POD_IP}`, no en localhost, y
  # un port-forward entra por localhost. El trafico real llega por el Service,
  # que es lo que esto reproduce.
  # La traza de la Saga (los tres nombres de span que buscan los paneles de
  # Tempo del dashboard 04) y, en otra traza, el span con secretos de la
  # prueba de redaccion.
  python3 "$PAYLOADS" traces "$TRACE_ID" "$SPAN_ID" "$TRACE_REDACCION" "$SECRETO" "$MARCA" \
    > /tmp/obs-kind-trace.json
  enviar_otlp

  echo "$TRACE_ID" > /tmp/obs-kind-trace-id.txt
  echo "$TRACE_REDACCION" > /tmp/obs-kind-trace-redaccion.txt
  echo "    Esperando 45 s a que Loki y Tempo ingieran y Prometheus raspe las dos instantaneas…"
  sleep 45
fi

# ---------------------------------------------------------------------------
# Verificacion. Corre dentro del cluster: los Service son nombres DNS internos.
# ---------------------------------------------------------------------------
paso "6. Verificacion"
TRACE_ID="$(cat /tmp/obs-kind-trace-id.txt 2>/dev/null || true)"
TRACE_REDACCION="$(cat /tmp/obs-kind-trace-redaccion.txt 2>/dev/null || true)"
if [[ -z "$TRACE_ID" ]]; then
  echo "ERROR: no se de que traceId verificar. Corre el script sin --verify." >&2
  exit 2
fi

if [[ "$accion" == "verificar" ]]; then
  if [[ ! -f /tmp/obs-kind-metrics-1.json && ! -f /tmp/obs-kind-trace.json ]]; then
    echo "ERROR: faltan los payloads en /tmp. Corre el script sin --verify." >&2
    exit 2
  fi
  # Un ReplicaSet nuevo, para que la anotacion de despliegues (que marca los
  # ReplicaSets creados en los ultimos tres minutos) tenga que encontrar algo.
  k rollout restart deployment/fake-bank-service -n "$NS_BANCO" >/dev/null
  k rollout status deployment/fake-bank-service -n "$NS_BANCO" --timeout 120s >/dev/null
  echo "    Reenviando la telemetria (las series expiran) y esperando los raspados…"
  enviar_otlp
  sleep 45
fi

k delete job verificar-obs -n "$NS" --ignore-not-found >/dev/null
# SIN acentos graves en los comentarios del heredoc de abajo (T-60): es un
# heredoc sin comillas, y bash los ejecutaba como sustitucion de comandos. Un
# `rate()` citado asi era una definicion de funcion a medias y rompia el resto
# de la sustitucion con «unexpected end of file» en cada corrida.
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
              # El stream se llama "transaction-service" y no "fake-bank-service"
              # A PROPOSITO: "transform/parse_bank_json" toma "service.name" del
              # campo "serviceName" de la propia linea (values.yaml), no de la
              # etiqueta del pod, porque en el chart "bank-usac" los siete
              # componentes comparten "app.kubernetes.io/name" y colapsaban en
              # una sola etiqueta. El Deployment de prueba se llama
              # "fake-bank-service"; lo que el log dice ser es
              # "transaction-service", y Loki hace bien en creerle al log.
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode "query={service_name=\"transaction-service\"} | traceId=\"\$T\"" \\
                   --data-urlencode 'limit=1' | grep -q '"transfer state changed"'; then
                echo "   OK"
              else
                echo "   FALLO: transform/parse_bank_json no abrio el JSON"; fallos=\$((fallos+1))
              fi

              echo "4. correlationId tambien es consultable"
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode 'query={service_name="transaction-service"} | correlationId="corr-obs-kind"' \\
                   --data-urlencode 'limit=1' | grep -q '"totalEntriesReturned":[1-9]'; then
                echo "   OK"
              else
                echo "   FALLO: correlationId no es consultable"; fallos=\$((fallos+1))
              fi

              echo "5. La linea que NO es JSON se guardo igual"
              # Se busca por namespace y no por servicio: una linea que no es
              # JSON no tiene campo "serviceName", asi que no puede nombrarse a
              # si misma y su stream queda con lo que derivo el agente. Que se
              # guarde es justo lo que se esta comprobando.
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode 'query={k8s_namespace_name="${NS_BANCO}"} |= "NO es JSON"' \\
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

              echo "8. Prometheus tiene las series con el nombre del catalogo"
              # Reintenta: el job otel-gateway se raspa cada 15 s y la metrica
              # acaba de llegar. Sin esperar, esto fallaria por carrera y no por
              # configuracion, que es la peor clase de rojo.
              serie_contador=""
              serie_histograma=""
              intento=0
              while [ "\$intento" -lt 12 ]; do
                serie_contador=\$(curl -s -G 'http://prometheus-server/api/v1/query' \\
                  --data-urlencode 'query=bank_transfer_finished_total')
                serie_histograma=\$(curl -s -G 'http://prometheus-server/api/v1/query' \\
                  --data-urlencode 'query=bank_transfer_duration_seconds_bucket')
                if echo "\$serie_contador" | grep -q '"value"' && \\
                   echo "\$serie_histograma" | grep -q '"value"'; then
                  break
                fi
                intento=\$((intento+1))
                sleep 5
              done

              if echo "\$serie_contador" | grep -q '"value"'; then
                echo "   OK  bank_transfer_finished_total"
              else
                echo "   FALLO: el contador no existe con _total. Revisa add_metric_suffixes"
                fallos=\$((fallos+1))
              fi
              if echo "\$serie_histograma" | grep -q '"value"'; then
                echo "   OK  bank_transfer_duration_seconds_bucket"
              else
                echo "   FALLO: el histograma no existe con _seconds. Revisa add_metric_suffixes"
                fallos=\$((fallos+1))
              fi

              echo "9. Las dos etiquetas del catalogo estan, y ninguna mas"
              if echo "\$serie_contador" | grep -q '"service_name":"transaction-service"' && \\
                 echo "\$serie_contador" | grep -q '"environment":"prod"'; then
                echo "   OK  service_name y environment"
              else
                echo "   FALLO: falta service_name o environment en la serie"
                fallos=\$((fallos+1))
              fi
              if echo "\$serie_contador" | grep -q 'k8s_pod_name'; then
                echo "   FALLO: un atributo de recurso de alta cardinalidad se volvio etiqueta"
                fallos=\$((fallos+1))
              else
                echo "   OK  k8s_pod_name NO es etiqueta"
              fi

              echo "10. Las reglas de grabacion de T-50 cargan y sus selectores RESUELVEN"
              reglas=\$(curl -s 'http://prometheus-server/api/v1/rules' | tr ',' '\\n' | grep -c '"name":"slo:\\|"name":"sli:')
              echo "   \$reglas reglas de grabacion cargadas"
              if [ "\$reglas" -ge 30 ]; then
                echo "   OK  cargadas"
              else
                echo "   FALLO: faltan reglas de grabacion"; fallos=\$((fallos+1))
              fi

              # Lo que se comprueba es que el SELECTOR devuelve serie, no que el
              # cociente valga un numero concreto: con dos muestras sinteticas
              # "rate()" apenas tiene pendiente y el ratio sale NaN sin que nada
              # este roto. Un ratio de verdad necesita carga sostenida, y eso es
              # T-51 contra el entorno de T-54.
              #
              # Y el selector es exactamente lo que se rompio: con "le="5""
              # —el valor que el Collector muestra en su texto— esta consulta
              # devolvia VACIO, porque Prometheus guarda "le="5.0"". Un panel
              # de SLO-2 en blanco para siempre, sin un solo error.
              bucket=\$(curl -s -G 'http://prometheus-server/api/v1/query' \\
                --data-urlencode 'query=sum(rate(bank_transfer_duration_seconds_bucket{le=~"5(\\\\.0+)?"}[5m]))' \\
                | grep -o '"value":\\[[^]]*\\]' | head -1)
              echo "   numerador de SLO-2 (le ~ 5) -> \${bucket:-VACIO}"
              if [ -n "\$bucket" ]; then
                echo "   OK  el selector del bucket resuelve"
              else
                echo "   FALLO: el selector del bucket no devuelve serie. Revisa la etiqueta le"
                fallos=\$((fallos+1))
              fi

              grabada=\$(curl -s -G 'http://prometheus-server/api/v1/query' \\
                --data-urlencode 'query=slo:transfer_under_5s:ratio_rate5m' \\
                | grep -o '"value":\\[[^]]*\\]' | head -1)
              echo "   slo:transfer_under_5s:ratio_rate5m -> \${grabada:-SIN SERIE}"
              if [ -n "\$grabada" ]; then
                echo "   OK  la regla produce serie (su valor exige carga real)"
              else
                echo "   FALLO: la regla no produce serie"; fallos=\$((fallos+1))
              fi

              echo "11. El entorno es ETIQUETA de Loki (deployment_environment), no metadato"
              # Lo que rompio los tres dashboards de logs (T-60): el agente no
              # ponia "deployment.environment" y los paneles filtraban por una
              # etiqueta que no existia.
              if curl -s -G 'http://loki:3100/loki/api/v1/query_range' \\
                   --data-urlencode 'query={deployment_environment="prod", service_name="transaction-service"}' \\
                   --data-urlencode 'limit=1' | grep -q '"totalEntriesReturned":[1-9]'; then
                echo "   OK"
              else
                echo "   FALLO: el agente de logs no fija deployment.environment"; fallos=\$((fallos+1))
              fi

              echo
              if [ "\$fallos" -eq 0 ]; then
                echo "RESULTADO: 11 de 11. El stack mide lo que dice medir."
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

# ---------------------------------------------------------------------------
# 7. Cada consulta de los nueve dashboards, ejecutada (T-60).
#
# Desde el HOST y no desde un Job: son cien consultas con su URL-encoding y su
# JSON, y eso es Python, no curl en un heredoc. Prometheus, Loki, Tempo y
# Grafana escuchan en 0.0.0.0, asi que un port-forward si les llega (al
# Collector no: ver su comentario en values.yaml).
# ---------------------------------------------------------------------------
paso "7. Cada consulta de los dashboards devuelve datos, y el secreto no se guardo"
P_PROM="${OBS_KIND_PORT_PROM:-19090}"
P_LOKI="${OBS_KIND_PORT_LOKI:-13100}"
P_TEMPO="${OBS_KIND_PORT_TEMPO:-13200}"
P_GRAFANA="${OBS_KIND_PORT_GRAFANA:-13000}"
FORWARDS=""
cerrar_forwards() { [ -n "$FORWARDS" ] && kill $FORWARDS 2>/dev/null || true; }
trap cerrar_forwards EXIT
for par in "prometheus-server ${P_PROM}:80" "loki ${P_LOKI}:3100" "tempo ${P_TEMPO}:3200" "grafana ${P_GRAFANA}:80"; do
  set -- $par
  k port-forward -n "$NS" "svc/$1" "$2" >/dev/null 2>&1 &
  FORWARDS="$FORWARDS $!"
done
sleep 5
if "${REPO_ROOT}/infra/k8s/scripts/check-dashboards.sh" --live \
     --prometheus "http://127.0.0.1:${P_PROM}" \
     --loki "http://127.0.0.1:${P_LOKI}" \
     --tempo "http://127.0.0.1:${P_TEMPO}" \
     --grafana "http://127.0.0.1:${P_GRAFANA}" --grafana-auth "admin:${GRAFANA_PASS}" \
     --environment prod \
     --redaction-secret "$SECRETO" --redaction-marker "$MARCA" --redaction-namespace "$NS_BANCO" \
     ${TRACE_REDACCION:+--redaction-trace-id "$TRACE_REDACCION"} 2>&1 | sed 's/^/    /'; then
  :
else
  # `pipefail` (arriba) hace que la tuberia falle si falla el chequeo y no
  # solo si falla `sed`: sin el, esto daria verde siempre.
  rc=1
fi
cerrar_forwards

paso "Como mirarlo con los ojos"
cat <<FIN
    kubectl --context ${CTX} port-forward -n ${NS} svc/grafana 3000:80
    # http://localhost:3000 — admin / ${GRAFANA_PASS}
    # Explore > Loki > {service_name="transaction-service"} y abre una linea:
    # el boton "Ver la traza" salta a Tempo con el mismo traceId.

    Cuando termines, y recuerda que esto NO cuesta nada mientras exista:
      ./infra/scripts/cloud/obs-kind.sh --down
FIN

exit $rc
