# ==============================================================================
# Arranque — el bucket donde vive el estado del módulo principal
#
# Se ejecuta UNA vez por proyecto de GCP, antes del primer `terraform init` del
# módulo de arriba, y con estado local: no puede guardar su estado en el bucket
# que todavía no existe. Es el único lugar del repositorio donde eso es cierto.
#
#   cd infra/terraform/gcp/bootstrap
#   terraform init
#   terraform apply -var project_id=<proyecto>
#   terraform output -raw backend_hcl > ../backend.hcl
#
# Después, en el módulo de arriba:
#
#   cd .. && terraform init -backend-config=backend.hcl
#
# Por qué existe como módulo en vez de como un `gcloud storage buckets create`
# en la documentación: el versionado del objeto de estado es lo que permite
# recuperarse de un `apply` interrumpido, y un bucket creado a mano no lo tiene
# por defecto. Un comando que hay que recordar con la bandera correcta es
# exactamente el tipo de paso manual que TD-079 y TD-080 convirtieron en
# incidente.
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.15"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "Identificador del proyecto de GCP donde vivirá el estado de Terraform."
}

variable "region" {
  type        = string
  description = "Región del bucket de estado. La misma del resto del sistema."
  default     = "us-central1"
}

variable "state_bucket_name" {
  type        = string
  description = "Nombre del bucket de estado. Vacío lo deriva del proyecto, que es lo recomendado: los nombres de bucket son globales."
  default     = ""
}

locals {
  bucket_name = var.state_bucket_name != "" ? var.state_bucket_name : "${var.project_id}-tfstate"
}

resource "google_storage_bucket" "tfstate" {
  name     = local.bucket_name
  location = var.region

  # Sin esto, un `apply` interrumpido puede dejar un estado truncado y no hay
  # nada a lo que volver. Es la razón de que este bucket sea código.
  versioning {
    enabled = true
  }

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # El estado describe la infraestructura, no datos del banco. Aun así nunca
  # debe borrarse por accidente: Terraform se niega a destruir el bucket
  # mientras tenga objetos.
  force_destroy = false

  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    app = "bank-usac"
  }
}

output "state_bucket" {
  description = "Nombre del bucket de estado."
  value       = google_storage_bucket.tfstate.name
}

output "backend_hcl" {
  description = "Contenido del backend.hcl que necesita el módulo principal."
  value       = "bucket = \"${google_storage_bucket.tfstate.name}\"\n"
}
