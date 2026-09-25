# Diagrama de Despliegue UML 2 — Bank USAC

Este documento describe el despliegue del sistema bancario **Bank USAC**, especificando los nodos físicos y de virtualización, contenedores, servicios Kubernetes, puertos y protocolos de red.

Para **ejecutar** este despliegue —prerrequisitos, comandos, verificación y
resolución de fallos— el procedimiento está en
[`docs/operations/DEPLOYMENT.md`](../operations/DEPLOYMENT.md). Este documento
explica la forma; aquel explica cómo levantarla.

---

## 1. Diagrama de Despliegue Local (Fase 1)

![Diagrama de Despliegue Local — Bank USAC](diagrams/05-uml-despliegue.png)

Fuentes de diagramación versionadas:
* [PlantUML (`.puml`)](diagrams/05-uml-despliegue.puml)

> **Los puertos reenviados, por escrito.** El `port-forward` mapea
> `localhost:3000 → gateway` y `localhost:3010 → frontend`; así lo declara la
> fuente `.puml`, así lo fija `pnpm k8s:forward` y así lo exigen
> `web.apiBaseUrl` y `gateway.corsAllowedOrigins` en `values.yaml`. La imagen
> exportada de esta sección fue recompuesta a mano y quedó por detrás de su
> fuente en este punto: si la lees al revés, la fuente manda.

### Topología Local (Kind / Helm)
* **Host de Desarrollo (`Developer Host` · `<<device>>`)**:
  * Ejecuta los 5 contenedores de PostgreSQL 18.4 (puertos `:5433` a `:5437`), garantizando aislamiento físico de datos (*Database-per-Service*).
  * Ejecuta el clúster RabbitMQ 4.3 (puertos `:5672` AMQP y `:15672` Management).
  * Ejecuta MinIO S3 (puertos `:9000` API y `:9001` Console).
* **Clúster Kubernetes Local (`kind cluster` / Helm)**:
  * **Frontend**: Deployment `frontend` (Pod Nuxt 3) expuesto en `localhost:3010`.
  * **API Gateway**: Deployment `gateway` (Pod NestJS) expuesto en `localhost:3000`.
  * **5 Servicios de Dominio**: Deployments independientes (`customer`, `account`, `transaction`, `payment`, `notification-audit`) con `ClusterIP` interno.
  * **Configuración y Secretos**: `ConfigMap/bank-usac-config` y `Secret/bank-usac-secrets`.

---

## 2. Diagrama de Despliegue en la Nube (GCP — Fase 2)

![Diagrama de Despliegue en la Nube GCP — Bank USAC](diagrams/08-despliegue-cloud-gcp.png)

Fuentes de diagramación versionadas:
* [PlantUML (`.puml`)](diagrams/08-despliegue-cloud-gcp.puml)

### Topología en Google Cloud Platform (IaC con Terraform)
Para la **Fase 2**, la infraestructura se aprovisiona mediante Terraform (`infra/terraform/gcp/`) con una arquitectura segmentada y resiliente:

1. **Frontend Serverless en Google Cloud Run**:
   - Servicio `bank-usac-web` en Cloud Run ejecutando el contenedor Nitro/Nuxt 3 en el puerto `8080`.
   - Autoescalado elástico de **0 a 5 instancias** (*scale-to-zero* en ausencia de tráfico).
   - Consume la variable pública `NUXT_PUBLIC_API_BASE_URL` apuntando al API Gateway en GKE.

2. **Red Virtual Privada (VPC `bank-usac-vpc`)**:
   - **Subred GKE (`10.10.0.0/20`)**: Aloja el plano de datos de Kubernetes, con rangos secundarios para Pods (`10.20.0.0/16`) y Services (`10.30.0.0/20`).
   - **Subred Bases de Datos (`10.40.0.0/24`)**: Subred privada dedicada exclusivamente a las máquinas virtuales de PostgreSQL.
   - **Cloud Router & Cloud NAT**: Permite que las VMs privadas de base de datos descarguen actualizaciones y paquetes de software sin exponer IPs públicas a Internet.
   - **Firewall VPC**: Bloqueo perimetral estricto; el puerto 5432 de PostgreSQL solo es alcanzable desde los nodos y pods de GKE.

3. **Clúster Administrado de Google Kubernetes Engine (GKE)**:
   - **Microservicios con HPA al 80% CPU**: API Gateway, Customer, Account, Transaction, Payment y Notification & Audit Service escalan automáticamente entre 1 y 5 réplicas ante incrementos de carga.
   - **Broker RabbitMQ**: StatefulSet con colas durables en el puerto interno `5672`.
   - **MinIO Object Storage**: StatefulSet para almacenamiento de fotos de DPI en el puerto interno `9000`.

