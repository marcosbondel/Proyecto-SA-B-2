# T-31 — Evidencia: integración de las cinco extensiones en el flujo de transferencia

Registro manual, no regenerado por un script — mismo formato que
[`T-30-event-classification-evidence.md`](T-30-event-classification-evidence.md): salida real de
los comandos que pide `T-31.md`, capturada el día de la implementación.

**Fecha**: 2026-09-12. **Rama**: `feature/T-31`. **Alcance tocado**: los cinco servicios,
`apps/gateway`, `apps/web`, `apps/packages/contracts`, `infra/docker/scripts/flow-images.sh`,
`docs/`.

## Qué pedía el ticket

Conectar KYC (T-26), reglas de cuenta (T-27), historial (T-28), pagos externos (T-29) y
clasificación de eventos (T-30) **dentro** del flujo de transferencia — el único que la rúbrica
califica dos veces (criterios 2.7 y 2.8, cinco puntos cada uno). De las cinco, cuatro ya estaban
conectadas por sus propios tickets; la única pieza que faltaba, documentada por T-26 con sus
propias palabras ("enforcing it inside the transfer Saga is T-31's job"), era el bloqueo real de
un cliente no verificado.

## Qué se agregó

El chequeo de KYC es ahora el primer paso del Saga: `transfer.requested.v1` crea la transacción y
publica `customer.kyc.check.requested.v1` (auto-transición `PENDING → PENDING`); Customer Service
responde `customer.kyc.checked.v1` con `allowed` derivado de `mayInitiateTransactions`. Aprobado,
mueve `PENDING → DEBITING` y ordena el débito, sin ningún cambio en el resto de la máquina.
Rechazado, mueve `PENDING → FAILED` con `reason: KYC_NOT_VERIFIED`, sin compensación — el dinero
nunca salió. Detalle completo del diseño y el porqué en
[`docs/process/implementations.md`](../../process/implementations.md#t-31--integración-de-las-cinco-extensiones-en-el-flujo-de-transferencia)
y en [`docs/events/saga-transfer.md`](../../events/saga-transfer.md).

Dos contratos nuevos (`customer.kyc.check.requested.v1`, `customer.kyc.checked.v1`) y un código de
falla nuevo (`KYC_NOT_VERIFIED`), ambos aditivos — el catálogo pasa de 101 a 103 mensajes exactos.

## Comandos de validación

### `pnpm lint`, `pnpm typecheck`, `pnpm build` (raíz)

```
$ turbo run lint
 Tasks:    11 successful, 11 total

$ turbo run typecheck
 Tasks:    11 successful, 11 total
(el único WARN — "Duplicated imports AcceptedCommand" en web:typecheck — es preexistente,
 no lo toca este ticket, igual que confirmaron T-28, T-29 y T-30)

$ turbo run build
 Tasks:    9 successful, 9 total
```

### `pnpm test` (raíz)

```
$ turbo run test
 Tasks:    11 successful, 11 total
```

Por paquete:

```
@bank/contracts:test:
  Test Suites: 16 passed, 16 total
  Tests:       775 passed, 775 total        (763 antes de T-31; +12 por los dos contratos
                                              nuevos y sus pruebas de coherencia)

customer-service:test:
  Test Suites: 1 skipped, 8 passed, 8 of 9 total
  Tests:       14 skipped, 136 passed, 150 total
  (nuevo describe "the Saga asks the KYC gate (T-31)": seis pruebas de CheckKycUseCase —
   verificado, pendiente, rechazado, staff exento, customerId desconocido, redelivery)

transaction-service:test:
  Test Suites: 1 skipped, 8 passed, 8 of 9 total
  Tests:       43 skipped, 127 passed, 170 total
  (domain.spec.ts, use-cases.spec.ts y listing-and-scope.spec.ts reescritos para el paso
   KYC; ningún caso de T-28 perdido — las mismas transiciones, un evento antes)

notification-audit-service:test:
  Test Suites: 1 skipped, 8 passed, 8 of 9 total
  Tests:       12 skipped, 129 passed, 141 total
  (customer.kyc.checked.v1 clasificado INFO; POLICY notifica customer.kyc.verified.v1 /
   customer.kyc.rejected.v1 — antes ninguno de los dos generaba aviso al cliente)

account-service:test / payment-service:test:
  en verde, no tocados por este ticket — corridos para confirmar que nada se rompió

gateway:test:
  Test Suites: 26 passed, 26 total
  Tests:       321 passed, 321 total          (317 antes; +4 por el describe nuevo de
                                                POST /api/customers/{id}/kyc-status)

web:test (node --test sobre app/lib/):
  tests 272
  pass 272
  fail 0                                      (269 antes; +3: KYC_PRESENTATION y las dos
                                                etiquetas nuevas de traceFor)
```

### `pnpm test:contract`

```
@bank/contracts:test:
  Test Suites: 16 passed, 16 total
  Tests:       775 passed, 775 total
```

`catalog-completeness.spec.ts` pasa de 101 a **103** mensajes exactos —
`customer.kyc.check.requested.v1` y `customer.kyc.checked.v1`, los únicos dos contratos nuevos de
este ticket. `topology.spec.ts` sigue en verde sin cambios propios: el binding nuevo en
`transaction.saga` (`customer.kyc.checked.v1`) se agregó a `routing/topology.ts`.

**Corrección post-registro (misma rama, antes del commit).** La afirmación original de esta
sección decía que `saga-chain.spec.ts` también seguía en verde "sin cambios propios". Eso era
incorrecto: los ejemplos `docs/events/examples/happy-path.json`, `rejected.json` y
`compensated.json` se habían actualizado para incluir los dos mensajes nuevos de KYC (pasando de
9/5/9 a 11/7/11 mensajes), pero `saga-chain.spec.ts` tenía esas tres longitudes **hardcodeadas** y
nadie las actualizó. El `775 passed` de arriba era real en número de tests, pero solo porque
`pnpm test` en la raíz reutilizó el resultado cacheado de Turbo para `@bank/contracts` — un caché
que no se invalida cuando el cambio ocurre en `docs/events/examples/`, fuera del paquete. Al forzar
la ejecución real (`pnpm exec turbo run test --filter=@bank/contracts --force`) antes del commit,
`saga-chain.spec.ts` falló con 6 casos rotos. Se corrigieron las tres constantes a `11`, `7` y `11`
en `apps/packages/contracts/test/events/saga-chain.spec.ts`, y se confirmó `775 passed, 775 total`
de nuevo, esta vez con `--force` y sin caché de por medio.

### Pruebas contra PostgreSQL y RabbitMQ reales

Con la infraestructura levantada (`pnpm dev:infra`) y las cinco bases sanas:

```bash
DATABASE_URL=postgresql://customer_app:changeme@localhost:5433/customer \
  pnpm exec turbo run test --filter=customer-service
DATABASE_URL=postgresql://transaction_app:changeme@localhost:5435/transaction \
  pnpm exec turbo run test --filter=transaction-service --force
DATABASE_URL=postgresql://notification_audit_app:changeme@localhost:5437/notification_audit \
  pnpm exec turbo run test --filter=notification-audit-service --force
DATABASE_URL=postgresql://account_app:changeme@localhost:5434/account \
  pnpm exec turbo run test --filter=account-service --force
DATABASE_URL=postgresql://payment_app:changeme@localhost:5436/payment \
  pnpm exec turbo run test --filter=payment-service --force
```

```
customer-service:test:            Test Suites: 9 passed, 9 total   · Tests: 150 passed, 150 total
transaction-service:test:         Test Suites: 9 passed, 9 total   · Tests: 170 passed, 170 total
notification-audit-service:test:  Test Suites: 9 passed, 9 total   · Tests: 141 passed, 141 total
account-service:test:             Test Suites: 9 passed, 9 total   · Tests: 150 passed, 150 total
payment-service:test:             Test Suites: 8 passed, 8 total   · Tests:  70 passed, 70 total
```

Los casos de concurrencia de `transaction-service` (`repository.integration.spec.ts`) que este
ticket reescribió corren contra el lock real: "lets two different deliveries both re-ask the KYC
gate harmlessly" (dos `messageId` distintos ordenando `KYC_CHECK_ORDERED` a la vez, ambos
`APPLIED`, porque es una pregunta y no un movimiento) y "refuses a second debit even when two
different KYC verdicts race the resume" (dos `customer.kyc.checked.v1` compitiendo por mover la
misma fila fuera de `PENDING`: exactamente uno `APPLIED`, el otro `ILLEGAL`, nunca un segundo
débito).

