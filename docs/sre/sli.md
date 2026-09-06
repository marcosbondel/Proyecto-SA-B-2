# Indicadores de Nivel de Servicio (SLI) — Bank USAC

Este documento define los **Indicadores de Nivel de Servicio (Service Level
Indicators)** adoptados por Bank USAC, especificando su fórmula matemática,
fuente de datos y método de recolección.

> **Documentos relacionados:** [SLO](slo.md) · [SLA](sla.md) ·
> [RELIABILITY.md](../RELIABILITY.md)
>
> **SLI-1 a SLI-6 son la línea base aprobada en T-03**, *antes* de la
> implementación. Sus fórmulas y fuentes no se editan aquí: cualquier cambio
> requiere una enmienda formal del equipo. Los indicadores **SLI-7 en adelante
> son complementarios**: se derivan de instrumentación que el sistema ya
> produce y amplían la cobertura sin alterar ningún umbral existente.

---

## 1. Tabla de Indicadores Base (T-03)

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-1** | Disponibilidad del API Gateway | `peticiones HTTP exitosas (sin error técnico 5xx) / total peticiones recibidas` | Logs del API Gateway y métricas HTTP |
| **SLI-2** | Tasa de completitud de transferencias | `transferencias que alcanzan estado COMPLETED / total transferencias aceptadas` | Base de datos de Transaction Service |
| **SLI-3** | Duración de la Saga (P50 / P95) | `timestamp de estado final (COMPLETED/COMPENSATED) - timestamp de inicio` | Metadatos de la envolvente del mensaje |
| **SLI-4** | Latencia de propagación de eventos | `timestamp de consumo exitoso en suscriptor - occurredAt del emisor` | Envolvente estándar de RabbitMQ |
| **SLI-5** | Tasa de reintentos y mensajes en DLQ por cola | `reintentos ejecutados / entregas totales`; recuento absoluto en Dead-Letter Queues | API de gestión de RabbitMQ |
| **SLI-6** | Consistencia contable eventual | `transferencias cuyo estado final coincide con saldos y auditoría / total finalizadas` | Comparación cruzada Transaction, Account y Audit DB |

---

## 2. Indicadores Complementarios

Cada indicador complementario cumple la misma regla que los seis anteriores:
**una fórmula que produce un número y una fuente de datos que ya existe en el
sistema**. Ninguno exige instrumentación que el código no emita hoy.

### 2.1 Grupo A — Borde: API Gateway y experiencia del solicitante

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-7** | Latencia del API Gateway (P50 / P95 / P99) | `timestamp de respuesta HTTP - timestamp de recepción`, segmentado por ruta y por tipo (lectura vs. comando) | Logs estructurados del Gateway con `correlationId` |
| **SLI-8** | Tasa de expiración de respuesta (`REPLY_TIMEOUT`) | `respuestas fallidas con REPLY_TIMEOUT / total de peticiones request-reply emitidas` | Filtro de excepciones del Gateway (`gateway-exception.filter.ts`) |
| **SLI-9** | Tasa de indisponibilidad del broker vista desde el borde | `fallos BROKER_UNAVAILABLE / total de peticiones que intentaron publicar` | Mismo filtro de excepciones y `isConnected()` del adaptador de RabbitMQ |
| **SLI-10** | Distribución de fallos por clase del catálogo | Recuento por cada uno de los siete `GatewayErrorType`, separando fallo **técnico** (`REPLY_TIMEOUT`, `BROKER_UNAVAILABLE`, `INTERNAL_ERROR`) de respuesta **funcional** (`VALIDATION_ERROR`, `BUSINESS_REJECTION`, `UNAUTHENTICATED`, `FORBIDDEN`) | Catálogo cerrado en `apps/gateway/src/application/errors/gateway-error.ts` |

