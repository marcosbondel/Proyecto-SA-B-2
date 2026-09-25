# T-29 — Evidencia: simulación de proveedor externo de pagos (Payment Service)

Registro manual, no regenerado por un script — mismo formato que
[`T-28-transaction-history-evidence.md`](T-28-transaction-history-evidence.md): salida real
de los comandos de validación que pide `T-29.md` (`pnpm lint`, `pnpm typecheck`, `pnpm test`,
pruebas específicas de Payment Service), capturada verificando el ticket ya implementado, más
la verificación manual en vivo (frontend + backend reales) que pidió el responsable del
proyecto antes de cerrarlo — la misma que T-28 hizo y que reveló dos correcciones registradas
al final de este documento.

**Fecha de esta evidencia**: 2026-09-11/12. **Rama**: `feature/T-29`. **Alcance verificado**:
`apps/services/payment-service` (implementación original del commit `c45965b`), más dos
correcciones fuera de ese commit, en `apps/services/account-service` y `apps/web`, encontradas
probando el ticket en vivo.

## Qué pedía el enunciado

Sección 4.1 (Payment Service, p. 5-6): procesar pagos externos simulando **éxito, fallo y
timeout**, con reintentos acotados, idempotencia, correlationId, estados y sin doble cargo.

## Qué ya existía y qué agregó este ticket

Éxito y fallo — `APPROVE`/`REJECT`/`TRANSIENT_FAILURE`, la escalera de reintentos (1 s, 5 s,
30 s, cuatro intentos), la compensación de la Saga, los eventos `payment.succeeded.v1` /
`payment.failed.v1` / `payment.attempt.failed.v1` — ya existían desde T-19. **Este ticket no
construyó el mecanismo de pagos externos; lo completó**, en tres piezas concretas:

| Capa | Qué se agregó |
| --- | --- |
| Dominio | `provider.ts` (nuevo): `callProvider`, función pura que separa "qué contestó el proveedor" (`SUCCESS`/`FAILURE`/`TIMEOUT`, sin reloj ni azar) de la política de reintentos, que sigue en `decideAttempt` (`payment.ts`) sin cambios en su escalera. `PaymentScenario` gana un cuarto valor, `TIMEOUT`, antes indistinguible de `TRANSIENT_FAILURE`. `PaymentAttempt` y `AttemptOutcome` cargan `providerResult` junto al `errorType` que ya tenían. |
| Persistencia | Migración `004_payment_provider_simulation`: ensancha el `CHECK` de `scenario` en `payments` y agrega la columna `provider_result` (con su propio `CHECK`) en `payment_attempts`. |
| Contratos | `payment-view.ts` (`paymentAttemptView.providerResult`), `payment.attempt.failed.v1` (`providerResult: 'FAILURE' \| 'TIMEOUT'`), `transfer.requested.v1`/`transaction/transfer.requested.v1` (`paymentScenario` admite `TIMEOUT`). Aditivo — ningún mensaje nuevo, ninguna versión de contrato cambia. |
| Gateway | `transfer.dto.ts`: `SCENARIOS` incluye `'TIMEOUT'`. |
| Web | `PaymentScenarioSelect.vue` (cuarta opción, "El proveedor no responde (timeout)"), `PaymentAttemptTrail.vue` (`PROVIDER_RESULT_PRESENTATION`), `lib/payment.ts` y `lib/transaction.ts` (`PaymentScenario`, `PROVIDER_RESULT_PRESENTATION`). |
| Tests | `provider.spec.ts` (nuevo, el proveedor simulado en aislamiento), casos nuevos en `domain.spec.ts` (la escalera trata `TIMEOUT` igual que `TRANSIENT_FAILURE`), `use-cases.spec.ts`, `inbound-message.handler.spec.ts`, `repository.integration.spec.ts` (contra PostgreSQL real). `isolation.spec.ts` ensanchado para vigilar también el literal `'TIMEOUT'` fuera de `domain/`. |

## Comandos de validación

### `pnpm lint` (raíz)

```
$ turbo run lint
   • Packages in scope: @bank/contracts, @bank/messaging, @bank/tooling, account-service,
     customer-service, gateway, notification-audit-service, payment-service,
     transaction-service, web
   • Running lint in 10 packages

 Tasks:    11 successful, 11 total
Cached:    11 cached, 11 total
```

### `pnpm typecheck` (raíz)

```
$ turbo run typecheck
 Tasks:    11 successful, 11 total
Cached:    11 cached, 11 total
```

(El único `WARN` que imprime `web:typecheck` — "Duplicated imports `AcceptedCommand`" — es
preexistente, entre `useCommandOutcome.ts` y `useCustomerOutcome.ts`, y no lo toca este ticket
— confirmado también en la evidencia de T-28.)

### `pnpm build` (raíz)

```
 Tasks:    9 successful, 9 total
Cached:    2 cached, 9 total
```

### `pnpm test` (raíz)

```
$ turbo run test
 Tasks:    11 successful, 11 total
```

Por paquete, relevante a este ticket:

