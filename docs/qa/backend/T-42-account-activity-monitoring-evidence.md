# T-42 — Evidencia: monitoreo de uso de cuentas (Account Service)

Registro manual, no regenerado por un script: la salida real de los comandos de
validación que pide `T-42.md`, capturada el día de la implementación. No se edita
a mano después de escrita; una revisión posterior debe volver a correr los
comandos y añadir una entrada nueva.

**Fecha**: 2026-10-04 · **Rama**: `feature/T-42` (apilada sobre `feature/T-41`) ·
**Alcance tocado**: `apps/packages/contracts`, `apps/services/account-service`,
`apps/services/notification-audit-service` (una línea), `infra/`, `docs/`.

## Qué se implementó

Account Service mide cómo se usan las cuentas y avisa cuando una se usa de forma
anómala: más de **N** débitos y créditos sobre una misma cuenta en **M** minutos
(10 y 5 por defecto, configurables desde el ConfigMap). Cubre el enunciado de la
Fase 3 (§4.1, *Account Service — Monitoreo de uso de cuentas*).

| Capa | Qué se agregó |
| --- | --- |
| Contratos | `account.anomaly.detected.v1` (evento, `account-service` → `notification-audit-service`) con su test de contrato; el catálogo pasa de 103 a 104 |
| Dominio | `activity-policy.ts`: `exceedsLimit`, `windowStart`, `isCoolingDown`; sin reloj ni base de datos |
| Aplicación | `ActivityMonitor` (nunca lanza), puertos `AccountActivity`, `ActivityTelemetry`, `claimAnomaly` / `markAnomalyPublished`; los cuatro casos de uso que mueven saldo lo llaman **después** de confirmar y publicar |
| Infraestructura | Migración `008_account_anomalies`; `claimAnomaly` bajo un cerrojo consultivo por cuenta; `OtelActivityTelemetry` (solo `@opentelemetry/api`) |
| Configuración | `ANOMALY_MAX_OPERATIONS`, `ANOMALY_WINDOW_MINUTES` en `environment.ts`, `values.yaml`, `configmap.yaml`, el Deployment y los dos Compose; el Deployment lleva el checksum del ConfigMap |
| Auditoría | `account.anomaly.detected.v1` clasificado `WARNING` (el test de completitud exige una entrada por evento). La notificación al cliente es T-45 |
| Docs | ADR-017, catálogo de eventos, `message-catalog.md`, `CONTAINERS.md`, manual técnico |

**No se agregó** ninguna llamada HTTP entre servicios; `test/isolation.spec.ts` sigue verde.

## Catálogo de telemetría (lo que T-50 consolida)

| Señal | Nombre | Detalle |
| --- | --- | --- |
| Métrica (contador) | `bank.account.operations` | Unidad `{operation}`. Etiquetas: `account_type` (`AHORRO` / `MONETARIA`), `operation` (`debit` / `credit` / `compensation`) |
| Métrica (contador) | `bank.account.anomalies` | Unidad `{anomaly}`. Etiquetas: `account_type`, `rule` (`HIGH_FREQUENCY`). Una republicación no vuelve a contar |
| Span | `account.activity anomaly` | `bank.account.id`, `bank.account.type`, `bank.anomaly.rule`, `bank.anomaly.operation_count`, `bank.anomaly.threshold`, `bank.anomaly.window_minutes`, `bank.correlation_id` |
| Log | `account operation` | `accountId`, `accountType`, `operation`, `transactionId`, `correlationId` |
| Log | `account anomaly detected` / `republished` | nivel `warn`; `accountId`, `operationCount`, `threshold`, `windowMinutes`, `traceId`, `spanId` |
| Log | `account activity monitoring failed` | nivel `error`; `stage` (`detection` / `publication`) |

El `accountId` es campo de log y atributo de span, **nunca** etiqueta de métrica; un
test lo comprueba con los exporters en memoria. `MONETARIA` es la cuenta corriente del
enunciado (así lo dice ya `docs/domain/message-catalog.md`).

## Decisiones de diseño

Las razones completas están en [ADR-017](../../architecture/adr/ADR-017-account-anomaly-reports-not-blocks.md).

- **No se bloquea la cuenta.** Se registra, se publica y se notifica.
- **«Más de N» es la operación N + 1**; la ventana es deslizante; tras una anomalía la
  cuenta calla M minutos, así que una ráfaga de treinta es un solo evento.