### 2.2 Grupo B — Plataforma: contenedores y Kubernetes

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-11** | Disponibilidad de réplicas listas | `sondeos de /ready que responden 200 / total de sondeos ejecutados`, por cada una de las siete cargas de trabajo | `readinessProbe` del chart Helm (`periodSeconds: 10`) y eventos del kubelet |
| **SLI-12** | Tiempo de arranque hasta listo (*Time To Ready*) | `timestamp del primer /ready = 200 - timestamp de arranque del contenedor` | `kubectl get pods` y logs de arranque capturados por `pnpm k8s:evidence` |
| **SLI-13** | Tasa de reinicios de contenedor | `restartCount acumulado / número de pods`, durante la ventana de la corrida | Campo `restartCount` de `kubectl get pods` |
| **SLI-14** | Separación efectiva de sondas | `casos en que /health responde 200 mientras /ready responde 503 durante una degradación inducida / degradaciones inducidas` | `pnpm images:smoke` (casos degradados) |

### 2.3 Grupo C — Mensajería, idempotencia y auditoría

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-15** | Efectividad de la idempotencia | `comandos duplicados absorbidos sin efecto adicional / total de duplicados recibidos` | Restricción única de `idempotencyKey` en Customer y Account; clave primaria `(event_id, consumer)` en Audit |
| **SLI-16** | Cobertura de auditoría | `eventos del flujo principal registrados en la bitácora / eventos del flujo principal publicados` | Cinco colas `audit.*` contra el conteo de publicaciones en el broker |
| **SLI-17** | Tasa de mensajes no interpretables | `filas con processingStatus = INVALID / total de filas registradas` | Tabla de auditoría alimentada desde el exchange `bank.errors` |
| **SLI-18** | Integridad de la redacción previa a la inserción | `filas de auditoría que contienen documento, dirección o monto en texto plano / total de filas` (el numerador debe ser cero) | Inspección de la Audit DB contra `domain/redaction.ts` |
| **SLI-19** | Completitud de la envolvente canónica | `mensajes cuya envolvente valida contra envelopeSchema / total de mensajes emitidos` — incluye `messageId`, `correlationId`, `causationId`, `idempotencyKey` y coherencia entre `messageVersion` y el sufijo de `messageType` | Esquema Zod en `@bank/contracts` |

### 2.4 Grupo D — Dominio: cuentas, transferencias y pagos

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-20** | Tasa de conflicto optimista en cuentas | `escrituras rechazadas por desajuste de version / escrituras de saldo intentadas` | Columna `version` de `accounts` y logs de Account Service |
| **SLI-21** | Integridad del libro contable | `cuentas con balance < 0` (debe ser cero) **y** `Σ débitos - (Σ créditos + Σ compensaciones)` al centavo | Restricción `accounts_balance_not_negative` y tabla de movimientos (`NUMERIC(14,2)`) |
| **SLI-22** | Tasa de transiciones ilegales rechazadas | `transiciones rechazadas con ILLEGAL_TRANSITION / transiciones solicitadas` | Máquina de seis estados de Transaction Service |
| **SLI-23** | Profundidad de la escalera de reintentos de pago | Distribución del número de intento con el que cada pago alcanza su desenlace terminal (escalera por defecto `1000,5000,30000` ms, cuatro intentos como máximo) | Tabla de intentos de Payment Service y eventos `payment.attempt.failed.v1` |
| **SLI-24** | Puntualidad del barrido de reintentos (P95) | `timestamp de ejecución real del intento - nextAttemptAt` | Columna `nextAttemptAt` contra los logs del *sweeper* (`PAYMENT_RETRY_SWEEP_MS`, 500 ms por defecto) |
| **SLI-25** | Exactitud de la desactivación automática de cuentas | `cuentas desactivadas que cumplían el criterio de inactividad / cuentas desactivadas por el trabajo programado` | Job de Account Service con reloj inyectado (`DEACTIVATION_INTERVAL_MS`) |

