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
4. [Métricas SRE: Definición de SLI, SLO y SLA](#4-métricas-sre-definición-de-sli-slo-y-sla)
5. [Casos de uso detallados por rol](#5-casos-de-uso-detallados-por-rol)
6. [Justificación de decisiones arquitectónicas (ADRs)](#6-justificación-de-decisiones-arquitectónicas-adrs)
7. [Manual de usuario y guías operativas](#7-manual-de-usuario-y-guías-operativas)
8. [Estructura del monorepo y código fuente](#8-estructura-del-monorepo-y-código-fuente)
9. [Contenedores y despliegue en Kubernetes](#9-contenedores-y-despliegue-en-kubernetes)
10. [Frontend web (Nuxt 3) y validación de roles](#10-frontend-web-nuxt-3-y-validación-de-roles)
11. [Verificación, calidad y deudas técnicas controladas](#11-verificación-calidad-y-deudas-técnicas-controladas)

---

## 1. Los entregables del enunciado y su ubicación

Este documento consolida la arquitectura, el diseño y las evidencias de implementación de **Bank USAC**, guiando la evaluación hacia cada artefacto concreto versionado en el repositorio:

| Entregable Oficial | Dónde vive en el repositorio | Estado |
| :--- | :--- | :---: |
| **Documento técnico completo** | Este documento ([`docs/TECHNICAL_DOCUMENT.md`](TECHNICAL_DOCUMENT.md)) + [`docs/architecture.md`](architecture.md). El índice de toda la documentación es [`docs/README.md`](README.md) | **Completo** |
| **Caso de negocio, requisitos y trazabilidad** | [`docs/dda.md`](dda.md) — stakeholders, RF/RNF, escenarios de calidad y las matrices que atan cada requisito a su caso de uso | **Completo** |
| **Diagramas arquitectónicos** | [`docs/architecture/diagrams/`](architecture/diagrams/) (fuentes `.puml`, `.dsl`, `.dbml` e imágenes renderizadas `.png`) | **Completo** |
| **Definición de SLI, SLO y SLA** | [`docs/sre/sli.md`](sre/sli.md), [`slo.md`](sre/slo.md) y [`sla.md`](sre/sla.md) (30 indicadores, 26 objetivos y sus exclusiones); las preocupaciones de diseño que responden, en [`docs/RELIABILITY.md`](RELIABILITY.md) | **Completo** |
| **Casos de uso detallados** | [`docs/domain/use-cases.md`](domain/use-cases.md) y jerarquía UML en [`docs/architecture/diagrams/cdu/`](architecture/diagrams/cdu/README.md) | **Completo** |
| **Decisiones arquitectónicas (ADRs)** | [`docs/adr.md`](adr.md) y 13 registros formales en [`docs/architecture/adr/`](architecture/adr/README.md) | **Completo** |
| **Manual de usuario integral** | [`docs/manual/`](manual/README.md) — la guía general, una por rol y el [recorrido visual](manual/recorrido-visual.md) de 78 pasos con captura por paso | **Completo** |
| **Estrategia de monorepo** | Raíz: `pnpm-workspace.yaml`, `package.json` y Turborepo (`turbo.json`) | **Completo** |
| **5 microservicios desacoplados** | [`apps/services/`](../apps/services/) (`customer`, `account`, `transaction`, `payment`, `notification-audit`) | **Completo** |
| **API Gateway perimetral** | [`apps/gateway/`](../apps/gateway/) (NestJS, puerto 3000, sin DB, sin HTTP interno) | **Completo** |
| **Despliegue en Kubernetes** | [`infra/k8s/`](../infra/k8s/README.md), chart Helm en `infra/k8s/helm/bank-usac/` y runbook [`DEPLOYMENT.md`](operations/DEPLOYMENT.md) | **Completo** |
| **Frontend web funcional** | [`apps/web/`](../apps/web/README.md) (Nuxt 3, puerto 3010, Claude Design, 34 pantallas) | **Completo** |
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

### 3.5 Diagrama UML de Despliegue

Muestra la topología física y de orquestación en el clúster local de Kubernetes (kind) bajo el namespace `bank-usac`:

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
1. **Inicio y Débito:** El cliente solicita la transferencia. `transaction-service` crea el registro en estado `PENDING` y publica `account.debit.requested.v1`.
2. **Bloqueo y Débito:** `account-service` ejecuta `SELECT ... FOR UPDATE` sobre la cuenta origen, verifica saldo suficiente con la restricción `CHECK (balance >= 0)`, aplica el débito y emite `account.debited.v1`.
3. **Intento de Pago / Transferencia:** `transaction-service` avanza a `DEBITED` y publica `payment.attempt.requested.v1`.
4. **Procesamiento de Pago con Reintentos:** `payment-service` intenta el cargo. Si ocurre un fallo transitorio, escala los reintentos (1s, 5s, 30s) persistidos en la columna `next_attempt_at`.
5. **Flujo de Éxito:** Al confirmarse el pago (`payment.completed.v1`), `account-service` acredita los fondos en la cuenta destino (`account.credited.v1`) y `transaction-service` concluye la Saga en estado `COMPLETED`.
6. **Flujo de Compensación (Garantía de Fondos):** Si el pago falla de forma terminal (`payment.failed.terminal.v1`), `transaction-service` solicita reversión mediante `account.debit.compensate.v1`. `account-service` reembolsa el monto exacto a la cuenta origen (`account.debited.compensated.v1`) y la transacción culmina en `COMPENSATED`. **El saldo nunca se pierde ni queda en estado inconsistente.**

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
│   └── k8s/                      # Chart de Helm y configuración del clúster kind
├── E2E.md                        # Informe y evidencias de pruebas E2E con Playwright
└── README.md                     # Guía de inicio rápido y puesta en marcha
```

---

## 9. Contenedores y despliegue en Kubernetes

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
* **Pruebas de Contratos de Eventos:** 16 suites y **737 pruebas aprobadas** en `@bank/contracts` (`pnpm test:contract`).
* **Chequeo de Tipos y Linter:** 11 paquetes aprobados con **0 errores de TypeScript y 0 infracciones de arquitectura** (`pnpm typecheck`, `pnpm lint`).
* **Pruebas End-to-End (E2E):** Suite Playwright con **11/11 en QA y Seguridad** y **67/69 en Happy Path** con 138+ capturas en [`docs/qa/screenshots/`](qa/screenshots/) (documentado en [`E2E.md`](../E2E.md)).
* **Integridad de Enlaces de Documentación:** **571 enlaces internos verificados, 0 enlaces rotos**.

### Registro de Deudas Técnicas Menores ([`docs/TECH_DEBT.md`](TECH_DEBT.md))
* **TD-018 (Retiro en ventanilla):** Se implementó el depósito en ventanilla (`POST /api/accounts/:id/deposit`), manteniéndose el retiro diferido para priorizar la estabilidad de la Saga de transferencias.
* **TD-021 (Auditoría restringida a Administrador):** Por diseño estricto de seguridad bancaria, la lectura de la bitácora global requiere privilegios de administrador para proteger datos transaccionales de terceros.

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
```
