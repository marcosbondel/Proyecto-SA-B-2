# ==============================================================================
# Outputs de Terraform para Bank USAC en GCP
# ==============================================================================

output "project_id" {
  description = "ID del proyecto en Google Cloud Platform."
  value       = var.project_id
}

output "vpc_name" {
  description = "Nombre de la red VPC aprovisionada."
  value       = google_compute_network.vpc.name
}

output "gke_cluster_name" {
  description = "Nombre del clúster de Kubernetes en GKE."
  value       = google_container_cluster.primary.name
}

output "gke_get_credentials_command" {
  description = "Comando de gcloud para configurar kubectl y conectarse al clúster de GKE."
  value       = "gcloud container clusters get-credentials ${google_container_cluster.primary.name} --zone ${var.zone} --project ${var.project_id}"
}

output "database_private_ips" {
  description = "Direcciones IP privadas de las máquinas virtuales de Compute Engine con PostgreSQL."
  value = {
    for k, instance in google_compute_instance.db_instances :
    k => instance.network_interface[0].network_ip
  }
}

output "artifact_repo" {
  description = "Nombre del repositorio de Artifact Registry. Es el valor de la variable de repositorio ARTIFACT_REPO en GitHub."
  value       = google_artifact_registry_repository.images.repository_id
}

output "image_registry" {
  description = "Prefijo del registry al que empujan release.yml y cd.yml, sin el nombre del componente."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "gateway_public_ip" {
  description = "IP pública reservada del API Gateway. Es el valor de gateway.loadBalancerIP del chart y la dirección que va en el acuerdo de integración con el banco pareja."
  value       = google_compute_address.gateway.address
}

output "gateway_public_url" {
  description = "URL pública del API Gateway. Es el valor de la variable de repositorio GATEWAY_PUBLIC_URL en GitHub."
  value       = local.gateway_public_url
}

output "cloud_run_service_name" {
  description = "Nombre del servicio de Cloud Run del frontend. Es el valor de la variable de repositorio CLOUD_RUN_SERVICE, sin la cual cd.yml no actualiza el portal público (TD-081)."
  value       = length(google_cloud_run_v2_service.web) > 0 ? google_cloud_run_v2_service.web[0].name : null
}

output "cloud_run_web_url" {
  description = "URL pública de acceso a la interfaz web desplegada en Cloud Run."
  value       = length(google_cloud_run_v2_service.web) > 0 ? google_cloud_run_v2_service.web[0].uri : null
}

output "github_repository_variables" {
  description = "Las variables de repositorio que cd.yml y release.yml exigen, con los valores que acaba de producir este apply. Se pegan en Settings > Secrets and variables > Actions > Variables."
  value       = <<-EOT
    GCP_PROJECT_ID     = ${var.project_id}
    GKE_CLUSTER        = ${google_container_cluster.primary.name}
    GKE_ZONE           = ${var.zone}
    ARTIFACT_REPO      = ${google_artifact_registry_repository.images.repository_id}
    GATEWAY_PUBLIC_URL = ${local.gateway_public_url}
    GATEWAY_STATIC_IP  = ${google_compute_address.gateway.address}
    CLOUD_RUN_SERVICE  = ${length(google_cloud_run_v2_service.web) > 0 ? google_cloud_run_v2_service.web[0].name : "(deploy_cloud_run = false)"}
  EOT
}

output "helm_external_ips_example" {
  description = "Ejemplo de parámetros Helm para conectar los microservicios de GKE a las bases de datos en Compute Engine."
  value       = <<-EOT
    helm upgrade --install bank-usac infra/k8s/helm/bank-usac \
      --set external.mode=dockerNetwork \
      --set external.postgresCustomer.dockerNetwork.host=${google_compute_instance.db_instances["customer"].network_interface[0].network_ip} \
      --set external.postgresAccount.dockerNetwork.host=${google_compute_instance.db_instances["account"].network_interface[0].network_ip} \
      --set external.postgresTransaction.dockerNetwork.host=${google_compute_instance.db_instances["transaction"].network_interface[0].network_ip} \
      --set external.postgresPayment.dockerNetwork.host=${google_compute_instance.db_instances["payment"].network_interface[0].network_ip} \
      --set external.postgresNotificationAudit.dockerNetwork.host=${google_compute_instance.db_instances["notification-audit"].network_interface[0].network_ip}
  EOT
}
