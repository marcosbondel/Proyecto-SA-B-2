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

output "cloud_run_web_url" {
  description = "URL pública de acceso a la interfaz web desplegada en Cloud Run."
  value       = length(google_cloud_run_v2_service.web) > 0 ? google_cloud_run_v2_service.web[0].uri : null
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