```
payment-service:test:
  Test Suites: 1 skipped, 7 passed, 7 of 8 total
  Tests:       10 skipped, 60 passed, 70 total
  (el skip es repository.integration.spec.ts, que requiere DATABASE_URL — ver abajo)

@bank/contracts:test:
  Test Suites: 16 passed, 16 total
  Tests:       763 passed, 763 total

gateway:test:
  Test Suites: 26 passed, 26 total
  Tests:       315 passed, 315 total
  (incluye payment-scenario.spec.ts y payments-routes.spec.ts, ambos ensanchados con TIMEOUT)

web:test (node --test sobre app/lib/):
  tests 266
  pass 266
  fail 0
```

Los demás cuatro servicios (`account-service`, `customer-service`, `transaction-service`,
`notification-audit-service`) también en verde — no tocados por la implementación original de
este ticket, corridos para confirmar que nada se rompió.

### Pruebas contra PostgreSQL real

Con el stack levantado (`pnpm dev`) y `postgres-payment` sano en `localhost:5436`:

```bash
DATABASE_URL="postgresql://payment_app:changeme@localhost:5436/payment" \
  pnpm --filter payment-service test
```

```
Test Suites: 8 passed, 8 total
Tests:       70 passed, 70 total
```

Los 10 que se saltan sin `DATABASE_URL` (`repository.integration.spec.ts`) cubren, contra la
base real: persistencia de `scenario` y `providerResult`, idempotencia de `open()` bajo
`ON CONFLICT`, el candado `SELECT … FOR UPDATE` de `attempt()` con `expectedAttempt`, y la
escalera completa hasta `PAYMENT_RETRIES_EXHAUSTED`.

## Verificación manual en vivo

Con el stack completo corriendo (`pnpm dev`, frontend y backend reales) y el responsable del
proyecto operando la interfaz directamente — no un script — se probó, desde una sesión de
Cliente (`marcotulio`):

1. **Transferencia entre cuentas propias con escenario `TIMEOUT`** (`/transferencias/nueva`,
   cuenta Ahorro → cuenta propia, Q100.00): la pantalla de seguimiento mostró los cuatro
   intentos, con las esperas de 1 s/5 s/30 s, y cada intento fallido rotulado "el proveedor no
   respondió (timeout)" — distinto del texto para `TRANSIENT_FAILURE` ("el proveedor
   rechazó"). Tras agotar la escalera, la transferencia cerró en **Compensada**.
2. **Comparación con los otros tres resultados** (`APPROVE`, `REJECT`, `TRANSIENT_FAILURE`):
   cada uno cerró en el estado esperado (Completada de inmediato; Fallida sin escalera;
   Compensada tras la escalera), confirmando que los cuatro se disparan por separado sin
   depender uno del otro.
3. **El mismo flujo desde `/pagos/nuevo`** ("Pago de servicios"), tras la corrección TD-066
   de abajo: el campo "Escenario de pago" y el mismo comportamiento, pagando a la cuenta
   recaudadora de un biller en vez de a una cuenta propia.

Esta verificación en vivo — no los comandos automatizados — fue la que encontró las dos
correcciones que siguen.

## Trazabilidad contra el enunciado y el ticket

| Pide `T-29.md` | Dónde queda cumplido |
| --- | --- |
| Proveedor externo simulado y determinista | `provider.ts`, `callProvider` — sin reloj, sin `setTimeout`, sin azar |
| Los tres resultados externos (éxito, fallo, timeout) se pueden ejecutar de forma controlada | `PaymentScenario` de cuatro valores (`APPROVE` cubre éxito); probado por `provider.spec.ts`, por `payment-scenario.spec.ts` en el Gateway, y en vivo desde ambas pantallas de transferencia |
| Un timeout puede reintentarse según la política existente | `decideAttempt`: `TIMEOUT` sube la misma escalera que `TRANSIENT_FAILURE`, sin cambio en `DEFAULT_RETRY_DELAYS_MS` ni en `maxAttempts` |
| Un fallo terminal publica el evento correspondiente | `payment.failed.v1` tras `PAYMENT_RETRIES_EXHAUSTED`; `payment.attempt.failed.v1` en cada rung, con `providerResult` distinguiendo el timeout de un fallo transitorio ordinario |
| Un mensaje duplicado no procesa dos veces el pago | `open()`: `ON CONFLICT DO NOTHING` sobre `payment_id`, más el manejo del unique key por `transaction_id`; `attempt()`: `SELECT … FOR UPDATE` + `expectedAttempt` hace que una segunda entrega quede `SUPERSEDED`, no un segundo cargo |
| Mantener reintentos, idempotencia, correlationId y estados | Sin cambios de diseño — todo heredado de T-19/T-21, con `TIMEOUT` tratado exactamente igual que `TRANSIENT_FAILURE` en cada uno |
| Evitar doble cargo, doble publicación o doble compensación | El candado de `attempt()` más el outbox (`TD-047`, resuelto en T-21) siguen intactos; ningún cambio de este ticket toca esa garantía |
| Mantener la lógica de pago separada de Transaction Service | `test/isolation.spec.ts`, sin cambios en su intención — solo ensanchado para incluir `'TIMEOUT'` en el patrón que vigila |
| Tests unitarios del proveedor, casos de uso, handlers, persistencia y reintentos | `provider.spec.ts` (proveedor), `use-cases.spec.ts` (casos de uso), `inbound-message.handler.spec.ts` (handlers), `repository.integration.spec.ts` (persistencia, contra PostgreSQL real), `domain.spec.ts` (reintentos) |

