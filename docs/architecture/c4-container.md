# C4 Nivel 2 — Diagrama de Contenedores

Este documento describe el **Nivel 2 (Contenedores)** de la arquitectura C4 para **Bank USAC**, detallando las aplicaciones ejecutables, los almacenes de datos y el intermediario de mensajería.

---

## 1. Diagrama de Contenedores

![C4 Contenedores — Bank USAC](diagrams/03-c4-contenedores.png)

Fuentes de diagramación versionadas:
* [Structurizr DSL (`.dsl`)](diagrams/03-c4-contenedores.dsl)
* [Structurizr DSL Workspace Maestro (`c4.dsl`)](diagrams/c4.dsl)

---

## 2. Inventario de Contenedores

### Frontend y Perímetro
1. **Web App (`apps/web`)**: SPA/SSR moderna en **Nuxt 4 / Vue 3** servida sobre el puerto `:3010`. Implementa las 34 pantallas del diseño de prototipo, control de sesión y vistas segregadas por rol.
2. **API Gateway (`apps/gateway`)**: Servicio perimetral en **NestJS** sobre el puerto `:3000`. Expone 24 rutas REST públicas y protegidas con JWT, validación de schemas con Zod y agregación de respuestas.

### Servicios de Dominio (Núcleo Bancario)
3. **Customer Service (`apps/services/customer-service`)**: Microservicio NestJS. Posee la base de datos `customer_db` (PostgreSQL en `:5433`). Maneja identidades, credenciales scrypt, activación por correo y verificación de DPI.
4. **Account Service (`apps/services/account-service`)**: Microservicio NestJS. Posee la base de datos `account_db` (PostgreSQL en `:5434`). Maneja cuentas monetarias/ahorro, saldos exactos en `NUMERIC(14,2)` y proceso automático de desactivación.
5. **Transaction Service (`apps/services/transaction-service`)**: Microservicio NestJS. Posee la base de datos `transaction_db` (PostgreSQL en `:5435`). Orquestador de la máquina de estados de transferencias y coordinador de la Saga.
6. **Payment Service (`apps/services/payment-service`)**: Microservicio NestJS. Posee la base de datos `payment_db` (PostgreSQL en `:5436`). Procesa pagos externos con escalera de reintentos resiliente.
7. **Notification & Audit Service (`apps/services/notification-audit-service`)**: Microservicio NestJS. Posee la base de datos `notification_audit_db` (PostgreSQL en `:5437`). Bitácora global inmutable de auditoría y buzón de notificaciones.

### Infraestructura Compartida
* **Message Broker (`RabbitMQ 4.3`)**: Broker de eventos y comandos asíncronos AMQP sobre los puertos `:5672` (tráfico) y `:15672` (consola de gestión).
* **Almacenamiento de Objetos (`MinIO`)**: Servidor de almacenamiento compatible con Amazon S3 sobre `:9000` (API) y `:9001` (consola web) para resguardo de fotografías de documentos de identidad.
