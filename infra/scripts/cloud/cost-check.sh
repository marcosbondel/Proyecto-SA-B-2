#!/usr/bin/env bash
#
# Enumera lo facturable que queda en el proyecto de GCP, separando lo que es de
# Bank USAC de lo que es de otro curso. Es la diferencia entre «creo que lo
# apagué» y saberlo.
#
#   ./infra/scripts/cloud/cost-check.sh            # falla si queda algo nuestro
#   ./infra/scripts/cloud/cost-check.sh --report   # solo informa, sale 0
#
# Por qué existe, y por qué no basta con `terraform destroy`.
#
# Tres clases de recurso se quedan atrás aunque el destroy diga «Destroy
# complete», y ninguna aparece en el estado de Terraform:
#
#   1. Los discos de `loki` y `tempo`. Son `volumeClaimTemplates` de un
#      StatefulSet, y Helm NO los borra nunca — ni con `helm uninstall`. Si
#      además se destruye el clúster antes de borrarlos, quedan huérfanos: 20
#      GiB facturando sin que nada en el proyecto los nombre.
#   2. Las reglas de reenvío de los `Service` de tipo LoadBalancer. Las crea
#      GKE a partir del Service, no Terraform, así que destruir el clúster sin
#      desinstalar el release antes las deja vivas.
#   3. Una IP estática reservada **sin usar cuesta más que en uso**. Si el
#      destroy falla a medias y la deja, se paga por no usarla.
#
# Se consulta por API y no por el estado de Terraform a propósito: el estado
# dice lo que Terraform cree, y lo que se factura es lo que existe.
#
# POR QUÉ DISTINGUE DUEÑO. Este proyecto de GCP es compartido con otros cursos:
# la primera corrida encontró un repositorio `p5-images` que no es de aquí. Un
# script que «borra todo lo que encuentre» habría destruido el trabajo de otra
# práctica. Así que todo lo de Bank USAC se reconoce por nombre
# (`bank-usac…`, `bank-images`, `…-tfstate`) y lo demás se lista aparte y NUNCA
# se toca.
#
# Escrito para bash 3.2, la versión que trae macOS.
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"

# Lo que es nuestro. `network_name` por defecto es `bank-usac-vpc`, y de ahí
# salen los nombres del clúster (`bank-usac-vpc-gke`) y de la IP
# (`bank-usac-vpc-gateway`). Las VMs son `bank-db-<servicio>`.
NUESTRO='^(bank-usac|bank-db-|bank-images$|bank-observability)|-tfstate$'

for arg in "$@"; do
  case "$arg" in
    --report) ;; # mismo informe; solo cambia el código de salida al final
    -h | --help)
      sed -n '2,38p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $arg" >&2
      exit 2
      ;;
  esac
done
report_only=false
[[ "${1:-}" == "--report" ]] && report_only=true

if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "ERROR: no hay proyecto. Exporta GCP_PROJECT_ID o corre 'gcloud config set project'." >&2
  exit 2
fi

echo "Proyecto : $PROJECT"
echo "Cuenta   : $(gcloud config get-value account 2>/dev/null || echo '?')"
echo "Region   : $REGION"
echo

cobrando=0   # recursos nuestros que cobran por hora
residual=0   # recursos nuestros que cuestan centavos (estado e imagenes)
ajenos=0     # de otro curso: se listan y no se tocan

# $1 titulo, $2 clase (cobra|residual), $3 las lineas (una por recurso)
seccion() {
  local titulo="$1" clase="$2" lineas="$3"
  local mios="" otros=""

  if [[ -n "${lineas// /}" ]]; then
    mios="$(echo "$lineas" | grep -Ei "$NUESTRO" || true)"
    otros="$(echo "$lineas" | grep -Eiv "$NUESTRO" || true)"
  fi

  local marca="limpio"
  if [[ -n "${mios// /}" ]]; then
    if [[ "$clase" == "residual" ]]; then
      marca="residual"
      residual=$((residual + 1))
    else
      marca="FACTURANDO"
      cobrando=$((cobrando + 1))
    fi
  fi

  printf '  %-36s %s\n' "$titulo" "$marca"
  [[ -n "${mios// /}" ]] && echo "$mios" | sed 's/^/      /'

  if [[ -n "${otros// /}" ]]; then
    ajenos=$((ajenos + 1))
    echo "$otros" | sed 's/^/      (de otro curso, no se toca) /'
  fi
  return 0
}

q() { gcloud "$@" --project "$PROJECT" --format='value(name)' 2>/dev/null || true; }

echo "Computo y almacenamiento"
seccion "Clusteres de GKE" cobra "$(q container clusters list)"
seccion "Instancias de Compute Engine" cobra "$(q compute instances list)"
seccion "Discos persistentes" cobra "$(q compute disks list)"
seccion "Instantaneas" cobra "$(q compute snapshots list)"
echo

echo "Red"
seccion "Direcciones IP reservadas" cobra "$(q compute addresses list)"
seccion "Reglas de reenvio (balanceadores)" cobra "$(q compute forwarding-rules list)"
seccion "Cloud NAT (routers)" cobra "$(q compute routers list)"
echo

echo "Serverless"
# Cloud Run con min-instances 0 no cobra computo en reposo; se lista para que
# no quede un servicio olvidado con min-instances > 0.
seccion "Servicios de Cloud Run" cobra "$(gcloud run services list --project "$PROJECT" --format='value(metadata.name)' 2>/dev/null || true)"
echo

echo "Estado e imagenes"
seccion "Buckets de GCS" residual "$(gcloud storage buckets list --project "$PROJECT" --format='value(name)' 2>/dev/null || true)"
seccion "Repositorios de Artifact Registry" residual "$(q artifacts repositories list)"
echo

[[ $ajenos -gt 0 ]] && echo "Hay $ajenos clase(s) con recursos de otro curso. Este script y el apagado nunca los tocan." && echo

if [[ $cobrando -eq 0 && $residual -eq 0 ]]; then
  echo "RESULTADO: no queda nada de Bank USAC. Coste 0."
  exit 0
fi

if [[ $cobrando -eq 0 ]]; then
  echo "RESULTADO: nada de Bank USAC cobra por hora."
  echo
  echo "Quedan $residual clase(s) residual(es) — el bucket de estado y/o el"
  echo "repositorio de imagenes. Son centavos al mes. Para cero absoluto:"
  echo
  echo "  ./infra/scripts/cloud/cloud-down.sh --purge-state --purge-images"
  echo
  echo "Eso pierde el estado de Terraform y obliga a republicar las siete"
  echo "imagenes antes del siguiente despliegue."
  exit 0
fi

echo "RESULTADO: $cobrando clase(s) de recurso de Bank USAC facturando."
echo
echo "Si acabas de correr el apagado, lo mas probable es una de estas dos:"
echo
echo "  - Discos huerfanos de 'loki' o 'tempo'. Helm nunca borra un"
echo "    volumeClaimTemplate; hay que borrar el PVC con el cluster aun vivo."
echo "  - Reglas de reenvio de un Service LoadBalancer que no se desinstalo"
echo "    antes de destruir el cluster."
echo
echo "El apagado en el orden correcto:  ./infra/scripts/cloud/cloud-down.sh"

$report_only && exit 0
exit 1