## Corrección: la comisión de AHORRO no se devolvía en una transferencia compensada (TD-065)

Probando el escenario `TIMEOUT` hasta agotar la escalera sobre una cuenta `AHORRO`, el
responsable del proyecto notó que el saldo consolidado quedó Q3.00 por debajo del que tenía
antes de enviar la transferencia — a pesar de que esta cerró en **Compensada**. La causa: el
diseño de la comisión de T-27 (`compensate()` en `domain/account.ts`) solo devolvía el monto de
la transferencia, nunca la comisión de Q3.00 que `debit()` había cobrado junto a él. Ni T-27 ni
este ticket decidieron eso a propósito — era una consecuencia de la firma de la función, no una
regla de negocio, e invisible a todo test automatizado porque ninguno ejercitaba una
compensación sobre `AHORRO`.

Registrado como **TD-065** (`docs/TECH_DEBT.md`, **Resuelto**) y con su propia sección de
corrección en
[`docs/qa/backend/T-27-account-type-rules-evidence.md`](T-27-account-type-rules-evidence.md#corrección-la-comisión-no-sobrevivía-a-una-transferencia-compensada),
donde vive el detalle completo porque el defecto pertenece al diseño de la comisión que ese
ticket estableció, aunque lo expuso probar este. Resumen del arreglo: `compensate()` gana un
tercer parámetro, `commissionToReverse`; el repositorio busca la fila `COMMISSION` que el
débito original cargó (por `transaction_id`, dentro del mismo candado que revierte el débito),
la marca `COMPENSATED`, y le pasa su monto a `compensate` para que el reembolso sea el total
correcto en un solo movimiento atómico. `MONETARIA` no cambia — nunca hay comisión que
encontrar.

## Corrección: "Pago de servicios" no ofrecía el escenario de pago (TD-066)

Al preguntarle al responsable del proyecto por qué la pantalla `/pagos/nuevo` no tenía el campo
de escenario de pago, se confirmó que era un vacío, no una decisión: un pago de servicio **es**
la misma transferencia (`POST /api/transfers`, con el destino en la cuenta recaudadora del
biller) y ya pasaba por el mismo Payment Service, pero la pantalla nunca incluía
`PaymentScenarioSelect` ni enviaba `paymentScenario` en el cuerpo de la petición — así que la
pantalla más directamente relacionada con "pagos externos", que es de lo que trata este
ticket, era la única del producto donde el timeout, el rechazo o el fallo transitorio no se
podían demostrar.

Registrado como **TD-066** (`docs/TECH_DEBT.md`, **Resuelto**). Arreglo: se reutilizó
`PaymentScenarioSelect` (el mismo componente de `/transferencias/nueva`, sin duplicarlo) en
`apps/web/app/pages/pagos/nuevo.vue` — un `paymentScenario` ref, el componente en la plantilla,
y el campo agregado al cuerpo de la petición exactamente como ya lo hacía el formulario de
transferencias. Cero cambios de backend: el Gateway ya aceptaba `paymentScenario` para
cualquier destino, biller incluido: solo faltaba exponerlo en este formulario. Verificado en
vivo por el responsable del proyecto tras la corrección (paso 3 de "Verificación manual en
vivo" arriba).

## Comandos ejecutados tras ambas correcciones

```
$ pnpm --filter account-service test
Test Suites: 1 skipped, 8 passed, 8 of 9 total
Tests:       22 skipped, 128 passed, 150 total

$ DATABASE_URL="postgresql://account_app:changeme@localhost:5434/account" \
  pnpm --filter account-service test
Test Suites: 9 passed, 9 total
Tests:       150 passed, 150 total

$ pnpm --filter web lint      # limpio
$ pnpm --filter web typecheck # limpio (mismo WARN preexistente que arriba)
$ pnpm --filter web test
tests 266, pass 266, fail 0

$ pnpm lint       # Tasks: 11 successful, 11 total
$ pnpm typecheck  # Tasks: 11 successful, 11 total
$ pnpm build      # Tasks: 9 successful, 9 total
```

## Cierre

Los cinco criterios de aceptación de `T-29.md` están cumplidos y probados en los tres niveles
que pide (unitario, contra PostgreSQL real, y en vivo contra el frontend). Las dos correcciones
surgidas de la verificación manual quedan resueltas y documentadas (`TD-065`, `TD-066`), con sus
propios tests nuevos en los tres niveles donde aplican. `T-31`, que este ticket bloqueaba, queda
libre para empezar.
