# ==============================================================================
# Red Virtual (VPC) y Subredes de Bank USAC en GCP
# ==============================================================================

resource "google_compute_network" "vpc" {
  name                    = var.network_name
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  description             = "VPC principal para microservicios bancarios y bases de datos de Bank USAC"
}

# Subred dedicada para el clúster de Google Kubernetes Engine (GKE)
resource "google_compute_subnetwork" "gke_subnet" {
  name                     = "${var.network_name}-gke-subnet"
  ip_cidr_range            = "10.10.0.0/20"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "gke-pods"
    ip_cidr_range = "10.20.0.0/16"
  }

  secondary_ip_range {
    range_name    = "gke-services"
    ip_cidr_range = "10.30.0.0/20"
  }
}

# Subred dedicada para las máquinas virtuales Compute Engine (Bases de Datos PostgreSQL)
resource "google_compute_subnetwork" "db_subnet" {
  name                     = "${var.network_name}-db-subnet"
  ip_cidr_range            = "10.40.0.0/24"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
}

# Cloud Router para salida a Internet mediante Cloud NAT
resource "google_compute_router" "nat_router" {
  name    = "${var.network_name}-nat-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

# Cloud NAT para permitir que las VMs privadas de base de datos descarguen paquetes
# de PostgreSQL y actualizaciones sin exponer direcciones IP públicas directas.
resource "google_compute_router_nat" "nat_gateway" {
  name                               = "${var.network_name}-nat-gw"
  router                             = google_compute_router.nat_router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = false
    filter = "ERRORS_ONLY"
  }
}

# ==============================================================================
# Reglas de Firewall (Seguridad de Red)
# ==============================================================================

# Permite comunicación completa dentro de la red privada VPC (entre GKE y las VMs de base de datos)
resource "google_compute_firewall" "allow_internal" {
  name        = "${var.network_name}-allow-internal"
  network     = google_compute_network.vpc.name
  description = "Permite comunicacion interna entre subredes de GKE y BDs PostgreSQL"

  allow {
    protocol = "icmp"
  }

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  source_ranges = [
    "10.10.0.0/20", # GKE Nodes
    "10.20.0.0/16", # GKE Pods
    "10.30.0.0/20", # GKE Services
    "10.40.0.0/24"  # DB VMs
  ]
}

# Permite acceso SSH seguro mediante Cloud IAP (Identity-Aware Proxy) sin IP pública
resource "google_compute_firewall" "allow_ssh_iap" {
  name        = "${var.network_name}-allow-ssh-iap"
  network     = google_compute_network.vpc.name
  description = "Permite acceso administrativo SSH a traves de Google Cloud IAP"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
}

# Permite verificaciones de salud de los balanceadores de carga de Google Cloud
resource "google_compute_firewall" "allow_health_checks" {
  name        = "${var.network_name}-allow-health-checks"
  network     = google_compute_network.vpc.name
  description = "Permite verificaciones de estado de los balanceadores de carga de GCP"

  allow {
    protocol = "tcp"
  }

  source_ranges = [
    "130.211.0.0/22",
    "35.191.0.0/16"
  ]
}
