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
  description = "URI del contenedor de la aplicación frontend Web (ej. us-central1-docker.pkg.dev/MI-PROYECTO/bank-repo/web:latest)."
  default     = "us-central1-docker.pkg.dev/cloudrun/container/hello:latest"
}

variable "gateway_public_url" {
  type        = string
  description = "URL pública de acceso al API Gateway para inyectar en NUXT_PUBLIC_API_BASE_URL del frontend Web."
  default     = "http://34.123.45.67:3000"
}
