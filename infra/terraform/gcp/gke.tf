# ==============================================================================
# Clúster de Google Kubernetes Engine (GKE) para Microservicios Bancarios
# Requisito Fase 2: GKE para Backend, Broker RabbitMQ y MinIO
# ==============================================================================

resource "google_container_cluster" "primary" {
  name     = "${var.network_name}-gke"
  location = var.zone

  # Eliminamos el node pool por defecto para administrar un node pool dedicado
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.gke_subnet.id

  # Configuración de red nativa de VPC (Alias IPs)
  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods"
    services_secondary_range_name = "gke-services"
  }

  addons_config {
    horizontal_pod_autoscaling {
      disabled = false # HPA activado en el plano de control
    }
    http_load_balancing {
      disabled = false
    }
  }

  release_channel {
    channel = "REGULAR"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  deletion_protection = false
}

# Node Pool administrado para ejecutar los microservicios
resource "google_container_node_pool" "primary_nodes" {
  name       = "${var.network_name}-node-pool"
  location   = var.zone
  cluster    = google_container_cluster.primary.name
  node_count = var.gke_node_count

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    preemptible  = false
    machine_type = var.gke_machine_type

    # El disco de los nodos, y por que no es el que GKE pone por defecto.
    #
    # GKE usa 100 GB `pd-balanced` por nodo si no se dice nada, y `pd-balanced`
    # cuenta contra la cuota **SSD_TOTAL_GB**, que en esta region son 250 GB.
    # Tres nodos piden 300 y el `apply` falla a mitad: dos nodos arrancan, el
    # tercero muere con `GCE_QUOTA_EXCEEDED` y el node pool queda en estado
    # ERROR — con el cluster ya creado y facturando. Lo encontro el primer apply
    # real del 2026-10-14; ni `terraform validate` ni `plan` lo ven, porque la
    # cuota no esta en el plan.
    #
    # 50 GB x 3 = 150 GB, y deja 100 GB de la misma cuota para los PVC del stack
    # de observabilidad (32 GiB), que usan la StorageClass `standard-rwo` y por
    # tanto tambien son `pd-balanced`. Un nodo de GKE no guarda datos: solo
    # imagenes y capas, y 50 GB sobran para siete.
    disk_size_gb = var.gke_node_disk_size_gb
    disk_type    = var.gke_node_disk_type

    labels = {
      app = "bank-usac"
    }

    tags = ["gke-node", "bank-usac"]

    oauth_scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/devstorage.read_only"
    ]

    metadata = {
      disable-legacy-endpoints = "true"
    }
  }
}
