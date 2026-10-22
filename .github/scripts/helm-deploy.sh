#!/usr/bin/env bash
#
# El `helm upgrade --install` que ejecutan los dos jobs de cd.yml.
#
# Existe como script y no como un bloque `run:` porque dev y produccion
# despliegan EL MISMO chart con los mismos veintiocho `--set`: la unica
# diferencia entre ambos es el namespace, el nombre del release y la etiqueta de
# imagen. Duplicar eso en dos jobs del workflow es como se llega a un entorno
# que diverge del otro sin que nadie lo decida.
#
# Es el equivalente en CI de `infra/k8s/scripts/install.sh`, que hace lo mismo
# para el cluster kind local. Aquel descubre las IPs de la infraestructura en
# Docker; este recibe todo por variables de entorno, porque en la nube la
# infraestructura ya tiene direcciones estables (las VMs de Terraform).
#
# Variables requeridas:
#   NAMESPACE        namespace de destino (dev | prod)
#   RELEASE_NAME     nombre del release de Helm
#   IMAGE_TAG        etiqueta versionada de las imagenes (nunca `latest`)
#   IMAGE_REGISTRY   prefijo del registry, sin el nombre del componente
#   HELM_SECRETS     lineas `clave=valor` con los secrets.* que pide el chart
#   INFRA_ADDRESSES  lineas `clave=valor` con las direcciones de la
#                    infraestructura que vive FUERA del cluster: las VMs de
#                    PostgreSQL de Terraform, RabbitMQ y MinIO. El chart las
#                    exige (`external.*.dockerNetwork.host`) y falla el render
#                    si faltan, que es preferible a desplegar siete pods que no
#                    pueden alcanzar su base de datos.
#   OTEL_EXPORTER_OTLP_ENDPOINT  opcional — el Collector al que los seis
#                    componentes instrumentados envian trazas y metricas (T-49). Vacio, el SDK
#                    registra igual y no exporta. `observability.environment`
#                    no se pide: es el namespace, para que la telemetria de dev
#                    y la de prod nunca se confundan en el mismo Grafana (T-48).
#   UPDATED_COMPONENTS  opcional — los componentes que cambiaron, separados por
#                    espacios. Solo esos reciben la etiqueta nueva; el resto
#                    conserva la suya. Sin definir, todos se actualizan.
#   GATEWAY_PUBLIC_URL  la direccion del Gateway tal como la alcanza el
#                    NAVEGADOR de una persona, no un nombre de Service interno.
#                    El chart la tiene por defecto en `http://localhost:3000`,
#                    que es correcto para kind con port-forward y silenciosamente
#                    inservible en GKE: el despliegue tendria exito y entregaria
#                    un frontend que no puede hablar con su backend. Se exige
#                    aqui para que ese caso no exista.
#
# Variable opcional:
#   GATEWAY_STATIC_IP  la IP reservada por Terraform
#                    (`terraform output -raw gateway_public_ip`). El chart pone
#                    el Service del Gateway en LoadBalancer por defecto; esto
#                    fija ADEMAS la direccion, para que la entrada publica del
#                    banco sobreviva a que se borre el Service o se reinstale
#                    el release (TD-080). Solo produccion la define: el
#                    acuerdo de integracion con el banco pareja lleva esa
#                    direccion escrita, y una IP que cambia rompe el acuerdo.
#                    Sin ella, el proveedor asigna una efimera.
#
# Variable opcional:
#   IN_CLUSTER_BROKER  `true` levanta RabbitMQ DENTRO del namespace en vez de
#                    apuntar a la VM. Es lo que separa de verdad a `dev` de
#                    `prod`: con el broker compartido, los consumidores de
#                    desarrollo compiten por las MISMAS colas durables que
#                    produccion y se llevan sus mensajes. Produccion lo deja sin
#                    definir y sigue usando la infraestructura de Terraform.
#
#   IN_CLUSTER_OBJECT_STORAGE  lo mismo para MinIO.
#
# Las dos son redundantes hoy: `HELM_SECRETS`/`INFRA_ADDRESSES` ya traen
# `rabbitmq.inCluster=true` y `minio.inCluster=true`, asi que los dos entornos
# levantan su broker y su almacenamiento dentro de su propio namespace desde
# antes de que estas variables existieran. Se dejan porque hacen explicito en el
# workflow algo que hoy solo se sabe leyendo un secreto.
#
#   DATABASE_SUFFIX  sufijo para el nombre de las cinco bases (`_dev`). Vacio
#                    en produccion. Las bases con sufijo tienen que existir ya;
#                    los servicios migran, pero no crean la base.
#
#   ZERO_DOWNTIME_PROBE_URL  si esta definida, se sondea durante la
#                    actualizacion para medir si hubo caida.
#
#   ALERT_WEBHOOK_TOKEN  el secreto compartido del webhook de alertas (T-60).
#                    Si esta, gana sobre `secrets.alertWebhookToken` de
#                    HELM_SECRETS; es el mismo valor que el job
#                    `deploy-observability` pone en el Secret de Grafana.
#
#   WEB_PUBLIC_URL   el origen desde el que el navegador carga el frontend, para
#                    `gateway.corsAllowedOrigins`. Opcional y sin valor por
#                    defecto derivado a proposito: es el origen del *frontend*,
#                    no el del Gateway, y adivinarlo mal abre CORS a la lista
#                    equivocada sin que nadie lo note hasta que una peticion
#                    legitima sea rechazada.
#
set -euo pipefail

