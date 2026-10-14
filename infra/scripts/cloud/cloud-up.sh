#!/usr/bin/env bash
#
# Levanta Bank USAC en GCP para una sesion de validacion, desde un proyecto
# vacio, y deja escrito cuanto cuesta tenerlo encendido.
#
#   ./infra/scripts/cloud/cloud-up.sh --dry-run   # imprime el plan, no toca nada
#   ./infra/scripts/cloud/cloud-up.sh             # infra + imagenes + despliegue
#   ./infra/scripts/cloud/cloud-up.sh --only-infra
#
# PARA QUE ES, Y PARA QUE NO ES.
#
# Es para depurar y validar en una sesion corta, con `cloud-down.sh` despues.
# **No es el despliegue de la entrega**: ese pasa por el pipeline (`cd.yml`),
# porque el enunciado penaliza el despliegue manual (§8.3, 25 %). Esto hace un
# `helm upgrade` directo, que es mas rapido para iterar y no sirve como
# evidencia. La evidencia de la rubrica sale de un merge a `main`.
#
# ANTES DE GASTAR, PRUEBA EN KIND. Casi todo lo que puede romperse del stack de
# observabilidad es comportamiento de cluster, no de nube: que el Collector
# parsee el JSON del logger, que Loki ingiera, que el salto log -> traza
# funcione, que carguen los datasources. Eso se ve gratis:
#
#   pnpm k8s:cluster && pnpm k8s:install
#   ./infra/scripts/cloud/obs-kind.sh
#
# A la nube solo lo que kind no puede mostrar: la IP estatica con el
# LoadBalancer, el HPA bajo carga real y las capturas para la rubrica.
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform/gcp"

PROJECT="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-a}"
ARTIFACT_REPO="${ARTIFACT_REPO:-bank-images}"

dry_run=false
only_infra=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --only-infra) only_infra=true ;;
    -h | --help)
      sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "ERROR: no hay proyecto. Exporta GCP_PROJECT_ID o corre 'gcloud config set project'." >&2
  exit 2
fi

paso() { echo; echo "=== $* ==="; }
run() {
  if $dry_run; then
    echo "    [dry-run] $*"
  else
    echo "    \$ $*"
    "$@"
  fi
}

inicio="$(date +%s)"

echo "Proyecto : $PROJECT"
echo "Cuenta   : $(gcloud config get-value account 2>/dev/null || echo '?')"
echo "Region   : $REGION / $ZONE"
$dry_run && echo "Modo     : DRY RUN — no se toca nada"

# ---------------------------------------------------------------------------
# 0. Lo que tiene que estar antes de gastar un centavo.
# ---------------------------------------------------------------------------
paso "0. Comprobaciones previas"

for binario in gcloud terraform helm kubectl docker gh; do
  if ! command -v "$binario" >/dev/null 2>&1; then
    echo "ERROR: falta '$binario' en el PATH." >&2
    exit 2
  fi
done
echo "    Herramientas: gcloud terraform helm kubectl docker gh"

if [[ ! -f "${TF_DIR}/terraform.tfvars" ]]; then
  echo "ERROR: falta ${TF_DIR}/terraform.tfvars." >&2
  echo "       Copialo de terraform.tfvars.example y pon project_id y las cinco" >&2
  echo "       contrasenas. No se genera aqui: una contrasena inventada por un" >&2
  echo "       script acaba en el Secret de Kubernetes y nadie sabe cual es." >&2
  exit 2
fi
echo "    terraform.tfvars presente"