4. **Bases de Datos en Máquinas Virtuales Compute Engine**:
   - 5 instancias Compute Engine independientes (`bank-db-customer`, `bank-db-account`, `bank-db-transaction`, `bank-db-payment`, `bank-db-audit`).
   - Aprovisionadas con scripts desatendidos (*startup-scripts*) que instalan PostgreSQL, configuran `listen_addresses = '*'` y reglas de acceso en `pg_hba.conf` para la subred privada de GKE.

---

## 3. Matriz Comparativa: Local (Fase 1) vs Cloud GCP (Fase 2)

| Componente | Despliegue Local (Fase 1) | Despliegue Cloud GCP (Fase 2) | Beneficio Arquitectónico |
|---|---|---|---|
| **Frontend Web** | Pod en Kind (`localhost:3010`) | Google Cloud Run (Serverless) | Costo cero en reposo (*scale-to-zero*) y alta disponibilidad global |
| **API Gateway y Microservicios** | Pods estáticos (1 réplica) en Kind | Pods en GKE con **HPA al 80% CPU** (1 a 5 réplicas) | Elasticidad automática ante picos de transacciones financieras |
| **Bases de Datos (5 PostgreSQL)** | Contenedores en Docker Engine del host | **5 Máquinas Virtuales Compute Engine** | Aislamiento físico de cómputo por dominio y persistencia empresarial |
| **Red y Seguridad** | Red interna Docker tipo puente (`bridge`) | **VPC de GCP** con subredes privadas, Cloud NAT y Firewall | Cero exposición pública de datos bancarios sensibles |
| **Aprovisionamiento** | Docker Compose + Helm local | **Terraform (IaC)** + Helm sobre GKE | Despliegue 100% reproducible y auditable en código |

---

## 4. Protocolos y Puertos de Comunicación

* **HTTPS :443**: Acceso de los cuentahabientes y cajeros a Cloud Run y al API Gateway público.
* **TCP 3000**: API Gateway Ingress en GKE (REST / JSON).
* **AMQP 0-9-1 / TCP 5672**: Comunicación asíncrona bidireccional entre pods y RabbitMQ en GKE.
* **PostgreSQL / TCP 5432**: Comunicación síncrona privada entre cada pod y su VM dedicada en Compute Engine (`10.40.0.0/24`).
* **S3-compatible / TCP 9000**: Streaming de imágenes de DPI hacia MinIO.

---

## 5. Justificación Arquitectónica: MinIO en GKE vs Almacenamiento Gestionado (Google Cloud Storage)

Aun cuando la plataforma se despliega sobre Google Cloud Platform, el almacenamiento de objetos para documentos de identidad (DPI y pasaportes) se ejecuta mediante **MinIO StatefulSet en GKE** en lugar de un bucket nativo de Google Cloud Storage (GCS). Esta decisión obedece a las mejores prácticas de la industria bancaria:

1. **Soberanía y Perímetro de Seguridad (Modelo Zero Trust):**
   * Los documentos de identificación son datos personales altamente sensibles (*PII*).
   * Al alojarse en MinIO dentro de la VPC privada (`10.10.0.0/20`), el tráfico de subida, descarga y validación criptográfica nunca viaja por la Internet pública ni reside en almacenes multi-inquilino compartidos. Se eliminan riesgos de filtración por políticas erróneas de IAM público.
2. **Mitigación de *Vendor Lock-In* y Cumplimiento Regulatorio (Estrategia de Salida):**
   * MinIO implementa la API estándar abierta de **Amazon S3** (`@aws-sdk/client-s3`).
   * Los entes reguladores del sector bancario (como la Superintendencia de Bancos - SIB) exigen planes de contingencia y portabilidad. Gracias al estándar S3, el banco puede trasladar su infraestructura entre GCP, AWS, Azure o data centers privados (On-Premise) sin modificar una sola línea de código fuente.
3. **Paridad de Entornos (Principio X de The Twelve-Factor App):**
   * El comportamiento del almacenamiento es exactamente el mismo en desarrollo local (Docker/Kind) que en el clúster de producción (GKE).
   * Toda la suite de integración (`pnpm test`, `pnpm images:flow`) se ejecuta de manera determinista, reproducible y 100% offline sin incurrir en dependencias de conexión ni costos de nube por desarrollador.
4. **Previsibilidad de Costos y Latencia Interna:**
   * GCS factura por operaciones de API (Clase A y B) y transferencia de red (*egress*). En un sistema con alto volumen de transacciones y validaciones, estos cobros variables aumentan los costos operativos.
   * MinIO opera sobre los volúmenes persistentes del clúster con costo fijo, cero cobro por petición y latencia de red sub-milisegundo dentro de la VPC.