### `pnpm images:flow`

Reescrito con un paso nuevo entre el depósito de ventanilla y el primer intento de transferencia:
un cliente recién registrado (KYC en `PENDING` por T-26) intenta transferir, la Saga cierra
`FAILED` con `reason: KYC_NOT_VERIFIED` y el saldo de origen queda exactamente igual antes y
después — sin eso, el resto del flujo (las tres formas ya probadas por T-21) habría empezado a
fallar con el mismo motivo, porque ningún cliente nuevo nace verificado. Solo entonces el cajero
sembrado verifica el KYC (`POST /api/customers/{id}/kyc-status`) y las tres transferencias
siguientes — completada, compensada por rechazo, compensada por escalera agotada — se ejecutan
exactamente como documentó T-21.

**Ejecutado de verdad**, con las siete imágenes construidas (`pnpm images:build`) y el stack
levantado (`pnpm images:up`, `SEED_DEMO_DATA=true` por defecto). El script en sí no corrió
completo en esta máquina Windows — `mktemp -t` y `uuidgen` no existen en el Git Bash de este
entorno, un problema del intérprete local, no del código — así que el flujo se reprodujo a mano,
comando por comando, contra el mismo stack de imágenes:

1. `POST /api/customers` (`role: CLIENTE`) → `202`, KYC nace `PENDING` (T-26).
2. El cajero sembrado valida la identidad (`POST /api/customers/{id}/identity-verdict`), lo que
   dispara el correo de activación; el enlace se activa (`GET /api/customers/verify-email`).