: "${NAMESPACE:?NAMESPACE no definido}"
: "${RELEASE_NAME:?RELEASE_NAME no definido}"
: "${IMAGE_TAG:?IMAGE_TAG no definido}"
: "${IMAGE_REGISTRY:?IMAGE_REGISTRY no definido}"
: "${GATEWAY_PUBLIC_URL:?GATEWAY_PUBLIC_URL no definido — sin el, el frontend se despliega apuntando a localhost}"

CHART_PATH="${CHART_PATH:-infra/k8s/helm/bank-usac}"

# `latest` esta prohibido por el enunciado. Se comprueba aqui y no en el
# workflow para que valga igual si alguien ejecuta este script a mano.
if [ "$IMAGE_TAG" = "latest" ]; then
  echo "::error::IMAGE_TAG no puede ser 'latest' — el enunciado exige imagenes versionadas."
  exit 1
fi

echo "Desplegando ${RELEASE_NAME} en el namespace ${NAMESPACE} con la etiqueta ${IMAGE_TAG}"

# Los secrets del chart llegan como lineas `clave=valor` en una sola variable,
# porque son once y crear once secrets de GitHub para un solo consumidor es
# repartir el mismo problema en once sitios. Se leen a un arreglo para que
# ningun valor pase por `eval` ni por una expansion de palabras.
#
# Se usa para dos cosas con la misma forma — los secrets y las direcciones de la
# infraestructura externa — asi que la lectura vive en una funcion.
read_set_lines() { # read_set_lines <contenido>; deja el resultado en SET_LINES
  SET_LINES=()
  local line
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"   # recorta espacios iniciales
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac     # permite comentarios
    SET_LINES+=(--set-string "$line")
  done <<< "$1"
}

read_set_lines "${HELM_SECRETS:-}"
declare -a SECRET_ARGS=("${SET_LINES[@]}")

