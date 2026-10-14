#!/usr/bin/env bash
#
# Apaga Bank USAC en GCP, en el orden que no deja nada facturando.
#
#   ./infra/scripts/cloud/cloud-down.sh --dry-run    # imprime el plan, no toca nada
#   ./infra/scripts/cloud/cloud-down.sh              # apaga (deja estado e imagenes)
#   ./infra/scripts/cloud/cloud-down.sh --purge-state --purge-images   # cero absoluto
#
# EL ORDEN ES LO QUE HACE ESTE SCRIPT, no el `terraform destroy`.
#
#   1. `helm uninstall` de los dos releases, con el cluster todavia vivo. Es lo
#      que borra los `Service` de tipo LoadBalancer y, con ellos, las reglas de
#      reenvio que GKE creo en GCP. Destruir el cluster primero las deja
#      huerfanas: facturan y Terraform no las conoce.
#   2. Borrar a mano los PVC de `loki` y `tempo`. Son `volumeClaimTemplates` de
#      un StatefulSet y Helm NO los borra nunca. Con el cluster vivo, borrar el
#      PVC hace que GKE borre el disco; sin cluster, quedan 20 GiB huerfanos.
#   3. Esperar a que las reglas de reenvio desaparezcan de verdad. El borrado
#      del Service es asincrono: el destroy puede adelantarlo.
#   4. `terraform destroy`.
#   5. Solo entonces, y solo si se pide, el bucket de estado y el repositorio de
#      imagenes.
#
# El estado se borra AL FINAL a proposito: mientras exista infraestructura,
# existe el estado que sabe destruirla. Si este script falla a mitad, el estado
# sigue ahi y se puede reintentar.
#
# NUNCA toca recursos de otro curso. Este proyecto de GCP es compartido: todo se
# borra por nombre explicito (`bank-images`, `…-tfstate`, los releases de Helm),
# nunca con un «borra lo que haya».
#
# Escrito para bash 3.2, la version que trae macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform/gcp"

PROJECT="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-a}"
CLUSTER="${GKE_CLUSTER:-bank-usac-vpc-gke}"
ARTIFACT_REPO="${ARTIFACT_REPO:-bank-images}"

dry_run=false
purge_state=false
purge_images=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --purge-state) purge_state=true ;;
    --purge-images) purge_images=true ;;
    -h | --help)
      sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

# Ejecuta, o imprime si es --dry-run.
run() {
  if $dry_run; then
    echo "    [dry-run] $*"
  else
    echo "    \$ $*"
    "$@"
  fi
}

echo "Proyecto : $PROJECT"
echo "Cuenta   : $(gcloud config get-value account 2>/dev/null || echo '?')"
echo "Cluster  : $CLUSTER ($ZONE)"
$dry_run && echo "Modo     : DRY RUN — no se toca nada"
$purge_state && echo "Estado   : se borrara el bucket de Terraform"
$purge_images && echo "Imagenes : se borrara el repositorio ${ARTIFACT_REPO}"

# ---------------------------------------------------------------------------
# 1 y 2. Lo que vive dentro del cluster. Solo si el cluster existe: tras un
# apagado anterior no existe, y esto tiene que poder correrse dos veces.
# ---------------------------------------------------------------------------
paso "1. Releases de Helm y discos que Helm no borra"

existe_cluster="$(gcloud container clusters list --project "$PROJECT" \
  --filter="name=${CLUSTER}" --format='value(name)' 2>/dev/null || true)"

if [[ -z "$existe_cluster" ]]; then
  echo "    El cluster ${CLUSTER} no existe. Nada que desinstalar."
else
  run gcloud container clusters get-credentials "$CLUSTER" \
    --zone "$ZONE" --project "$PROJECT" --quiet

  # El stack de observabilidad. Su `helm uninstall` se lleva los PVC de Grafana
  # y Prometheus (son PVC sueltos del chart), pero NO los de Loki y Tempo.
  for release_ns in "bank-observability:observability"; do
    release="${release_ns%%:*}"
    ns="${release_ns##*:}"
    if $dry_run || helm status "$release" -n "$ns" >/dev/null 2>&1; then
      run helm uninstall "$release" --namespace "$ns" --wait --timeout 10m
    else
      echo "    El release $release no esta instalado en $ns."
    fi
  done

  # Los dos que Helm nunca borra. Con el cluster vivo, borrar el PVC hace que
  # GKE borre el PersistentVolume y con el el disco de GCP.
  paso "2. PVC de loki y tempo (volumeClaimTemplates)"
  if $dry_run; then
    echo "    [dry-run] kubectl delete pvc -n observability -l app.kubernetes.io/name=loki"
    echo "    [dry-run] kubectl delete pvc -n observability -l app.kubernetes.io/name=tempo"
  else
    # `--ignore-not-found` para que la segunda corrida no falle.
    kubectl delete pvc -n observability \
      -l 'app.kubernetes.io/name in (loki,tempo)' \
      --ignore-not-found --wait=true --timeout=5m || true
    # Y por si las etiquetas cambiaran con una version del chart: cualquier PVC
    # que quede en el namespace es nuestro, el namespace es nuestro.
    kubectl delete pvc --all -n observability --ignore-not-found --timeout=5m || true
  fi

  # Las aplicaciones. Esto borra los Service de tipo LoadBalancer, que es lo que
  # libera las reglas de reenvio en GCP.
  paso "3. Releases de la aplicacion (libera los balanceadores)"
  for ns in prod dev; do
    if $dry_run || helm status bank-usac -n "$ns" >/dev/null 2>&1; then
      run helm uninstall bank-usac --namespace "$ns" --wait --timeout 10m
    else
      echo "    No hay release bank-usac en $ns."
    fi
  done
