# Manual Técnico — Bank USAC

## Índice
1. [Objetivos](#1-objetivos)
   - [1.1 Objetivo General](#11-objetivo-general)
   - [1.2 Objetivos Específicos](#12-objetivos-específicos)
2. [Alcances del Sistema](#2-alcances-del-sistema)
3. [Especificaciones Técnicas](#3-especificaciones-técnicas)
   - [3.1 Requisitos de Hardware](#31-requisitos-de-hardware)
   - [3.2 Requisitos de Software](#32-requisitos-de-software)
   - [3.3 Tecnologías y Herramientas Utilizadas](#33-tecnologías-y-herramientas-utilizadas)
4. [Arquitectura del Sistema y Patrones de Diseño](#4-arquitectura-del-sistema-y-patrones-de-diseño)
   - [4.1 Arquitectura General y Despliegue Local](#41-arquitectura-general-y-despliegue-local)
   - [4.2 Arquitectura en la Nube (GCP - Fase 2)](#42-arquitectura-en-la-nube-gcp---fase-2)
   - [4.3 Reglas Arquitectónicas Inviolables (Constitution)](#43-reglas-arquitectónicas-inviolables-constitution)
5. [Lógica y Descripción de la Solución](#5-lógica-y-descripción-de-la-solución)
   - [5.1 API Gateway](#51-api-gateway)
   - [5.2 Customer Service](#52-customer-service)
   - [5.3 Account Service](#53-account-service)
   - [5.4 Transaction Service y Orquestación Saga](#54-transaction-service-y-orquestación-saga)
   - [5.5 Payment Service y Simulación de Fallos](#55-payment-service-y-simulación-de-fallos)
   - [5.6 Notification & Audit Service](#56-notification--audit-service)
   - [5.7 Frontend Web (Nuxt 3)](#57-frontend-web-nuxt-3)
6. [Diseño de Bases de Datos](#6-diseño-de-bases-de-datos)
7. [Guía de Compilación, Ejecución y Pruebas](#7-guía-de-compilación-ejecución-y-pruebas)
   - [7.1 Levantado Completo en Docker Local](#71-levantado-completo-en-docker-local)
   - [7.2 Ejecución de Pruebas Automatizadas](#72-ejecución-de-pruebas-automatizadas)
   - [7.3 Despliegue en la Nube con Terraform y Helm (GCP - Fase 2)](#73-despliegue-en-la-nube-con-terraform-y-helm-gcp---fase-2)
   - [7.4 Marco de Confiabilidad SRE (SLI, SLO y SLA)](#74-marco-de-confiabilidad-sre-sli-slo-y-sla)

---

## 1. Objetivos

### 1.1 Objetivo General
Proporcionar una explicación técnica detallada sobre la arquitectura, la implementación del código fuente, la lógica transaccional distribuida y las bases operativas de la plataforma bancaria **Bank USAC**, facilitando el mantenimiento futuro, la extensibilidad y la auditoría del sistema.

### 1.2 Objetivos Específicos
* Describir la estructura modular del monorepo y la aplicación de los principios de **Clean Architecture** en cada uno de los microservicios.
* Detallar el funcionamiento del patrón **Saga por Coreografía** asíncrona sobre **RabbitMQ**, garantizando consistencia eventual y reversas contables.
* Explicar los mecanismos de concurrencia y seguridad financiera implementados (bloqueos pesimistas, integridad de saldos, idempotencia absoluta y redacción de datos sensibles).
* Documentar las entidades de datos, esquemas relacionales de las cinco bases de datos independientes en **PostgreSQL** y los contratos de mensajería tipados con **Zod**.
* Establecer los procedimientos técnicos para la ejecución local mediante contenedores **Docker** y el despliegue orquestado en **Kubernetes**.

---

## 2. Alcances del Sistema

El sistema bancario Bank USAC implementa la totalidad del ciclo de vida de operaciones bancarias digitales:
* **Gestión de Clientes y KYC:** Registro público de cuentahabientes, validación de identidad (KYC con estados `PENDING`, `VERIFIED`, `REJECTED`), almacenamiento seguro de fotografías de DPI en almacenamiento de objetos compatible con S3 (MinIO) y activación por correo electrónico.
* **Gestión de Cuentas Bancarias:** Creación de cuentas de Ahorro y Monetarias, control de saldos con precisión exacta en centavos (`NUMERIC(14,2)`), comisiones por transacción, barrido automático de desactivación por inactividad y activación/desactivación manual por parte de Administradores, Cajeros Receptores y Clientes (para sus propias cuentas).
* **Transferencias Interbancarias Distribuidas:** Ejecución de transferencias mediante una Saga coreografiada de 6 estados (`PENDING`, `DEBITED`, `COMPLETED`, `REFUSED`, `COMPENSATING`, `FAILED`), asegurando que jamás exista dinero duplicado ni fondos perdidos.
* **Procesamiento de Pagos a Proveedores:** Pago de servicios (energía, agua, telefonía) con simulación estocástica de respuestas de proveedores externos (`Éxito`, `Fallo`, `Timeout`) y escalera de reintentos configurada a nivel de base de datos.
* **Auditoría Regulatoria y Notificaciones:** Bitácora inmutable de eventos clasificados por severidad (`INFO`, `WARNING`, `ERROR`), trazabilidad integral mediante `correlationId` y emisión de notificaciones al cliente.

> **Nota:** Para la guía operativa dirigida al usuario final, pantallas detalladas y flujos paso a paso por rol (Cliente, Cajero Receptor y Administrador), consultar el **[Manual de Usuario](manual-usuario.md)** y el **[Recorrido Visual de 78 Pasos](manual/recorrido-visual.md)**.

---

## 3. Especificaciones Técnicas

### 3.1 Requisitos de Hardware
* **Procesador (CPU):** Arquitectura x86_64 o ARM64, mínimo 4 núcleos físicos (recomendado 8 núcleos para ejecución simultánea de los 15 contenedores del entorno local o nodos K8s).
* **Memoria RAM:** Mínimo 8.0 GB libres (recomendado 16.0 GB).
* **Almacenamiento:** Mínimo 15 GB de espacio libre en disco en estado sólido (SSD).
* **Conectividad de Red:** Conexión a Internet para descarga de imágenes Docker base y paquetes de dependencias.

### 3.2 Requisitos de Software
* **Sistema Operativo:** Linux (Ubuntu 22.04+ / Debian 12+), macOS (13+ Ventura / Sonoma), o Windows 10/11 con WSL2.
* **Motor de Contenedores:** Docker Engine v24.0+ y Docker Compose v2.20+.
* **Entorno de Ejecución:** Node.js versión `24.19.0` (LTS Krypton) gestionado vía `.nvmrc`.
* **Gestor de Paquetes:** `pnpm` versión `11.21.0` (definido en `packageManager`).
* **Orquestación de Monorepo:** Turborepo v2.x.
* **Orquestador de Contenedores:** Kubernetes v1.28+ (local mediante `kind` o administrado mediante `GKE`).

### 3.3 Tecnologías y Herramientas Utilizadas
* **Backend:** TypeScript 5.x, NestJS 11.x.
* **Frontend:** Vue 3.5, Nuxt 4.5, Tailwind CSS 4.x, Nuxt UI.
* **Bases de Datos:** PostgreSQL 18.4 (5 instancias dedicadas e independientes).
* **Broker de Mensajería:** RabbitMQ 4.3.4 con plugin de administración (protocolo AMQP 0-9-1).
* **Almacenamiento de Objetos:** MinIO Server (API compatible con AWS S3 SDK v3).
* **Infraestructura como Código:** Terraform para aprovisionamiento en la nube (GCP) y Helm v3 para manifiestos de Kubernetes.

---

## 4. Arquitectura del Sistema y Patrones de Diseño

### 4.1 Arquitectura General y Despliegue Local
El sistema está construido bajo una arquitectura orientada a microservicios desacoplados y dirigida por eventos:

```text
[ Cliente Web (Nuxt 3) ]  ──HTTP/REST──►  [ API Gateway (NestJS :3000) ]
                                                   │
                             ┌─────────────────────┴─────────────────────┐
                             ▼                                           ▼
                    [ bank.commands ]                           [ bank.replies ]
                             │                                           ▲
      ┌──────────────────────┼──────────────────────┬────────────────────┘
      ▼                      ▼                      ▼
[Customer Service]   [Account Service]   [Transaction Service]
  (PostgreSQL :5433)   (PostgreSQL :5434)  (PostgreSQL :5435)
      │                      │                      │
      └──────────────────────┼──────────────────────┘
                             ▼
                      [ bank.events ]
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
    [Payment Service]            [Notification & Audit]
    (PostgreSQL :5436)             (PostgreSQL :5437)
```

*(Para ver el diagrama UML de despliegue local en detalle, consultar [`docs/architecture/diagrams/05-uml-despliegue.puml`](architecture/diagrams/05-uml-despliegue.puml)).*

### 4.2 Arquitectura en la Nube (GCP - Fase 2)
Para el cumplimiento de los requerimientos de la Fase 2, se estructuró la infraestructura como código (**Terraform**) sobre Google Cloud Platform (diagrama detallado en [`docs/architecture/diagrams/08-despliegue-cloud-gcp.puml`](architecture/diagrams/08-despliegue-cloud-gcp.puml)):

1. **Frontend Serverless en Cloud Run:** El contenedor web corre de forma elástica escalando de 0 a 5 instancias, consumiendo la URL pública del API Gateway.
2. **Clúster GKE Administrado:** Aloja los microservicios backend, el API Gateway, el broker RabbitMQ y MinIO. Incluye **Horizontal Pod Autoscaling (HPA)** configurado al **80% de utilización de CPU**.
3. **Máquinas Virtuales Compute Engine para PostgreSQL:** 5 instancias privadas dedicadas en su propia subred (`10.40.0.0/24`), aisladas de Internet directo y protegidas por Cloud NAT y Firewall de red VPC.
4. **Almacenamiento de Objetos Seguro con MinIO (API S3):** Para la custodia de fotografías de DPI, se utiliza MinIO StatefulSet dentro de la VPC privada de Kubernetes en lugar de un bucket multitenant público. Esto garantiza soberanía de datos personales sensibles (Zero Trust PII), latencia interna ultra baja, paridad dev/prod total (12-Factor App) y erradica el *Vendor Lock-in* al apegarse a la especificación estándar de la API S3.

### 4.3 Reglas Arquitectónicas Inviolables (Constitution)
1. **Frontera de Datos Estricta:** Cada microservicio es dueño de su base de datos PostgreSQL. Ningún servicio puede consultar tablas ni conectarse a la base de datos de otro microservicio.
2. **Sin HTTP entre Servicios:** Todos los microservicios se comunican de forma 100% asíncrona mediante colas y exchanges de RabbitMQ.
3. **Gateway Agregador sin Lógica de Dominio:** El API Gateway es el único punto de entrada; maneja autenticación JWT, autorización de roles y transmutación HTTP $\leftrightarrow$ AMQP, pero no toma decisiones financieras ni guarda datos.
4. **Saga por Coreografía:** Las operaciones distribuidas no usan bloqueos de dos fases (2PC); avanzan y compensan mediante eventos durables.

---

## 5. Lógica y Descripción de la Solución

A continuación se detalla la lógica de los componentes principales y los fragmentos de código donde se resuelven las reglas de negocio críticas.

### 5.1 API Gateway
Punto de entrada único. Expone endpoints REST, valida esquemas de entrada con DTOs fuertemente tipados, verifica el token JWT y emite el comando correspondiente al bus AMQP, esperando la respuesta con un techo estricto de 5 segundos (*Request/Reply pattern*).

#### Validación y Control de Roles de Usuario (`@Roles`)
La autorización se aplica a nivel de controlador mediante metadatos y Guards personalizados:

```typescript
// apps/gateway/src/interfaces/accounts.controller.ts
@ApiOperation({
  summary: 'Activa o desactiva una cuenta',
  description: 'ADMINISTRADOR, CAJERO_RECEPTOR y CLIENTE (para sus propias cuentas).',
})
@Roles('ADMINISTRADOR', 'CAJERO_RECEPTOR', 'CLIENTE')
@Post(':accountId/status')
@HttpCode(202)
public async setStatus(
  @Param('accountId') accountId: string,
  @Body(validated(SetAccountStatusDto)) body: SetAccountStatusDto,
  @Req() request: GatewayRequest,
): Promise<{ readonly correlationId: string }> {
  if (!UUID_V4.test(accountId)) {
    throw GatewayError.validation('accountId debe ser un UUID v4', 'accountId');
  }

  return await this.#commands.setAccountStatus({
    accountId,
    status: body.status,
    reason: body.reason,
    actor: actorOf(request),
    correlationId: request.correlationId,
    idempotencyKey: request.idempotencyKey,
  });
}
```

---

### 5.2 Customer Service
Gestiona la identidad de los usuarios, credenciales hasheadas con `scrypt`, generación automática del nombre de usuario a partir del nombre completo, y la validación KYC.

#### Aggregate de Cliente y Transiciones KYC
El agregado `Customer` protege las transiciones deterministas del estado de validación:

```typescript
// apps/services/customer-service/src/domain/customer.ts
export type KycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export function setKycStatus(customer: Customer, newStatus: KycStatus): Customer {
  // Un cliente ya verificado se considera en estado terminal
  if (customer.kycStatus === 'VERIFIED') {
    return customer;
  }
  return {
    ...customer,
    kycStatus: newStatus,
    updatedAt: new Date(),
  };
}
```

---

### 5.3 Account Service
Controla la apertura de cuentas de ahorro o monetarias, comisiones y la integridad del balance monetario.

#### Manejo de Concurrencia Pesimista y Balances Exactos
Para evitar condiciones de carrera cuando se reciben débitos concurrentes, el servicio adquiere un bloqueo de fila pesimista en PostgreSQL (`SELECT ... FOR UPDATE`):

```sql
-- Bloqueo pesimista en PostgreSQL para serializar movimientos sobre la misma cuenta
SELECT account_id, balance_minor, status, version, customer_id 
FROM accounts 
WHERE account_id = $1 
FOR UPDATE;
```

#### Autorización de Activación / Desactivación Manual
Permite que Administradores y Cajeros gestionen cualquier cuenta, y que los Clientes congelen o descongelen exclusivamente sus propias cuentas:

```typescript
// apps/services/account-service/src/application/set-account-status.use-case.ts
export class SetAccountStatusUseCase {
  public async execute(
    payload: AccountSetStatusV1,
    identity: Identity | null,
    idempotencyKey: string,
  ): Promise<void> {
    if (!identity) return;

    const before = await this.#repository.findById(payload.accountId);
    if (before === null) return;

    // Validación de pertenencia: el cliente solo puede alterar sus cuentas
    if (identity.role === 'CLIENTE') {
      if (before.customerId !== identity.customerId) {
        return; // Rechazo silencioso si no es el dueño
      }
    } else if (identity.role !== 'ADMINISTRADOR' && identity.role !== 'CAJERO_RECEPTOR') {
      return;
    }

    const account = await this.#repository.setStatus({
      accountId: payload.accountId,
      status: payload.status,
      idempotency: { idempotencyKey, messageType: 'account.set-status.v1', resultSummary: { status: payload.status } },
    });
    // Emisión de evento account.deactivated.v1 o account.reactivated.v1...
  }
}
```

---

### 5.4 Transaction Service y Orquestación Saga
Coordina el flujo distribuido de las transferencias bancarias mediante una máquina de estados determinista.

#### Máquina de 6 Estados de la Saga
El siguiente método puro implementa el autómata de estados de la transacción:

```typescript
// apps/services/transaction-service/src/domain/transaction.ts
export function advanceTransaction(
  transaction: Transaction,
  event: TransactionEvent,
): TransitionResult {
  const from = transaction.status;

  switch (event.kind) {
    case 'KYC_APPROVED':
      return from === 'PENDING' ? move('DEBITING', 'DEBIT') : illegal(transaction, event);
    case 'KYC_REJECTED':
      return from === 'PENDING' ? terminal('FAILED', event.reason) : illegal(transaction, event);
    case 'DEBIT_SUCCEEDED':
      return from === 'DEBITING' ? move('PAYING', 'PAYMENT') : illegal(transaction, event);
    case 'DEBIT_REFUSED':
      return from === 'DEBITING' ? terminal('REFUSED', event.reason) : illegal(transaction, event);
    case 'PAYMENT_SUCCEEDED':
      return from === 'PAYING' ? move('CREDITING', 'CREDIT') : illegal(transaction, event);
    case 'PAYMENT_REFUSED':
    case 'PAYMENT_EXHAUSTED':
      return from === 'PAYING' ? move('COMPENSATING', 'COMPENSATION') : illegal(transaction, event);
    case 'CREDIT_SUCCEEDED':
      return from === 'CREDITING' ? terminal('COMPLETED', null) : illegal(transaction, event);
    case 'COMPENSATION_SUCCEEDED':
      return from === 'COMPENSATING' ? terminal('COMPENSATED', null) : illegal(transaction, event);
  }
}
```

---

### 5.5 Payment Service y Simulación de Fallos
Simula el procesamiento hacia redes de pago interbancarias externas.

#### Escalera de Reintentos en Base de Datos (*Retry Ladder*)
En lugar de depender de temporizadores en memoria que se pierden si un contenedor se reinicia, el próximo reintento se calcula como una columna de tiempo en PostgreSQL (`due_at`):

```typescript
// apps/services/payment-service/src/domain/retry-ladder.ts
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000]; // 1s, 5s, 30s

export function computeNextAttempt(attemptNumber: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attemptNumber - 1];
  if (delay === undefined) {
    return null; // Se agotaron los reintentos -> Dispara compensación
  }
  return new Date(now.getTime() + delay);
}
```

---

### 5.6 Notification & Audit Service
Garantiza el no-repudio y el cumplimiento normativo.

#### Redacción de PII Previo a la Inserción
Los números de documento, credenciales y montos exactos se enmascaran antes de guardarse en la base de datos de auditoría:

```typescript
// apps/services/notification-audit-service/src/domain/redaction.ts
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload };
  for (const key of Object.keys(sanitized)) {
    if (['password', 'pin', 'documentPhoto', 'token'].includes(key)) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}
```

---

### 5.7 Frontend Web (Nuxt 3)
Desarrollado en Vue 3 y Nuxt con Server-Side Rendering y empaquetado en contenedor.
* Implementa 34 pantallas completas (catálogo prototipo Claude Design).
* **Gestión de Cuentas:** Permite ver movimientos, saldos y congelar/descongelar cuentas tanto para cuentahabientes como para personal bancario.
* **Monitor Saga en Vivo:** Sondeo reactivo que dibuja la línea de tiempo de la transacción paso a paso según los eventos recibidos del Gateway.

---

## 6. Diseño de Bases de Datos

Cada microservicio gestiona su propio esquema relacional independiente en PostgreSQL 18:

### 6.1 Base de Datos `customer`
* `customers`: `(customer_id PK, username UNIQUE, email UNIQUE, identity_document, kyc_status, created_at, creation_trace)` — `creation_trace` es el `traceparent` W3C del span de creación (T-41), nulo si no había SDK de trazas
* `identity_documents`: `(document_id PK, customer_id FK, object_key, photo_sha256, verified_at)`
* `email_activation_tokens`: `(token_hash PK, customer_id FK, expires_at, used_at)`
* `processed_messages`: `(idempotency_key, message_type PK, processed_at)`

### 6.2 Base de Datos `account`
* `accounts`: `(account_id PK, customer_id, account_type, balance_minor, status, version, created_at, last_activity_at)`
* `account_operations`: `(operation_id PK, account_id FK, type, amount_minor, balance_after_minor, transaction_id, created_at)`
* `biller_accounts`: `(biller_id PK, biller_name, account_id FK)`
* `deactivation_runs`: `(run_id PK, executed_at, deactivated_count)`
* `account_anomalies`: `(anomaly_id PK, account_id FK, rule, operation_count, threshold, window_minutes, window_start, detected_at, claimed_at, published_at)` — las anomalías de alta frecuencia (T-42); se escribe antes de publicar y `published_at` nulo significa «detectada, aún sin anunciar»

### 6.3 Base de Datos `transaction`
* `transactions`: `(transaction_id PK, source_account, target_account, amount_minor, status, failure_reason, created_at, requested_at, trace_context)` — `requested_at` es el `occurredAt` de `transfer.requested.v1` (el inicio de la latencia, SLI-3) y `trace_context` el `traceparent` W3C de la raíz de la traza de la transferencia (T-43); ambos nulos en las filas anteriores a la migración 010
* `transaction_events`: `(event_id PK, transaction_id FK, event_type, payload, occurred_at)`
* `transaction_transitions`: `(transition_id PK, transaction_id FK, from_status, to_status, created_at)`

### 6.4 Base de Datos `payment`
* `payments`: `(payment_id PK, transaction_id UNIQUE, status, attempt_count, max_attempts, next_due_at)`
* `payment_attempts`: `(attempt_id PK, payment_id FK, attempt_number, status, failure_reason, simulated_latency_ms, created_at)`

### 6.5 Base de Datos `notification_audit`
* `audit_events`: `(event_id, consumer PK, event_type, correlation_id, severity, sanitized_payload, recorded_at)`
* `notifications_inbox`: `(notification_id PK, customer_id, title, message, channel, delivered_at)`

---

## 7. Guía de Compilación, Ejecución y Pruebas

### 7.1 Levantado Completo en Docker Local
Desde la raíz del monorepo:

```powershell
# 1. Configurar variables de entorno iniciales
cp infra/docker/.env.example infra/docker/.env

# 2. Levantar la infraestructura y las 7 aplicaciones en modo watch
pnpm dev

# 3. Verificar estado de salud de todos los contenedores
docker compose -f infra/docker/docker-compose.dev.yml ps
```

Puntos de acceso:
* **Frontend Web:** `http://localhost:3010`
* **API Gateway:** `http://localhost:3000`
* **RabbitMQ Management:** `http://localhost:15672` (User: `admin`, Pass: `changeme`)
* **Consola MinIO:** `http://localhost:9001` (User: `minioadmin`, Pass: `changeme`)

### 7.2 Ejecución de Pruebas Automatizadas
```powershell
pnpm test           # Ejecuta pruebas unitarias en todo el monorepo
pnpm test:contract  # Valida contratos de mensajería Zod
pnpm lint           # Verifica las reglas de aislamiento arquitectónico
pnpm typecheck      # Verificación de tipos TypeScript en estricto
```

### 7.3 Despliegue en la Nube con Terraform y Helm (GCP - Fase 2)
Para el aprovisionamiento de la infraestructura en Google Cloud Platform:

```powershell
# 1. Posicionarse en el módulo de Terraform
cd infra/terraform/gcp

# 2. Inicializar y aplicar la infraestructura
terraform init
terraform apply -var="project_id=tu-proyecto-gcp"

# 3. Conectar kubectl al clúster GKE
gcloud container clusters get-credentials bank-usac-vpc-gke --zone us-central1-a

# 4. Desplegar microservicios y HPA con Helm
# Utilizar las IPs privadas emitidas en terraform output para configurar Helm
```
*(Para instrucciones exhaustivas, consultar [`infra/terraform/gcp/README.md`](../infra/terraform/gcp/README.md)).*

### 7.4 Marco de Confiabilidad SRE (SLI, SLO y SLA)
El sistema opera bajo una política de confiabilidad de grado bancario (99.99% de disponibilidad, RPO=0, RTO < 15 min, latencias transaccionales P95 < 250 ms, autoescalado HPA al 80% de CPU y matriz de incidentes SEV-1 a SEV-4).

El marco unificado con sus 30 SLIs, 26 SLOs y acuerdos contractuales se encuentra documentado en:
👉 [`docs/sre/sli-slo-sla.md`](sre/sli-slo-sla.md).