# Las credenciales que necesita TERRAFORM, que no son las de gcloud.
#
# `gcloud auth login` autentica la CLI; el provider de Google de Terraform usa
# Application Default Credentials, que es otro archivo. Tenerlas separadas hace
# que `gcloud compute instances list` funcione y `terraform apply` falle con
# «could not find default credentials» — y lo hace a los 90 segundos, cuando ya
# se habilitaron las APIs. Esta comprobacion existe por haberlo visto.
#
# Si no hay ADC, se usa un token de acceso de la sesion de gcloud, que el
# provider acepta por `GOOGLE_OAUTH_ACCESS_TOKEN`. Dura una hora: suficiente
# para un apply (6-10 min) y para una sesion corta, no para dejarlo puesto.
if [[ -z "${GOOGLE_OAUTH_ACCESS_TOKEN:-}" ]] &&
  [[ ! -f "${HOME}/.config/gcloud/application_default_credentials.json" ]] &&
  [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  echo "    Sin Application Default Credentials; usando un token de la sesion de gcloud."
  echo "    Para que esto deje de hacer falta, una vez:  gcloud auth application-default login"
  if ! GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token 2>/dev/null)"; then
    echo "ERROR: no hay ADC ni sesion de gcloud de la que sacar un token." >&2
    echo "       Corre:  gcloud auth application-default login" >&2
    exit 2
  fi
  export GOOGLE_OAUTH_ACCESS_TOKEN
  echo "    Token obtenido (caduca en ~1 h)."
else
  echo "    Credenciales de Terraform: presentes"
fi

# Las APIs. Habilitar una ya habilitada no cuesta ni cambia nada, asi que se
# hace siempre en vez de comprobarlo: desde un proyecto nuevo son obligatorias.
run gcloud services enable \
  compute.googleapis.com container.googleapis.com run.googleapis.com \
  artifactregistry.googleapis.com cloudresourcemanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  storage.googleapis.com --project "$PROJECT"

# ---------------------------------------------------------------------------
# 1. El bucket de estado. Tras un apagado con --purge-state no existe, asi que
# esto tiene que poder correrse desde cero.
# ---------------------------------------------------------------------------
paso "1. Bucket de estado de Terraform"

if [[ -f "${TF_DIR}/backend.hcl" ]]; then
  echo "    backend.hcl ya existe: $(cat "${TF_DIR}/backend.hcl" | tr -d '\n')"
else
  run bash -c "cd '${TF_DIR}/bootstrap' && terraform init -input=false"
  run bash -c "cd '${TF_DIR}/bootstrap' && terraform apply -auto-approve -input=false -var project_id='${PROJECT}' -var region='${REGION}'"
  if $dry_run; then
    echo "    [dry-run] terraform output -raw backend_hcl > ../backend.hcl"
  else
    (cd "${TF_DIR}/bootstrap" && terraform output -raw backend_hcl) > "${TF_DIR}/backend.hcl"
    echo "    Escrito ${TF_DIR}/backend.hcl"
  fi
fi

# ---------------------------------------------------------------------------
# 2. La infraestructura.
# ---------------------------------------------------------------------------
paso "2. terraform apply (entre 6 y 10 minutos)"
run bash -c "cd '${TF_DIR}' && terraform init -backend-config=backend.hcl -input=false"
if $dry_run; then
  # No se intenta el `plan`: sin el backend inicializado falla con un mensaje
  # sobre reinicializacion que no dice nada util aqui. El plan de verdad se ve
  # con `cd infra/terraform/gcp && terraform plan`.
  echo "    [dry-run] terraform apply (19 recursos sobre un proyecto vacio)"
else
  run bash -c "cd '${TF_DIR}' && terraform apply -auto-approve -input=false"
fi

if $dry_run; then
  GATEWAY_IP="203.0.113.10"
  GATEWAY_URL="http://203.0.113.10:3000"
  CLOUD_RUN=" bank-usac-web"
else
  GATEWAY_IP="$(cd "$TF_DIR" && terraform output -raw gateway_public_ip)"
  GATEWAY_URL="$(cd "$TF_DIR" && terraform output -raw gateway_public_url)"
  CLOUD_RUN="$(cd "$TF_DIR" && terraform output -raw cloud_run_service_name 2>/dev/null || true)"
  echo
  echo "    Gateway  : ${GATEWAY_URL}"
  echo "    Cloud Run: ${CLOUD_RUN:-(sin desplegar)}"
fi