fi

# ---------------------------------------------------------------------------
# 4. Esperar a que GCP termine de borrar los balanceadores. El borrado del
# Service es asincrono y `terraform destroy` puede adelantarlo, dejando la
# regla de reenvio viva y sin dueno.
# ---------------------------------------------------------------------------
paso "4. Esperar a que desaparezcan las reglas de reenvio"
if $dry_run; then
  echo "    [dry-run] esperar hasta 5 min a que no queden forwarding-rules de bank-usac"
else
  for intento in $(seq 1 30); do
    quedan="$(gcloud compute forwarding-rules list --project "$PROJECT" \
      --format='value(name)' 2>/dev/null | grep -Ei 'bank-usac|^a[0-9a-f]{31}$' || true)"
    if [[ -z "${quedan// /}" ]]; then
      echo "    Sin reglas de reenvio pendientes."
      break
    fi
    echo "    Esperando ($intento/30): $(echo "$quedan" | tr '\n' ' ')"
    sleep 10
  done
fi

# ---------------------------------------------------------------------------
# 5. Terraform.
# ---------------------------------------------------------------------------
paso "5. terraform destroy"
if [[ ! -f "${TF_DIR}/backend.hcl" ]]; then
  echo "    AVISO: no hay ${TF_DIR}/backend.hcl, asi que no se sabe donde esta"
  echo "    el estado. Si ya apagaste antes con --purge-state, esto es normal y"
  echo "    no hay nada que destruir. Si NO, recupera el backend.hcl antes de"
  echo "    seguir: sin estado, destroy no sabe que borrar."
else
  run bash -c "cd '${TF_DIR}' && terraform init -backend-config=backend.hcl -input=false"
  if $dry_run; then
    echo "    [dry-run] terraform plan -destroy (solo lectura):"
    (cd "$TF_DIR" && terraform plan -destroy -input=false -no-color 2>&1 | tail -5) || true
  else
    run bash -c "cd '${TF_DIR}' && terraform destroy -auto-approve -input=false"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Lo residual, solo si se pide. Por nombre explicito: en este proyecto hay
# recursos de otros cursos.
# ---------------------------------------------------------------------------
if $purge_images; then
  paso "6a. Repositorio de imagenes ${ARTIFACT_REPO}"
  existe="$(gcloud artifacts repositories list --project "$PROJECT" \
    --location "$REGION" --filter="name~/${ARTIFACT_REPO}$" \
    --format='value(name)' 2>/dev/null || true)"
  if [[ -z "$existe" ]]; then
    echo "    ${ARTIFACT_REPO} no existe."
  else
    run gcloud artifacts repositories delete "$ARTIFACT_REPO" \
      --location "$REGION" --project "$PROJECT" --quiet
    echo "    Las siete imagenes habra que republicarlas antes del proximo despliegue."
  fi
fi

if $purge_state; then
  paso "6b. Bucket de estado de Terraform"
  bucket="$(sed -n 's/^ *bucket *= *"\(.*\)" *$/\1/p' "${TF_DIR}/backend.hcl" 2>/dev/null || true)"
  if [[ -z "$bucket" ]]; then
    bucket="${PROJECT}-tfstate"
    echo "    Sin backend.hcl; se asume el nombre por convencion: ${bucket}"
  fi

  if gcloud storage buckets describe "gs://${bucket}" --project "$PROJECT" >/dev/null 2>&1; then
    # Recursivo porque el bucket tiene versionado: hay versiones antiguas del
    # objeto de estado que lo mantienen no vacio.
    run gcloud storage rm -r "gs://${bucket}" --project "$PROJECT"
    run rm -f "${TF_DIR}/backend.hcl"
    run rm -rf "${TF_DIR}/.terraform" "${TF_DIR}/bootstrap/.terraform" "${TF_DIR}/bootstrap/terraform.tfstate"
    echo "    El proximo encendido vuelve a hacer el bootstrap desde cero."
  else
    echo "    El bucket gs://${bucket} no existe."
  fi
fi

# ---------------------------------------------------------------------------
# 7. La comprobacion que convierte esto en un hecho.
# ---------------------------------------------------------------------------
paso "7. Verificacion de coste"
if $dry_run; then
  echo "    [dry-run] ./infra/scripts/cloud/cost-check.sh"
  exit 0
fi

exec "${SCRIPT_DIR}/cost-check.sh"