- **Cuentan solo débitos y créditos** (un depósito entra como crédito). Las comisiones y
  las compensaciones no cuentan hacia el límite; la compensación sí aparece en el
  contador de operaciones con su propio valor.
- **El conteo es de la base de datos y está fuera del cerrojo de saldo.** Corre después
  de `applyMovement`, bajo un cerrojo consultivo por cuenta que **no** es el de la fila.
- **Se escribe antes de publicarse**, con un arrendamiento de 60 s sobre el derecho a
  publicar; una anomalía que quedó sin anunciar se republica con el siguiente movimiento
  de esa cuenta dentro de la ventana.
- **Una redelivery no vuelve a contar**: el monitor solo se llama tras un movimiento nuevo.

## Comandos ejecutados y resultado real

Todos con `--force` (sin caché de Turbo), salvo lo indicado.

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | 11 / 11 tareas correctas |
| `pnpm typecheck --force` | 11 / 11 tareas correctas |
| `pnpm build --force` | 9 / 9 tareas correctas |
| `pnpm test:contract --force` | 806 casos correctos (31 nuevos del contrato) |
| `account-service` con PostgreSQL 18.4 real (`DATABASE_URL`, `--runInBand`) | 13 / 13 suites, **244 / 244 casos**, ninguno saltado |
| `pnpm test` (sin base de datos) | `account-service`: 188 correctos y 49 saltados por falta de `DATABASE_URL`; `notification-audit-service`: 130 correctos |
| `pnpm test:pyramid` | `account-service` 23,0 % de integración (objetivo 22,2 %). Sistema: unitarias 71,7 % y E2E 7,4 %, las mismas dos desviaciones previas |
| `helm lint` | 0 gráficos con fallos |

**Mutaciones** (se rompió una pieza y se comprobó que las pruebas la echan de menos; luego
se restauró y el total volvió a 237 correctos en esa tanda): el caso de uso de débito sin
reportar el movimiento, 8 fallos; sin enfriamiento, 6; contando las comisiones, 3; disparando
en N en vez de N + 1, 13; sin el cerrojo consultivo (carrera entre detecciones), 1.

**Cambiar N y M sin cambiar código.** `helm template` con los valores por defecto da
`ANOMALY_MAX_OPERATIONS: "10"` y `ANOMALY_WINDOW_MINUTES: "5"`; con
`--set-string services.account.anomaly.maxOperations=3 … windowMinutes=1` el ConfigMap
cambia a `"3"` y `"1"`, y el checksum del pod de `account-service` cambia, de modo que
`helm upgrade` reinicia los pods con los valores nuevos.

**Contra el stack real** (imágenes de `account-service` y `notification-audit-service`
reconstruidas con `pnpm images:build --allow-dirty`, `ANOMALY_MAX_OPERATIONS=3`):
la migración `008_account_anomalies` se aplicó al arrancar; cinco depósitos seguidos de un
cajero sobre una misma cuenta, por el Gateway, produjeron en `account-service` un solo
`account anomaly detected` (en el 4.º depósito: 4 operaciones, umbral 3, ventana 5) y
ninguno más con el 5.º; la fila quedó en `account_anomalies` ya publicada, y
`notification-audit-service` registró `account.anomaly.detected.v1` (consumidor
`audit.account`, mismo `correlationId`) con severidad `WARNING`.

## Lo que no se verificó

- **Spans y métricas en ejecución real.** Sin SDK registrado la API de OpenTelemetry es
  no-op: solo los comprueban los exporters en memoria. Aparecerán en Grafana cuando T-48
  registre el SDK y el Collector.
- **La notificación `WARNING` visible en la bandeja.** El evento llega a auditoría y se
  clasifica `WARNING`, pero generar la notificación al cliente es T-45.
- **Un pod que muere entre escribir la anomalía y publicarla**, sin que haya otro
  movimiento sobre esa cuenta dentro de la ventana, no la anuncia (ADR-017). La lógica de
  reintento está probada con una clave vencida, no matando un pod.
- **`apps/web`.** Ocho pruebas de `session-guard` fallan en esta máquina porque no está
  instalado el navegador de Playwright; no se tocó `apps/web`.
- **`.env.example` de `account-service`.** Las dos variables nuevas no se agregaron ahí:
  el archivo está bloqueado por una regla de permisos del entorno. Tienen valor por
  defecto en código, así que no hace falta para arrancar.