# ---------------------------------------------------------------------------
# 3. Las variables del pipeline. Se escriben aqui para que el merge a `main`
# que produce la evidencia no falle por una variable que nadie puso.
# ---------------------------------------------------------------------------
paso "3. Variables de repositorio en GitHub"
run gh variable set GCP_PROJECT_ID --body "$PROJECT"
run gh variable set GKE_ZONE --body "$ZONE"
run gh variable set ARTIFACT_REPO --body "$ARTIFACT_REPO"
run gh variable set GATEWAY_PUBLIC_URL --body "$GATEWAY_URL"
run gh variable set GATEWAY_STATIC_IP --body "$GATEWAY_IP"
[[ -n "${CLOUD_RUN// /}" ]] && run gh variable set CLOUD_RUN_SERVICE --body "${CLOUD_RUN// /}"

echo
echo "    INFRA_ADDRESSES y HELM_SECRETS no se escriben aqui: llevan las cinco"
echo "    contrasenas de terraform.tfvars y este script no manda secretos a"
echo "    GitHub sin que lo pidas. Las direcciones nuevas son:"
if $dry_run; then
  echo "      [dry-run] terraform output database_private_ips"
else
  (cd "$TF_DIR" && terraform output -json database_private_ips 2>/dev/null |
    python3 -c '
import json,sys
clave={"customer":"Customer","account":"Account","transaction":"Transaction",
       "payment":"Payment","notification-audit":"NotificationAudit"}
for k,v in json.load(sys.stdin).items():
    print(f"      external.postgres{clave[k]}.dockerNetwork.host={v}")
') || true
fi

if $only_infra; then
  paso "Listo (solo infraestructura)"
else
  # -------------------------------------------------------------------------
  # 4. Imagenes. Tras un apagado con --purge-images el registry esta vacio.
  # -------------------------------------------------------------------------
  paso "4. Construir y publicar las siete imagenes"
  REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/${ARTIFACT_REPO}"
  run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

  # shellcheck source=/dev/null
  source "${REPO_ROOT}/infra/docker/scripts/images.sh"
  TAG="$(git rev-parse --short=12 HEAD)"
  [[ -n "$(git status --porcelain 2>/dev/null)" ]] && TAG="${TAG}-dirty" &&
    echo "    AVISO: el arbol tiene cambios sin comitear; etiqueta ${TAG}"

  echo "    Etiqueta : ${TAG}"
  echo "    Registro : ${REGISTRY}"
  for row in "${BANK_COMPONENTS[@]}"; do
    bank_component_fields "$row"
    destino="${REGISTRY}/${BANK_COMPONENT_NAME}:${TAG}"
    run docker build --file "${REPO_ROOT}/${BANK_COMPONENT_DOCKERFILE}" \
      --tag "$destino" --build-arg "IMAGE_VERSION=${TAG}" "${REPO_ROOT}"
    run docker push "$destino"
  done

  # -------------------------------------------------------------------------
  # 5. El despliegue de depuracion.
  # -------------------------------------------------------------------------
  paso "5. Desplegar (helm directo — NO es el despliegue de la entrega)"
  run gcloud container clusters get-credentials "bank-usac-vpc-gke" \
    --zone "$ZONE" --project "$PROJECT" --quiet

  # Los secretos se COMPONEN de lo que ya existe, no se piden otra vez:
  #   - las cinco contrasenas de base de datos, de terraform.tfvars, porque son
  #     las que el startup-script le dio a cada rol y tienen que coincidir;
  #   - las de RabbitMQ y MinIO, de infra/docker/.env, el mismo archivo que usa
  #     el flujo local.
  # Escribirlas a mano catorce veces bajo prisa es como se despliega un pod que
  # no puede alcanzar su base de datos.
  # Si existe el .env del flujo local, se reutiliza; si no, se genera lo que
  # falte. No es obligatorio: este despliegue no comparte nada con el stack
  # local de Docker.
  ENV_FILE="${REPO_ROOT}/infra/docker/.env"
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    set -a && source "$ENV_FILE" && set +a
    echo "    Credenciales base tomadas de infra/docker/.env"
  fi

  # DE DONDE SALE CADA SECRETO, que no es lo mismo para todos.
  #
  #   - Las cinco contrasenas de base de datos TIENEN que coincidir con lo que
  #     el startup-script le dio a cada rol en su VM, asi que se leen de
  #     terraform.tfvars. No se generan: una inventada aqui produce cinco pods
  #     que no pueden alcanzar su base, y el error no dice eso.
  #   - Las de RabbitMQ, MinIO y el JWT se GENERAN si no estan. Con
  #     `rabbitmq.inCluster=true` y `minio.inCluster=true` el chart es quien
  #     CREA esas cuentas, asi que basta con que sean consistentes dentro del
  #     release. Y en un cluster que se destruye en una hora, una credencial
  #     efimera es mucho mejor que el valor por defecto de `install.sh`
  #     (`dev-only-secret-not-for-any-deployed-environment`), que es publico y
  #     firmaria los JWT de verdad.
  #
  # Las generadas se dicen en voz alta, porque hacen falta para entrar.

  tfvar() { sed -n "s/^ *$1 *= *\"\(.*\)\" *$/\1/p" "${TF_DIR}/terraform.tfvars" | head -1; }
  DB_PASS="$(tfvar db_default_password)"
  if [[ -z "$DB_PASS" ]]; then
    echo "ERROR: no pude leer db_default_password de ${TF_DIR}/terraform.tfvars." >&2
    echo "       Si usas db_passwords por servicio, exporta HELM_SECRETS a mano." >&2
    exit 2
  fi

  # `tr -dc ... | head -c N` parece lo obvio y rompe el script: `head` cierra la
  # tuberia al llegar a N, `tr` recibe SIGPIPE y con `set -o pipefail` el
  # pipeline devuelve 141. El script moria sin imprimir nada. `cut` lee toda la
  # entrada, asi que no hay SIGPIPE.
  gen() {
    local n="${1:-32}"
    head -c $((n * 32)) /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c "1-${n}"
  }
  generadas=""
  if [[ -z "${JWT_SECRET:-}" ]]; then
    JWT_SECRET="$(gen 48)"
    generadas="${generadas}      JWT_SECRET            ${JWT_SECRET}\n"
  fi
  if [[ -z "${RABBITMQ_APP_PASSWORD:-}" ]]; then
    RABBITMQ_APP_PASSWORD="$(gen 32)"
    generadas="${generadas}      RABBITMQ_APP_PASSWORD ${RABBITMQ_APP_PASSWORD}\n"
  fi
  if [[ -z "${MINIO_APP_PASSWORD:-}" ]]; then
    MINIO_APP_PASSWORD="$(gen 32)"
    generadas="${generadas}      MINIO_APP_PASSWORD    ${MINIO_APP_PASSWORD}\n"
  fi
  RABBITMQ_APP_USER="${RABBITMQ_APP_USER:-bank_app}"
  MINIO_APP_USER="${MINIO_APP_USER:-bank_app}"
  MINIO_BUCKET="${MINIO_BUCKET:-bank-usac}"

  HELM_SECRETS="$(cat <<SECRETS
secrets.jwtSecret=${JWT_SECRET}
secrets.rabbitmq.user=${RABBITMQ_APP_USER}
secrets.rabbitmq.password=${RABBITMQ_APP_PASSWORD}
secrets.objectStorage.accessKey=${MINIO_APP_USER}
secrets.objectStorage.secretKey=${MINIO_APP_PASSWORD}
secrets.objectStorage.bucket=${MINIO_BUCKET}
secrets.databases.customer.password=${DB_PASS}
secrets.databases.account.password=${DB_PASS}
secrets.databases.transaction.password=${DB_PASS}
secrets.databases.payment.password=${DB_PASS}
secrets.databases.notificationAudit.password=${DB_PASS}
rabbitmq.inCluster=true
minio.inCluster=true
SECRETS
)"

  if [[ -n "$generadas" ]]; then
    echo "    Credenciales generadas para esta sesion (apuntalas):"
    printf '%b' "$generadas"
  fi

  if $dry_run; then
    INFRA_ADDRESSES="external.postgresCustomer.dockerNetwork.host=10.40.0.1"
  else
    INFRA_ADDRESSES="$(cd "$TF_DIR" && terraform output -json database_private_ips |
      python3 -c '
