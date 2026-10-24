# T-28 — Evidencia: historial completo y trazabilidad de transacciones (Transaction Service)

Registro manual, no regenerado por un script — mismo formato que
[`T-27-account-type-rules-evidence.md`](T-27-account-type-rules-evidence.md): salida real de
los comandos de validación que pide `T-28.md` (`pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:contract`), capturada el día de la implementación.

> **Corrección registrada el mismo día**: la primera versión de este documento decía que
> `repository.integration.spec.ts` (persistencia, deduplicación y **concurrencia**) se había
> "planificado" pero se saltaba por falta de `DATABASE_URL`. Eso era exacto pero incompleto —
> las pruebas nunca se habían corrido de verdad contra Postgres. Al levantar el stack con
> `pnpm dev` para que el responsable humano probara desde la interfaz, se corrieron por primera
> vez contra `postgres-transaction` real y **fallaron 4 de 42**, revelando tres errores propios
> de las pruebas (no del código de producción): dos aserciones de conteo que no consideraban
> que `seedDebiting()` ya escribe dos filas de transición (apertura + `DEBIT_ORDERED`), y un
> helper de fechas (`seeded()`) que pasaba `createdAt`/`updatedAt` como *overrides* de
> `candidate()` — que los descarta silenciosamente, porque `openTransaction()` solo lee `now`.
> Corregido; los 42 pasan contra PostgreSQL real (detalle en la sección de abajo). Se deja
> registrado en vez de reescribir la evidencia como si siempre hubiera pasado — mismo criterio
> que T-27 aplica a sus propias correcciones.

**Fecha**: 2026-09-10 · **Rama**: `feature/T-27` (implementación de T-28 continuada en la misma
rama antes de commitear) · **Alcance tocado**: `apps/services/transaction-service`,
`apps/packages/contracts`, `apps/gateway`, `apps/web`, `docs/`.

## Qué se implementó

| Capa | Qué se agregó |
| --- | --- |
| Dominio | `phase-status.ts` (nuevo): `phaseStatusOf`, `statusesInPhase` — proyección de los seis estados de la Saga a los tres de Fase 2 (`PENDING`/`APPROVED`/`FAILED`), sin tocar `applyEvent` ni el `CHECK` de la columna. `TransitionRecord` en `transaction.ts`. |
| Persistencia | Migración `008_transaction_transitions` (tabla + índice único parcial `(transaction_id, message_id)` para T-5). `PostgresTransactionRepository`: fila de apertura en `start()`, fila de transición en `applyEvent()` (incluidas las auto-transiciones de `PAYMENT_PENDING`), método `transitionsOf()`. `list()` ahora acepta `statuses[]`, `from`, `to`. |
| Contratos | `phaseStatus` en `primitives.ts`. Campos aditivos-opcionales en `transaction.list.query.v1` (`phaseStatus`, `from`, `to`, con `.refine()` contra rango invertido), `transaction.list.replied.v1` (`phaseStatus` por fila), `transaction.status.replied.v1` (`phaseStatus`, `transitions[]`). Ningún mensaje nuevo — el catálogo sigue en 101. |
| Aplicación | `ListTransactionsUseCase`: resuelve `status`+`phaseStatus` a la intersección de estados, pasa `from`/`to` como `Date`, agrega `phaseStatus` a cada fila. `GetTransactionStatusUseCase`: agrega `phaseStatus` y `transitions` al reply, leídos **después** de `mayReadTransaction`. |
| Gateway | `ListTransfersQueryDto`: `phaseStatus`, `from`, `to` (`@IsISO8601`). `TransfersController`: valida el rango invertido en el borde (`400` antes de publicar), normaliza las fechas a ISO estricto. `TransferListFilter` ensanchado. `gateway.v1.yaml` regenerado. |
| Web | `app/lib/transaction.ts`: `PhaseStatus`, `PHASE_PRESENTATION`, `phaseFilterOptions`, `TransitionRow`, `traceFor`, `historyFilterProblems`. `TransactionStatusTimeline.vue`: traza real cuando `transitions` no está vacío, línea proyectada (`timelineFor`) como respaldo. `/transferencias`: barra de filtros (fase, desde, hasta), estado vacío distinto para "sin transferencias" vs. "sin resultados con estos filtros". `/transferencias/[id]`: pasa `transitions` al componente. |
| Tests (handlers) | `test/query-handlers.spec.ts` (nuevo) — cierra el hueco de que ningún handler individual tenía prueba propia (solo el router genérico en `inbound-message.handler.spec.ts`): `TransactionListHandler` y `TransactionStatusHandler` probados contra el **schema real** del contrato, incluidos los campos de T-28 y el rango de fechas invertido refusado antes de llegar al caso de uso. |

