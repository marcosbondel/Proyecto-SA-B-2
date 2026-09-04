# Diagrama de Despliegue UML 2 — Bank USAC

Este documento describe el despliegue del sistema bancario **Bank USAC**, especificando los nodos físicos y de virtualización, contenedores, servicios Kubernetes, puertos y protocolos de red.

Para **ejecutar** este despliegue —prerrequisitos, comandos, verificación y
resolución de fallos— el procedimiento está en
[`docs/operations/DEPLOYMENT.md`](../operations/DEPLOYMENT.md). Este documento
explica la forma; aquel explica cómo levantarla.

---

## 1. Diagrama de Despliegue

![Diagrama de Despliegue — Bank USAC](diagrams/05-uml-despliegue.png)

Fuentes de diagramación versionadas:
* [PlantUML (`.puml`)](diagrams/05-uml-despliegue.puml)

> **Los puertos reenviados, por escrito.** El `port-forward` mapea
> `localhost:3000 → gateway` y `localhost:3010 → frontend`; así lo declara la
> fuente `.puml`, así lo fija `pnpm k8s:forward` y así lo exigen
> `web.apiBaseUrl` y `gateway.corsAllowedOrigins` en `values.yaml`. La imagen
> exportada de esta sección fue recompuesta a mano y quedó por detrás de su
> fuente en este punto: si la lees al revés, la fuente manda.

---

## 2. Topología de Despliegue

### Host de Desarrollo (`Developer Host` · `<<device>>`)
* **Docker Engine (`<<executionEnvironment>>`)**:
  * Ejecuta los 5 contenedores de PostgreSQL 18.4 (puertos `:5433` a `:5437`), garantizando aislamiento físico de datos (*Database-per-Service*).
  * Ejecuta el cluster RabbitMQ 4.3 (puertos `:5672` AMQP y `:15672` Management).
  * Ejecuta MinIO S3 (puertos `:9000` API y `:9001` Console).

### Clúster Kubernetes Local (`kind cluster` / Helm)
* **Namespace `bank-usac`**:
  * **Frontend**: Deployment `frontend` (Pod Nuxt 4) expuesto vía `kubectl port-forward` en `localhost:3010`.
  * **API Gateway**: Deployment `gateway` (Pod NestJS) expuesto vía `kubectl port-forward` en `localhost:3000`.
  * **5 Servicios de Dominio**: Deployments independientes (`customer`, `account`, `transaction`, `payment`, `notification-audit`) con `ClusterIP` interno.
  * **Configuración y Secretos**: `ConfigMap/bank-usac-config` (variables de entorno y puertos) y `Secret/bank-usac-secrets` (credenciales de base de datos, llaves JWT y contraseñas).

### Protocolos de Comunicación
* **AMQP 0-9-1 / TCP 5672**: Comunicación asíncrona bidireccional entre pods y RabbitMQ.
* **PostgreSQL / TCP**: Comunicación síncrona entre cada servicio y su base de datos dedicada.
* **S3-compatible / TCP 9000**: Envío y streaming de fotografías de DPI hacia MinIO.
* **HTTPS/REST / TCP 3000**: Interacción frontend-gateway y clientes externos.
