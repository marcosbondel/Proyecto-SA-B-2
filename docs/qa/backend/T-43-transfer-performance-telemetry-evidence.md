# T-43 — Evidencia: desempeño de transferencias y Saga en la traza (Transaction Service)

Registro manual, no regenerado por un script: la salida real de los comandos de
validación que pide `T-43.md`, capturada el día de la implementación. No se edita
a mano después de escrita; una revisión posterior debe volver a correr los
comandos y añadir una entrada nueva.

**Fecha**: 2026-10-04 · **Rama**: `feature/T-43` (apilada sobre `feature/T-42`) ·
**Alcance tocado**: `apps/services/transaction-service`, `docs/`.

## Qué se implementó

`transaction-service` mide la latencia de cada transferencia, cuenta cómo
terminan y deja la Saga —con sus compensaciones— representada en la traza.
Cubre el enunciado de la Fase 3 (§4.1, *Transaction Service — Métricas de
rendimiento y estado*).

| Capa | Qué se agregó |
| --- | --- |
| Aplicación | Puertos `TransferTelemetry`, `TransferRoot`, `TransferStep`, `TransferObservation`; `RequestTransferUseCase`, `AdvanceSagaUseCase` y `RecordPaymentAttemptUseCase` reportan **después** de confirmar y sin lanzar nunca |
| Infraestructura | `OtelTransferTelemetry` (solo `@opentelemetry/api`); migración `010_transactions_observability` (`requested_at`, `trace_context`); el repositorio devuelve la observación con cada transición aplicada |
| Interfaces | `LogFields` con `from`, `phaseStatus`, `attempt`, `traceId`, `spanId`; cableado en `main.ts` |
| Dependencias | `@opentelemetry/api` (producción); `sdk-trace-base` y `sdk-metrics` solo como devDependencies |
| Tests | `test/transfer-telemetry.spec.ts` (29 casos) y 7 casos nuevos en `repository.integration.spec.ts`; los suites existentes solo cambiaron su ensamblado |

**No se tocó** `domain/transaction.ts`: la máquina de estados, `applyEvent` y la
proyección `phaseStatus` quedan idénticas, y `saga-transition-matrix.spec.ts` pasa
sin modificar una sola aserción. `test/isolation.spec.ts` sigue verde y no se agregó
ninguna llamada HTTP entre servicios.

## Catálogo de telemetría (lo que T-50 consolida)

### Métricas

| Métrica | Tipo | Unidad | Etiquetas |
| --- | --- | --- | --- |
| `bank.transfer.duration` | histograma | `s` | `result` (`completed` / `failed` / `compensated`) |
| `bank.transfer.finished` | contador | `{transfer}` | `result`, `reason` (un código de fallo del conjunto cerrado, o `NONE` si se completó) |
| `bank.transfer.started` | contador | `{transfer}` | — |

La latencia es un histograma, sin ninguna métrica de promedio. Sus fronteras son
`0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 30, 45, 60, 90, 120` s: **hay una
frontera exacta en 5 s** porque SLO-2 dice «transferencias completadas en menos de
5,0 s», y un histograma solo responde eso con exactitud si ahí hay una frontera; el
tramo largo cubre la escalera de reintentos de pago (1, 5 y 30 s). El `transactionId`
nunca es una etiqueta.

### Spans

| Span | Cuándo | Atributos |
| --- | --- | --- |
| `transfer.requested` | La transferencia se acepta (raíz de la traza) | `bank.transfer.id`, `bank.transfer.status`, `bank.transfer.phase_status`, `bank.correlation_id` |
| `saga.step <EVENTO>` | Cada transición aplicada de la Saga | `bank.saga.event`, `bank.transfer.from_status`, `bank.transfer.status`, `bank.transfer.phase_status`, `bank.saga.command`, `bank.transfer.failure_reason`, `bank.correlation_id` |
| `saga.compensation ordered` | Se ordena la compensación (pago fallido o crédito rechazado) | los mismos |
| `saga.compensation completed` | Account confirma la devolución | los mismos |
| `saga.payment attempt` | Cada rung fallido de la escalera de pago (no es una transición) | `bank.payment.attempt`, `bank.payment.error_type`, `bank.payment.will_retry`, `bank.correlation_id` |
| `transfer` | La transferencia llega a un estado final | Dura de `requested_at` a `completedAt`; eventos `PENDING` y `APPROVED` o `FAILED` con su hora real; `bank.transfer.duration_ms` |

Los pasos son hijos del contexto guardado por la raíz, así que una transferencia es
una sola traza aunque cada paso sea un mensaje distinto procesado en otro momento.
Una transferencia compensada se distingue de una completada solo por sus spans
(`saga.compensation *`, y el evento `FAILED` en lugar de `APPROVED`).

### Logs

`transfer started`, `transfer step`, `transfer payment attempt` y `transfer finished`,
con `transactionId`, `correlationId`, `from`, `status`, `phaseStatus`, `reason`,
`durationMs` y, cuando hay SDK, `traceId` y `spanId`. Conviven con las líneas que ya
existían (`transfer accepted`, `saga advanced`), que no se modificaron.

## Decisiones de diseño

- **La latencia empieza en el `occurredAt` de `transfer.requested.v1`**, no cuando la
  fila se crea: así lo dice el ticket y así define SLI-3 el inicio. La diferencia es lo
  que el mensaje esperó en el broker. Termina en el `completedAt` que se estampa en la
  misma escritura que cierra la transferencia, de modo que una réplica que procesa el
  último evento tarde no hace parecer lenta la transferencia. Se acota a cero: el reloj
  del Gateway y el del servicio pueden diferir unos milisegundos.
