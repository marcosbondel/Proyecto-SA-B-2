# Infraestructura como Código (IaC) en Google Cloud Platform — Bank USAC

Este directorio contiene la definición completa en **Terraform** para aprovisionar la infraestructura cloud de **Bank USAC** en **Google Cloud Platform (GCP)**, conforme a los requerimientos de la **Fase 2 / Proyecto 2**:

1. **Red Virtual Privada (VPC)** con subredes separadas para GKE y Bases de Datos, reglas de firewall internas y salida segura a Internet vía **Cloud NAT**.
2. **Máquinas Virtuales (Compute Engine)** para hospedar de forma independiente las 5 bases de datos relacionales PostgreSQL con scripts de aprovisionamiento desatendido (*startup-script*).
3. **Clúster de Kubernetes (GKE)** administrado para desplegar los microservicios backend, el API Gateway, el broker de mensajería (RabbitMQ) y el almacenamiento de objetos (MinIO).
4. **Google Cloud Run** para el despliegue serverless de la aplicación frontend Web (Nuxt 3).
5. **Configuración de Autoescalado Horizontal (HPA)** integrado en los templates de Helm al 80% de utilización de CPU.

---

## Estructura de Archivos

```
infra/terraform/gcp/
├── versions.tf               # Requisitos de versión de Terraform y Google Provider
├── variables.tf              # Parámetros configurables (proyecto, región, tipos de máquina)
├── vpc.tf                    # VPC, subredes GKE/DB, Cloud Router, Cloud NAT y Firewall
├── compute_vms.tf            # Instancias Compute Engine para PostgreSQL (Customer, Account, etc.)
├── gke.tf                    # Clúster de Kubernetes y Node Pool administrado
├── cloud_run.tf              # Despliegue de frontend Web en Cloud Run
├── outputs.tf                # Direcciones IP privadas, credenciales GKE y comando Helm
├── terraform.tfvars.example  # Archivo de ejemplo con las variables requeridas
└── README.md                 # Esta guía paso a paso
```

---

## 1. Requisitos Previos

1. **Google Cloud SDK (`gcloud`)** instalado y actualizado:
   ```bash
   gcloud version
   ```
2. **Terraform** (>= 1.5.0):
   ```bash
   terraform version
   ```
3. **Helm** (v3.x) y **kubectl**:
   ```bash
   helm version
   kubectl version --client
   ```
4. Proyecto activo en GCP con facturación habilitada.

---

## 2. Preparación del Entorno GCP

Autentícate en tu cuenta de Google Cloud y establece el proyecto de trabajo:

```bash
# Iniciar sesión en GCP
gcloud auth login
gcloud auth application-default login

# Establecer el ID de tu proyecto
export GCP_PROJECT_ID="tu-proyecto-gcp-id"
gcloud config set project $GCP_PROJECT_ID

# Habilitar las APIs requeridas de Google Cloud
gcloud services enable \
  compute.googleapis.com \
  container.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com
```

---

## 3. Configuración de Variables

Copia el archivo de ejemplo `terraform.tfvars.example` a `terraform.tfvars`:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edita `terraform.tfvars` colocando el ID de tu proyecto y las credenciales deseadas:

```hcl
project_id          = "tu-proyecto-gcp-id"
region              = "us-central1"
zone                = "us-central1-a"
network_name        = "bank-usac-vpc"
gke_machine_type    = "e2-standard-2"
gke_node_count      = 3
vm_machine_type     = "e2-medium"
db_default_password = "BankUsacSecurePassword#2026"
deploy_cloud_run    = true
```

---

## 4. Despliegue con Terraform

Ejecuta el ciclo estándar de Terraform desde la carpeta `infra/terraform/gcp`:

```bash
# 1. Inicializar proveedores y módulos
terraform init

# 2. Validar sintaxis y configuración
terraform validate

# 3. Previsualizar los recursos a crear
terraform plan

# 4. Aprovisionar la infraestructura en GCP
terraform apply
```

Al finalizar exitosamente (aproximadamente 6 a 10 minutos debido a la creación del clúster GKE y las VMs), Terraform imprimirá en pantalla las IPs privadas asignadas a las máquinas virtuales de PostgreSQL y el comando para enlazar `kubectl`.

---

## 5. Conexión y Despliegue de Microservicios con Helm

1. **Configurar el contexto de `kubectl`:**
   ```bash
   $(terraform output -raw gke_get_credentials_command)
   ```

2. **Verificar los nodos de GKE:**
   ```bash
   kubectl get nodes
   ```

3. **Desplegar la plataforma bancaria en GKE utilizando Helm:**
   Usa el comando generado automáticamente en los outputs de Terraform, el cual mapea las IPs privadas de las VMs de Compute Engine a los servicios de base de datos internos:

   ```bash
   # Obtener el comando exacto con las IPs reales aprovisionadas:
   terraform output -raw helm_external_ips_example
   ```

   El comando tendrá la siguiente estructura:
   ```bash
   helm upgrade --install bank-usac ../../k8s/helm/bank-usac \
     --set external.mode=dockerNetwork \
     --set external.postgresCustomer.dockerNetwork.host=<IP_VM_CUSTOMER> \
     --set external.postgresAccount.dockerNetwork.host=<IP_VM_ACCOUNT> \
     --set external.postgresTransaction.dockerNetwork.host=<IP_VM_TRANSACTION> \
     --set external.postgresPayment.dockerNetwork.host=<IP_VM_PAYMENT> \
     --set external.postgresNotificationAudit.dockerNetwork.host=<IP_VM_NOTIFICATION_AUDIT> \
     --set secrets.jwtSecret="BankUsacSecret2026" \
     --set secrets.rabbitmq.password="changeme" \
     --set secrets.objectStorage.accessKey="minioadmin" \
     --set secrets.objectStorage.secretKey="minioadmin" \
     --set secrets.databases.customer.password="BankUsacSecurePassword#2026" \
     --set secrets.databases.account.password="BankUsacSecurePassword#2026" \
     --set secrets.databases.transaction.password="BankUsacSecurePassword#2026" \
     --set secrets.databases.payment.password="BankUsacSecurePassword#2026" \
     --set secrets.databases.notificationAudit.password="BankUsacSecurePassword#2026"
   ```

4. **Verificar el Autoescalado (HPA):**
   ```bash
   kubectl get hpa
   ```
   Comprobarás que los pods escalan automáticamente cuando el consumo de CPU supera el umbral del **80%**.

---

## 6. Limpieza de Recursos (Destrucción)

Para evitar consumos innecesarios de créditos o facturación en GCP una vez finalizada la evaluación:

```bash
# 1. Desinstalar el release de Helm en el clúster
helm uninstall bank-usac

# 2. Destruir toda la infraestructura aprovisionada por Terraform
terraform destroy
```
