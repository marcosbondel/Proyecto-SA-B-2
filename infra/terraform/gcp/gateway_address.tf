# ==============================================================================
# La entrada pública del banco — una IP reservada para el Gateway
#
# Cierra TD-080. El `Service` de tipo LoadBalancer del Gateway era el punto de
# entrada de todo el sistema y no existía en ningún archivo del repositorio:
# se creaba con un `kubectl patch` a mano y sobrevivía sólo porque el
# *three-way merge* de Helm deja quieto un campo que no cambió entre la
# revisión anterior y la nueva. Borrar el Service, o instalar el release en un
# namespace nuevo, dejaba el sistema sin URL pública y el despliegue en verde.
#
# Esta dirección es **regional y externa**, que es lo que GKE necesita para
# fijarla en un balanceador de paso (`spec.loadBalancerIP`). La reserva vive en
# el proyecto, no en el clúster: borrar el Service, el release o el namespace
# entero no la libera, así que la dirección que va en el acuerdo de integración
# con el banco pareja (§4.1 del enunciado de la Fase 3) sigue siendo la misma
# después de un `helm upgrade`, de un `helm uninstall` o de recrear el clúster.
#
# Quién la consume:
#   - `infra/k8s/helm/bank-usac/values.yaml` → `gateway.loadBalancerIP`, que
#     `cd.yml` pasa en el despliegue a producción.
#   - `var.gateway_public_url`, que el frontend de Cloud Run resuelve en el
#     navegador. Si no se fija a mano, se deriva de aquí (ver `cloud_run.tf`).
# ==============================================================================

resource "google_compute_address" "gateway" {
  name         = "${var.network_name}-gateway"
  description  = "IP pública del API Gateway de Bank USAC (Service LoadBalancer en GKE)"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"
}

# La IP de desarrollo NO se reserva a propósito. `dev` también renderiza un
# Service de tipo LoadBalancer, pero con dirección efímera: nadie externo tiene
# que poder apuntar a desarrollo de forma estable, y una reserva ociosa se
# cobra igual que una en uso.
