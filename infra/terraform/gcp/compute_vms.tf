# ==============================================================================
# Instancias de Compute Engine para Bases de Datos PostgreSQL
# Requisito Fase 2: Bases de datos en Máquinas Virtuales de GCP
# ==============================================================================

locals {
  databases = {
    customer = {
      service_name = "customer"
      db_name      = "customer"
      db_user      = "customer_app"
    }
    account = {
      service_name = "account"
      db_name      = "account"
      db_user      = "account_app"
    }
    transaction = {
      service_name = "transaction"
      db_name      = "transaction"
      db_user      = "transaction_app"
    }
    payment = {
      service_name = "payment"
      db_name      = "payment"
      db_user      = "payment_app"
    }
    notification-audit = {
      service_name = "notification-audit"
      db_name      = "notification_audit"
      db_user      = "notification_audit_app"
    }
  }
}

resource "google_compute_instance" "db_instances" {
  for_each     = local.databases
  name         = "bank-db-${each.key}"
  machine_type = var.vm_machine_type
  zone         = var.zone
  description  = "Instancia de PostgreSQL para el microservicio ${each.value.service_name}"

  tags = ["bank-database", "postgres"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
      type  = "pd-standard"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.db_subnet.id
    # Sin IP pública externa: comunicación privada y segura dentro de la VPC
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e
    echo "Iniciando provisionamiento automatico de PostgreSQL para ${each.value.service_name}..."

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y postgresql postgresql-contrib

    PG_CONF=$(find /etc/postgresql/ -name postgresql.conf)
    PG_HBA=$(find /etc/postgresql/ -name pg_hba.conf)

    # Permitir que PostgreSQL escuche en todas las interfaces de red de la VM
    sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" "$PG_CONF"
    sed -i "s/listen_addresses = 'localhost'/listen_addresses = '*'/g" "$PG_CONF"

    # Configurar autenticacion md5 para las subredes internas de la VPC (10.0.0.0/8)
    echo "host    all             all             10.0.0.0/8            md5" >> "$PG_HBA"
    echo "host    all             all             127.0.0.1/32          md5" >> "$PG_HBA"

    # Reiniciar PostgreSQL para aplicar cambios de configuracion de red
    systemctl restart postgresql
    systemctl enable postgresql

    # Crear usuario y base de datos con contrasena segura
    DB_PASS="${lookup(var.db_passwords, each.key, var.db_default_password)}"

    sudo -u postgres psql -v ON_ERROR_STOP=1 <<-EOSQL
      DO \$\$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${each.value.db_user}') THEN
          CREATE ROLE ${each.value.db_user} WITH LOGIN PASSWORD '$DB_PASS';
        ELSE
          ALTER ROLE ${each.value.db_user} WITH PASSWORD '$DB_PASS';
        END IF;
      END
      \$\$;

      SELECT 'CREATE DATABASE ${each.value.db_name} OWNER ${each.value.db_user}'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${each.value.db_name}')\gexec

      GRANT ALL PRIVILEGES ON DATABASE ${each.value.db_name} TO ${each.value.db_user};
    EOSQL

    echo "PostgreSQL aprovisionado exitosamente para la base de datos ${each.value.db_name}."
  EOF

  # SIN `create_before_destroy`, a propósito. Con él, reemplazar una VM crea la
  # nueva antes de borrar la vieja y necesita una 9.ª instancia, pero la cuota
  # INSTANCES del proyecto es 8 y el sistema usa exactamente 8 (5 VMs + 3 nodos
  # de GKE). Así ningún reemplazo cabía jamás: el 2026-10-19 mover las VMs de
  # zona falló con "Quota 'INSTANCES' exceeded" y hubo que borrar a mano las
  # VMs viejas (vacías) para que Terraform siguiera.
  #
  # El orden por defecto (borrar y luego crear) sí cabe. El costo es que el
  # reemplazo de una VM con datos los pierde: es el disco de arranque el que
  # guarda PostgreSQL. Por eso un reemplazo de VM aquí exige un respaldo antes,
  # nunca un `apply` a ciegas — `terraform plan` dice "must be replaced".
}
