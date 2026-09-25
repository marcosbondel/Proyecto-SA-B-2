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
#   GATEWAY_PUBLIC_URL  la direccion del Gateway tal como la alcanza el
#                    NAVEGADOR de una persona, no un nombre de Service interno.
#                    El chart la tiene por defecto en `http://localhost:3000`,
#                    que es correcto para kind con port-forward y silenciosamente
#                    inservible en GKE: el despliegue tendria exito y entregaria
#                    un frontend que no puede hablar con su backend. Se exige
#                    aqui para que ese caso no exista.
#
# Variable opcional:
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

read_set_lines "${INFRA_ADDRESSES:-}"
declare -a INFRA_ARGS=("${SET_LINES[@]}")

if [ ${#INFRA_ARGS[@]} -eq 0 ]; then
  echo "::error::INFRA_ADDRESSES vacio. El chart necesita saber donde estan las cinco VMs de PostgreSQL, RabbitMQ y MinIO — las IPs las da 'terraform output' en infra/terraform/gcp/."
  exit 1
fi

# Los siete componentes, con el nombre que usan tanto el registry como el chart.
# El chart trata `image.repository` como la ruta completa de la imagen, asi que
# apuntarlo al registry es todo lo que hace falta para que GKE la encuentre.
declare -a IMAGE_ARGS=()
add_image() { # add_image <clave en values.yaml> <nombre del componente>
  IMAGE_ARGS+=(--set-string "$1.image.repository=${IMAGE_REGISTRY}/$2")
  IMAGE_ARGS+=(--set-string "$1.image.tag=${IMAGE_TAG}")
}

# Que base de datos usa cada servicio, por entorno.
#
# Las cinco VMs de PostgreSQL que provisiona Terraform son las mismas para dev y
# para produccion — el enunciado pide las bases en VM, no una VM por entorno — y
# hasta ahora los dos entornos escribian tambien en las MISMAS bases. Eso hacia
# que un despliegue a `dev` tocara los datos de produccion, que es exactamente
# lo que el enunciado prohibe ("no deben afectar el entorno productivo").
#
# Con `DB_NAME_SUFFIX=_dev`, el entorno de desarrollo usa `customer_dev`,
# `account_dev`, etc. sobre esas mismas maquinas: el aislamiento es de datos, no
# de hardware, que es donde estaba el problema. Produccion no pasa sufijo y
# conserva los nombres de siempre.
declare -a DB_ARGS=()
if [ -n "${DB_NAME_SUFFIX:-}" ]; then
  DB_ARGS+=(--set-string "databases.customer.name=customer${DB_NAME_SUFFIX}")
  DB_ARGS+=(--set-string "databases.account.name=account${DB_NAME_SUFFIX}")
  DB_ARGS+=(--set-string "databases.transaction.name=transaction${DB_NAME_SUFFIX}")
  DB_ARGS+=(--set-string "databases.payment.name=payment${DB_NAME_SUFFIX}")
  DB_ARGS+=(--set-string "databases.notificationAudit.name=notification_audit${DB_NAME_SUFFIX}")
  echo "Entorno con bases propias: sufijo '${DB_NAME_SUFFIX}'"
fi

add_image services.customer          customer-service
add_image services.account           account-service
add_image services.transaction       transaction-service
add_image services.payment           payment-service
add_image services.notificationAudit notification-audit-service
add_image gateway                    gateway
add_image web                        web

helm upgrade "$RELEASE_NAME" "$CHART_PATH" \
  --install \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --set-string "imagePullPolicy=IfNotPresent" \
  --set-string "web.apiBaseUrl=${GATEWAY_PUBLIC_URL}" \
  ${WEB_PUBLIC_URL:+--set-string "gateway.corsAllowedOrigins=${WEB_PUBLIC_URL}"} \
  "${SECRET_ARGS[@]}" \
  "${INFRA_ARGS[@]}" \
  "${DB_ARGS[@]+"${DB_ARGS[@]}"}" \
  "${IMAGE_ARGS[@]}" \
  --atomic \
  --wait \
  --timeout 15m

# `--atomic --wait` ya revierte un despliegue que no levanta, pero no dice
# cual de los siete Deployments fue. Esto lo deja escrito en el log, que es lo
# que alguien va a leer cuando el rollback ya ocurrio.
echo "=== Estado de los Deployments en ${NAMESPACE} ==="
kubectl rollout status deployment --namespace "$NAMESPACE" --timeout=5m --selector "app.kubernetes.io/instance=${RELEASE_NAME}" || {
  echo "::error::Un Deployment no completo su rolling update."
  kubectl get pods --namespace "$NAMESPACE" -o wide
  exit 1
}

kubectl get deployments,hpa --namespace "$NAMESPACE"
echo "Despliegue completado en ${NAMESPACE} con la version ${IMAGE_TAG}."