## Comandos de validación

### `pnpm lint` (raíz)

```
$ turbo run lint
   • Packages in scope: @bank/contracts, @bank/messaging, @bank/tooling, account-service,
     customer-service, gateway, notification-audit-service, payment-service,
     transaction-service, web
   • Running lint in 10 packages

 Tasks:    11 successful, 11 total
Cached:    2 cached, 11 total
  Time:    13.068s
```

### `pnpm typecheck` (raíz)

```
$ turbo run typecheck
   • Running typecheck in 10 packages

 Tasks:    11 successful, 11 total
Cached:    2 cached, 11 total
  Time:    30.792s
```

(El único `WARN` que imprime `web:typecheck` — "Duplicated imports `AcceptedCommand`" — es
preexistente, entre `useCommandOutcome.ts` y `useCustomerOutcome.ts`, y no lo toca este ticket.)

### `pnpm test` (raíz)

```
$ turbo run test
 Tasks:    11 successful, 11 total
Cached:    2 cached, 11 total
  Time:    36.942s
```

Por paquete, relevante a este ticket:

```
transaction-service:test:
  Test Suites: 1 skipped, 7 passed, 7 of 8 total
  Tests:       33 skipped, 120 passed, 153 total
  (el skip es repository.integration.spec.ts, que requiere DATABASE_URL — ver abajo)

@bank/contracts:test:
  Test Suites: 16 passed, 16 total
  Tests:       761 passed, 761 total

gateway:test:
  Test Suites: 26 passed, 26 total
  Tests:       314 passed, 314 total

web:test (node --test sobre app/lib/):
  tests 264
  pass 264
  fail 0
```

Los demás cinco servicios (`account-service`, `customer-service`, `payment-service`,
`notification-audit-service`, `@bank/messaging`) también en verde — no tocados por este
ticket, corridos para confirmar que nada se rompió.

### `pnpm test:contract`

Incluido en la corrida de `@bank/contracts` arriba: `catalog-completeness.spec.ts` sigue
verde con `catalog` en 101 mensajes, confirmando que ningún mensaje nuevo se agregó — todos
los campos de T-28 son adiciones opcionales a contratos existentes.

### `pnpm build` + `pnpm --filter gateway openapi:emit`

```
Tasks:    9 successful, 9 total
Cached:    0 cached, 9 total
  Time:    1m34.38s

$ node dist/openapi/emit.js
wrote .../apps/gateway/openapi/gateway.v1.yaml
```

`gateway.v1.yaml` se regeneró y `apps/gateway/test/openapi.spec.ts` (incluido en la corrida de
`gateway:test` de arriba) confirma que el documento comprometido coincide con el generado.

### Pruebas contra PostgreSQL real

Con el stack levantado (`pnpm dev`) y `postgres-transaction` sano en `localhost:5435`:

```bash
DATABASE_URL="postgresql://transaction_app:changeme@localhost:5435/transaction" \
  pnpm --filter transaction-service test
```

```
Test Suites: 9 passed, 9 total
Tests:       165 passed, 165 total
Time:        4.661 s
```

Dentro de esas, `repository.integration.spec.ts` por sí sola:

```
Test Suites: 1 passed, 1 total
Tests:       42 passed, 42 total
```

Cubre, contra la base real: la fila de apertura de `start()`; una fila por transición
aplicada, **incluidas las auto-transiciones de `PAYMENT_PENDING`**; que una transición ilegal
no escribe fila; que un `messageId` redelivered no escribe una segunda fila; el índice único
parcial `(transaction_id, message_id)` como **hecho de la base de datos**, probado insertando
directamente un duplicado y esperando el rechazo (independiente de `processed_messages`);
límites de fecha inclusivos; el filtro `ANY($n::TEXT[])` de estados combinado con fecha; y la
**concurrencia**: dos eventos de Saga (`account.credited.v1` / `payment.failed.v1`) aplicados
a la vez sobre la misma transacción escriben exactamente una fila de transición cada uno —
nunca ambas, nunca ninguna.