import json,sys
clave={"customer":"Customer","account":"Account","transaction":"Transaction",
       "payment":"Payment","notification-audit":"NotificationAudit"}
for k,v in json.load(sys.stdin).items():
    print(f"external.postgres{clave[k]}.dockerNetwork.host={v}")
')"
  fi

  echo "    HELM_SECRETS: 13 lineas compuestas (5 de tfvars, 6 de .env, 2 banderas)"
  echo "    INFRA_ADDRESSES: $(echo "$INFRA_ADDRESSES" | grep -c .) direcciones privadas"

  # Se usa el MISMO script que el pipeline, para que no haya dos caminos de
  # despliegue que puedan divergir.
  if $dry_run; then
    echo "    [dry-run] bash .github/scripts/helm-deploy.sh (namespace prod)"
  else
    IMAGE_REGISTRY="$REGISTRY" \
    IMAGE_TAG="$TAG" \
    NAMESPACE=prod \
    RELEASE_NAME=bank-usac \
    GATEWAY_PUBLIC_URL="$GATEWAY_URL" \
    GATEWAY_STATIC_IP="$GATEWAY_IP" \
    HELM_SECRETS="$HELM_SECRETS" \
    INFRA_ADDRESSES="$INFRA_ADDRESSES" \
    IN_CLUSTER_BROKER=true \
    OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-gateway.observability.svc.cluster.local:4318" \
      bash "${REPO_ROOT}/.github/scripts/helm-deploy.sh"
  fi

  # El stack de observabilidad.
  paso "6. Stack de observabilidad"
  GRAFANA_PASS="${GRAFANA_ADMIN_PASSWORD:-}"
  if [[ -z "$GRAFANA_PASS" ]]; then
    # Generada y dicha en voz alta. Es un cluster que se destruye en una hora:
    # lo peligroso aqui no es una contrasena efimera, es un Grafana con la que
    # trae el chart por defecto, que es publica.
    GRAFANA_PASS="$(gen 24)"
    echo "    Contrasena de Grafana generada: ${GRAFANA_PASS}"
    echo "    (usuario admin — apuntala, no se guarda en ningun archivo)"
  fi

  if $dry_run; then
    echo "    [dry-run] crear namespace observability, el Secret grafana-admin y helm upgrade"
  else
    kubectl create namespace observability --dry-run=client -o yaml | kubectl apply -f -
    kubectl create secret generic grafana-admin --namespace observability \
      --from-literal=admin-user=admin \
      --from-literal=admin-password="$GRAFANA_PASS" \
      --dry-run=client -o yaml | kubectl apply -f -

    "${REPO_ROOT}/infra/k8s/scripts/check-chart-deps.sh" "${REPO_ROOT}/infra/k8s/helm/bank-observability"
    helm upgrade bank-observability "${REPO_ROOT}/infra/k8s/helm/bank-observability" \
      --install --namespace observability --wait --timeout 20m
  fi
fi

# ---------------------------------------------------------------------------
# 6. Lo que cuesta, y el recordatorio.
# ---------------------------------------------------------------------------
fin="$(date +%s)"
mins=$(((fin - inicio) / 60))

paso "Encendido"
cat <<FIN
    Tardo ${mins} min.

    Cuesta del orden de 0.50 USD por hora mientras exista: tres nodos
    e2-standard-2, cinco VMs e2-medium, Cloud NAT, dos reglas de reenvio y
    unos 200 GB de disco. Una sesion de una hora son ~0.60 USD.

    CUANDO TERMINES, y no manana:

      ./infra/scripts/cloud/cloud-down.sh --purge-state --purge-images

    Eso apaga en el orden que no deja discos ni balanceadores huerfanos, y
    termina ejecutando cost-check.sh, que falla si queda algo facturando.

    Para comprobar en cualquier momento, sin apagar:

      ./infra/scripts/cloud/cost-check.sh
FIN
