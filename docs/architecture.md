# Arquitectura del Sistema — Bank USAC

---

## Tabla de Contenidos

- [Arquitectura del Sistema — Bank USAC](#arquitectura-del-sistema--bank-usac)
  - [Tabla de Contenidos](#tabla-de-contenidos)
  - [1. Resumen Arquitectónico](#1-resumen-arquitectónico)
    - [1.1. Contexto y Visión de la Plataforma](#11-contexto-y-visión-de-la-plataforma)
    - [1.2. Principios Rectores de la Arquitectura](#12-principios-rectores-de-la-arquitectura)
    - [1.3. Aclaración del Estilo Arquitectónico](#13-aclaración-del-estilo-arquitectónico)
  - [2. Estilo y Patrón Arquitectónico](#2-estilo-y-patrón-arquitectónico)
    - [2.1. Ecosistema de Microservicios Asíncronos](#21-ecosistema-de-microservicios-asíncronos)
    - [2.2. Patrones de Diseño Aplicados](#22-patrones-de-diseño-aplicados)
  - [3. Diagrama de Contexto (C4 Nivel 1)](#3-diagrama-de-contexto-c4-nivel-1)
    - [3.1. Representación Visual del Contexto](#31-representación-visual-del-contexto)
    - [3.2. Actores Humanos (Usuarios del Sistema)](#32-actores-humanos-usuarios-del-sistema)
    - [3.3. Sistemas Externos e Infraestructura de Soporte](#33-sistemas-externos-e-infraestructura-de-soporte)
  - [4. Diagrama de Contenedores y Bloques (C4 Nivel 2)](#4-diagrama-de-contenedores-y-bloques-c4-nivel-2)
    - [4.1. Representación Visual de Contenedores](#41-representación-visual-de-contenedores)
    - [4.2. Desglose de Contenedores y Microservicios](#42-desglose-de-contenedores-y-microservicios)
      - [Frontend Web (Nuxt 4)](#frontend-web-nuxt-4)
      - [API Gateway (NestJS)](#api-gateway-nestjs)
      - [Customer Service (CDU001)](#customer-service-cdu001)
      - [Account Service (CDU002)](#account-service-cdu002)
      - [Transaction Service (CDU003)](#transaction-service-cdu003)
      - [Payment Service (CDU004)](#payment-service-cdu004)
      - [Notification & Audit Service (CDU005)](#notification--audit-service-cdu005)
      - [Message Broker (RabbitMQ 4.x)](#message-broker-rabbitmq-4x)
      - [Almacenamiento de Objetos (MinIO S3-Compatible)](#almacenamiento-de-objetos-minio-s3-compatible)
  - [5. Diagrama de Componentes y Capas Internas (C4 Nivel 3)](#5-diagrama-de-componentes-y-capas-internas-c4-nivel-3)
    - [5.1. Estructura Interna: Clean Architecture / Arquitectura Hexagonal](#51-estructura-interna-clean-architecture--arquitectura-hexagonal)
    - [5.2. Diagrama de Componentes de Transaction Service (Saga Coordinator)](#52-diagrama-de-componentes-de-transaction-service-saga-coordinator)
    - [5.3. Descripción de Capas](#53-descripción-de-capas)
  - [6. Decisiones Arquitectónicas Clave](#6-decisiones-arquitectónicas-clave)
  - [7. Infraestructura, Despliegue y Topología de Red](#7-infraestructura-despliegue-y-topología-de-red)
    - [7.1. Diagramas de Despliegue (UML)](#71-diagramas-de-despliegue-uml)
      - [7.1.1. Despliegue Local (Fase 1: Kubernetes con kind)](#711-despliegue-local-fase-1-kubernetes-con-kind)
      - [7.1.2. Despliegue en la Nube (Fase 2: Google Cloud Platform con Terraform)](#712-despliegue-en-la-nube-fase-2-google-cloud-platform-con-terraform)
    - [7.2. Matriz de Puertos y Variables de Entorno](#72-matriz-de-puertos-y-variables-de-entorno)
    - [7.3. Estrategia de Resiliencia y Healthchecks](#73-estrategia-de-resiliencia-y-healthchecks)

---

## 1. Resumen Arquitectónico

### 1.1. Contexto y Visión de la Plataforma

**Bank USAC** es una plataforma de banca digital distribuida académica, diseñada para demostrar operaciones financieras distribuidas a tres actores diferenciados: **Clientes**, **Cajeros Receptores** y **Administradores**. El sistema abarca el autoregistro público con revisión documental y verificación de digest, con carga inicial en MinIO, activación criptográfica por correo, apertura de cuentas monetarias y de ahorro, depósitos en ventanilla con emisión síncrona de comprobantes contables, transferencias interbancarias y pago de servicios mediante Sagas coreografiadas asíncronas, y auditoría redactada y trazabilidad distribuida.

### 1.2. Principios Rectores de la Arquitectura

| Principio | Descripción y Aplicación en Bank USAC |
|---|---|
| **Consistencia Financiera** | Invariantes de saldo no negativo, idempotencia y compensación; su cumplimiento se verifica con pruebas monetarias. Aritmética exacta de punto fijo `NUMERIC(14,2)` y bloqueos pesimistas de fila `SELECT ... FOR UPDATE` en PostgreSQL. |
| **Aislamiento Estricto** | Regla constitucional de microservicios: **Database per Service**. Ningún servicio puede consultar la base de datos de otro ni realizar llamadas HTTP directas a servicios de dominio. |
| **Disponibilidad y Resiliencia** | Objetivos y ventanas definidos en el marco SLI/SLO/SLA, que requieren medición. Recepción asíncrona inmediata en Gateway (`202 Accepted`), colas durables en RabbitMQ y escalera de reintentos automatizada. |
| **Seguridad y Menor Privilegio** | Autenticación stateless por JWT, contraseñas protegidas con `scrypt`, redacción de datos confidenciales antes de la inserción en auditoría y control de acceso RBAC perimetral (ADR D-06). |
| **Idempotencia Transaccional** | Protección de base de datos contra duplicidad de débitos o créditos ante reintentos de red mediante índices únicos `UNIQUE (idempotency_key, type)`. |
| **Cloud-Ready y Portabilidad** | Empaquetado en imágenes Docker multi-stage ejecutadas bajo usuario no root (`node`), desplegables localmente con Docker Compose o en clústeres Kubernetes con Helm. |

### 1.3. Aclaración del Estilo Arquitectónico

Bank USAC se implementa como una **Arquitectura de Microservicios Asíncrona Orientada a Eventos (Event-Driven Architecture - EDA)** pura para la comunicación inter-servicios, complementada con un **API Gateway Perimetral** que actúa como punto único de entrada para clientes web. 

- **Sin llamadas HTTP inter-servicios:** Los 5 microservicios de dominio no exponen puertos HTTP entre sí; toda la coordinación transaccional se realiza consumiendo y publicando eventos a través de **RabbitMQ**.
- **Request/Reply Asíncrono en Gateway:** Para consultas que demandan respuesta inmediata (ej. autenticación o balance), el Gateway publica comandos con colas de respuesta exclusivas por instancia, no durables y auto-delete, correlacionadas por `correlationId` con un techo estricto de timeout de 5 segundos.

---

## 2. Estilo y Patrón Arquitectónico

### 2.1. Ecosistema de Microservicios Asíncronos

![Arquitectura General del Sistema](architecture/diagrams/01-arquitectura-general.png)

> **Descripción del diagrama:** La arquitectura general presenta al API Gateway como único punto de entrada HTTP desde el frontend, desacoplado de los cinco microservicios de dominio (Customer, Account, Transaction, Payment y Notification & Audit) a través del broker de mensajería RabbitMQ. Cada microservicio cuenta con su base de datos PostgreSQL exclusiva. MinIO recibe la fotografía; Customer verifica y conserva el documento. Los terceros y la telemetría tienen conexiones diferenciadas.

### 2.2. Patrones de Diseño Aplicados

1. **Patrón Saga Coreografiada (ADR-009):** Orquestación distribuida de transferencias sin coordinador síncrono central. Cada servicio escucha eventos del broker y emite el siguiente comando/evento correspondiente, ejecutando compensaciones atómicas si un paso falla.
2. **Patrón Database per Service (ADR-005):** Cada microservicio posee un esquema y servidor PostgreSQL dedicado. Se prohíbe el acceso cruzado a datos.
3. **Patrón API Gateway & Aggregator (ADR-003 / D-06):** Punto de entrada único que valida JWT, autoriza por roles y compone respuestas (ej. asociar nombre de cliente y cuentas en `/api/accounts`) sin poseer base de datos ni lógica de negocio propia.
4. **Patrón Transactional Outbox (US3 / TD-031):** En *Transaction Service* y *Payment Service*, los mensajes y eventos salientes se guardan en la tabla `outbox_messages` dentro de la misma transacción SQL que el cambio de estado, y un relay en segundo plano (`OutboxRelay`) los despacha de forma confiable, cerrando la ventana de fallos de caída entre commit y publicación.
5. **Patrón Pre-Insert Redaction (ADR-010 / US5):** El servicio de auditoría oculta contraseñas, documentos de identidad y montos antes de ejecutar la sentencia `INSERT`, asegurando que la base de datos compartida de auditoría no almacene secretos.

---

## 3. Diagrama de Contexto (C4 Nivel 1)

### 3.1. Representación Visual del Contexto

![Diagrama de Contexto (C4 Nivel 1)](architecture/diagrams/02-c4-contexto.png)

> **Descripción del diagrama:** El diagrama de contexto sitúa a Bank USAC como el núcleo central interactuando con los tres actores humanos (Cliente, Cajero Receptor y Administrador) a través del API Gateway mediante HTTPS/REST, y comunicándose con sistemas externos como el servicio de correo para activación de cuentas y el proveedor externo de pagos.

### 3.2. Actores Humanos (Usuarios del Sistema)

| Actor | Rol en Sistema | Interacción Principal y Permisos |
|---|---|---|
| **Cliente** | `CLIENTE` | Accede a la banca web para consultar sus cuentas, realizar transferencias con Saga coreografiada, pagar servicios y actualizar sus datos. Restringido estrictamente a sus propios registros. |
| **Cajero Receptor** | `CAJERO_RECEPTOR` | Opera en ventanilla bancaria: atiende clientes presenciales, inspecciona fotografías de DPI almacenadas en MinIO para aprobar identidades y registra depósitos en efectivo con comprobante síncrono. |
| **Administrador** | `ADMINISTRADOR` | Realiza supervisión y gobierno del sistema: consulta el rastro forense de auditoría distribuida por `correlationId`, monitorea la escalera de reintentos de pagos y activa/bloquea cuentas bancarias. |

### 3.3. Sistemas Externos e Infraestructura de Soporte

| Sistema Externo / Infra | Tipo de Integración | Responsabilidad y Mecanismo |
|---|---|---|
| **Servicio de Correo (Resend)** | API REST / HTTPS | Envío asíncrono de correos transaccionales con tokens criptográficos de activación y recuperación. El canal simulado es el default; el entorno puede configurar Resend. También existen avisos autorizados de seguridad con dirección de entrega. |
| **Proveedor de pagos / facturadores** | Adaptador simulado / AMQP | Payment decide intentos; un pago de servicio es una transferencia a la cuenta recaudadora interna del facturador. |
| **Banco externo** | HTTP JSON autenticado | Envío, callback, consulta, cancelación y reverso conforme al contrato interbancario. |
| **Observabilidad** | OTLP / scrape / HTTP | Collector, Prometheus, Tempo, Loki y Grafana, con agente de logs y kube-state-metrics. |
| **RabbitMQ Message Broker** | AMQP 0-9-1 | Columna vertebral de mensajería asíncrona; gestiona colas durables, enrutamiento por topics y Dead Letter Queues (`bank.errors`). |
| **MinIO Object Storage** | S3 API / HTTP | Almacén de objetos seguro para fotografías de DPI, con referencias y digest SHA-256; Customer también persiste los bytes para su consulta autorizada. |

---

## 4. Diagrama de Contenedores y Bloques (C4 Nivel 2)

### 4.1. Representación Visual de Contenedores

![Diagrama de Contenedores (C4 Nivel 2)](architecture/diagrams/03-c4-contenedores.png)

> **Descripción del diagrama:** Descomposición en contenedores del sistema. El nivel C4 muestra responsabilidades y relaciones. En cloud el frontend público está en Cloud Run; las bases están en VMs fuera de GKE y broker/MinIO en cada namespace bancario. El despliegue físico se desarrolla en §7.

---

### 4.2. Desglose de Contenedores y Microservicios

#### Frontend Web (Nuxt 4)
* **Responsabilidad:** Renderiza las 34 pantallas del portal bancario para los tres roles, gestiona estado reactivo y sesión de pestaña en `sessionStorage` y se comunica únicamente con el API Gateway.
* **Tecnología:** Nuxt 4.5.2, Vue 3.5.41, Nitro, Nuxt UI 4.10.0, TypeScript 6 y Tailwind CSS 4.3.3. El proxy `/api` evita contenido mixto cuando el Gateway es HTTP.

#### API Gateway (NestJS)
* **Responsabilidad:** Entrada perimetral única. Autentica sesiones mediante JWT Bearer, aplica control de acceso RBAC (**ADR D-06**), enruta comandos a RabbitMQ y compone datos agregados sin almacenar estado.
* **Tecnología:** NestJS, JWT y adaptador AMQP compartido; el contrato HTTP está versionado en OpenAPI.

#### Customer Service (CDU001)
* **Responsabilidad:** Gestiona el ciclo de vida de identidades, registro en 3 pasos con validación de edad ($\ge 18$ años), hashing `scrypt`, activación por correo y validación de fotografías en MinIO.
* **Persistencia:** PostgreSQL, nombre de base local (`customer` en puerto 5433).

#### Account Service (CDU002)
* **Responsabilidad:** Administra cuentas Monetarias y de Ahorro con UUID inmutable, gestiona balances con aritmética exacta `NUMERIC(14,2)`, ejecuta débitos y créditos atómicos con bloqueo `SELECT ... FOR UPDATE`, procesa depósitos en ventanilla y ejecuta el job de desactivación automática de cuentas inactivas.
* **Persistencia:** PostgreSQL dedicado (`account` en puerto 5434).

#### Transaction Service (CDU003)
* **Responsabilidad:** Coordina la máquina de estados finita de transferencias bancarias (Saga coreografiada de 6 estados). Emite comandos de débito, pago, crédito y compensación garantizando la consistencia eventual. Implementa Transactional Outbox para publicación segura.
* **Persistencia:** PostgreSQL dedicado (`transaction` en puerto 5435).

#### Payment Service (CDU004)
* **Responsabilidad:** Procesa el paso de pago de la Saga, simulación global persistida y protocolo interbancario externo. La escalera ofrece hasta cuatro intentos con esperas 1/5/30 s; callbacks y reconciliación tienen su propio ciclo de vida.
* **Persistencia:** PostgreSQL dedicado (`payment` en puerto 5436).

#### Notification & Audit Service (CDU005)
* **Responsabilidad:** Receptor pasivo de todos los eventos del bus. Aplica redacción de datos sensibles antes de la inserción SQL (`pre-insert redaction`), gestiona la bitácora forense por `correlationId` y despacha notificaciones.
* **Persistencia:** PostgreSQL dedicado (`notification_audit` en puerto 5437).

#### Message Broker (RabbitMQ 4.x)
* **Responsabilidad:** Desacopla la comunicación mediante 4 exchanges configurados como tipo `topic` y durables: `bank.commands` (comandos y solicitudes de consulta emitidos al bus), `bank.events` (eventos de dominio y notificaciones de cambio de estado), `bank.replies` (respuestas de consulta correlacionadas hacia el API Gateway) y `bank.errors` (mensajes rechazados o inválidos en Dead Letter Exchanges).

#### Almacenamiento de Objetos (MinIO S3-Compatible)
* **Responsabilidad:** Almacena de forma binaria las fotografías de documentos DPI con acceso seguro por referencias y verificación de hashes SHA-256.

---

## 5. Diagrama de Componentes y Capas Internas (C4 Nivel 3)

### 5.1. Estructura Interna: Clean Architecture / Arquitectura Hexagonal

Cada uno de los microservicios sigue estrictamente la separación de 4 capas concéntricas con regla de dependencia hacia el interior:

1. **`domain/` (Núcleo):** Entidades de negocio puras, objetos de valor (`Money`), máquinas de estados y reglas invariantes sin dependencias de base de datos ni frameworks.
2. **`application/`:** Casos de uso (*Use Cases*) y puertos abstractos (`ports.ts`) para repositorios y publicadores de eventos.
3. **`infrastructure/`:** Adaptadores tecnológicos (PostgreSQL con `pg`, `OutboxRelay`, adaptadores de RabbitMQ y MinIO).
4. **`interfaces/`:** Controladores de mensajes (*Message Handlers*) que consumen del router de eventos y controladores de salud HTTP (`/health`, `/ready`).

---

### 5.2. Diagrama de Componentes de Transaction Service (Saga Coordinator)

![Diagrama de Componentes - Transaction Service (C4 Nivel 3)](architecture/diagrams/04-c4-componentes.png)

> **Descripción del diagrama:** Estructura interna de Transaction Service modelada en Clean Architecture: los Message Handlers en `interfaces/` reciben eventos AMQP, los Casos de Uso en `application/` aplican transiciones sobre la máquina de estados en `domain/`, y los adaptadores en `infrastructure/` persisten en PostgreSQL gestionando el Transactional Outbox.

---

### 5.3. Descripción de Capas

| Capa | Responsabilidad Principal | Reglas de Dependencia |
|---|---|---|
| **Dominio (`domain/`)** | Contiene las entidades puras (`Customer`, `Account`, `Transaction`), objetos de valor inmutables (`Money`) y máquinas de estados. | **Cero dependencias externas.** No importa NestJS, base de datos ni librerías de red. |
| **Aplicación (`application/`)** | Orquesta los casos de uso del sistema e interactúa con el dominio mediante puertos e interfaces. | Depende únicamente de la capa de Dominio. |
| **Infraestructura (`infrastructure/`)** | Implementa los puertos mediante adaptadores concretos (SQL PostgreSQL, Outbox Scheduler, RabbitMQ). | Depende de Aplicación y Dominio. |
| **Interfaces (`interfaces/`)** | Enruta los mensajes AMQP entrantes hacia los casos de uso correspondientes y expone endpoints de diagnóstico. | Depende de Aplicación. |

---

## 6. Decisiones Arquitectónicas Clave

La arquitectura de Bank USAC se fundamenta en decisiones versionadas en el [índice ADR](architecture/adr/README.md) y decisiones de dominio D-01 a D-06. La [narrativa](adr.md) resume su evolución; el ADR canónico prevalece:

* **ADR-001 / ADR-002:** Ecosistema homogéneo TypeScript con NestJS en backend y Nuxt 4 en frontend sobre monorepo Turborepo.
* **ADR-003 / ADR-004:** Desacoplamiento asíncrono puro con RabbitMQ 4.x, eliminando llamadas HTTP síncronas entre microservicios de dominio.
* **ADR-005:** Persistencia aislada con PostgreSQL 18 (*Database per Service*), precisión decimal exacta `NUMERIC(14,2)` y bloqueos `SELECT ... FOR UPDATE`.
* **ADR-006 / ADR-007:** Contenerización multi-stage sin privilegios root (`node`) y Compose para desarrollo; kind/Helm para Kubernetes local y GKE/Helm en cloud, con aprovisionamiento Terraform.
* **ADR-008 / ADR-009:** Clean Architecture interna y patrón Saga Coreografiada con compensación determinista ante fallos.
* **ADR-010 / ADR-012:** Seguridad stateless con JWT, hashing `scrypt`, control RBAC perimetral (D-06) y almacenamiento S3 en MinIO para fotografías de DPI.

---

## 7. Infraestructura, Despliegue y Topología de Red

### 7.1. Diagramas de Despliegue (UML)

#### 7.1.1. Despliegue Local (Fase 1: Kubernetes con kind)

![Diagrama de Despliegue Local UML / Kubernetes](architecture/diagrams/05-uml-despliegue.png)

> **Descripción:** Topología local en kind, instalada por Helm; la observabilidad es un segundo chart. Cada microservicio corre como un Pod/Deployment dentro del namespace `bank-usac` con su Service ClusterIP, consumiendo configuración de ConfigMaps y credenciales de Secrets, interactuando con PostgreSQL, RabbitMQ y MinIO externos por la red Docker y Services/Endpoints; `host.docker.internal` es una alternativa configurada, no la única ruta.

#### 7.1.2. Despliegue en la Nube (Fase 2: Google Cloud Platform con Terraform)

La vista se actualiza a Fase III: **Terraform** aprovisiona infraestructura,
**Helm** mantiene `bank-usac` y `bank-observability`, y **GitHub Actions**
publica/despliega imágenes. Las flechas de gestión no son tráfico bancario.

![Diagrama de Despliegue Cloud GCP](architecture/diagrams/08-despliegue-cloud-gcp.png)

> **Descripción:** Topología de producción en Google Cloud Platform (GCP). El frontend corre en **Google Cloud Run (Serverless)**; los microservicios, el broker RabbitMQ y MinIO se ejecutan en un clúster administrado **Google Kubernetes Engine (GKE)** con **Autoescalado Horizontal de Pods (HPA) al 80% de CPU**; y las cinco bases de datos PostgreSQL se alojan en **5 Máquinas Virtuales Compute Engine** en una subred privada dedicada (`10.40.0.0/24`) con salida segura vía **Cloud NAT**.

---

### 7.2. Matriz de Puertos y Variables de Entorno

| Componente / Servicio | Puerto Host | Protocolo | Variable de Entorno Primaria | Propósito / Destino |
|---|:---:|:---:|---|---|
| **Frontend Web** | `3010` | HTTP | `NUXT_PUBLIC_API_BASE_URL` | Interfaz de usuario para clientes y staff. |
| **API Gateway** | `3000` | HTTP | `PORT`, `JWT_SECRET`, `RABBITMQ_URL` | Entrada pública REST y autenticación JWT. |
| **Customer Service** | `3001` | HTTP (Health) / AMQP | `DATABASE_URL`, `RABBITMQ_URL`, variables de objetos | Identidad, credenciales, KYC y telemetría. |
| **Account Service** | `3002` | HTTP (Health) | `DATABASE_URL` (Puerto 5434) | Contabilidad, saldos y depósitos. |
| **Transaction Service** | `3003` | HTTP (Health) | `DATABASE_URL` (Puerto 5435) | Coordinación de la Saga de transferencias. |
| **Payment Service** | `3004` | HTTP (Health) | `DATABASE_URL` (Puerto 5436) | Cobro a proveedores y escalera de reintentos. |
| **Notification & Audit** | `3005` | HTTP (Health) | `DATABASE_URL` (Puerto 5437) | Bitácora forense y envío de correos. |
| **PostgreSQL Customer** | `5433` | TCP | `POSTGRES_DB=customer` | Base de datos de identidades. |
| **PostgreSQL Account** | `5434` | TCP | `POSTGRES_DB=account` | Base de datos de cuentas y balances. |
| **PostgreSQL Transaction**| `5435` | TCP | `POSTGRES_DB=transaction` | Base de datos de transacciones y outbox. |
| **PostgreSQL Payment** | `5436` | TCP | `POSTGRES_DB=payment` | Base de datos de pagos e intentos. |
| **PostgreSQL Audit** | `5437` | TCP | `POSTGRES_DB=notification_audit` | Base de datos inmutable de auditoría. |
| **RabbitMQ Broker** | interno `5672` / `15672`; comprobar publicación host | AMQP / HTTP | `RABBITMQ_URL` / configuración del broker | Mensajería, gestión y exporter `15692`. |
| **MinIO Object Store** | interno `9000` / `9001`; comprobar publicación host | HTTP / S3 | Configuración de objetos y secretos | Carga de documentos de identidad. |

---

### 7.3. Estrategia de Resiliencia y Healthchecks

1. **Desacoplamiento de Sondas de Salud:** Cada uno de los 7 contenedores implementa dos endpoints de diagnóstico HTTP independientes:
   * **`/health` (Liveness Probe):** Responde inmediatamente `200 OK {"status":"ok"}` indicando que el proceso Node.js está vivo, evitando reinicios espurios de Kubernetes mientras los servicios se conectan.
   * **`/ready` (Readiness Probe):** En backend evalúa dependencias de arranque según el componente. En web evalúa configuración del Gateway, no su conectividad. No es una prueba end-to-end.
2. **Mensajería:** El adaptador compartido gestiona conexiones, confirmaciones y reintentos; las garantías concretas y fallos observados están en sus pruebas y runbooks. No se garantiza recuperación sin intervención para cualquier caída.
3. **Fallos de datos:** Los límites por servicio reducen el alcance directo; una Saga o consulta compuesta puede depender de más de uno. VM, cluster y cuotas compartidos siguen siendo dominios comunes de fallo.



## 8. Fase III: observabilidad, interbancario y estado observado

El 21 de octubre de 2026 se observó GKE en `us-central1-c`, Kubernetes
1.36.4, aplicaciones de producción y mock en `v1.3.6`, y despliegues de dev
Ready. Las bases tienen nombres distintos por entorno (`payment` frente a
`payment_dev`, por ejemplo) en las mismas cinco VMs privadas. Ese aislamiento
lógico no elimina el fallo compartido de la VM.

La red deseada incluye NetworkPolicies, pero no había objetos aplicados en
dev/prod/observability; Dataplane V2 activo por sí solo no los crea. RabbitMQ
live usa 3.13-management frente a 4.3.4 deseado. Grafana tiene LoadBalancer
público y credenciales independientes. La evidencia es el
[inventario prod](qa/load/2026-10-21-gke-prod-inventory.txt),
[inventario dev](qa/load/2026-10-21-gke-dev-inventory.txt) y el
[inventario de observabilidad](qa/load/2026-10-21-gke-observability-inventory.txt).
No se equipara Ready con cumplimiento del SLO.

La telemetría enlaza OpenTelemetry/OTLP, Collector, Prometheus, Tempo, Loki,
agente de logs, Grafana y kube-state-metrics. Nueve dashboards, dieciséis reglas
y siete runbooks conectan señales con respuesta. Las métricas, etiquetas, spans
y campos admitidos están en el [catálogo](sre/telemetry-catalog.md); objetivos,
ventanas y budget, en el [marco SRE](sre/sli-slo-sla.md).

Las nuevas secuencias documentan [envío](architecture/diagrams/09-secuencia-envio-interbancario.puml),
[recepción idempotente](architecture/diagrams/10-secuencia-recepcion-interbancaria.puml),
[reintentos de pago](architecture/diagrams/11-secuencia-reintentos-pago.puml) y
[observabilidad/alertas](architecture/diagrams/12-observabilidad-y-alertas.puml).
TIMEOUT interbancario mantiene reserva hasta reconciliar; una liberación sin
respuesta verificada se señala y requiere seguimiento. Dev no tiene mock ni
URL de banco pareja configurada; la prueba de fallos interbancarios necesita
preparación explícita, sin tomar producción como entorno de carga.

Terraform declara Artifact Registry y la IP pública reservada; Helm declara el
Service del Gateway y CD actualiza la imagen de Cloud Run. La propiedad
declarada, el estado importado y la versión efectiva son verificaciones
distintas. Los procedimientos y diferencias actuales están en
[CLOUD](operations/CLOUD.md), las [deudas](TECH_DEBT.md) y la
[guía de validación](qa/guia-validacion-manual-fase3.md).