### 2.5 Grupo E — Servicios de soporte y seguridad

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-26** | Tasa de emisión de notificaciones | `notificaciones emitidas / eventos notificables consumidos` | Canal simulado de Notification & Audit Service |
| **SLI-27** | Éxito de carga del documento de identidad | `cargas confirmadas por el almacén de objetos / cargas intentadas` | Adaptador S3/MinIO del Gateway |
| **SLI-28** | Corrección del control de acceso por rol | `peticiones admitidas cuyo rol pertenece a la matriz D-06 / peticiones admitidas` (el complemento debe ser cero) | Guardas de JWT y de rol del Gateway |
| **SLI-29** | Higiene de la sesión | `rechazos UNAUTHENTICATED por token expirado / rechazos UNAUTHENTICATED totales` — separa la caducidad esperada (`JWT_EXPIRES_IN`, 3600 s) de la firma inválida | Servicio JWT del Gateway |
| **SLI-30** | Ausencia de secretos en las imágenes | `capas de imagen que contienen un secreto / capas inspeccionadas` (debe ser cero) en las siete imágenes | `pnpm images:smoke` |

---

## 3. Aclaraciones Técnicas de Medición

* **Error Técnico (SLI-1, SLI-10)**: Refiere a fallos 5xx, timeouts o caídas de
  conexión. Un rechazo funcional del negocio (por ejemplo, fondos insuficientes
  `400` o acceso no autorizado `403`) es una **respuesta correcta de la lógica
  de dominio** y no cuenta como indisponibilidad técnica. Contabilizar rechazos
  de negocio como indisponibilidad mediría la solvencia de los usuarios en
  lugar de la salud del servicio.
* **Consistencia Contable (SLI-6, SLI-21)**: Valida la ausencia de discrepancias
  o saldos negativos, garantizando que el dinero debitado coincida al centavo
  con el acreditado o compensado. SLI-21 es la versión *estructural* del mismo
  hecho: SLI-6 compara estados finales, SLI-21 compara sumas de dinero.
* **`REPLY_TIMEOUT` no es una cancelación (SLI-8)**: el techo de 5 000 ms del
  registro de respuestas del Gateway significa que *nadie contestó a tiempo*,
  no que la operación se deshizo. La Saga puede seguir en vuelo. Por eso SLI-8
  se reporta junto a SLI-2 y nunca en su lugar.
* **Salud ≠ Disponibilidad (SLI-11, SLI-14)**: `/health` pregunta si el proceso
  vive y `/ready` si puede hacer su trabajo. Una base de datos ausente debe
  degradar la segunda y **no** la primera; medirlas juntas convertiría una
  indisponibilidad transitoria en un ciclo de reinicios.
* **Indicadores cuyo valor correcto es cero (SLI-18, SLI-21, SLI-28, SLI-30)**:
  se reportan como recuentos absolutos, no como porcentajes. Un porcentaje
  cercano a cero invita a negociar; un recuento distinto de cero es un defecto.
* **Percentiles (SLI-3, SLI-7, SLI-24)**: se calculan sobre la corrida completa,
  sin descartar valores atípicos. El P99 se reporta como información y no
  respalda ningún objetivo, porque una corrida de demostración rara vez tiene
  suficientes muestras para que sea estable.

---

## 4. Convenciones de Recolección

1. **Unidad de tiempo**: milisegundos en todo el documento; los timestamps
   provienen del campo `occurredAt` de la envolvente canónica, en formato ISO-8601.
2. **Ventana**: salvo indicación contraria, la ventana es **una corrida de
   demostración** (el stack levantado, los flujos ejecutados y la evidencia
   recolectada). Nada se acumula entre corridas.
3. **Correlación**: todo evento medido se une a su cadena por `correlationId`;
   su relación causal se reconstruye con `causationId`.
4. **Reproducibilidad**: los indicadores de plataforma se capturan con
   `pnpm k8s:evidence`, los de imágenes con `pnpm images:smoke`, y los de flujo
   bancario con `pnpm images:flow`. La evidencia es un script, no un pegado.
