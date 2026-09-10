# T-27 — Evidencia: tipos de cuenta con reglas diferenciadas (Account Service)

> **Corrección registrada el mismo día, ver "Corrección: el saldo mínimo es un
> requisito de apertura, no un piso de débito" al final de este documento.**
> Todo lo que sigue hasta esa sección describe el diseño **original**
> (saldo mínimo como piso re-forzado en cada débito), que quedó reemplazado
> tras una prueba en vivo en la UI que mostró el comportamiento equivocado.
> Se deja tal cual se escribió — igual que T-26 pide para sus propias
> revisiones — y la sección final es la versión vigente.

Registro manual, no regenerado por un script — mismo formato que
[`T-26-kyc-evidence.md`](T-26-kyc-evidence.md): salida real de los comandos de
validación que pide `T-27.md` (`pnpm lint`, `pnpm typecheck`, `pnpm test`),
capturada el día de la implementación, más una verificación manual contra el
stack local real (`pnpm dev`), publicando comandos directo al broker — no solo
contra dobles de prueba.

**Fecha**: 2026-09-10 · **Rama**: `feature/T-27` · **Alcance tocado**:
`apps/services/account-service`, `apps/services/transaction-service` (solo
vocabulario de tipos, ver abajo), `apps/gateway` (solo tabla de mapeo de
errores), `apps/packages/contracts`, `apps/web` (una línea, ver "Excepción de
alcance: el mensaje en la pantalla de transferencia" abajo), `docs/`.

## Qué se implementó

Cada tipo de cuenta (`MONETARIA` — el "Corriente" del enunciado — y `AHORRO`)
ahora carga su propia regla, como constantes fijas en el dominio
(`account-type-rules.ts`), decisión confirmada con el responsable del
proyecto: saldo mínimo en ambos tipos con montos distintos, y comisión por
débito solo en `AHORRO`.

| Tipo | Saldo mínimo | Comisión por débito |
| --- | --- | --- |
| `MONETARIA` | Q25.00 | ninguna |
| `AHORRO` | Q100.00 | Q3.00 |

| Capa | Qué se agregó |
| --- | --- |
| Dominio | `account-type-rules.ts` (nuevo), `RejectionCode.MINIMUM_BALANCE_VIOLATION`, `debit()` reescrito: calcula `amount + comisión` como un total, rechaza atómicamente si el resultado rompe el piso del tipo, devuelve `Movement.commission` |
| Contratos | `account.commission.charged.v1` (evento nuevo), `MINIMUM_BALANCE_VIOLATION` en el `failureCode` cerrado, admitido por `account.debit.rejected.v1` y por `transaction.failed.v1` (ver "Por qué se tocó Transaction Service y Gateway" abajo), `'COMMISSION'` en `accountOperationType` |
| Aplicación | `ports.ts` (`AppliedMovement.commission`), `debit-account.use-case.ts` publica `account.commission.charged.v1` junto a `account.debited.v1` cuando corresponde, y lo repite en un redelivery |
| Infraestructura | Migración `007_account_operations_commission_type` (CHECK ampliado), `PostgresAccountRepository.applyMovement` inserta una segunda fila `COMMISSION` en la misma transacción cuando aplica |
| Interfaces | Sin cambios — el comando `account.debit.requested.v1` que dispara todo esto ya existía (T-17), el Saga no cambia de forma |
| Tests | Casos nuevos en `domain.spec.ts`, `use-cases.spec.ts` y `repository.integration.spec.ts` (persistencia real, dos filas por comisión, redelivery no duplica) |
| Docs | `docs/domain/entities.md` ("Account type", que ya no dice "changes no invariant, no state and no flow"), `docs/domain/message-catalog.md`, `docs/events/catalog.md` |

### Por qué se tocó Transaction Service y Gateway

`T-27.md` prohíbe modificar responsabilidades de otros servicios — y no se
hizo. Lo que sí fue inevitable: `MINIMUM_BALANCE_VIOLATION` se agregó al
vocabulario **cerrado y compartido** `FailureCode` en `@bank/contracts`
(`primitives.ts`), el mismo catálogo del que Transaction Service ya toma
`DebitRejection` (su propio tipo, en `transaction.ts`) y que Gateway ya mapea
completo a códigos HTTP (`FAILURE_CODE_STATUS`). Sin ensanchar esos dos
puntos:

- Transaction Service no compilaba — su `DebitRejection` es un tipo cerrado
  que ya listaba los otros tres códigos de débito rechazado, y TypeScript
  correctamente marcó el nuevo valor como no asignable.
- Gateway no compilaba — `FAILURE_CODE_STATUS` es un `Record<FailureCode, number>`
  exhaustivo con un test dedicado (`failure-code-table.spec.ts`) que falla si
  falta cualquier código del catálogo.
- `transaction.failed.v1` (el evento que Transaction Service ya publica
  cuando un débito es rechazado, sin importar la razón) tampoco admitía el
  nuevo código en su propio `.extract([...])` — sin el ajuste, una
  transferencia real rechazada por saldo mínimo habría roto el `.parse()` de
  ese contrato en producción.

Ninguno de los tres cambios agrega lógica de negocio nueva a esos servicios:
Transaction Service sigue decidiendo cero dinero (`transaction.ts` ya lo dice
explícitamente: "This file imports nothing... this service decides
transitions, never money"), y Gateway sigue solo traduciendo un código a un
estado HTTP (`failure-code-table.ts` ya lo dice: "Translating a verdict
someone else reached is routing; deciding one is domain logic"). Es el mismo
patrón que T-17 ya sentó con `FORBIDDEN_ACCOUNT_ACCESS`: un código nuevo en el
catálogo compartido ensancha a cada consumidor tipado que ya lo consumía, sin
tocar su regla.

## Diseño de la comisión

`account.debited.v1` — el evento que Transaction Service compara contra el
monto que su Saga pidió mover — **nunca** carga `amount + comisión`. La
comisión viaja en un evento propio, `account.commission.charged.v1`, publicado
solo cuando el tipo de la cuenta la tiene configurada. El saldo mínimo se
valida sobre el total (`amount + comisión`) como un único chequeo atómico: si
no alcanza, no se aplica ni el débito ni la comisión — probado en
`repository.integration.spec.ts` contra PostgreSQL real, no solo en memoria.

## Comandos ejecutados y resultado real

### Workspace completo

```
$ pnpm typecheck
 Packages in scope: @bank/contracts, @bank/messaging, @bank/tooling,
   account-service, customer-service, gateway, notification-audit-service,
   payment-service, transaction-service, web
 Tasks: 11 successful, 11 total

$ pnpm lint
 Tasks: 11 successful, 11 total

$ npx turbo run test --continue --force
 Tasks: 11 successful, 11 total
```

Los 11 paquetes pasan:

```
web                          PASS  (69 suites, 255 tests)
@bank/contracts               PASS  (16 suites, 761 tests)
@bank/messaging                 PASS  (6 suites, 42 tests, 3 saltadas sin DATABASE_URL)
account-service                   PASS  (8 suites, 119 tests, 19 saltadas sin DATABASE_URL)
customer-service                    PASS  (8 suites, 130 tests, 14 saltadas sin DATABASE_URL)
notification-audit-service            PASS  (8 suites, 112 tests, 8 saltadas sin DATABASE_URL)
payment-service                         PASS  (6 suites, 46 tests, 7 saltadas sin DATABASE_URL)
transaction-service                       PASS  (7 suites, 104 tests, 33 saltadas sin DATABASE_URL)
gateway                                     PASS  (26 suites, 306 tests)
```

### `account-service` — contra PostgreSQL real

```
$ DATABASE_URL=postgresql://account_app:changeme@localhost:5434/account \
  npx turbo run test --filter=account-service --force
Test Suites: 9 passed, 9 total
Tests:       138 passed, 138 total
```

Las 19 pruebas que se saltan sin `DATABASE_URL` corrieron y pasaron, incluidas
las tres nuevas de este ticket (dos filas por comisión, ninguna en
`MONETARIA`, sin doble cobro en un redelivery).

## Verificación manual en vivo (no solo dobles de prueba)

Con el stack completo corriendo (`pnpm dev`, siete servicios, hot-reload
activo — el mismo mecanismo de prueba manual que se usó para T-26), se
publicaron comandos `account.debit.requested.v1` directo al broker
(`bank.commands`, RabbitMQ Management API) contra cuentas demo reales:

1. **AHORRO** (`b0000...002`, saldo inicial Q1500.00), débito de Q200.00 →
   `account_operations` quedó con una fila `DEBIT` (Q200.00, balance
   intermedio Q1300.00) y una fila `COMMISSION` (Q3.00, balance final
   Q1297.00) en la misma transacción; balance real de la cuenta: Q1297.00.
   Auditoría registró `account.debited.v1` y `account.commission.charged.v1`,
   ambos con el mismo `correlationId`.
2. **MONETARIA** (`b0000...001`, saldo Q5000.00), débito de Q100.00 → balance
   Q4900.00, una sola fila `DEBIT`, ningún evento de comisión.
3. **AHORRO** (la del paso 1, ya en Q1297.00), débito de Q1194.01 — el monto
   solo deja Q102.99 (por encima del piso de Q100.00), pero sumando la
   comisión de Q3.00 el resultado sería Q99.99, por debajo del piso → la cuenta
   quedó intacta en Q1297.00, sin ninguna fila nueva en `account_operations`,
   y el evento `account.debit.rejected.v1` en auditoría trae
   `"reason":"MINIMUM_BALANCE_VIOLATION"`.
4. **Desde la interfaz web de verdad**, no solo publicando al broker: login
   como `cliente@bankusac.gt`, **Transferencias → Nueva**, origen la cuenta
   AHORRO de esa cuenta, monto que rompía el piso — el frontend mostró
   `FALLIDA`, "Débito" marcado en rojo, dinero intacto en origen. Confirma que
   el camino real (frontend → `POST /api/transfers` → `transfer.requested.v1`
   → Saga → `account.debit.requested.v1` interno) también dispara la regla,
   sin que el ticket tuviera que tocar Gateway ni agregar ninguna ruta.

## Excepción de alcance: el mensaje en la pantalla de transferencia

La prueba del paso 4 mostró el genérico *"La transferencia no se completó"* en
vez de explicar el rechazo por saldo mínimo. Causa: `apps/web/app/lib/transaction.ts`
tiene una tabla cerrada `FAILURE_REASON_TEXT` que traduce cada código de fallo
a una frase en español, y `MINIMUM_BALANCE_VIOLATION` es un código que este
ticket acaba de crear — el fallback genérico es intencional (el propio
comentario del archivo lo anticipa: *"the frontend may well meet a code added
after this file was last touched"*), no un defecto.

`T-27.md` limita el alcance a Account Service; integrar superficies frontend
para los nuevos estados es explícitamente el trabajo de T-31. Se decidió, con
el responsable del proyecto, hacer una excepción puntual: una sola entrada
nueva en `FAILURE_REASON_TEXT` (más la lista cerrada del test que la verifica,
`apps/web/test/transaction.test.mjs`) — ninguna pantalla, ruta ni lógica
nueva, cero riesgo arquitectónico, y la diferencia entre que la demo explique
el rechazo o no. `pnpm --filter web test` corrió después (69 suites, 255
tests, todo pasa).

## Lo que esta evidencia no cubre

- No se corrieron las suites de integración de customer/payment/notification-
  audit-service contra sus propias bases — no tienen cambios de este ticket
  que verificar ahí.

---

## Corrección: el saldo mínimo es un requisito de apertura, no un piso de débito

**Fecha**: 2026-09-10 (mismo día, después de la prueba manual del paso 4
arriba). El diseño original interpretó "saldo mínimo" como un piso que
`debit()` volvía a verificar en cada transferencia — el responsable del
proyecto probó ese comportamiento en vivo en la UI (`Transferencias → Nueva`
sobre una cuenta AHORRO) y corrigió la interpretación: el saldo mínimo de
Q100.00 es un **requisito para abrir** una cuenta `AHORRO` — un depósito
inicial —, no una condición que la cuenta deba mantener después. Una vez
abierta, una cuenta `AHORRO` puede vaciarse a Q0.00 por transferencias
normales, igual que `MONETARIA`. La comisión de Q3.00 por débito en `AHORRO`
**no cambió** — seguía siendo correcta.

### Qué se revirtió

- `debit()` (`domain/account.ts`): ya no verifica ningún piso — vuelve a
  refusar solo por `INSUFFICIENT_FUNDS`, exactamente como antes de T-27. La
  lógica de comisión se mantuvo intacta.
- `account-type-rules.ts`: `AccountTypeRule` perdió `minimumBalanceMinor` como
  concepto de piso de débito.
- `transaction.ts` (Transaction Service) y `transaction.failed.v1` (contrato):
  se revirtió el ensanchamiento de `DebitRejection`/`reason` que el diseño
  original necesitó — ya no hace falta, porque `debit()` nunca vuelve a
  producir `MINIMUM_BALANCE_VIOLATION`.
- `account.debit.rejected.v1` (contrato): igual, se quitó
  `MINIMUM_BALANCE_VIOLATION` de su `reason` — un débito nunca la produce.
- Los tests que probaban el piso de débito (`domain.spec.ts`,
  `use-cases.spec.ts`, `repository.integration.spec.ts`, incluida la prueba de
  concurrencia que se había reescrito alrededor del piso) volvieron a su forma
  original o fueron reemplazados por pruebas del comportamiento nuevo.

### Qué se agregó

- `account-type-rules.ts`: `AHORRO_MINIMUM_OPENING_BALANCE_MINOR = 10_000`,
  como constante separada del `commissionMinor`.
- `openAccount()` (`domain/account.ts`): acepta `initialDepositMinor` (por
  defecto `0`) y lo usa como saldo inicial en vez del `0` fijo.
- `openingDepositRefusal(accountType, initialDepositMinor)` (dominio): función
  nueva, `null` salvo `AHORRO` por debajo de su mínimo.
- `CreateAccountUseCase`: corre `openingDepositRefusal` junto al chequeo de
  actor/sujeto existente; si rechaza, publica `account.open.rejected.v1` con
  `MINIMUM_BALANCE_VIOLATION` (código reutilizado del catálogo cerrado, ya
  existía) y no crea la cuenta.
- Contrato `account.create.v1`: campo nuevo `initialDeposit?: money`. Ausente
  se trata como Q0.00 — así `MONETARIA` no cambia en nada.
- Contrato `account.open.rejected.v1`: admite `MINIMUM_BALANCE_VIOLATION` en
  su `reason` (antes solo `ROLE_NOT_ELIGIBLE` \| `FORBIDDEN_ACCOUNT_ACCESS`).
- Gateway: `OpenAccountDto.initialDeposit?` (solo valida forma, reusa
  `MoneyDto`), `OpenAccountRequest.initialDeposit` en `commands.use-case.ts`,
  pasado a través en `accounts.controller.ts`. El monto mínimo real lo decide
  Account Service — el Gateway no toma esa decisión (X-7).
- Frontend: `AccountCreateForm.vue` gana un campo de depósito inicial, visible
  solo para `AHORRO`, con el mínimo mostrado dinámicamente desde
  `ACCOUNT_TYPE_PRESENTATION` (`app/lib/account.ts`, campo nuevo
  `minimumOpeningDepositMinor`); el texto fijo "Q 0.00" en el encabezado, la
  confirmación y el mensaje de éxito pasó a ser dinámico. `cuentas/nueva.vue`
  actualiza su subtítulo. Excepción de alcance de la misma naturaleza que la
  ya registrada arriba para el mensaje de transferencia — confirmada con el
  responsable del proyecto.

### Comandos ejecutados tras la corrección

```
$ pnpm typecheck    # Tasks: 11 successful, 11 total
$ pnpm lint         # Tasks: 11 successful, 11 total
$ npx turbo run test --continue --force
 Tasks: 11 successful, 11 total (web 256/256, contracts 761/761, gateway
 306/306, y el resto igual que arriba)

$ DATABASE_URL=postgresql://account_app:changeme@localhost:5434/account \
  npx turbo run test --filter=account-service --force
Test Suites: 9 passed, 9 total
Tests:       145 passed, 145 total
```

### Verificación manual en vivo, tras la corrección

Con el mismo stack corriendo (hot-reload recompiló todo automáticamente),
publicando directo al broker sobre `cliente@bankusac.gt`
(`a0000000-...-005`):

1. `account.create.v1`, `AHORRO`, `initialDeposit` Q50.00 → **rechazada**, sin
   fila en `accounts`, `account.open.rejected.v1` con
   `"reason":"MINIMUM_BALANCE_VIOLATION"` en auditoría.
2. `account.create.v1`, `AHORRO`, `initialDeposit` Q100.00 exactos → cuenta
   creada con `balance = 100.00`, cero filas en `account_operations` (el
   depósito inicial no genera movimiento, solo el balance de apertura).
3. Sobre esa misma cuenta, `account.debit.requested.v1` por Q97.00 (que con la
   comisión de Q3.00 consume el saldo completo) → **aceptada**, balance final
   `0.00`. Confirma que ya no existe ningún piso que lo bloquee.

Los tres casos reproducidos también desde el navegador
(`Cuentas → Abrir una cuenta`) quedan pendientes de que el responsable del
proyecto los confirme por su cuenta, igual que hizo con el escenario que
motivó esta corrección.
