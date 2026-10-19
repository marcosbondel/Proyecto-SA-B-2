# T-46 — Recepción de depósitos interbancarios: evidencia

Fecha de la medición: **2026-10-15**. Entregado en T-46 (#133); esta evidencia se
escribió en T-59 (#156), contra el **despliegue local real** de T-57 y no contra
dobles.

## 1. Qué es este ticket

La mitad **entrante** del enlace interbancario: el otro banco nos manda un
depósito, este banco lo decide, lo acredita si procede, y le contesta por
callback. La mitad saliente —el depósito que **nosotros** enviamos— es T-47 y
tiene [su propia evidencia](T-47-interbank-send-evidence.md).

La asimetría es del enunciado y es deliberada: la entrada entra por el
**Gateway** (§4.2) y la salida sale de **Payment** (§4.1). Por eso los
controladores de Payment siguen siendo dos, `health` y `ready` — el callback del
otro banco no llega a Payment por HTTP. La decisión está en
[ADR-019](../../architecture/adr/ADR-019-payment-http-egress.md).

## 2. El camino feliz, medido

```
$ curl -X POST http://localhost:3000/api/interbank/deposits \
    -H "Authorization: Bearer $INTERBANK_PARTNER_TOKEN" \
    -H "traceparent: 00-af9631dabe2c54dd4f4e5e1bf64824b0-a5ae41d01c58caab-01" \
    -d '{"interbankTransferId":"04F86C58-…","idempotencyKey":"04F86C58-…",
         "originBankCode":"PARTNER_MOCK","destinationBankCode":"BANK_USAC",
         "accountId":"b0000000-0000-4000-8000-000000000003",
         "amount":{"amountMinor":7500,"currency":"GTQ"}}'

{"depositId":"27633383-1ba5-4cf7-bd12-d4d69c869a43","correlationId":"b92fe756-…"}
HTTP 202
```

`202` y no `200`: el Gateway contesta en cuanto el comando está en el broker. No
decide nada — si la cuenta existe, si el monto cabe y si el depósito ya se
contó son tres preguntas de Payment, que es quien tiene la fila.

La fila, seis segundos después:

```
$ psql -d payment -c "SELECT … FROM interbank_deposits WHERE external_transfer_id='04F86C58-…'"

deposit_id            | 27633383-1ba5-4cf7-bd12-d4d69c869a43
origin_bank_code      | PARTNER_MOCK
external_transfer_id  | 04F86C58-6242-46B3-82FF-8B845475F639
amount_minor          | 7500
stage                 | ACCEPTED
rejection_reason      |
callback_attempts     | 1
callback_delivered_at | 2026-10-15 21:20:49.692+00
trace_context         | 00-af9631dabe2c54dd4f4e5e1bf64824b0-3c86ed5ae5ad3356-01
```

Tres cosas en esa fila, y las tres importan:

- **`stage = ACCEPTED`** con `rejection_reason` vacío. Los dos campos son
  excluyentes por `CHECK`.
- **`callback_attempts = 1` y `callback_delivered_at` puesto**: la respuesta
  llegó al otro banco en el primer intento. El plazo es una **columna**
  (`callback_due_at`), no un temporizador, así que un pod reprogramado no olvida
  contestar.
- **`trace_context`** guarda el `traceparent`: mismo `traceId`
  (`af9631…24b0`) que el que mandó el otro banco, distinto `spanId`. Es §4.1
  literalmente — «relacionar un depósito entre ambos bancos con el mismo
  traceId».

## 3. La idempotencia, medida sobre el dinero

No «el estado dice que no se duplicó», sino **el saldo**. Tres peticiones
idénticas, con el mismo `idempotencyKey`:

```
saldo antes:   209000
saldo después: 216500
delta:         7500      (tres peticiones idénticas, un solo crédito de 7500)

filas en interbank_deposits: 1
```

Y la razón de que sea 1 y no una comprobación en código:

```
$ psql -d payment -c "\d interbank_deposits"  (restricciones)

interbank_deposits_pkey                                        PRIMARY KEY (deposit_id)
interbank_deposits_origin_bank_code_external_transfer_id_key   UNIQUE (origin_bank_code, external_transfer_id)
interbank_deposits_origin_bank_code_idempotency_key_key        UNIQUE (origin_bank_code, idempotency_key)
```

**Dos restricciones y no una, y las dos llevan el banco de origen.** El
`interbankTransferId` lo elige el otro banco: sin `origin_bank_code` en la
clave, dos bancos pareja que eligieran el mismo identificador se pisarían, y el
segundo depósito se descartaría como duplicado del primero. La idempotencia la
decide PostgreSQL, no una consulta previa — una comprobación «¿ya existe?»
seguida de un `INSERT` es una carrera con premio en dinero.

La segunda petición devolvió **el mismo `depositId`** con un `correlationId`
distinto: la respuesta es idéntica porque el depósito es el mismo, y la
correlación es distinta porque la petición es otra.

## 4. El rechazo, y por qué también contesta

```
$ curl … -d '{"accountId":"00000000-0000-4000-8000-000000000999", …}'
{"depositId":"01e5ee8e-…","correlationId":"a336932d-…"}
HTTP 202

stage | rejection_reason   | callback_attempts | entregado
------+--------------------+-------------------+----------
REJECTED | ACCOUNT_NOT_FOUND |                 1 | t
```

`202` también para un depósito que va a ser rechazado: el Gateway acusa recibo
del **mensaje**, no de la decisión. Y el callback se entrega igual — un rechazo
que no se comunica deja al otro banco esperando, y el otro banco tiene dinero
retenido mientras espera.

**La cuenta se valida por `request/reply` con Account a través del broker**, no
leyendo su tabla ni llamándola por HTTP. `ACCOUNT_NOT_FOUND` es lo que Account
contestó, y viaja por donde viaja todo lo demás
([ADR-019](../../architecture/adr/ADR-019-payment-http-egress.md) §3).

Sin el token compartido:

```
$ curl -X POST http://localhost:3000/api/interbank/deposits -d '{}'
HTTP 401
```

## 5. Una traza, los dos bancos, cuatro servicios

El `traceId` que el otro banco puso en su `traceparent`, buscado en Tempo:

```
$ curl http://localhost:3200/api/traces/af9631dabe2c54dd4f4e5e1bf64824b0

spans: 80
  payment-service              30 spans
  gateway                      21 spans
  account-service              15 spans
  notification-audit-service   14 spans

spans interbancarios:
  POST /api/interbank/deposits · InterbankController.receive · process payment.interbank
  payment.interbank state · payment.interbank.action · payment.interbank.callback
  payment.interbank.result
```

El mismo `traceId` en Loki, que es el salto que hace útil un log:

```
$ logcli query '{service_name="payment-service"} | traceId="af9631…24b0"'
  flujos: 3
  message handled | traceId af9631dabe2c54dd4f4e5e1bf64824b0
```

Cuatro servicios en una sola traza **sin que ninguno llame a otro por HTTP**: el
contexto W3C viaja en las propiedades AMQP (T-48). El único salto HTTP de la
traza es el que entra desde el otro banco.

## 6. La bitácora y las métricas

```
account.interbank.credited.v1   | INFO    | PROCESSED
payment.interbank.accepted.v1   | INFO    | PROCESSED
payment.interbank.rejected.v1   | WARNING | PROCESSED
```

El rechazo entra como `WARNING` y la aceptación como `INFO`: la clasificación de
T-30, aplicada sin que nadie la escriba por evento.

```
bank_interbank_deposits_total{result="accepted"}  3
bank_interbank_deposits_total{result="rejected"}  1
bank_interbank_callbacks_total{result="delivered"} 4
bank_interbank_callbacks_total{result="failed"}    3
```

`bank_interbank_callbacks_total` es lo que **nosotros** entregamos, separado de
la decisión: si falla, el problema es nuestro lado o la red, no su respuesta.
Los tres `failed` son de los escenarios de carga de T-51, cuando el mock estuvo
en `REJECT` y devolvió `503` al callback — exactamente el caso que esa métrica
existe para distinguir.

Los paneles están en `08-banco-pareja.json` y las alertas `PartnerBankDegraded`
y `PartnerBankConfirmationSlow` vigilan esta dirección, con su runbook en
[`partner-bank.md`](../../operations/runbooks/partner-bank.md).

## 7. Las pruebas, y el contraste que demuestra que corren

```
$ DATABASE_URL=postgresql://…@localhost:5436/payment_t46 pnpm --filter payment-service test
Test Suites: 20 passed, 20 total
Tests:       250 passed, 250 total

$ pnpm --filter payment-service test          # sin base de datos
Test Suites: 5 skipped, 15 passed, 15 of 20 total
Tests:       58 skipped, 192 passed, 250 total
```

**58 casos de diferencia.** Es el contraste que hace falta: con `DATABASE_URL`
no se omite nada, y sin él las cinco suites de integración se declaran omitidas
en vez de pasar en falso. Las de este ticket son
`interbank-repository.integration.spec.ts` y las de `repository.integration.spec.ts`
que ejercitan las dos restricciones `UNIQUE` contra PostgreSQL real — una
restricción sólo se puede comprobar provocándola.

Sólo lo interbancario:

```
$ DATABASE_URL=… pnpm --filter payment-service test -- interbank
Test Suites: 6 passed, 6 total
Tests:       54 passed, 54 total
```

## 8. El mock, y la regla que lo justifica

`apps/partner-bank-mock` hace de banco pareja en las dos direcciones. Para esta,
su `POST /transfers` **origina** un depósito hacia nosotros y lo reenvía a
nuestro `POST /api/interbank/deposits` propagando el `traceparent`, que es como
se ejercita el flujo completo sin el otro grupo.

Está apagado por defecto en el chart (`partnerMock.enabled: false`) y se
enciende con un valor. §4.1 lo pide «para desarrollar sin depender del otro
grupo y para inyectar fallos», y la regla que no se negocia es la otra cara: **un
fallo del banco pareja nunca se inyecta apagando ni alterando el sistema del
otro grupo**. T-51 corrió los cuatro modos del mock y
[lo documentó](../../sre/postmortems/2026-10-15-banco-pareja.md).

## 9. Lo que queda abierto

- **El contrato de verdad no está acordado.** Todo esto implementa el contrato
  *provisional* de `docs/operations/INTERBANK.md`. T-55 (#152) pide el OpenAPI
  oficial al auxiliar y T-56 (#153) reconcilia el mensaje con él. Hasta
  entonces, los nombres de campo son una propuesta, no un acuerdo.
- **El destino configurado no se valida.** `isolation.spec.ts` comprueba que la
  URL sale de la configuración, no que apunte al banco pareja
  ([ADR-019](../../architecture/adr/ADR-019-payment-http-egress.md),
  *Consequences*).
