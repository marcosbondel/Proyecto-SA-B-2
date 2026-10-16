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

  # ---------------------------------------------------------------------------
  # Dataplane V2 (T-54, cierra la decisión que TD-088 dejó abierta)
  #
  # **Esto es lo único de este archivo que no se puede cambiar después.** El
  # `datapath_provider` se fija al crear el clúster y no se puede alternar en uno
  # que ya existe: pasar a Dataplane V2 más tarde significa recrear el clúster
  # con todo lo que lleve dentro. Por eso se decide aquí y no cuando haga falta.
  #
  # Para qué sirve: para que una `NetworkPolicy` **haga algo**. Sin un plugin que
  # las aplique, Kubernetes acepta el objeto y lo ignora — el API server lo
  # guarda, `kubectl get` lo muestra, y el tráfico pasa igual. Es el peor modo de
  # fallo que puede tener una regla de seguridad: parece configurada.
  #
  # Qué protege concretamente (TD-088): hasta ahora cualquier pod del clúster
  # podía escribir en Tempo, leer Loki, consultar Prometheus o empujar a los dos
  # Collectors. Los datos ya van redactados antes de escribirse, así que lo
  # expuesto no son datos de clientes — es la telemetría misma, y el filo está
  # ahí: **un pod que puede escribir en Tempo puede falsificar una traza**, y
  # evidencia falsificada es peor que ninguna. Las políticas que lo cierran están
  # en `infra/k8s/helm/bank-observability/templates/network-policies.yaml`.
  #
  # Por qué V2 y no el addon de Calico, que también las aplica: Calico se puede
  # encender en un clúster existente pero recrea los nodos, es el camino
  # anterior, no convive con V2, y añade un DaemonSet que compite por las 6 vCPU
  # de los tres nodos que la cuota permite. V2 va en el dataplane (eBPF) y de
  # paso trae el **registro de políticas**, que es lo que convierte una política
  # en auditable en vez de en una suposición.
  #
  # El coste es pequeño y no nulo: el agente consume algo de memoria por nodo y
  # V2 impone versiones mínimas de imagen de nodo, que el canal `REGULAR` ya
  # cumple.
  datapath_provider = "ADVANCED_DATAPATH"

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