- **Una traza por transferencia, construida desde la base de datos.** Una transferencia
  son varios mensajes, tratados en momentos distintos por pods posiblemente distintos,
  así que ningún span puede quedar abierto entre ellos. El span raíz se abre antes del
  insert y su `traceparent` se guarda en `transactions.trace_context` en la misma
  escritura; cada paso posterior es su hijo. El span `transfer`, con la duración total,
  se emite al final con `startTime` y `endTime` explícitos.
- **`PENDING`, `APPROVED` y `FAILED` como eventos del span `transfer`**, con la hora en
  que se alcanzó cada fase, y como atributo `phase_status` en cada paso. `FAILED` cubre a
  `FAILED` y a `COMPENSATED` (así los agrupa `phaseStatus`); el estado real va en
  `bank.transfer.status`.
- **Solo lo que se aplicó se reporta**: un duplicado, un evento ilegal y uno de una
  transferencia desconocida no son pasos y no producen span ni mueven un contador. Es
  también lo que evita contar dos veces una redelivery.
- **La telemetría nunca lanza.** Corre después del commit; un fallo suyo sale como log
  de error y no convierte una transición correcta en un mensaje reintentado.
- **`reason` en el contador** separa un rechazo del negocio (`KYC_NOT_VERIFIED`,
  `INSUFFICIENT_FUNDS`) de un fallo del pago (`PAYMENT_DECLINED`,
  `PAYMENT_RETRIES_EXHAUSTED`), para que la tasa de error de un panel pueda excluir los
  primeros. Es un conjunto cerrado, no un identificador.

## Comandos ejecutados y resultado real

Todos con `--force` (sin caché de Turbo), salvo lo indicado.

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | 11 / 11 tareas correctas |
| `pnpm typecheck --force` | 11 / 11 tareas correctas |
| `pnpm build --force` | 9 / 9 tareas correctas |
| `pnpm test:contract --force` | 806 casos correctos |
| `transaction-service` con PostgreSQL 18.4 real (`DATABASE_URL`, `--runInBand`) | 14 / 14 suites, **257 / 257 casos**, ninguno saltado |
| `pnpm test` (sin base de datos) | `transaction-service`: 202 correctos y 55 saltados por falta de `DATABASE_URL` |
| `pnpm test:pyramid` | `transaction-service` «ok» (21,4 % de integración). Sistema: unitarias 71,8 % y E2E 7,2 %, las mismas dos desviaciones previas |

**Mutaciones** (se rompió una pieza y se comprobó que las pruebas la echan de menos;
luego se restauró y el total volvió a 257 correctos): la Saga sin reportar la transición
aplicada, 19 fallos; los pasos sin unirse a la traza guardada, 3; la compensación sin
spans propios, 3; el histograma sin su frontera en 5 s, 1; el contador etiquetado por
`transactionId`, 4; la latencia contada desde la creación y no desde la petición, 1; el
contexto de traza sin guardar en la fila, 4; una duración negativa cuando los relojes
discrepan, 1.

**Contra el stack real** (imagen de `transaction-service` reconstruida con
`pnpm images:build --allow-dirty`, Gateway en `:3100`, cliente demo): la migración
`010_transactions_observability` se aplicó al arrancar. Dos transferencias reales por
el Gateway —una `APPROVE` y una `REJECT`— dejaron en los logs, con su `correlationId`:
`transfer step` por cada transición con `from`, `status` y `phaseStatus`; la
completada, `phaseStatus: APPROVED` y `durationMs: 765`, bajo los 5 s del SLO-2; la
compensada, `reason: PAYMENT_DECLINED`, el intento de pago agotado y
`phaseStatus: FAILED` con `durationMs: 741`. En la base, `completed_at - requested_at`
da 0,765 s y 0,741 s, las mismas cifras, y una fila anterior a la migración (con las dos
columnas nulas) siguió funcionando por el respaldo a `created_at`.

## Lo que no se verificó

- **Spans y métricas en ejecución real.** Sin SDK registrado la API de OpenTelemetry es
  no-op: solo los comprueban los exporters en memoria. Aparecerán en Grafana y Jaeger
  cuando T-48 registre el SDK y el Collector. Por la misma razón `trace_context` queda
  en `NULL` en el stack real; el guardado y la lectura sí están probados contra
  PostgreSQL real.
- **La traza completa entre servicios.** Esta es la vista de `transaction-service`: los
  spans de Account y de Payment solo se unirán a la misma traza cuando el `traceparent`
  cruce el broker (el enunciado lo exige en el §4.1 y la rúbrica penaliza su ausencia
  con el 50 %). Eso es T-48. Lo que T-43 deja listo es el contexto: lo que T-48 tiene que
  hacer es inyectar `transactions.trace_context` como `traceparent` en cada comando que
  el outbox publica, y extraerlo en los consumidores.
- **Los `traceId` y `spanId` de los logs** aparecen solo con SDK registrado; en el stack
  real los logs no los llevan todavía. Con exporters en memoria sí están probados.
- **Los campos `serviceName`, `environment` y `version` de los logs** que pide el
  enunciado son transversales a todos los servicios (hoy el campo se llama `service`) y
  no se tocaron aquí.
- **Las consultas de las métricas en Prometheus** (SLI-2, SLI-3, SLO-2; ver el anexo de
  `docs/sre/sli-slo-sla.md`) son las esperadas con la conversión por defecto de
  OpenTelemetry y no se han ejecutado: todavía no hay Prometheus.
- **`apps/web`.** Con Chromium de Playwright instalado, `pnpm --filter web test` pasa
  completo (272 de 272 en `node --test` y 84 de 84 en Vitest con Nitro). La salvedad
  que T-41 y T-42 registraron —ocho pruebas de `session-guard` que fallaban— era solo
  la falta del navegador, no un defecto de código; esas notas quedan desactualizadas.
