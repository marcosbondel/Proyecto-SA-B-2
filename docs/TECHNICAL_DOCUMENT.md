# Documento Técnico del Sistema — Bank USAC

**Software Avanzado \| Segundo Semestre 2026 \| Sección B \| Grupo 2**  
**Catedrático:** Ing. Marco Tulio Aldana Prillwitz \| **Tutor Académico:** Kevin Raúl Pozuelos Estrada

---

## Índice de Contenidos

1. [Los entregables del enunciado y su ubicación](#1-los-entregables-del-enunciado-y-su-ubicación)
2. [Resumen del sistema y arquitectura general](#2-resumen-del-sistema-y-arquitectura-general)
3. [Diagramas arquitectónicos detallados (C4, UML y ER)](#3-diagramas-arquitectónicos-detallados)
   - [3.1 Arquitectura General del Sistema](#31-arquitectura-general-del-sistema)
   - [3.2 Modelo C4 — Nivel 1: Contexto del Sistema](#32-modelo-c4--nivel-1-contexto-del-sistema)
   - [3.3 Modelo C4 — Nivel 2: Contenedores](#33-modelo-c4--nivel-2-contenedores)
   - [3.4 Modelo C4 — Nivel 3: Componentes y Arquitectura Limpia](#34-modelo-c4--nivel-3-componentes-y-arquitectura-limpia)
   - [3.5 Diagrama UML de Despliegue](#35-diagrama-uml-de-despliegue)
   - [3.6 Diagrama UML de Secuencia: Creación de Cuenta](#36-diagrama-uml-de-secuencia-creación-de-cuenta)
   - [3.7 Diagrama UML de Secuencia: Transferencia con Saga Coreografiada](#37-diagrama-uml-de-secuencia-transferencia-con-saga-coreografiada)
   - [3.8 Diagramas UML de Casos de Uso (Jerarquía y Roles)](#38-diagramas-uml-de-casos-de-uso-jerarquía-y-roles)
   - [3.9 Modelos Entidad-Relación Físicos (ER)](#39-modelos-entidad-relación-físicos-er)
   - [3.10 Diagrama de Despliegue en la Nube (GCP — Fase II)](#310-diagrama-de-despliegue-en-la-nube-gcp--fase-ii)
4. [Métricas SRE: Definición de SLI, SLO y SLA](#4-métricas-sre-definición-de-sli-slo-y-sla)
5. [Casos de uso detallados por rol](#5-casos-de-uso-detallados-por-rol)
6. [Justificación de decisiones arquitectónicas (ADRs)](#6-justificación-de-decisiones-arquitectónicas-adrs)
7. [Manual de usuario y guías operativas](#7-manual-de-usuario-y-guías-operativas)
8. [Estructura del monorepo y código fuente](#8-estructura-del-monorepo-y-código-fuente)
9. [Contenedores y despliegue en Kubernetes](#9-contenedores-y-despliegue-en-kubernetes)
10. [Frontend web (Nuxt 3) y validación de roles](#10-frontend-web-nuxt-3-y-validación-de-roles)
11. [Verificación, calidad y deudas técnicas controladas](#11-verificación-calidad-y-deudas-técnicas-controladas)
12. [Fase II — Extensión funcional por microservicio](#12-fase-ii--extensión-funcional-por-microservicio)
13. [Fase II — Pipeline CI/CD, estrategia de ramas y despliegue selectivo](#13-fase-ii--pipeline-cicd-estrategia-de-ramas-y-despliegue-selectivo)
14. [Fase II — Infraestructura como código y despliegue en la nube](#14-fase-ii--infraestructura-como-código-y-despliegue-en-la-nube)

---

## 1. Los entregables del enunciado y su ubicación

Este documento consolida la arquitectura, el diseño y las evidencias de implementación de **Bank USAC**, guiando la evaluación hacia cada artefacto concreto versionado en el repositorio:

| Entregable Oficial | Dónde vive en el repositorio | Estado |
| :--- | :--- | :---: |
| **Documento técnico completo** | Este documento ([`docs/TECHNICAL_DOCUMENT.md`](TECHNICAL_DOCUMENT.md)) + [`docs/architecture.md`](architecture.md). El índice de toda la documentación es [`docs/README.md`](README.md) | **Completo** |
| **Caso de negocio, requisitos y trazabilidad** | [`docs/dda.md`](dda.md) — stakeholders, RF/RNF, escenarios de calidad y las matrices que atan cada requisito a su caso de uso | **Completo** |
| **Diagramas arquitectónicos** | [`docs/architecture/diagrams/`](architecture/diagrams/) (fuentes `.puml`, `.dsl`, `.dbml` e imágenes renderizadas `.png`) | **Completo** |
| **Definición de SLI, SLO y SLA** | [`docs/sre/sli-slo-sla.md`](sre/sli-slo-sla.md) (Marco unificado: 30 indicadores, 26 objetivos, 99.99% disponibilidad y exclusiones); las preocupaciones de diseño que responden, en [`docs/RELIABILITY.md`](RELIABILITY.md) | **Completo** |
| **Casos de uso detallados** | [`docs/domain/use-cases.md`](domain/use-cases.md) y jerarquía UML en [`docs/architecture/diagrams/cdu/`](architecture/diagrams/cdu/README.md) | **Completo** |
| **Decisiones arquitectónicas (ADRs)** | [`docs/adr.md`](adr.md) y 16 registros formales en [`docs/architecture/adr/`](architecture/adr/README.md), de los cuales [ADR-014](architecture/adr/ADR-014-cloud-provider.md), [ADR-015](architecture/adr/ADR-015-ci-cd-platform.md) y [ADR-016](architecture/adr/ADR-016-cloud-infrastructure.md) son los de la Fase II | **Completo** |
| **Manual de usuario integral** | [`docs/manual/`](manual/README.md) — la guía general, una por rol y el [recorrido visual](manual/recorrido-visual.md) de 78 pasos con captura por paso | **Completo** |
| **Estrategia de monorepo** | Raíz: `pnpm-workspace.yaml`, `package.json` y Turborepo (`turbo.json`) | **Completo** |
| **5 microservicios desacoplados** | [`apps/services/`](../apps/services/) (`customer`, `account`, `transaction`, `payment`, `notification-audit`) | **Completo** |
| **API Gateway perimetral** | [`apps/gateway/`](../apps/gateway/) (NestJS, puerto 3000, sin DB, sin HTTP interno) | **Completo** |
| **Despliegue en Kubernetes** | [`infra/k8s/`](../infra/k8s/README.md), chart Helm en `infra/k8s/helm/bank-usac/` y runbook local [`DEPLOYMENT.md`](operations/DEPLOYMENT.md) | **Completo** |
| **Frontend web funcional** | [`apps/web/`](../apps/web/README.md) (Nuxt 3, puerto 3010, Claude Design, 34 pantallas) | **Completo** |
| **Código: microservicios extendidos (Fase II)** | KYC, tipos de cuenta con comisión, historial con filtros, pagos externos simulados y clasificación de eventos — §12 de este documento, con la evidencia por ticket en [`docs/qa/backend/`](qa/README.md) | **Completo** |
| **Pipeline: CI/CD funcional (Fase II)** | [`.github/workflows/`](../.github/workflows/) — `ci.yml`, `changes.yml`, `release.yml`, `cd.yml`; explicados en [`operations/CI.md`](operations/CI.md) y en §13 | **Completo** |
| **Infraestructura: scripts de Terraform (Fase II)** | [`infra/terraform/gcp/`](../infra/terraform/gcp/README.md) — VPC, cinco VMs con PostgreSQL, GKE y Cloud Run; §14 | **Completo, con tres recursos aún manuales (TD-079 … TD-081)** |
| **Despliegue: sistema en la nube (Fase II)** | GKE namespaces `prod` y `dev`, frontend en Cloud Run. Procedimiento completo en [`operations/CLOUD.md`](operations/CLOUD.md) | **Completo** |
| **Documento: arquitectura actualizada (Fase II)** | Este documento (§3.10, §12, §13 y §14) y [`docs/architecture.md`](architecture.md) §7.1.2 | **Completo** |
| **Informe de Pruebas E2E** | [`docs/qa/`](qa/README.md) — el [informe de validación](qa/validation-report.md) con las 68 pruebas una por una, la [guía de happy path y errores](qa/happypath.md) y las capturas que produce cada suite; la narrativa de la ejecución, en [`E2E.md`](../E2E.md) | **Completo** |

---

## 2. Resumen del sistema y arquitectura general

Bank USAC implementa una arquitectura bancaria distribuida de microservicios orientada a eventos, aplicando **Clean Architecture** en cada servicio, **Saga por coreografía** para flujos distribuidos y comunicación **100% asíncrona mediante RabbitMQ (AMQP 0-9-1)**.

### Matriz de componentes y responsabilidades

| Componente | Rol en el sistema | Puerto Host | Base de datos | Comunicación Externa |
| :--- | :--- | :---: | :---: | :--- |
| **Frontend Web** | Interfaz de usuario reactiva en Nuxt 3 para los 3 roles. | `3010` | Ninguna | HTTP REST hacia API Gateway |
| **API Gateway** | Único punto de entrada perimetral. Autenticación JWT, RBAC y traducción HTTP ↔ AMQP. | `3000` | Ninguna | RabbitMQ (`bank.commands`, `bank.replies`) y MinIO |
| **Customer Service** | Gestión de clientes, identidad (DPI en MinIO), tokens de activación y contraseñas scrypt. | `3001` (solo `/health`) | `5433` (`customer`) | RabbitMQ |
| **Account Service** | Cuentas monetarias y de ahorro, saldos exactos, movimientos y desactivación automática. | `3002` (solo `/health`) | `5434` (`account`) | RabbitMQ |
| **Transaction Service** | Coordinación de la Saga distribuida y máquina de estados finita pura (6 estados). | `3003` (solo `/health`) | `5435` (`transaction`) | RabbitMQ |
| **Payment Service** | Procesamiento de pagos a servicios (EEGSA, Empagua, Claro) y escalera de reintentos en BD. | `3004` (solo `/health`) | `5436` (`payment`) | RabbitMQ |
| **Notification & Audit** | Bitácora inmutable con *pre-insert redaction* y notificaciones por correo/inbox. | `3005` (solo `/health`) | `5437` (`notification_audit`) | RabbitMQ |

### Tres principios inviolables de aislamiento

1. **Cero llamadas HTTP entre microservicios:** Ningún microservicio expone endpoints de negocio ni invoca a otro por HTTP. La suite `isolation.spec.ts` y las reglas de lint impiden llamadas síncronas directas.
2. **Cero bases de datos compartidas:** Cada microservicio es dueño absoluto de su base de datos PostgreSQL. No existen tablas compartidas ni conexiones cruzadas.
3. **El Gateway no orquesta:** El API Gateway publica comandos con `correlationId` y espera respuestas sobre `bank.replies` con un timeout estricto de 5 segundos. Las transacciones multietapa las coordina la Saga por coreografía en los servicios.

---

## 3. Diagramas arquitectónicos detallados

A continuación se presentan los diagramas oficiales del sistema, organizados bajo el modelo C4 y UML, explicando la interacción técnica, topología y flujo de datos de cada uno.

### 3.1 Arquitectura General del Sistema

El diagrama de arquitectura general ilustra la división entre la red perimetral de acceso y la infraestructura interna de soporte:

![Arquitectura General](architecture/diagrams/01-arquitectura-general.png)

#### Explicación Técnica
* **Perímetro Exterior:** Los usuarios (Cliente, Cajero Receptor y Administrador) se comunican mediante HTTPS con la aplicación Web (puerto `3010`) y el API Gateway (puerto `3000`).
* **Límite del Clúster / Entorno de Aplicaciones:** El API Gateway actúa como frontera de seguridad; valida credenciales y convierte las peticiones entrantes en comandos asíncronos encolados en RabbitMQ.
* **Infraestructura de Soporte Externa:** Fuera del clúster de ejecución corren las 5 instancias independientes de PostgreSQL 18.4 (puertos `5433` a `5437`), el bus de mensajería RabbitMQ (puerto `5673` en host, `5672` interno) y el almacenamiento S3 compatible MinIO (puerto `9002` en host, `9000` interno).

---

### 3.2 Modelo C4 — Nivel 1: Contexto del Sistema

El diagrama de contexto establece los límites de **Bank USAC**, los actores que interactúan con él y las integraciones externas simuladas:

![C4 Nivel 1 - Contexto](architecture/diagrams/02-c4-contexto.png)

#### Explicación Técnica
* **Actores Principales:**
  1. **Cliente:** Cuentahabiente que consulta saldos, transfiere fondos, paga servicios y administra sus credenciales.
  2. **Cajero Receptor:** Operador en ventanilla que ejecuta depósitos en efectivo, abre cuentas presenciales y valida la identidad de nuevos clientes.
  3. **Administrador:** Personal bancario que supervisa la bitácora de auditoría global, desactiva cuentas inactivas y monitorea la salud del sistema.
* **Sistemas Externos:**
  * **Servicio de Correo Electrónico:** Entrega enlaces de activación y tokens de recuperación de contraseñas.
  * **Proveedor de Pagos:** Sistema externo simulado que liquida los pagos de servicios básicos que el banco no procesa internamente.

---

### 3.3 Modelo C4 — Nivel 2: Contenedores

El diagrama de contenedores detalla los límites de despliegue, protocolos de red y responsabilidades de almacenamiento:

![C4 Nivel 2 - Contenedores](architecture/diagrams/03-c4-contenedores.png)

#### Explicación Técnica
* **Tráfico Web y API:** El Frontend (Nuxt 3) invoca al API Gateway mediante peticiones REST/JSON autenticadas con encabezados `Authorization: Bearer <JWT>`.
* **Bus de Mensajería RabbitMQ:** Cuatro topic exchanges durables organizan el enrutamiento:
  * `bank.commands`: Comandos directos dirigidos a un microservicio específico (`account.create.v1`, `transfer.create.v1`, etc.).
  * `bank.events`: Eventos de dominio emitidos tras completar una operación (`account.opened.v1`, `account.debited.v1`, etc.).
  * `bank.replies`: Respuestas correlacionadas para operaciones de consulta o confirmación inmediata hacia el Gateway.
  * `bank.errors`: Mensajes rechazados o con fallos de validación dirigidos a Dead Letter Queues (DLQ).
* **Aislamiento de Persistencia:** Cinco bases de datos independientes impiden cualquier forma de acoplamiento de esquema. Las fotos de documentos de identificación se resguardan en MinIO, viajando por el broker únicamente su clave de objeto y digest SHA-256.

---

### 3.4 Modelo C4 — Nivel 3: Componentes y Arquitectura Limpia

El diagrama de componentes muestra el diseño interno basado en **Clean Architecture** (ejemplificado en `Transaction Service`):

![C4 Nivel 3 - Componentes](architecture/diagrams/04-c4-componentes.png)

#### Explicación Técnica
* **Capa de Dominio (Pureza Absoluta):** Entidades como `Transaction` y la máquina de estados de 6 transiciones (`PENDING`, `DEBITING`, `DEBITED`, `PAYMENT_PENDING`, `COMPLETED`, `FAILED`, `COMPENSATED`). No importa librerías externas ni frameworks.
* **Capa de Aplicación (Casos de Uso):** Orquestadores locales como `RequestTransferUseCase` y `SagaCoordinator` que dictan el avance de la transacción según los eventos recibidos.
* **Adaptadores Primarios (Inbound):** `RabbitMqConsumerAdapter` recibe mensajes de la cola, deserializa el sobre canónico (`Envelope`) y delega la ejecución al handler correspondiente (`TransferRequestedHandler`, `AccountDebitedHandler`, etc.).
* **Adaptadores Secundarios (Outbound):** `TransactionPostgresRepository` realiza persistencia transaccional con bloqueos pesimistas `SELECT ... FOR UPDATE`, mientras `RabbitMqPublisherAdapter` garantiza la entrega al broker.

---

### 3.5 Diagrama UML de Despliegue (local, kind)

Muestra la topología física y de orquestación en el clúster **local** de Kubernetes (kind) bajo el namespace `bank-usac`. La topología en la nube, que es la de la Fase II, es el diagrama de §3.10:

![UML Despliegue](architecture/diagrams/05-uml-despliegue.png)

#### Explicación Técnica
* **Dentro del Clúster Kubernetes:**
  * Siete Deployments con réplicas configuradas: `frontend`, `gateway`, `customer-service`, `account-service`, `transaction-service`, `payment-service` y `notification-audit-service`.
  * Servicios `ClusterIP` para comunicación interna y un `Ingress/NodePort` para exponer el Frontend (puerto 3010) y el Gateway (puerto 3000).
  * Todos los pods corren como usuario sin privilegios (`node`, uid 1000) con sondas de liveness (`/health`) y readiness (`/ready`) independientes.
* **Fuera del Clúster (Host):**
  * Las 5 bases de datos PostgreSQL, RabbitMQ y MinIO corren en Docker Compose sobre la red del host, accesibles desde los pods mediante `host.docker.internal`. Esto cumple rigurosamente el requisito §4.2 del enunciado.

---

### 3.6 Diagrama UML de Secuencia: Creación de Cuenta

Ilustra la interacción asíncrona real para la apertura de una cuenta bancaria (monetaria o de ahorro):

![UML Secuencia Crear Cuenta](architecture/diagrams/06-uml-secuencia-crear-cuenta.png)

#### Paso a Paso del Flujo
1. El usuario (o cajero) envía `POST /api/accounts` al API Gateway con los datos de apertura y tipo de cuenta.
2. El Gateway genera un `correlationId` único, empaqueta el sobre `Envelope` y publica el comando `account.create.v1` en `bank.commands`.
3. El Gateway responde inmediatamente `202 Accepted` indicando recepción de la solicitud (o espera la respuesta correlacionada en un ciclo de 5 s).
4. `account-service` consume el comando, valida los datos, genera el número de cuenta bancario y persiste el registro en PostgreSQL (`accounts`) de forma atómica.
5. `account-service` publica el evento `account.opened.v1` en `bank.events` y envía la respuesta con los datos de la cuenta a `bank.replies`.
6. `notification-audit-service` captura el evento para registrar la bitácora de auditoría y enviar la notificación de bienvenida.
7. El cliente recibe la confirmación con el saldo inicial (Q0.00) y número de cuenta asignado.

---

### 3.7 Diagrama UML de Secuencia: Transferencia con Saga Coreografiada

Representa los 15 pasos del patrón Saga coreografiada distribuida para transferencias entre cuentas y pagos a facturadores:

![UML Secuencia Transferencia Saga](architecture/diagrams/07-uml-secuencia-transferencia.png)

#### Mecánica de la Saga Coreografiada

La máquina de estados tiene **seis** estados y una sola función pura decide cada transición, rechazando cualquiera que no esté en el diagrama:

```
PENDING ──► DEBITING ──► PAYMENT_PENDING ──► COMPLETED
   │            │                └──► COMPENSATED   (pago fallido, o crédito rechazado)
   │            └──► FAILED                          (débito rechazado: no hay nada que deshacer)
   └──► FAILED                                       (el gate de KYC se negó)
```

1. **Gate de KYC (añadido en la Fase II).** El cliente solicita la transferencia; `transaction-service` crea el registro en `PENDING` y publica `customer.kyc.check.requested.v1`. `customer-service` responde `customer.kyc.checked.v1` con `allowed`. Si el cliente no está `VERIFIED`, la transacción cierra en `FAILED` con motivo `KYC_NOT_VERIFIED` **sin mover un centavo** y sin compensación, porque el dinero nunca salió.
2. **Débito bajo bloqueo.** Aprobado el KYC, la transición `PENDING → DEBITING` y el comando `account.debit.requested.v1` se escriben **en la misma transacción** (tabla `outbox_messages`, TD-031). `account-service` ejecuta `SELECT … FOR UPDATE` sobre la cuenta origen, comprueba el saldo contra `CHECK (balance >= 0)` más una versión optimista, aplica el débito y emite `account.debited.v1`.
3. **Comisión por tipo de cuenta (Fase II).** En el mismo bloqueo, una cuenta `AHORRO` cobra Q3.00 de comisión y emite `account.commission.charged.v1`; una `MONETARIA` no tiene regla de comisión. El destino recibe el monto íntegro.
4. **Pago externo.** `transaction-service` avanza a `PAYMENT_PENDING` y publica `payment.requested.v1`.
5. **Escalera de reintentos.** `payment-service` decide el intento con una función pura sin reloj ni base de datos. Ante un fallo transitorio o un `TIMEOUT` reintenta a 1 s, 5 s y 30 s, con el vencimiento en la **columna** `next_attempt_at` y no en un temporizador, y publica `payment.attempt.failed.v1` en cada intento fallido —incluido el último— que es lo que hace observable la escalera mientras se sube.
6. **Éxito.** Con `payment.succeeded.v1`, `account-service` acredita los fondos en el destino (`account.credited.v1`) y `transaction-service` cierra en `COMPLETED`.
7. **Compensación.** Si el pago falla de forma terminal (`payment.failed.v1`), `transaction-service` publica `account.debit.compensation.requested.v1`; `account-service` devuelve el monto exacto **y la comisión que hubiera cobrado** (TD-065), emite `account.debit.compensated.v1` y la transacción termina en `COMPENSATED`. **El saldo nunca se pierde ni queda en estado inconsistente**, y `pnpm images:flow` lo comprueba midiendo el saldo antes y después, no leyendo un estado.
8. **Notificación final.** `notification-audit-service` consume el cierre, lo clasifica (`INFO`, `WARNING` o `ERROR`) y genera la notificación al cliente.

Los tres estados que el enunciado de la Fase II nombra —`PENDING`, `APPROVED`, `FAILED`— se exponen como una **proyección** de estos seis (`phaseStatus`), nunca como un reemplazo: la máquina real conserva la información que la proyección descarta.

---

### 3.8 Diagramas UML de Casos de Uso (Jerarquía y Roles)

La funcionalidad del sistema se modela en una jerarquía formal que abarca los tres roles de usuario:

#### Nivel de Alto Nivel (`CDU000`)
![CDU Alto Nivel](architecture/diagrams/cdu/00-alto-nivel.png)

#### Primera Descomposición por Microservicio (`CDU001` a `CDU005`)
![CDU Primera Descomposición](architecture/diagrams/cdu/01-primera-descomposicion.png)

#### Cobertura Funcional por Rol
* **Cliente:**
  * `CDU001.1` Registrar cliente y subir fotografía de documento (DPI).
  * `CDU001.2` Activar cuenta mediante enlace y token recibido por correo.
  * `CDU001.3` Iniciar sesión y gestionar recuperación/cambio de contraseña.
  * `CDU002.1` Apertura de cuenta propia (monetaria o de ahorro).
  * `CDU002.2` Consulta de saldos y movimientos históricos.
  * `CDU003.1` Transferencias a otras cuentas bancarias locales.
  * `CDU004.1` Pago de facturas de servicios básicos (EEGSA, Empagua, Claro).
* **Cajero Receptor:**
  * `CDU001.6` Revisión y validación manual de documentos de identidad (aprobación/rechazo de DPI).
  * `CDU002.1` Apertura asistida de cuentas para cuentahabientes.
  * `CDU002.5` Registro de depósitos en efectivo por ventanilla.
* **Administrador:**
  * `CDU002.4` Desactivación de cuentas inactivas (> 6 meses sin movimientos y saldo < Q50.00).
  * `CDU005.1` Consulta de bitácora general de auditoría y monitoreo distribuido.
  * `CDU005.3` Inspección de eventos y estados de transacciones en la Saga.

---

### 3.9 Modelos Entidad-Relación Físicos (ER)

Cada microservicio gestiona su propio esquema relacional en PostgreSQL 18.4, garantizando un almacenamiento especializado e independiente:

#### Customer Service (`postgres-customer` : 5433)
![ER Customer](architecture/diagrams/er/customer-er.png)
* *Tablas:* `customers` (datos personales, rol, estado de identidad), `identity_documents` (metadatos del DPI y digest SHA-256), `email_activation_tokens` (tokens SHA-256 de un solo uso), `password_reset_tokens` y `processed_messages` (idempotencia).

#### Account Service (`postgres-account` : 5434)
![ER Account](architecture/diagrams/er/account-er.png)
* *Tablas:* `accounts` (número de cuenta, saldo en `NUMERIC(14,2)`, versión optimista, estado activa/bloqueada), `account_operations` (débitos, créditos, depósitos), `deactivation_runs` (historial de barrido de inactivas) y `processed_messages`.

#### Transaction Service (`postgres-transaction` : 5435)
![ER Transaction](architecture/diagrams/er/transaction-er.png)
* *Tablas:* `transactions` (idempotency_key, cuenta origen, cuenta destino, monto, estado de Saga), `transaction_events` (historial de transiciones de estado) y `processed_messages`.

#### Payment Service (`postgres-payment` : 5436)
![ER Payment](architecture/diagrams/er/payment-er.png)
* *Tablas:* `payments` (facturador, referencia de pago, monto, estado), `payment_attempts` (escalera de reintentos, `attempt_number`, `next_attempt_at`, error diagnosticado) y `processed_messages`.

#### Notification & Audit Service (`postgres-notification-audit` : 5437)
![ER Notification Audit](architecture/diagrams/er/notification-audit-er.png)
* *Tablas:* `audit_events` (registro inmutable con payload redactado, correlation_id, timestamp), `notifications` (asunto, canal simulado, estado de entrega) y `processed_messages`.

---

### 3.10 Diagrama de Despliegue en la Nube (GCP — Fase II)

La topología que la Fase II entrega y que está corriendo hoy. A diferencia de §3.5, aquí las bases de datos son **máquinas virtuales de Compute Engine**, el clúster es **GKE administrado** y el frontend vive **fuera del clúster**, en Cloud Run:

![Diagrama de Despliegue en la Nube GCP](architecture/diagrams/08-despliegue-cloud-gcp.png)

Fuente versionada: [`08-despliegue-cloud-gcp.puml`](architecture/diagrams/08-despliegue-cloud-gcp.puml)

#### Lectura del diagrama

* **Cloud Run (`bank-usac-web`)** sirve el frontend Nuxt por HTTPS con certificado gestionado, escalando de 0 a 5 instancias. No está dentro de la VPC: llega al Gateway por su dirección pública.
* **VPC `bank-usac-vpc`**, con dos subredes de propósito distinto:
  * **`10.10.0.0/20`** para el plano de datos de GKE, con rangos secundarios `10.20.0.0/16` (pods) y `10.30.0.0/20` (services).
  * **`10.40.0.0/24`** exclusiva para las bases de datos. **Ninguna de las cinco VM tiene IP pública**; su salida a Internet —la que necesita `apt-get install postgresql`— pasa por Cloud Router + Cloud NAT.
* **Clúster GKE `bank-usac-vpc-gke`**, zonal en `us-central1-a`, con un pool gestionado de tres nodos `e2-standard-2`, y **dos namespaces**:
  * **`prod`** — el release `bank-usac`, con imágenes `vX.Y.Z` publicadas por la fase de entrega.
  * **`dev`** — el release `bank-usac-dev`, con imágenes `dev-<sha>`, desplegado en cada merge a `develop` y **sólo con los componentes que cambiaron**.
  * Cada namespace levanta **su propio RabbitMQ y su propio MinIO**, de modo que mensajería y almacenamiento de objetos sí están separados entre entornos.
  * Los siete componentes llevan **HPA al 80 % de CPU** (de 1 a 5 réplicas) con `requests` y `limits` de CPU y memoria. `account-service` se queda en una réplica por diseño: además de consumir su cola ejecuta el barrido de cuentas inactivas, y su arrendamiento por `pg_try_advisory_lock` es lo que permite que el HPA exista sin que el barrido corra N veces.
* **Cinco VM de Compute Engine**, una base por microservicio, que es la misma invariante de ADR-005 llevada a la nube: una máquina, una base, una credencial.

**Lo que el diagrama dice y conviene no pasar por alto:** las cinco bases son **compartidas por `dev` y `prod`**. La nota al pie del diagrama lo declara, y la deuda que lo registra es TD-070.

---

## 4. Métricas SRE: Definición de SLI, SLO y SLA

Definidas en [`docs/RELIABILITY.md`](RELIABILITY.md), estas métricas cuantifican el rendimiento y la disponibilidad requerida para una operación bancaria crítica:

### Service Level Indicators (SLI)
* **Disponibilidad del API Gateway ($SLI_{disp}$):**  
  $$SLI_{disp} = \frac{\text{Peticiones HTTP exitosas (no 5xx)}}{\text{Total de peticiones HTTP válidas}} \times 100$$
* **Latencia de Procesamiento en Gateway ($SLI_{lat}$):**  
  Porcentaje de peticiones resueltas en $T \le 200\text{ ms}$ para endpoints de consulta y $T \le 500\text{ ms}$ para aceptación de comandos asíncronos.
* **Éxito de Entrega Asíncrona ($SLI_{msg}$):**  
  Porcentaje de mensajes AMQP procesados y confirmados (`ack`) sin terminar en cola de errores (DLQ).

### Service Level Objectives (SLO) — Compromisos Internos
* **Disponibilidad:** $\ge 99.9\%$ en ventanas móviles de 30 días naturales.
* **Latencia (p95):** $\le 250\text{ ms}$ para transferencias y aperturas de cuenta en el Gateway.
* **Error Budget:** $0.1\%$ mensual (aproximadamente 43.2 minutos de indisponibilidad permitida por mes).

### Service Level Agreement (SLA) — Compromiso Externo
* **Disponibilidad Garantizada:** $99.5\%$ mensual para operaciones de clientes en banca web.
* **Ventana de Mantenimiento:** Programada en horas de baja demanda con previo aviso de 48 horas.

---

## 5. Casos de uso detallados por rol

Documentados en prosa formal en [`docs/domain/use-cases.md`](domain/use-cases.md), organizados por actor y objetivo de negocio:

1. **CU-01: Registro y Activación de Cliente (Rol Cliente)**  
   Captura de nombres, correo, documento de identificación y contraseña cifrada con `scrypt`. Generación de token seguro enviado por correo.
2. **CU-02: Validación de Identidad por Ventanilla (Rol Cajero Receptor)**  
   Inspección visual del documento subido a MinIO. Emisión de veredicto con `POST /api/customers/:id/identity-verdict` (`VERIFIED` o `REJECTED`).
3. **CU-03: Apertura de Cuenta Monetaria o de Ahorro (Rol Cliente / Cajero)**  
   Creación de cuenta con validación de tipo y generación de identificador bancario único con saldo inicial en cero.
4. **CU-04: Depósito en Ventanilla (Rol Cajero Receptor)**  
   Abono en efectivo inmediato a una cuenta existente mediante `POST /api/accounts/:id/deposit`.
5. **CU-05: Transferencia entre Cuentas y Compensación (Rol Cliente)**  
   Ejecución de la Saga coreografiada con débito atómico, verificación de fondos, pago a facturador y crédito final o reversión.
6. **CU-06: Auditoría Global y Desactivación de Inactivas (Rol Administrador)**  
   Inspección de eventos encolados en la bitácora central y ejecución del job de desactivación de cuentas sin movimientos.

---

## 6. Justificación de decisiones arquitectónicas (ADRs)

Los trece registros de decisiones arquitectónicas están documentados en [`docs/architecture/adr/`](architecture/adr/README.md) y consolidados en [`docs/adr.md`](adr.md):

| Registro | Decisión Adoptada | Alternativas Evaluadas y Rechazadas | Justificación Técnica Principal |
| :--- | :--- | :--- | :--- |
| **ADR-001** | Node.js 24 LTS + TypeScript en backend | Java (Spring Boot), Go | Tipado compartido en monorepo con Zod y compatibilidad nativa de contratos. |
| **ADR-002** | Nuxt 3 (Vue 3) en frontend | React / Next.js, Angular | SSR nativo, enrutamiento semántico y rápida integración con Claude Design. |
| **ADR-003** | Comunicación 100% asíncrona (AMQP) | REST síncrono inter-servicio, gRPC | Desacoplamiento total y resiliencia ante caídas temporales de servicios. |
| **ADR-004** | RabbitMQ como Message Broker | Apache Kafka, NATS | Soporte nativo para topic exchanges, colas durables y patrón request/reply. |
| **ADR-005** | PostgreSQL 18.4 independiente por servicio | MySQL, MongoDB | Integridad ACID, bloqueos `SELECT ... FOR UPDATE` y soporte `NUMERIC(14,2)`. |
| **ADR-006** | Contenedores Docker multi-stage | Imágenes convencionales | Tamaño mínimo (<150 MB), compilación reproducible y usuario no-root (`node`). |
| **ADR-007** | Orquestación local con kind y Helm | Minikube, Docker Compose puro | Reproduce fielmente la topología de clúster K8s de producción. |
| **ADR-008** | Clean Architecture / Puertos y Adaptadores | Arquitectura en capas tradicional | Independencia de frameworks y pruebas de dominio aisladas sin base de datos. |
| **ADR-009** | Transacciones distribuidas con Saga Coreografiada | Saga Orquestada, 2PC (Two-Phase Commit) | Elimina el punto único de falla (SPOF) del orquestador y distribuye la lógica. |
| **ADR-010** | JWT asimétrico + Scrypt para contraseñas | Sesiones en Redis, Bcrypt | Seguridad contra ataques de fuerza bruta y validación de tokens sin consultar DB. |
| **ADR-011/013** | Diagramación como código (PlantUML + DBML) | Herramientas gráficas (Draw.io, Lucid) | Versionamiento en Git, auditoría de cambios y renderizado automatizado. |
| **ADR-012** | Almacenamiento de objetos en MinIO | Guardado en PostgreSQL (bytea), S3 AWS | Compatibilidad con API S3 para DPIs sin incurrir en costos de nube en local. |

---

## 7. Manual de usuario y guías operativas

El manual de usuario se encuentra completamente estructurado en [`docs/manual/recorrido-visual.md`](manual/recorrido-visual.md) y [`docs/manual/`](manual/README.md), proporcionando guías específicas para cada rol:

* **[Manual del Cliente](manual/rol-cliente.md):** Flujo de auto-registro, verificación de correo, consulta de balances, realización de transferencias locales y pago de facturas.
* **[Manual del Cajero Receptor](manual/rol-cajero-receptor.md):** Atención a cuentahabientes, registro de depósitos en efectivo y bandeja de validación de documentos DPI.
* **[Manual del Administrador](manual/rol-administrador.md):** Monitoreo de auditoría con mascarado de datos, inspección de eventos y gestión de desactivación de cuentas.

---

## 8. Estructura del monorepo y código fuente

El repositorio utiliza un esquema monorepo impulsado por **pnpm** y **Turborepo**:

```text
Proyecto-SA-B-2/
├── apps/
│   ├── gateway/                  # API Gateway NestJS (puerto 3000)
│   ├── web/                      # Frontend Nuxt 3 (puerto 3010)
│   ├── services/
│   │   ├── customer-service/     # Microservicio de Clientes e Identidad
│   │   ├── account-service/      # Microservicio de Cuentas y Saldos
│   │   ├── transaction-service/  # Microservicio de Transferencias y Saga
│   │   ├── payment-service/      # Microservicio de Pagos y Facturación
│   │   └── notification-audit-service/ # Microservicio de Notificaciones y Auditoría
│   └── packages/
│       ├── contracts/            # Esquemas Zod y contratos de eventos tipados
│       ├── messaging/            # Cliente AMQP RabbitMQ y publicadores
│       └── tooling/              # Reglas compartidas de ESLint, Prettier y TS
├── docs/                         # Documentación técnica, diagramas y manuales
├── infra/
│   ├── docker/                   # Docker Compose de infraestructura (Postgres, Rabbit, MinIO)
│   ├── k8s/                      # Chart de Helm y configuración del clúster kind
│   └── terraform/gcp/            # Infraestructura como código: VPC, VMs, GKE y Cloud Run
├── .github/
│   ├── workflows/                # ci.yml, changes.yml, release.yml, cd.yml
│   └── scripts/helm-deploy.sh    # El despliegue con rolling update, sonda y rollback
├── E2E.md                        # Informe y evidencias de pruebas E2E con Playwright
└── README.md                     # Guía de inicio rápido y puesta en marcha
```

Cada componente desplegable tiene además su propio `Dockerfile` y un enlace `k8s/`
a sus manifiestos dentro del chart, de modo que quien trabaja en `payment-service`
encuentra su `deployment.yaml`, su `service.yaml` y su `hpa.yaml` en su propio
directorio sin que exista un segundo original que mantener. El detalle está en
[`operations/MONOREPO.md`](operations/MONOREPO.md).

---

## 9. Contenedores y despliegue en Kubernetes

Esta sección es la evidencia del clúster **local**. El despliegue en la nube —GKE con dos namespaces, las VM de Compute Engine y Cloud Run— es §14, y su topología, §3.10.

### Evidencias de Despliegue en Clúster Local (kind)

| Captura de Ejecución | Descripción Técnica de la Evidencia |
| :---: | :--- |
| ![Construcción de las siete imágenes](images/kubernetes/01-build-imagenes.png) | **Construcción multi-stage:** Siete imágenes construidas y etiquetadas con el commit actual, cargadas en el nodo de kind sin subir a registros públicos. |
| ![helm upgrade --install](images/kubernetes/02-helm-install.png) | **Instalación de Helm:** Despliegue exitoso del chart `bank-usac` con los 7 Deployments y Services. |
| ![Los siete pods en ejecución](images/kubernetes/03-pods-running.png) | **Pods en estado 1/1 Running:** Todos los microservicios activos dentro del namespace `bank-usac`. |
| ![Las dependencias fuera del clúster](images/kubernetes/04-dependencias-fuera-del-cluster.png) | **Dependencias externas al clúster:** Salida de `docker ps` que demuestra las 5 bases PostgreSQL, RabbitMQ y MinIO corriendo fuera del clúster en la red del host. |
| ![/ready por componente](images/kubernetes/05-ready-por-componente.png) | **Sondas `/ready` en verde:** Cada microservicio confirma conexión exitosa a su base de datos y al broker RabbitMQ. |
| ![La Saga en sus tres formas](images/kubernetes/06-saga-completed.png) | **Ejecución de la Saga:** Demostración con saldos auditados de los flujos completado y compensado con `pnpm images:flow`. |
| ![Caso degradado](images/kubernetes/07-degradado-not-ready.png) | **Tolerancia a fallos:** Al detener una base de datos, el pod pasa a `0/1 Running` (no `CrashLoopBackOff`) y se recupera automáticamente al restablecerla. |
| ![/health responde, /ready no](images/kubernetes/07b-health-ok-ready-503.png) | **Separación de sondas:** Con la dependencia caída, `/health` responde `200 OK` (liveness vivo) y `/ready` devuelve `503` (sin recibir tráfico). |
| ![El frontend servido por el clúster](images/kubernetes/08-frontend-desde-el-cluster.png) | **Frontend operativo:** Acceso a la interfaz web mediante `kubectl port-forward` con sesión activa. |

---

## 10. Frontend web (Nuxt 3) y validación de roles

La aplicación web en [`apps/web/`](../apps/web/) ofrece una experiencia bancaria moderna basada en **Claude Design** con 34 pantallas funcionales:

* **Módulo de Autenticación y Perfil:** Login, registro con carga de DPI, activación por correo, recuperación y cambio de contraseña.
* **Módulo de Cuentas y Movimientos:** Listado de cuentas monetarias y de ahorro, apertura asistida, detalle de saldos y depósitos en ventanilla.
* **Módulo de Transferencias y Saga Monitor:** Transferencias locales con visualizador en vivo del estado de la Saga (`PENDING` $\rightarrow$ `DEBITED` $\rightarrow$ `COMPLETED`).
* **Módulo de Pagos de Servicios:** Pago de facturas de agua, luz y telefonía con selector de facturador y referencia de cobro.
* **Bandeja de Notificaciones y Auditoría:** Notificaciones en tiempo real para clientes y bitácora con mascarado de información para administradores.

---

## 11. Verificación, calidad y deudas técnicas controladas

### Métricas de Validación en el Repositorio

* **Pruebas de Aislamiento y Dominio:** Todas las suites pasan con éxito (`pnpm test`).
* **Pruebas de Contratos de Eventos:** 16 suites y **775 pruebas aprobadas** en `@bank/contracts` (`pnpm test:contract`), sobre un catálogo de **103 mensajes exactos** que una prueba fija: añadir o quitar uno sin actualizar el catálogo rompe la compilación.
* **Chequeo de Tipos y Linter:** 11 paquetes aprobados con **0 errores de TypeScript y 0 infracciones de arquitectura** (`pnpm typecheck`, `pnpm lint`).
* **Pruebas End-to-End (E2E):** Suite Playwright con **11/11 en QA y Seguridad** y **67/69 en Happy Path** con 138+ capturas en [`docs/qa/screenshots/`](qa/screenshots/) (documentado en [`E2E.md`](../E2E.md)).
* **Integridad de Enlaces de Documentación:** verificada con un barrido sobre los 297 archivos Markdown del repositorio. Los enlaces relativos rotos que quedaban en `docs/` se corrigieron el 2026-09-26; los restantes viven en `.agents/` y `.opencode/`, que son plantillas de configuración de herramientas y no documentación del sistema.

### Registro de Deudas Técnicas Menores ([`docs/TECH_DEBT.md`](TECH_DEBT.md))
* **TD-018 (Retiro en ventanilla):** Se implementó el depósito en ventanilla (`POST /api/accounts/:id/deposit`), manteniéndose el retiro diferido para priorizar la estabilidad de la Saga de transferencias.
* **TD-021 (Auditoría restringida a Administrador):** Por diseño estricto de seguridad bancaria, la lectura de la bitácora global requiere privilegios de administrador para proteger datos transaccionales de terceros.

---

## 12. Fase II — Extensión funcional por microservicio

Las cinco capacidades que el enunciado de la Fase II (§4.1, pp. 4-6) añade a los microservicios existentes, más la integración de todas ellas en el flujo de transferencia. La evidencia de ejecución por ticket —comandos y salida real— vive en [`docs/qa/backend/`](qa/README.md); el diseño y el porqué, en [`docs/process/implementations.md`](process/implementations.md).

### 12.1 Customer Service — Gestión de estado KYC

| | |
| :--- | :--- |
| **Estados** | `PENDING` → `VERIFIED` \| `REJECTED`, con `VERIFIED` terminal |
| **Dónde vive** | Campo `kycStatus` del agregado `Customer`, **distinto de `identityStatus`** (que es la revisión de la foto del DPI de la Fase I) |
| **Contratos** | `customer.set-kyc-status.v1` (comando), `customer.kyc.verified.v1` y `customer.kyc.rejected.v1` (eventos), `kycStatus` añadido a `customer.get.replied.v1` |
| **Persistencia** | Migración `007_customers_kyc_status`: columna más `CHECK`, escritura bajo versión optimista |
| **Ruta** | `POST /api/customers/{customerId}/kyc-status`, sólo personal |
| **La regla que importa** | `mayInitiateTransactions` — un cliente que no está `VERIFIED` no puede iniciar una transferencia |

Son **dos** estados de validación y no uno a propósito: `identityStatus` responde "¿el documento que subió es suyo?" y lo decide un cajero mirando una foto; `kycStatus` responde "¿está habilitado para mover dinero?" y es la puerta que la Saga consulta. Colapsarlos habría atado una decisión operativa a una revisión manual.

### 12.2 Account Service — Tipos de cuenta y reglas de negocio

| Tipo | Depósito mínimo de apertura | Comisión por transacción |
| :--- | :--- | :--- |
| `MONETARIA` (corriente) | ninguno | ninguna |
| `AHORRO` | **Q100.00** (`AHORRO_MINIMUM_OPENING_BALANCE_MINOR = 10_000`) | **Q3.00** por débito (`commissionMinor = 300`) |

Las reglas viven en un solo lugar, `domain/account-type-rules.ts`, y no repartidas por los casos de uso. Tres detalles que un evaluador suele preguntar:

* **La comisión se cobra dentro del mismo bloqueo de fila que el débito**, como una operación propia en `account_operations` (migración `007_account_operations_commission_type`), y emite `account.commission.charged.v1`. No es un segundo movimiento de dinero que pueda quedar a medias.
* **El destino recibe el monto íntegro.** La comisión la paga el origen.
* **Una compensación devuelve también la comisión.** No lo hacía: una transferencia `AHORRO` compensada devolvía el monto y se quedaba con los Q3.00, de modo que el banco cancelaba la transferencia y aun así cobraba por ella. Corregido y registrado como **TD-065**, con prueba en los tres niveles, incluida una contra PostgreSQL real que comprueba que la fila de la comisión queda en `COMPENSATED`.
* **El «saldo mínimo» es una condición de apertura, no un piso permanente**: una vez abierta, una cuenta `AHORRO` puede debitarse hasta Q0.00 como cualquier otra. Es una lectura del requisito y está escrita como tal en el dominio.

### 12.3 Transaction Service — Historial y trazabilidad

`transaction.list.query.v1` / `.replied.v1` responden el historial con estos filtros, combinables:

| Filtro | Comportamiento |
| :--- | :--- |
| `from`, `to` | Rango de fechas |
| `status` | Uno de los seis estados reales de la Saga |
| `phaseStatus` | Uno de los tres que nombra el enunciado: `PENDING`, `APPROVED`, `FAILED` |
| `customerId` | Sólo personal; un `CLIENTE` queda acotado a lo suyo por la identidad del sobre, nunca por un parámetro que él controle |
| `limit` | 25 por defecto, **100 como techo** (`MAX_TRANSACTION_ROWS`) |

`phaseStatus` es una **proyección** de los seis estados, no un reemplazo: `COMPLETED` se presenta como `APPROVED`, y los estados intermedios como `PENDING`. Nombrar `status` y `phaseStatus` a la vez estrecha a su intersección en lugar de que uno pise al otro en silencio.

El alcance por rol se decide con la identidad verificada del sobre, y un `customerId` ajeno devuelve **una lista vacía y no un 403**: un `403` para un cliente que existe y un `200` vacío para uno que no responderían juntos a la pregunta «¿esta persona es cliente de este banco?».

### 12.4 Payment Service — Pagos externos simulados

El proveedor es **una función pura**: sin reloj, sin base de datos, sin aleatoriedad.

| Escenario solicitado | Resultado del proveedor | Qué hace la Saga |
| :--- | :--- | :--- |
| `APPROVE` | `SUCCESS` con referencia | `COMPLETED` |
| `REJECT` | `FAILURE` permanente | Compensa en el primer intento |
| `TRANSIENT_FAILURE` | `FAILURE` transitorio | Reintenta y, agotada la escalera, compensa |
| `TIMEOUT` | `TIMEOUT` | Igual que el transitorio: reintenta y compensa |

Un `TIMEOUT` se devuelve **de inmediato**, igual que los otros dos: es lo que el proveedor contesta, no una espera que este servicio tenga que sufrir para simularla.

La escalera de reintentos es **1 s, 5 s, 30 s**, y su vencimiento es una **columna** (`next_attempt_at`) y no un temporizador en memoria, de modo que un pod reprogramado no se olvida de una transferencia a medio pagar. Los intentos se serializan con `SELECT … FOR UPDATE` más una comprobación de que el número de intento sigue al de la fila, así que un comando reentregado y el barrido de reintentos no pueden cobrar los dos.

`payment.attempt.failed.v1` se publica en **cada** intento fallido, incluido el último; sólo el evento terminal cierra la Saga. Esa distinción es lo que hace observable la escalera mientras se está subiendo, y es lo que la pantalla de transferencias muestra en vivo.

### 12.5 Notification & Audit Service — Clasificación de eventos

Tres severidades, asignadas por una tabla explícita de tipo de evento a severidad —no inferidas del nombre:

| Severidad | Qué significa | Ejemplos |
| :--- | :--- | :--- |
| `INFO` | El sistema hizo lo que se le pidió | `customer.registered.v1`, `account.opened.v1`, `transaction.completed.v1` |
| `WARNING` | Una negativa esperada, sin nada que deshacer | `customer.register.rejected.v1`, `account.debit.rejected.v1` |
| `ERROR` | Algo que ya había ocurrido tuvo que deshacerse | `transaction.compensated.v1`, `account.debit.compensated.v1` |

La severidad no es decorativa: es un filtro de `audit.events.list.query.v1`, alimenta los contadores `infoToday` / `warningToday` / `errorToday` de las estadísticas, y viaja en la bandeja de notificaciones del cliente. Una compensación se clasifica `ERROR` aunque desde el lado del cliente «mi dinero volvió» suene bien — porque para quien opera el banco es exactamente lo que hay que mirar.

Dos decisiones deliberadas que conviene poder defender:

* **El payload se redacta antes del `INSERT`**, no al leerlo. La única base de datos que escucha todos los eventos del banco no guarda documentos, direcciones ni montos.
* **Este servicio no toma validador del broker.** Un mensaje que no puede interpretar se registra como `INVALID` en vez de aparcarse: el servicio cuyo trabajo es registrar lo que llegó no puede ser el que no lo ve.

### 12.6 Funcionalidad transversal obligatoria

| Requisito (§4.1, p. 6) | Cómo está resuelto |
| :--- | :--- |
| **Idempotencia** | Los cinco servicios deduplican por `messageId` del sobre en `processed_messages` **antes** de tocar estado; Account Service evalúa la idempotencia antes de mover un saldo; Notification & Audit usa la clave primaria `(event_id, consumer)` |
| **CorrelationId** | Viaja en el sobre compartido de `@bank/contracts` y se propaga por cada publicación; el Gateway lo devuelve en la cabecera `x-correlation-id` de toda respuesta, y la auditoría permite recorrer un flujo completo por él |
| **Manejo de estados** | Cada operación tiene estados definidos: seis en la Saga (una función pura rechaza toda transición fuera del diagrama), tres en KYC, y los de pago y auditoría |
| **Manejo de errores** | Un fallo genera un evento explícito con su código —`KYC_NOT_VERIFIED`, `INSUFFICIENT_FUNDS`, `ACCOUNT_INACTIVE`, entre otros— nunca silencio; el Gateway los traduce a siete códigos HTTP contratados |

### 12.7 Integración con la Saga

Las cinco extensiones están **dentro** del flujo de transferencia, que es el orden que dibuja §3.7: gate de KYC → regla del tipo de cuenta con su comisión → registro en el historial → pago externo con su escalera → notificación final clasificada. Ninguna vive en una pantalla aparte ni en un endpoint que sólo exista para demostrarla.

---

## 13. Fase II — Pipeline CI/CD, estrategia de ramas y despliegue selectivo

La decisión de plataforma y sus alternativas descartadas están en [ADR-015](architecture/adr/ADR-015-ci-cd-platform.md); el detalle operativo de cada workflow, en [`operations/CI.md`](operations/CI.md); la estrategia de monorepo, en [`operations/MONOREPO.md`](operations/MONOREPO.md). Esto es el resumen.

### 13.1 Los cuatro workflows

| Workflow | Se dispara con | Qué hace |
| :--- | :--- | :--- |
| [`ci.yml`](../.github/workflows/ci.yml) | push a `feature/**`, `fix/**`, `test/**`, `docs/**`, `chore/**`, `refactor/**`; PR hacia `develop` o `main` | **Fase 1 Build** → **Fase 2 Test** → **Fase 3 Validación**, como tres jobs |
| [`changes.yml`](../.github/workflows/changes.yml) | `workflow_call` | Clasifica los archivos que cambiaron y devuelve la lista de componentes |
| [`release.yml`](../.github/workflows/release.yml) | push a `release/**`, tag `v*` | Genera la versión formal y publica **siete imágenes versionadas** en Artifact Registry |
| [`cd.yml`](../.github/workflows/cd.yml) | push a `develop`; push a `main` | Despliega al namespace `dev`; hace **rolling update** en `prod` |

### 13.2 Las tres fases obligatorias son tres jobs

`test` declara `needs: build` y `validate` declara `needs: [build, test]`. El orden que el enunciado enumera lo impone el grafo, y un fallo en cualquier punto **salta todas las fases posteriores** automáticamente. Aparecen como tres entradas independientes en la lista de checks, que es lo que convierte «no se omitió ninguna etapa» en algo que se ve en lugar de algo que se afirma.

| Fase | Qué ejecuta |
| :--- | :--- |
| **Build** | `pnpm install --frozen-lockfile`, `pnpm build` |
| **Test** | `pnpm test`, `pnpm test:contract`, las suites de integración contra **PostgreSQL 18.4 y RabbitMQ 4.3.4 reales** (una base por servicio), y la forma de la pirámide 70/20/10 |
| **Validación** | Guard de `.env` versionado, `pnpm lint` (que incluye las reglas ejecutables de aislamiento) y `pnpm typecheck` |

Un detalle que vale la pena señalar en la defensa: **cada paso de integración falla si Jest reporta alguna suite como `skipped`**. Una suite que se salta sola cuenta como verde, y ese es exactamente el defecto que el guard existe para cazar.

### 13.3 Flujo de ramas

```
feature/<nombre>  ──push──►  CI: Build + Test + Validación
        │
        └──merge request──►  develop  ──►  CI: Build + Test
                                │
                                └──►  CD: build selectivo + despliegue a namespace dev
                                                │
        release/<version> o tag vX.X.X  ──►  Release: versión formal + 7 imágenes versionadas
                                                │
                                └──merge──►  main  ──►  CD: rolling update en prod
                                                        con las imágenes ya publicadas
```

**Producción nunca construye una imagen.** El job de producción resuelve el tag `v*` más reciente y despliega lo que `release.yml` ya publicó; si no existe ningún tag, **falla** en lugar de inventarse uno. Ninguna imagen se etiqueta `latest`: la entrega usa `vX.Y.Z`, `dev` usa `dev-<sha>`, y `helm-deploy.sh` rechaza `latest` explícitamente, de modo que la regla se sostiene incluso si alguien corre el script a mano.

### 13.4 Despliegue selectivo

`changes.yml` mapea directorios a componentes:

```
apps/services/payment-service/**   → payment-service
apps/gateway/**                    → gateway
apps/web/**                        → web
apps/packages/**                   → los siete
pnpm-lock.yaml, turbo.json         → los siete
.github/workflows/**, infra/k8s/** → los siete
```

**Lo compartido dispara todo a propósito:** un cambio de contrato que sólo reconstruyera el servicio que lo editó dejaría a los otros seis hablando la versión anterior.

Y el despliegue es selectivo en las dos mitades, no sólo en la construcción: `helm-deploy.sh` recibe `UPDATED_COMPONENTS`, pone la etiqueta nueva sólo en ésos y **lee con `helm get values` la que ya tenían** los demás. Sin esa lectura, Helm caería al `tag: dev` por defecto del chart —una etiqueta que no existe en el registry— y el despliegue «selectivo» rompería los seis servicios que nadie tocó.

### 13.5 Eficiencia, rolling update y rollback

* **Caché:** dependencias con `actions/setup-node` (pnpm) más la caché de Turborepo compartida entre los tres jobs por clave de commit; capas de Docker con `cache-from: type=gha` **por componente**.
* **Paralelismo:** `strategy.matrix` construye las siete imágenes a la vez en la entrega, y sólo las modificadas en `dev`.
* **Rolling update sin caída:** `maxUnavailable: 0`, `maxSurge: 1`, `preStop` de cinco segundos para dejar de recibir tráfico antes de cerrarse, y sondas `/health` y `/ready` distintas en los siete componentes. El script **sondea el Gateway cada segundo mientras la actualización ocurre** y reporta el resultado: la última corrida de producción registró *41 peticiones, 0 respuestas distintas de 200*.
* **Rollback automático:** si el `helm upgrade --wait` no alcanza `Ready`, el script vuelca el diagnóstico —pods, eventos, logs, capacidad del nodo— y ejecuta `helm rollback`. Si era la primera instalación no hay revisión anterior, y entonces retira el release a medias en lugar de dejar restos que envenenen el siguiente intento.

---

## 14. Fase II — Infraestructura como código y despliegue en la nube

La decisión y sus alternativas descartadas están en [ADR-014](architecture/adr/ADR-014-cloud-provider.md) y [ADR-016](architecture/adr/ADR-016-cloud-infrastructure.md); el procedimiento paso a paso, en [`operations/CLOUD.md`](operations/CLOUD.md); las variables del módulo, en [`infra/terraform/gcp/README.md`](../infra/terraform/gcp/README.md).

### 14.1 Recursos aprovisionados

Un único módulo raíz de Terraform, `infra/terraform/gcp/`, con el proveedor `google ~> 5.15`:

| Archivo | Recursos |
| :--- | :--- |
| [`vpc.tf`](../infra/terraform/gcp/vpc.tf) | VPC `bank-usac-vpc`, subred GKE `10.10.0.0/20` con rangos secundarios de pods y services, subred de bases `10.40.0.0/24`, Cloud Router, Cloud NAT y tres reglas de firewall (tráfico interno, SSH sólo desde el rango de IAP, y los rangos de health check) |
| [`compute_vms.tf`](../infra/terraform/gcp/compute_vms.tf) | Cinco instancias `e2-medium` con Debian 12, disco de 20 GB y **sin IP pública**, cada una con un `metadata_startup_script` que instala PostgreSQL y crea **un rol y una base** |
| [`gke.tf`](../infra/terraform/gcp/gke.tf) | Clúster zonal, pool gestionado de 3 × `e2-standard-2`, canal `REGULAR`, auto-reparación, Workload Identity y el **addon de HPA habilitado** |
| [`cloud_run.tf`](../infra/terraform/gcp/cloud_run.tf) | Servicio `bank-usac-web`, puerto 8080, de 0 a 5 instancias, público |
| [`outputs.tf`](../infra/terraform/gcp/outputs.tf) | Las cinco IP privadas, el comando de credenciales de `kubectl` y la URL de Cloud Run |

### 14.2 Variables y procedimiento

El ciclo es el estándar —`terraform init`, `validate`, `plan`, `apply`— desde `infra/terraform/gcp/`, con un `terraform.tfvars` copiado del ejemplo. Las variables que hay que dar son `project_id` y las contraseñas de base de datos; el resto tiene valores por defecto (`region = us-central1`, `zone = us-central1-a`, `gke_node_count = 3`, `vm_machine_type = e2-medium`). Después, el pipeline despliega y nadie vuelve a tocar Terraform.

El procedimiento completo, incluidos los pasos que Terraform no cubre, está en [`operations/CLOUD.md`](operations/CLOUD.md).

### 14.3 Autoescalado

Los siete componentes llevan un `HorizontalPodAutoscaler` (`autoscaling/v2`) con `averageUtilization: 80` sobre CPU, `minReplicas: 1` y `maxReplicas: 5`, y todos declaran `requests` y `limits` de CPU y memoria —50m/128Mi y 250m/256Mi por defecto, ajustables por componente. Es el requisito literal de §4.1 (p. 7-8).

### 14.4 Separación de entornos

`dev` y `prod` son dos namespaces del mismo clúster. Cada uno tiene sus pods, **su propio RabbitMQ y su propio MinIO**, y sus propias etiquetas de imagen. Lo que **no** está separado son las cinco bases de datos: ambos entornos leen las mismas `INFRA_ADDRESSES`. Es una desviación conocida del enunciado, decidida a sabiendas y registrada como **TD-070**, con su remedio escrito —bases por entorno sobre las mismas VM, que el enunciado permite— y la razón por la que no está aplicada: las VM no tienen IP pública y ningún runner puede alcanzarlas.

### 14.5 Lo que todavía no está en Terraform

Tres recursos del sistema en producción se crean fuera del módulo. Están registrados como deuda porque el enunciado penaliza explícitamente la infraestructura creada a mano:

| Recurso | Deuda |
| :--- | :--- |
| El repositorio de Artifact Registry `bank-images` | **TD-079** |
| El `Service` de tipo `LoadBalancer` que expone el Gateway | **TD-080** |
| La revisión de Cloud Run que sirve el frontend real | **TD-081** |

Los tres tienen su comando en [`operations/CLOUD.md`](operations/CLOUD.md) y su arreglo propuesto en [`TECH_DEBT.md`](TECH_DEBT.md). Preferimos que estén escritos a que se descubran.

---

## Comandos Esenciales de Verificación

```bash
# 1. Compilación y validación de reglas de arquitectura
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm test:contract

# 2. Levantar la plataforma completa en local (Docker + Host)
pnpm dev

# 3. Demostración de los tres flujos de la Saga (éxito y compensación)
pnpm images:flow

# 4. Ejecución de la suite de pruebas End-to-End (Playwright)
pnpm test:e2e

# 5. Fase II — la infraestructura, desde infra/terraform/gcp/
terraform init && terraform validate && terraform plan

# 6. Fase II — comprobar el sistema desplegado en la nube
curl -s http://<IP-del-Gateway>:3000/health
curl -s http://<IP-del-Gateway>:3000/ready
kubectl get pods,hpa -n prod
kubectl get pods,hpa -n dev
```

El procedimiento completo de nube está en [`operations/CLOUD.md`](operations/CLOUD.md).
