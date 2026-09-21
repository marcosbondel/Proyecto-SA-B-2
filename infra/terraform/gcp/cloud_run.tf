# ==============================================================================
# Google Cloud Run para la Aplicación Frontend Web (Nuxt 3)
# Requisito Fase 2: Cloud Run para Frontend
# ==============================================================================

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
        name  = "PORT"
        value = "8080"
      }

      env {
        name  = "NITRO_PORT"
        value = "8080"
      }

      env {
        name  = "NUXT_PUBLIC_API_BASE_URL"
        value = var.gateway_public_url
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
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
