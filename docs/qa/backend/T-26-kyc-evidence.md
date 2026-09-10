# T-26 — Evidencia: gestión de estado KYC (Customer Service)

Registro manual, no regenerado por un script — a diferencia de las suites E2E de
[`../README.md`](../README.md), esta evidencia es la salida real de los comandos
de validación que pide `T-26.md` (`pnpm lint`, `pnpm typecheck`, `pnpm test`),
capturada el día de la implementación. No se edita a mano después de escrita;
una revisión posterior de T-26 debe volver a correr los comandos y añadir una
entrada nueva, no modificar esta.

**Fecha**: 2026-09-09 · **Rama**: `feature/T-26` · **Alcance tocado**:
`apps/services/customer-service`, `apps/packages/contracts`, `docs/`.

## Qué se implementó

Un campo aditivo `kycStatus: PENDING | VERIFIED | REJECTED` en el agregado
`Customer`, **distinto** de `identityStatus` (que es la revisión Fase 1 de la
foto del documento). Cubre el requisito de Fase 2 (§4.1, p. 4 del enunciado):
registrar y actualizar el estado KYC de un cliente, y la regla de dominio que
decide si un cliente puede iniciar una transacción.

| Capa | Qué se agregó |
| --- | --- |
| Dominio | `KycStatus`, campo `kycStatus` en `Customer`, `setKycStatus` (transición determinista, `VERIFIED` terminal), `mayManageKyc` (staff), `mayInitiateTransactions` |
| Contratos | `customer.set-kyc-status.v1` (comando), `customer.kyc.verified.v1` / `customer.kyc.rejected.v1` (eventos), `kycStatus` añadido a `customer.get.replied.v1` |
| Aplicación | `SetKycStatusUseCase`, `saveKycVerdict` en el puerto `CustomerRepository`, `kycStatus` en la respuesta de `GetCustomerUseCase` |
| Infraestructura | Migración `007_customers_kyc_status` (columna + `CHECK`), `saveKycVerdict` en `PostgresCustomerRepository`, datos demo actualizados |
| Interfaces | `SetKycStatusHandler` registrado en `main.ts` sobre la cola `customer.commands` |
| Tests | Casos nuevos en `domain.spec.ts`, `use-cases.spec.ts` y `repository.integration.spec.ts` (persistencia + concurrencia optimista contra PostgreSQL real) |
| Docs | `docs/domain/entities.md` (C-8), `docs/domain/message-catalog.md`, `docs/events/catalog.md` |

**Decisión de diseño registrada**: `T-26.md` prohíbe modificar las
responsabilidades de Account, Transaction, Payment o Notification Service, y
las invariantes X-1 ("ningún servicio consulta la tabla de otro") y X-7 ("el
Gateway no toma decisiones de dominio") impiden que el bloqueo real de
transferencias de clientes no verificados se aplique dentro del Saga desde
este ticket. Por eso `T-26.md` declara "Bloquea: T-31" — esta tarea deja el
estado, las transiciones, la persistencia y los eventos listos; **T-31**
consumirá `customer.kyc.verified.v1` / `customer.kyc.rejected.v1` (o preguntará
por request/reply) para aplicar el bloqueo dentro del Saga de transferencias.

## Comandos ejecutados y resultado real

### `@bank/contracts` (build limpio, sin caché)

```
$ pnpm --filter @bank/contracts build
$ tsc -p tsconfig.build.json
✓ sin errores
```

### `customer-service` — build, typecheck, lint (vía turbo, con las dependencias del workspace)

```
$ npx turbo run build --filter=customer-service
@bank/contracts:build ✓  @bank/messaging:build ✓  customer-service:build ✓
 Tasks: 3 successful, 3 total

$ npx turbo run typecheck --filter=customer-service
customer-service:typecheck: $ tsc --noEmit -p tsconfig.json  →  sin errores

$ npx turbo run lint --filter=customer-service
customer-service:lint: $ eslint .  →  sin errores (incluye las reglas de
aislamiento arquitectónico del repo)
```

### `@bank/contracts` — test (incluye `catalog-completeness.spec.ts`, que
verifica que el catálogo de contratos y `docs/domain/message-catalog.md` no
se desincronicen)

```
$ npx turbo run test --filter=@bank/contracts --force
Test Suites: 16 passed, 16 total
Tests:       755 passed, 755 total
```