Sin `DATABASE_URL` (por ejemplo, en una corrida de CI sin Docker), esta suite se salta sola y
dice por qué; el resto de la suite (dominio, casos de uso, handlers, alcance) no depende de
Postgres y corre siempre.

## Excepción de alcance: la búsqueda por número de operación para CLIENTE

Probando los filtros desde la interfaz con sesión de cliente, se detectó que la tarjeta
*"Consultar una transferencia"* de `/transferencias` estaba condicionada a `v-if="isStaff"` —
un `CLIENTE` nunca la veía. No es un efecto de este ticket: la condición ya existía antes de
T-28. Pero contradice la propia documentación del proyecto — `docs/manual-usuario.md §3.1` y
`docs/manual/README.md` describen esa búsqueda como parte del flujo del cliente ("se pega
en *Transferencias → Consultar una transferencia*") — y el backend ya estaba preparado para
ello: `GetTransactionStatusUseCase` aplica `mayReadTransaction` y responde `NOT_FOUND` tanto a
un identificador inexistente como a uno de otro cliente, así que mostrar la caja a todos los
roles no expone nada nuevo.

Corrección puntual: se quitó el `v-if="isStaff"` de esa `UCard` en
`apps/web/app/pages/transferencias/index.vue`. Cero lógica nueva, cero riesgo
arquitectónico — la misma naturaleza de excepción que T-27 registró para su propio ajuste de
frontend, confirmada por prueba manual en la interfaz por el responsable del proyecto.

## Trazabilidad contra el enunciado y el ticket

Sección 4.1 de `780_Proyecto_2_2S2026.pdf`, "Transaction Service — Historial y trazabilidad de
transacciones", verbatim:

> Consultar historial por cuenta · Filtrar por: Fecha, Estado · Registrar estados intermedios:
> PENDING, APPROVED, FAILED

| Pide el enunciado / `T-28.md` | Dónde queda cumplido |
| --- | --- |
| Consultar historial por cuenta | `accountId` en `transaction.list.query.v1` (preexistente, T-18 — sin cambios; sigue probado) |
| Filtrar por fecha | `from`/`to`, ambos inclusivos sobre `createdAt` — `ListTransactionsUseCase`, `PostgresTransactionRepository.list()`, DTO del Gateway |
| Filtrar por estado | `status` (los seis de la Saga, preexistente) **y** `phaseStatus` (los tres de Fase 2, nuevo) — campos separados que se intersectan, nunca uno ensanchando al otro |
| Registrar PENDING/APPROVED/FAILED sin crear estados contradictorios | `phaseStatusOf` en el dominio: proyección pura de los seis estados a los tres, nunca almacenada — la máquina de `transaction.ts` y el `CHECK` de la columna quedan intactos |
| Filtros individuales y combinados | `listing-and-scope.spec.ts` (fecha sola, estado solo, fase sola, combinados, intersección vacía) + `repository.integration.spec.ts` contra Postgres real |
| Estados intermedios y finales registrados | Tabla `transaction_transitions`: una fila por transición aplicada, auto-transiciones de `PAYMENT_PENDING` incluidas, más la fila de apertura |
| Eventos duplicados no duplican transacciones ni transiciones | `idempotency_key` único (T-3/T-4, preexistente) + `processed_messages` + índice único parcial nuevo `(transaction_id, message_id)`, probado directo contra la base |
| Publicar eventos con correlationId | Sin cambios — la propagación de `correlationId` ya existía end to end (T-02/T-18) y T-28 no agrega mensajes nuevos |
| Idempotencia, errores claros, outbox, aislamiento de datos | Sin cambios de diseño — la transición se escribe dentro de la misma transacción de base de datos que ya escribe el outbox; `isolation.spec.ts` sigue en verde |
| No consultar bases de otros servicios | `isolation.spec.ts` — sin modificar, sigue pasando |
| Tests de dominio, consultas, handlers, persistencia, estados y concurrencia | `domain.spec.ts` (dominio/estados) · `listing-and-scope.spec.ts` (consultas) · `query-handlers.spec.ts` (handlers, nuevo) · `repository.integration.spec.ts` (persistencia, estados, concurrencia — contra Postgres real) |

La "Integración con Saga" transversal del enunciado ("Registro en historial" como parte del
flujo de transferencia) queda satisfecha porque la fila de transición se escribe **dentro** de
`applyEvent`/`start()`, en la misma transacción que decide el estado — no como un paso aparte
que pudiera perderse en un crash.