if [ ${#SECRET_ARGS[@]} -eq 0 ]; then
  echo "::error::HELM_SECRETS vacio. templates/secret.yaml marca esos valores como 'required' y helm fallaria con un error mucho menos claro."
  exit 1
fi

# El token del webhook de alertas (T-60, A3), con UNA fuente.
#
# Grafana (namespace `observability`) y el Gateway de cada entorno tienen que
# tener el MISMO valor: Grafana lo manda como `Bearer` y el Gateway lo compara.
# Antes eran dos: el Gateway lo leia de una linea de HELM_SECRETS y Grafana de
# un Secret que se creaba a mano (`docs/operations/CLOUD.md`). Dos copias de un
# secreto divergen, y cuando divergen el Gateway responde 401 y la alerta no
# llega a la bitacora sin que nada falle.
#
# Ahora las dos mitades leen el secreto de GitHub `ALERT_WEBHOOK_TOKEN`: el job
# `deploy-observability` crea con el el Secret de Grafana, y este script lo
# pasa al chart del banco DESPUES de HELM_SECRETS, de modo que gana sobre una
# linea vieja que siguiera ahi. Sin la variable, se conserva el comportamiento
# anterior (lo que traiga HELM_SECRETS) con un aviso.
declare -a ALERT_ARGS=()
if [ -n "${ALERT_WEBHOOK_TOKEN:-}" ]; then
  # El Gateway se niega a arrancar con un token de menos de 32 caracteres; es
  # mejor decirlo aqui que en un CrashLoopBackOff.
  if [ "${#ALERT_WEBHOOK_TOKEN}" -lt 32 ]; then
    echo "::error::ALERT_WEBHOOK_TOKEN tiene ${#ALERT_WEBHOOK_TOKEN} caracteres. El Gateway exige al menos 32 y no arrancaria."
    exit 1
  fi
  if grep -q '^[[:space:]]*secrets\.alertWebhookToken=' <<<"${HELM_SECRETS:-}"; then
    echo "::warning::HELM_SECRETS todavia trae secrets.alertWebhookToken; se ignora en favor del secreto ALERT_WEBHOOK_TOKEN. Conviene quitar esa linea para que haya una sola fuente."
  fi
  ALERT_ARGS+=(--set-string "secrets.alertWebhookToken=${ALERT_WEBHOOK_TOKEN}")
  echo "Token del webhook de alertas: desde el secreto ALERT_WEBHOOK_TOKEN (el mismo que recibe Grafana)."
else
  echo "::warning::Sin ALERT_WEBHOOK_TOKEN: el Gateway usa lo que traiga HELM_SECRETS. Si no coincide con el Secret grafana-alert-webhook, las alertas de Grafana reciben 401 y no llegan a la bitacora."
fi

# El correo real de activacion (Resend). Sin esto el chart queda en `simulated`:
# el servicio registra el envio y no manda nada, y como en la nube el enlace de
# activacion sale enmascarado en el log (REVEAL_ACTIVATION_LINKS=false), un
# cliente nuevo no tiene forma de activarse. Hasta el 2026-10-20 solo los
# compose locales leian Resend (de infra/docker/.env); la nube nunca lo recibio.
#
# NOTIFICATION_CHANNEL=resend exige los tres valores: la clave (secreto), el
# remitente en un dominio verificado y el origen publico del frontend para que
# el enlace del correo sea absoluto. Faltando uno, se falla aqui con su nombre
# en vez de dejar que el chart lo diga en un render.
declare -a MAIL_ARGS=()
if [ "${NOTIFICATION_CHANNEL:-simulated}" = "resend" ]; then
  faltan=()
  [ -n "${RESEND_API_KEY:-}" ] || faltan+=("secreto RESEND_API_KEY")
  [ -n "${EMAIL_FROM:-}" ] || faltan+=("variable EMAIL_FROM")
  [ -n "${APP_BASE_URL:-}" ] || faltan+=("variable WEB_PUBLIC_URL (APP_BASE_URL)")
  if [ ${#faltan[@]} -gt 0 ]; then
    echo "::error::NOTIFICATION_CHANNEL=resend pero faltan: ${faltan[*]}."
    exit 1
  fi
  MAIL_ARGS+=(
    --set-string "services.notificationAudit.notificationChannel=resend"
    --set-string "secrets.resendApiKey=${RESEND_API_KEY}"
    --set-string "services.notificationAudit.resend.emailFrom=${EMAIL_FROM}"
    --set-string "services.notificationAudit.resend.appBaseUrl=${APP_BASE_URL%/}"
  )
  echo "Correo de activacion: Resend, remitente ${EMAIL_FROM}, enlaces a ${APP_BASE_URL%/}."
else
  echo "Correo de activacion: canal simulado (no se envia nada)."
fi

read_set_lines "${INFRA_ADDRESSES:-}"
declare -a INFRA_ARGS=("${SET_LINES[@]}")

if [ ${#INFRA_ARGS[@]} -eq 0 ]; then
  echo "::error::INFRA_ADDRESSES vacio. El chart necesita saber donde estan las cinco VMs de PostgreSQL, RabbitMQ y MinIO — las IPs las da 'terraform output' en infra/terraform/gcp/."
  exit 1
fi

# Los siete componentes, con el nombre que usan tanto el registry como el chart.
# El chart trata `image.repository` como la ruta completa de la imagen, asi que
# apuntarlo al registry es todo lo que hace falta para que GKE la encuentre.
#
# `UPDATED_COMPONENTS` es lo que hace SELECTIVO al despliegue y no solo a la
# construccion. Cuando esta definido, solo esos componentes reciben la etiqueta
# nueva; los demas conservan exactamente la que ya tenian en el release, leida
# de `helm get values`. Sin esa lectura, no pasar el valor haria que helm
# cayera al `tag: dev` por defecto del chart — una etiqueta que no existe en el
# registry — y el despliegue "selectivo" acabaria rompiendo los seis servicios
# que nadie toco.
#
# En la primera instalacion no hay release del que leer, asi que todos reciben
# la etiqueta nueva.
RELEASE_EXISTE=false
if helm status "$RELEASE_NAME" --namespace "$NAMESPACE" >/dev/null 2>&1; then
  RELEASE_EXISTE=true
  VALORES_ACTUALES="$(helm get values "$RELEASE_NAME" --namespace "$NAMESPACE" -o json 2>/dev/null || echo '{}')"
fi

etiqueta_previa() { # etiqueta_previa <ruta en values, ej: services.customer>
  [ "$RELEASE_EXISTE" = true ] || { echo ""; return; }
  echo "$VALORES_ACTUALES" | jq -r --arg p "$1" '
    ($p | split(".")) as $ruta
    | getpath($ruta + ["image","tag"]) // ""
  ' 2>/dev/null || echo ""
}

esta_actualizado() { # esta_actualizado <nombre del componente>
  [ -z "${UPDATED_COMPONENTS:-}" ] && return 0   # sin lista: todos
  case " $UPDATED_COMPONENTS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

declare -a IMAGE_ARGS=()
declare -a SIN_TOCAR=()
add_image() { # add_image <clave en values.yaml> <nombre del componente>
  IMAGE_ARGS+=(--set-string "$1.image.repository=${IMAGE_REGISTRY}/$2")

  if esta_actualizado "$2"; then
    IMAGE_ARGS+=(--set-string "$1.image.tag=${IMAGE_TAG}")
    return
  fi

  local previa; previa="$(etiqueta_previa "$1")"
  if [ -n "$previa" ] && [ "$previa" != "dev" ]; then
    IMAGE_ARGS+=(--set-string "$1.image.tag=${previa}")
    SIN_TOCAR+=("$2@${previa}")
  else
    # No cambio, pero tampoco hay una etiqueta previa utilizable: se despliega
    # la nueva. Preferible a dejarlo apuntando al `dev` por defecto del chart.
    IMAGE_ARGS+=(--set-string "$1.image.tag=${IMAGE_TAG}")
  fi
}

add_image services.customer          customer-service
add_image services.account           account-service
add_image services.transaction       transaction-service
add_image services.payment           payment-service
add_image services.notificationAudit notification-audit-service
add_image gateway                    gateway
add_image web                        web

# El banco pareja simulado (T-60). Encendido solo donde se pide
# (`PARTNER_MOCK_ENABLED=true`, que cd.yml pone en prod): `release.yml` publica
# su imagen con la etiqueta de la version, pero el build de `dev` no la
# construye. Sin `INTERBANK_PARTNER_BASE_URL`, el chart apunta el envio al mock
# de ESTE release; con ella (el banco pareja real), el mock queda disponible
# solo para inyectar fallos.
declare -a INTERBANK_ARGS=()
if [ "${PARTNER_MOCK_ENABLED:-false}" = "true" ]; then
  INTERBANK_ARGS+=(--set "partnerMock.enabled=true")
  add_image partnerMock partner-bank-mock
  IMAGE_ARGS+=(--set-string "partnerMock.image.tag=${IMAGE_TAG}")
fi
if [ -n "${INTERBANK_PARTNER_BASE_URL:-}" ]; then
  INTERBANK_ARGS+=(--set-string "interbank.partnerBaseUrl=${INTERBANK_PARTNER_BASE_URL}")
fi

# El codigo del banco pareja y la clave que le enviamos (T-60). Los dos van
# juntos con la URL: un banco pareja real es los tres a la vez. El codigo vivia
# fijo en `values.yaml` (`BANK99`, el del mock) y la clave dentro de
# HELM_SECRETS, asi que cambiar de pareja exigia un PR y reescribir un secreto
# entero que nadie puede leer. El Gateway amarra la clave de ENTRADA a este
# codigo: con el codigo equivocado, los depositos del banco pareja autentican
# bien y salen REJECTED (visto con BANK13 el 2026-10-22).
if [ -n "${INTERBANK_PARTNER_BANK_CODE:-}" ]; then
  if ! [[ "$INTERBANK_PARTNER_BANK_CODE" =~ ^BANK[0-9]{2}$ ]]; then
    echo "::error::INTERBANK_PARTNER_BANK_CODE='${INTERBANK_PARTNER_BANK_CODE}' no cumple ^BANK[0-9]{2}$. El Gateway no arrancaria."
    exit 1
  fi
  INTERBANK_ARGS+=(--set-string "interbank.partnerBankCode=${INTERBANK_PARTNER_BANK_CODE}")
  echo "Banco pareja: ${INTERBANK_PARTNER_BANK_CODE} (variable INTERBANK_PARTNER_BANK_CODE)."
fi
if [ -n "${INTERBANK_API_KEY_OUTBOUND:-}" ]; then
  if grep -q '^[[:space:]]*secrets\.interbankApiKeyOutbound=' <<<"${HELM_SECRETS:-}"; then
    echo "::warning::HELM_SECRETS todavia trae secrets.interbankApiKeyOutbound; se ignora en favor del secreto INTERBANK_API_KEY_OUTBOUND."
  fi
  INTERBANK_ARGS+=(--set-string "secrets.interbankApiKeyOutbound=${INTERBANK_API_KEY_OUTBOUND}")
  echo "Clave hacia el banco pareja: desde el secreto INTERBANK_API_KEY_OUTBOUND."
fi

if [ ${#SIN_TOCAR[@]} -gt 0 ]; then
  echo "Sin cambios, conservan su etiqueta: ${SIN_TOCAR[*]}"
fi

# El despliegue se lanza SIN `--atomic` y en segundo plano, a proposito.
#
# `--atomic` desinstala el release en cuanto expira el plazo, y se lleva por
# delante los pods — que son la unica fuente que puede decir POR QUE no
# arrancaron. La primera instalacion en `prod` fallo con `context deadline
# exceeded` y para cuando helm devolvio el control ya no quedaba nada que
# preguntar: ni un `describe`, ni un evento, ni un log. Un rollback que borra la
# evidencia del fallo convierte cada intento en el mismo intento.
#
# Asi que aqui el orden se invierte: se espera, y si no llega a tiempo se
# captura el estado ANTES de revertir. El rollback sigue ocurriendo — solo
# despues de haber mirado.
# Restos de un intento anterior que fallo.
#
# Cuando una PRIMERA instalacion no alcanza Ready, `helm uninstall` retira el
# release pero puede dejar objetos vivos en el namespace — paso con el
# Deployment de MinIO, que sobrevivio a la desinstalacion y siguio creando
# pods en ImagePullBackOff. La corrida siguiente instala un release que ya no
# lo declara, asi que helm ni lo adopta ni lo borra: queda un pod que nadie
# reclama esperando una imagen que no existe, y el namespace no vuelve a estar
# sano por su cuenta. Cada merge a develop fallaba igual hasta que una persona
# entrara a limpiarlo.
#
# Solo se hace cuando NO hay release: si lo hay, sus objetos son suyos y
# tocarlos seria borrar lo que esta sirviendo. Produccion siempre tiene
# release, asi que esto no se ejecuta ahi nunca.
if [ "$RELEASE_EXISTE" = false ]; then
  # Lo que hay en el namespace ANTES de tocar nada, con etiqueta o sin ella.
  #
  # El barrido anterior buscaba `deployments,statefulsets,services,endpoints`
  # con la etiqueta del release y no encontro nada, mientras un ReplicaSet
  # `minio-58689fbff5` — el mismo en tres corridas seguidas, creado por ninguna
  # de ellas — seguia levantando pods. Un barrido que solo mira donde espera
  # encontrar algo no sirve para descubrir por que fallo el despliegue: lo
  # primero es ver el namespace entero y dejarlo escrito en el log.
  echo "=== Inventario de ${NAMESPACE} antes de instalar ==="
  kubectl get all,endpoints --namespace "$NAMESPACE" --show-labels --ignore-not-found 2>/dev/null || true

  # Se barre `all` — que incluye replicasets y pods, no solo deployments — mas
  # los endpoints, que no entran en `all`.
  RESTOS="$(kubectl get all,endpoints \
    --namespace "$NAMESPACE" \
    --selector "app.kubernetes.io/instance=${RELEASE_NAME}" \
    --no-headers --ignore-not-found 2>/dev/null | wc -l | tr -d ' ')"

  if [ "${RESTOS:-0}" -gt 0 ]; then
    echo "::warning::No hay release ${RELEASE_NAME}, pero quedan ${RESTOS} objetos con su etiqueta en ${NAMESPACE}. Son restos de un intento fallido; se retiran antes de instalar."
    kubectl delete all,endpoints \
      --namespace "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE_NAME}" \
      --ignore-not-found --wait --timeout=3m || true
  fi
fi

# Broker y almacenamiento propios del namespace, cuando se piden.
#
# `dev` y `prod` compartiendo el RabbitMQ de la VM no es un entorno separado:
# las colas son durables y con nombre fijo, asi que los cinco servicios de
# desarrollo se suscriben a las mismas que produccion y el broker les reparte
# mensajes reales. Con esto cada namespace levanta el suyo.
declare -a INFRA_PROPIA_ARGS=()
if [ "${IN_CLUSTER_BROKER:-false}" = "true" ]; then
  INFRA_PROPIA_ARGS+=(--set "rabbitmq.inCluster=true")
  echo "Broker propio del namespace: RabbitMQ dentro de ${NAMESPACE}."
fi
if [ "${IN_CLUSTER_OBJECT_STORAGE:-false}" = "true" ]; then
  INFRA_PROPIA_ARGS+=(--set "minio.inCluster=true")
  echo "Almacenamiento propio del namespace: MinIO dentro de ${NAMESPACE}."
fi

# ---------------------------------------------------------------------------
# Sonda de disponibilidad DURANTE la actualizacion (opcional).
#
# `maxUnavailable: 0` y `maxSurge: 1` estan en el chart, pero eso es la
# intencion declarada, no la prueba. La unica forma de afirmar que un rolling
# update no tuvo caida es preguntarle al servicio mientras ocurre: esta sonda
# golpea la URL publica cada segundo en segundo plano y cuenta las respuestas
# que NO fueron 200. Se activa definiendo ZERO_DOWNTIME_PROBE_URL y no altera
# el despliegue — solo lo observa.
# ---------------------------------------------------------------------------
SONDA_PID=""
SONDA_LOG=""
if [ -n "${ZERO_DOWNTIME_PROBE_URL:-}" ]; then
  SONDA_LOG="$(mktemp)"
  echo "Sondeando ${ZERO_DOWNTIME_PROBE_URL} durante la actualizacion."
  (
    while true; do
      # Sin `|| echo`: cuando curl no conecta ya imprime `000` por su cuenta y
      # ademas sale distinto de cero, asi que anadir un echo escribia `000000`.
      codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$ZERO_DOWNTIME_PROBE_URL" 2>/dev/null)" || codigo="000"
      [ -n "$codigo" ] || codigo="000"
      echo "$codigo" >> "$SONDA_LOG"
      sleep 1
    done
  ) &
  SONDA_PID=$!
fi

detener_sonda() {
  [ -n "$SONDA_PID" ] || return 0
  kill "$SONDA_PID" 2>/dev/null || true
  wait "$SONDA_PID" 2>/dev/null || true
  SONDA_PID=""

  local total fallos
  total="$(wc -l < "$SONDA_LOG" | tr -d ' ')"
  fallos="$(grep -cv '^200$' "$SONDA_LOG" || true)"

  echo "=== Disponibilidad durante la actualizacion ==="
  echo "Peticiones: ${total} · respuestas distintas de 200: ${fallos}"
  if [ "${fallos:-0}" -gt 0 ]; then
    echo "Codigos observados:"
    sort "$SONDA_LOG" | uniq -c | sort -rn
    echo "::warning::El servicio devolvio ${fallos} respuestas no-200 durante el rolling update."
  else
    echo "Ninguna peticion fallo: la actualizacion fue sin caida."
  fi

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Rolling update en \`${NAMESPACE}\`"
      echo ""
      echo "- Peticiones durante la actualizacion: **${total}**"
      echo "- Respuestas distintas de 200: **${fallos}**"
    } >> "$GITHUB_STEP_SUMMARY"
  fi

  rm -f "$SONDA_LOG"
}

echo "=== helm upgrade --install (sin --atomic; el rollback es explicito abajo) ==="
set +e
helm upgrade "$RELEASE_NAME" "$CHART_PATH" \
  --install \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --set-string "imagePullPolicy=IfNotPresent" \
  --set-string "web.apiBaseUrl=${GATEWAY_PUBLIC_URL}" \
  ${INFRA_PROPIA_ARGS[@]+"${INFRA_PROPIA_ARGS[@]}"} \
  ${GATEWAY_STATIC_IP:+--set-string "gateway.loadBalancerIP=${GATEWAY_STATIC_IP}"} \
  --set-string "databaseSuffix=${DATABASE_SUFFIX:-}" \
  --set-string "observability.environment=${NAMESPACE}" \
  ${OTEL_EXPORTER_OTLP_ENDPOINT:+--set-string "observability.otlpEndpoint=${OTEL_EXPORTER_OTLP_ENDPOINT}"} \
  ${WEB_PUBLIC_URL:+--set-string "gateway.corsAllowedOrigins=${WEB_PUBLIC_URL}"} \
  "${SECRET_ARGS[@]}" \
  ${ALERT_ARGS[@]+"${ALERT_ARGS[@]}"} \
  ${MAIL_ARGS[@]+"${MAIL_ARGS[@]}"} \
  "${INFRA_ARGS[@]}" \
  "${IMAGE_ARGS[@]}" \
  ${INTERBANK_ARGS[@]+"${INTERBANK_ARGS[@]}"} \
  --wait \
  ${HELM_WAIT_DEBUG:+--debug} \
  --timeout "${HELM_TIMEOUT:-10m}"
HELM_STATUS=$?
set -e

detener_sonda

if [ "$HELM_STATUS" -ne 0 ]; then
  echo "::group::Diagnostico: por que no arrancaron los pods"

  echo "--- Pods ---"
  kubectl get pods --namespace "$NAMESPACE" -o wide || true

  # `Pending` casi siempre significa que el cluster no tiene sitio; los
  # CrashLoopBackOff y los ImagePullBackOff se leen en la columna de estado.
  echo "--- Pods que no estan Running ---"
  kubectl get pods --namespace "$NAMESPACE" \
    --field-selector=status.phase!=Running -o wide || true

  echo "--- Eventos del namespace (los ultimos son los que importan) ---"
  kubectl get events --namespace "$NAMESPACE" \
    --sort-by=.lastTimestamp | tail -40 || true

  # Para cada pod que no esta listo: por que lo dice Kubernetes, y que dijo el
  # proceso antes de morir.
  for pod in $(kubectl get pods --namespace "$NAMESPACE" \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null); do
    listo=$(kubectl get pod "$pod" --namespace "$NAMESPACE" \
      -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "")
    [ "$listo" = "true" ] && continue

    echo "--- $pod: condiciones y motivo ---"
    kubectl describe pod "$pod" --namespace "$NAMESPACE" 2>/dev/null \
      | sed -n '/Events:/,$p' | head -25 || true

    echo "--- $pod: ultimas lineas del contenedor ---"
    kubectl logs "$pod" --namespace "$NAMESPACE" --tail=30 --all-containers 2>&1 \
      | head -40 || true
  done

  echo "--- Capacidad de los nodos ---"
  kubectl top nodes 2>/dev/null || echo "(metrics-server no respondio)"
  kubectl describe nodes 2>/dev/null \
    | grep -A6 "Allocated resources" | head -30 || true

  echo "::endgroup::"

  # Ahora si: se revierte, con la evidencia ya en el log.
  #
  # Revertir NO es desinstalar. Cuando el release ya existia, la version
  # anterior estaba sirviendo trafico y es exactamente a donde hay que volver:
  # `helm rollback` restaura su revision y deja la aplicacion en pie. Un
  # `helm uninstall` en ese caso se lleva por delante lo que si funcionaba y
  # convierte un despliegue fallido en una caida — que es lo que hacia antes.
  #
  # La desinstalacion solo tiene sentido en la PRIMERA instalacion: ahi no hay
  # revision anterior a la que volver, y dejar el release a medias impide el
  # siguiente intento.
  if [ "$RELEASE_EXISTE" = true ]; then
    REVISION_ACTUAL="$(helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 1 -o json 2>/dev/null \
      | jq -r '.[0].revision // empty' || true)"

    echo "::error::El despliegue no alcanzo Ready. Rollback de ${RELEASE_NAME} en ${NAMESPACE} (revision fallida: ${REVISION_ACTUAL:-desconocida})."

    # Sin argumento de revision, helm vuelve a la anterior.
    if helm rollback "$RELEASE_NAME" --namespace "$NAMESPACE" --wait --timeout 5m; then
      echo "Rollback completado. Revisiones del release:"
      helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 5 || true
      kubectl get pods --namespace "$NAMESPACE" -o wide || true
    else
      echo "::error::El rollback tambien fallo. El release queda como esta, para poder inspeccionarlo."
      helm history "$RELEASE_NAME" --namespace "$NAMESPACE" --max 5 || true
    fi
  else
    echo "::error::La primera instalacion de ${RELEASE_NAME} en ${NAMESPACE} no alcanzo Ready. No hay revision anterior: se retira el release a medias."
    helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE" --wait --timeout 5m || true

    # `helm uninstall` no siempre se lleva todo, y lo que deja atras hace
    # fallar la corrida siguiente con un sintoma que no apunta aqui. Se barre
    # por etiqueta, que es lo que el barrido previo de arriba ya no tendra que
    # descubrir.
    kubectl delete all,endpoints \
      --namespace "$NAMESPACE" \
      --selector "app.kubernetes.io/instance=${RELEASE_NAME}" \
      --ignore-not-found --wait --timeout=3m || true
  fi

  exit 1
fi

# Llegar aqui significa que helm ya espero a que todo estuviera Ready. Esto
# deja el estado final escrito en el log, para el lector que viene despues.
echo "=== Estado de los Deployments en ${NAMESPACE} ==="
kubectl rollout status deployment --namespace "$NAMESPACE" --timeout=5m --selector "app.kubernetes.io/instance=${RELEASE_NAME}" || {
  echo "::error::Un Deployment no completo su rolling update."
  kubectl get pods --namespace "$NAMESPACE" -o wide
  exit 1
}

kubectl get deployments,hpa --namespace "$NAMESPACE"
echo "Despliegue completado en ${NAMESPACE} con la version ${IMAGE_TAG}."