### `customer-service` — test, primera corrida (sin `DATABASE_URL`)

```
$ npx turbo run test --filter=customer-service
Test Suites: 1 skipped, 8 passed, 8 of 9 total
Tests:       14 skipped, 130 passed, 144 total
```

`test/repository.integration.spec.ts` se saltó — es el comportamiento existente
del repositorio (`describe.skip` sin `DATABASE_URL`), no algo introducido por
este ticket.

### `customer-service` — test, segunda corrida (con PostgreSQL real)

Se levantó la infraestructura local (`pnpm dev:infra`, contenedor
`postgres-customer` sano) y se corrió de nuevo contra una base real:

```
$ DATABASE_URL=postgresql://customer_app:changeme@localhost:5433/customer \
  npx turbo run test --filter=customer-service --force
Test Suites: 9 passed, 9 total
Tests:       144 passed, 144 total
```

Las 14 pruebas que antes se saltaban corrieron y pasaron, incluidas las dos
nuevas de este ticket:

- Persiste `kyc_status` y lo mantiene independiente de `identity_status`.
- Rechaza una escritura concurrente sobre la misma versión optimista (bloqueo
  real de PostgreSQL, no simulado) cuando dos veredictos de KYC parten de la
  misma lectura.

Filtro adicional por nombre, para aislar solo lo relacionado con esta feature:

```
$ DATABASE_URL=postgresql://customer_app:changeme@localhost:5433/customer \
  pnpm exec jest -t "KYC" --verbose
Test Suites: 6 skipped, 3 passed, 3 of 9 total
Tests:       130 skipped, 14 passed, 144 total
```

## Validación local exacta que pide T-26.md

`T-26.md` pide, literalmente, `pnpm lint`, `pnpm typecheck`, `pnpm test` (los
comandos de raíz, sobre **todo** el workspace) más las pruebas específicas de
Customer Service. Se corrieron los tres, sin filtrar.

**Primera corrida**, con Node `v22.14.0` instalado (`.nvmrc` pide
`>=24.19.0`): `pnpm typecheck` y `pnpm lint` dieron 11/11, pero
`npx turbo run test --continue` dio **10/11** — falló `web#test` con
`TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"` al
correr `node --test` sobre `apps/web/app/lib/*.ts`. Esta implementación no
tocó ningún archivo bajo `apps/web` (confirmado por `git status` antes de
empezar), así que el fallo era un desajuste de versión de Node preexistente,
no algo introducido por este ticket.

**Tras instalar Node `v24.21.0`** (confirmado con `node -v` en la sesión de
la terminal), se repitieron los tres comandos:

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

**Los 11 paquetes del workspace pasan**, `web` incluido:

```
web                          PASS  (69 suites, 255 tests)
customer-service              PASS  (9 suites, 144 tests — ver arriba)
@bank/contracts                 PASS  (16 suites, 755 tests)
@bank/messaging                   PASS  (7 suites, 45 tests, 3 saltadas sin DATABASE_URL)
gateway                             PASS  (26 suites, 306 tests)
account-service                       PASS  (9 suites, 123 tests, 16 saltadas sin DATABASE_URL)
transaction-service                     PASS  (8 suites, 137 tests, 33 saltadas sin DATABASE_URL)
payment-service                           PASS  (7 suites, 53 tests, 7 saltadas sin DATABASE_URL)
notification-audit-service                  PASS  (9 suites, 120 tests, 8 saltadas sin DATABASE_URL)
```

Las pruebas de integración de los otros cuatro servicios se saltan por la
misma razón documentada arriba para `customer-service`: cada uno necesita su
propia `DATABASE_URL` apuntando a su propio contenedor, y una sola variable
global no puede servir a los cinco a la vez sin romper a los otros cuatro.
Solo se verificó contra PostgreSQL real el servicio que este ticket modifica
(Customer Service, ver arriba); los demás no tienen cambios de este ticket
que probar contra su base.

## Lo que esta evidencia no cubre

- No se probó el flujo end-to-end a través del Gateway ni de la interfaz web:
  `T-26.md` limita el alcance a Customer Service, y esta implementación no
  agregó una ruta en el Gateway para `customer.set-kyc-status.v1` (queda
  disponible para T-31 o un ticket de Gateway posterior).
- No se corrieron las suites de integración de account/transaction/payment/
  notification-audit-service contra sus propias bases (no tienen cambios de
  este ticket que verificar ahí).