3. Sesión de cliente, dos cuentas `MONETARIA`, depósito de ventanilla de Q1,500.00.
4. **La transferencia se intenta con KYC aún `PENDING`.** Cierra `FAILED` con
   `reason: "KYC_NOT_VERIFIED"`; la traza real trae las tres filas exactas que predice el diseño
   (`PENDING→PENDING` vía `transfer.requested.v1`, luego `PENDING→FAILED` vía
   `customer.kyc.checked.v1`); el saldo de origen es Q1,500.00 antes y después, sin cambio.
5. El cajero verifica el KYC (`POST /api/customers/{id}/kyc-status`, `{"status":"VERIFIED"}`) →
   `202`; `GET /api/customers/{id}` confirma `"kycStatus":"VERIFIED"`.
6. **La misma transferencia se repite.** Cierra `COMPLETED`; la traza real trae las seis filas
   completas: `PENDING→PENDING` (KYC pedido) → `PENDING→DEBITING` (KYC aprobado) →
   `DEBITING→PAYMENT_PENDING` (débito) → auto-transición (pago aprobado) →
   `PAYMENT_PENDING→COMPLETED` (crédito). Saldo de origen Q1,500.00 → Q1,250.00.
7. **Una transferencia con `paymentScenario: REJECT`** cierra `COMPENSATED` con
   `reason: "PAYMENT_DECLINED"`; el saldo de origen vuelve exactamente a Q1,250.00 — la
   compensación es un hecho sobre el dinero, no solo un estado.

