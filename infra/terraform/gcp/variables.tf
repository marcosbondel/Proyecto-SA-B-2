variable "project_id" {
  type        = string
  description = "Identificador único del proyecto en Google Cloud Platform (GCP)."
}

variable "region" {
  type        = string
  description = "Región de GCP donde se aprovisionarán los recursos."
  default     = "us-central1"
}

variable "zone" {
  type        = string
  description = "Zona específica de GCP para instancias de Compute Engine y nodos GKE."
  default     = "us-central1-a"
}

variable "network_name" {
  type        = string
  description = "Nombre de la red de nube privada virtual (VPC) para el banco."
  default     = "bank-usac-vpc"
}

variable "artifact_repo" {
  type        = string
  description = "Nombre del repositorio de Artifact Registry al que el pipeline publica las imágenes. Es el valor de la variable de repositorio ARTIFACT_REPO en GitHub."
  default     = "bank-images"
}

variable "gke_machine_type" {
  type        = string
  description = "Tipo de máquina para los nodos del clúster de Google Kubernetes Engine (GKE)."
  default     = "e2-standard-2"
}

variable "gke_node_count" {
  type        = number
  description = "Número inicial de nodos para el pool de trabajo de GKE."
  default     = 3
}

variable "gke_node_disk_size_gb" {
  type        = number
  description = "Disco por nodo de GKE, en GB. El defecto de GKE es 100 y no cabe: tres nodos superan la cuota SSD_TOTAL_GB de 250 GB de la region. Ver el comentario en gke.tf."
  default     = 50
}

variable "gke_node_disk_type" {
  type        = string
  description = "Tipo de disco de los nodos. `pd-balanced` cuenta contra SSD_TOTAL_GB; `pd-standard` contra DISKS_TOTAL_GB, que tiene mucho mas margen pero es mas lento al bajar imagenes."
  default     = "pd-balanced"
}

variable "vm_machine_type" {
  type        = string
  description = "Tipo de máquina Compute Engine para las instancias de base de datos PostgreSQL."
  default     = "e2-medium"
}

variable "db_default_password" {
  type        = string
  description = "Contraseña por defecto para los usuarios de las bases de datos si no se especifica una particular."
  default     = "changeme"
  sensitive   = true
}

variable "db_passwords" {
  type        = map(string)
  description = "Mapa de contraseñas específicas por servicio: customer, account, transaction, payment, notification_audit."
  default     = {}
  sensitive   = true
}

variable "deploy_cloud_run" {
  type        = bool
  description = "Indica si se despliega el frontend Web en Google Cloud Run."
  default     = true
}

variable "web_image" {
  type        = string
  description = "URI del contenedor del frontend. El defecto es sólo un marcador: `cd.yml` apunta el servicio a la versión publicada en cada merge a `main` (TD-081), y `cloud_run.tf` ignora los cambios de este campo para no revertirlo."
  # `us-docker.pkg.dev`, no `us-central1-docker.pkg.dev`.
  #
  # El valor anterior era regional y el primer apply real (2026-10-14) fallo con
  # «Permission 'artifactregistry.repositories.downloadArtifacts' denied on
  # .../projects/cloudrun/locations/us-central1/repositories/container»: ese
  # espejo regional del contenedor de ejemplo de Google no es legible para esta
  # cuenta. El multirregional `us-docker.pkg.dev/cloudrun/container/hello` si lo
  # es, y es el que la documentacion de Cloud Run nombra.
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "gateway_public_url" {
  type        = string
  description = "URL pública del API Gateway que el NAVEGADOR resuelve, inyectada en NUXT_PUBLIC_API_BASE_URL del frontend. Vacía —lo recomendado— la deriva de la IP reservada en gateway_address.tf, para que no haya una dirección escrita a mano que se quede obsoleta."
  default     = ""
}

variable "gateway_port" {
  type        = number
  description = "Puerto en el que el Service del Gateway publica. Debe coincidir con gateway.port del chart de Helm."
  default     = 3000
}
