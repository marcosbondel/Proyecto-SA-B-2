# ==============================================================================
# Google Cloud Run para la Aplicación Frontend Web (Nuxt 3)
# Requisito Fase 2: Cloud Run para Frontend
# ==============================================================================

locals {
  # La dirección del Gateway tal como la alcanza el navegador. Se deriva de la
  # IP reservada salvo que alguien la fije a mano (por ejemplo para poner un
  # nombre DNS delante). Antes era el valor por defecto de una variable —
  # `http://34.123.45.67:3000`, una IP de ejemplo— y el riesgo era desplegar un
  # frontend que no puede hablar con su backend sin que nada lo reportara.
  gateway_public_url = (
    var.gateway_public_url != ""
    ? var.gateway_public_url
    : "http://${google_compute_address.gateway.address}:${var.gateway_port}"
  )
}

resource "google_cloud_run_v2_service" "web" {
  count    = var.deploy_cloud_run ? 1 : 0
  name     = "bank-usac-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.web_image

      ports {
        container_port = 8080
      }


      env {
        name  = "NITRO_PORT"
        value = "8080"
      }

      env {
        name  = "NUXT_PUBLIC_API_BASE_URL"
        value = local.gateway_public_url
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  # Quién manda sobre la imagen: el pipeline, no este archivo.
  #
  # `cd.yml` apunta este servicio a la versión publicada en cada merge a `main`
  # (el paso «Actualizar el frontend publico (Cloud Run)», que cierra TD-081).
  # Sin esta exclusión, el siguiente `terraform apply` vería la imagen del
  # pipeline como una desviación y devolvería el frontend a `var.web_image` —
  # que por defecto es el contenedor `hello` de Google. Terraform crea el
  # servicio; el pipeline decide qué versión sirve.
  #
  # `client` y `client_version` los escribe `gcloud run deploy` del pipeline
  # (cd.yml) en cada despliegue; sin ignorarlos, cada `terraform plan` posterior
  # muestra un cambio in-place que no significa nada.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

# Permite acceso público y anónimo al portal web bancario
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count    = var.deploy_cloud_run ? 1 : 0
  name     = google_cloud_run_v2_service.web[0].name
  location = google_cloud_run_v2_service.web[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