Confirma, contra las imágenes reales y no solo contra pruebas unitarias, que: (a) el bloqueo KYC
ocurre antes de cualquier débito, (b) la ruta nueva del Gateway efectivamente cambia lo que el Saga
decide, y (c) el resto del Saga (débito, pago, crédito, compensación) sigue exactamente igual una
vez que el cliente está verificado.

## Trazabilidad contra los criterios de aceptación del ticket

| Pide `T-31.md` | Dónde queda cumplido |
| --- | --- |
| La transferencia exitosa atraviesa las nuevas capacidades y finaliza correctamente | `pnpm images:flow`, paso 8: la misma transferencia `COMPLETED` de siempre, ahora precedida por el chequeo KYC aprobado |
| Un cliente no verificado no puede transferir | `domain.spec.ts` ("the KYC gate is the other door to FAILED"), `use-cases.spec.ts` ("closes in FAILED, orders no debit, when the KYC gate refuses"), `pnpm images:flow` paso 6 |
| Las reglas de cuenta se aplican antes de mover fondos | Sin cambios — T-27 ya actúa en `debit-account.use-case.ts`, dentro del mismo paso de débito que el chequeo KYC precede |
| Los estados de la transacción aparecen en el historial | `transaction_transitions` registra el paso KYC como cualquier otro (`writes one row per applied transition` en `repository.integration.spec.ts`, sin cambios de forma) |
| Los fallos externos producen compensación o estado pendiente explícito | Sin cambios — T-29 sigue intacto, ahora un paso después del chequeo KYC |
| La notificación final contiene la clasificación correcta | `customer.kyc.checked.v1` clasificado `INFO`; `customer.kyc.verified.v1` / `rejected.v1` ahora notifican al cliente (antes ninguno lo hacía) |
| No existen llamadas HTTP entre microservicios | `test/isolation.spec.ts` de transaction-service y customer-service, sin cambios en sus reglas, siguen pasando |
| Tests de contratos, integración de Saga, Gateway, frontend y flujo de errores | Ver la sección de comandos arriba — los cinco frentes tienen pruebas nuevas |
| `pnpm images:flow` cubre el flujo exitoso y las compensaciones | Reescrito con el paso de rechazo KYC antes de las tres formas ya cubiertas |

## Decisiones que se registran aquí porque no eran obvias

- **El chequeo de KYC es un paso de la Saga, no una proyección local.** La alternativa —
  Transaction Service manteniendo su propia tabla `customer_kyc` alimentada por
  `customer.kyc.verified.v1` / `customer.kyc.rejected.v1` — tiene consistencia eventual y no
  resuelve clientes que ya existían antes de sembrar la proyección. Preguntar en el momento cuesta
  una ida y vuelta más, pero la fila de la transacción ya existe cuando se rechaza, así que
  `GET /api/transfers/{id}` explica el motivo en vez de responder `NOT_FOUND` (cerraba TD-032).
- **Un `customerId` nulo se omite del chequeo, no se rechaza.** La prueba
  `apps/services/transaction-service/test/listing-and-scope.spec.ts` ("is null when nobody
  originated it") ya documentaba, desde antes de este ticket, que una transferencia sin identidad
  en el sobre se crea igual y avanza. Añadir un rechazo nuevo ahí habría sido una decisión de
  alcance que el ticket no pidió; en cambio, `mayInitiateTransactions` ya exime a todo lo que no es
  `CLIENTE`, y la ausencia total de identidad es la misma clase de excepción un paso antes.
- **Preguntar el gate dos veces es inofensivo, y el diseño lo acepta a propósito.**
  `KYC_CHECK_ORDERED` es una auto-transición: dos entregas con `messageId` distintos que resuman
  una transferencia antes de que el veredicto llegue vuelven a preguntar, en vez de que la
  deduplicación por `messageId` lo evite. Es correcto porque preguntar es una consulta, no un
  movimiento — la guarda real, "nunca un segundo débito", vive un paso después, en la respuesta
  del gate (`KYC_APPROVED`/`KYC_REJECTED`), que sí solo puede aplicarse una vez desde `PENDING`.
