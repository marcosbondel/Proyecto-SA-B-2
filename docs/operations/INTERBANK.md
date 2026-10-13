# Depósitos interbancarios entrantes (T-46)

**Estado del contrato: provisional.** No se recibió el PDF de Fase 3 ni el
OpenAPI oficial del curso. La ruta y el callback de esta página permiten probar
el flujo localmente; cuando llegue el contrato oficial habrá que comparar
nombres, campos, autenticación y códigos antes de considerarlo compatible.
Este trabajo no requiere desplegar en GCP.

## Plan implementado

1. El Gateway autentica al banco asociado con `INTERBANK_PARTNER_TOKEN` y
   valida el cuerpo. Publica `payment.interbank.receive.v1` y responde `202`.
2. Payment registra la solicitud y sus claves únicas por banco, transferencia
   e idempotencia. Rechaza banco, destino, moneda y monto inválidos.
3. Payment consulta la elegibilidad por RabbitMQ. Account responde si la cuenta
   existe y está activa; al acreditar vuelve a verificar `ACTIVE` dentro del
   bloqueo de la fila. Sólo Account cambia el saldo.
4. Payment guarda `ACCEPTED` o `REJECTED`, publica el evento final desde su
   bandeja persistida y envía un callback al URL configurado. Los reintentos de
   comandos y callbacks se programan en columnas, así que sobreviven reinicios.
   El contexto W3C de la recepción se conserva para continuar la misma traza
   cuando un barrido posterior publique o llame al emisor.
5. El mock opcional envía transferencias al Gateway, conserva los resultados en
   memoria mientras corre y permite simular fallos del callback.

| Mensaje v1 | Emisor → consumidor | Función |
| --- | --- | --- |
| `payment.interbank.receive` | Gateway → Payment | Inicia o deduplica la recepción. |
| `account.interbank.eligibility.query` | Payment → Account | Consulta existencia y estado actual. |
| `account.interbank.eligibility.replied` | Account → Payment | Responde la elegibilidad. |
| `account.interbank.credit.requested` | Payment → Account | Solicita el crédito bajo bloqueo. |
| `account.interbank.credited` | Account → Payment y auditoría | Confirma el movimiento. |
| `account.interbank.credit.rejected` | Account → Payment y auditoría | Rechaza el movimiento. |
| `payment.interbank.accepted` | Payment → auditoría | Resultado final aceptado. |
| `payment.interbank.rejected` | Payment → auditoría | Resultado final rechazado. |

La tabla omite el sufijo `.v1` sólo para leerse con menos ruido: todos los
nombres del contrato lo llevan. La cola durable `payment.interbank` recibe la
respuesta de elegibilidad y los dos eventos de crédito; una réplica puede
reanudar el flujo aunque otra se reinicie.

## Contrato HTTP provisional

`POST /api/interbank/deposits` usa
`Authorization: Bearer <INTERBANK_PARTNER_TOKEN>`. El OpenAPI versionado en
[`apps/gateway/openapi/gateway.v1.yaml`](../../apps/gateway/openapi/gateway.v1.yaml)
define su cuerpo y su respuesta. Ejemplo:

```json
{
  "interbankTransferId": "banco-123",
  "idempotencyKey": "banco-123",
  "originBankCode": "PARTNER_MOCK",
  "destinationBankCode": "BANK_USAC",
  "accountId": "fb6c2385-94a1-4f73-8188-cd2810ce4823",
  "amount": { "amountMinor": 12500, "currency": "GTQ" }
}
```

`202` confirma que el comando llegó al broker, no que el saldo cambió. Devuelve
`depositId` y `correlationId`. El primero se deriva de banco origen e
identificador externo de transferencia: reintentos de la misma transferencia
reciben el mismo ID. Una transferencia con el mismo ID o clave pero datos
distintos se rechaza con `IDEMPOTENCY_CONFLICT` sin segundo crédito.

Payment llama a la URL fija `INTERBANK_CALLBACK_URL` con el mismo Bearer y un
JSON con `depositId`, `interbankTransferId`, `originBankCode`,
`destinationBankCode`, `status` (`ACCEPTED` o `REJECTED`) y `reason` (nulo si se
aceptó). La URL **no** se toma del cuerpo de la solicitud. El banco receptor
debe tratar callbacks repetidos como la misma decisión. Una respuesta distinta
de 2xx, un timeout o un reinicio provoca otro intento; la espera crece hasta
60 segundos. Un duplicado recibido después del resultado vuelve a programar
el callback guardado.

Las causas de rechazo son `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`,
`AMOUNT_EXCEEDS_LIMIT`, `UNSUPPORTED_CURRENCY`, `WRONG_DESTINATION_BANK`,
`BANK_NOT_AUTHORIZED`, `INVALID_REQUEST` e `IDEMPOTENCY_CONFLICT`. Una cuenta
inactiva nunca se reactiva por este flujo. El crédito ordinario de una
transferencia interna conserva su regla de reactivación.

## Ejecutar sólo en local

Configure en `infra/docker/.env` un `INTERBANK_PARTNER_TOKEN` de al menos 32
caracteres. La entrada queda cerrada cuando falta. Inicie el stack y el mock
opcional con:

```bash
docker compose -f infra/docker/docker-compose.dev.yml --profile interbank up --build
```

`POST http://localhost:3021/transfers` recibe el token, `accountId`, `amount`
y un `interbankTransferId` opcional; el mock agrega los códigos de banco y
envía al Gateway. Si el cliente aporta `traceparent` válido, el mock lo
reenvía. `GET /transfers/{interbankTransferId}` devuelve `PENDING` y
luego la decisión. `PARTNER_CALLBACK_FAIL_COUNT=1` hace fallar el primer
callback para comprobar el reintento. `PARTNER_CALLBACK_MODE` acepta `ACCEPT`,
`REJECT`, `TIMEOUT` y `SLOW`; `PARTNER_CALLBACK_DELAY_MS` controla la demora.
El mock en `apps/partner-bank-mock/` guarda su vista en memoria; la
fuente durable del resultado es la base de Payment.

En modo host puede arrancarse sólo el mock con `pnpm partner:mock`; ese comando
lee `infra/docker/.env` cuando existe. Gateway, Account y Payment necesitan su
infraestructura local y el mismo token.
Las suites de integración hacen `TRUNCATE`: ejecútelas con bases de prueba
separadas del stack activo, como se explica en [`AGENTS.md`](../../AGENTS.md).

## Configuración y observación

| Variable | Componente | Propósito |
| --- | --- | --- |
| `INTERBANK_PARTNER_TOKEN` | Gateway, Payment, mock | Secreto compartido; vacío cierra la entrada y deja callbacks pendientes. |
| `INTERBANK_BANK_CODE` | Payment, mock | Código destino; predeterminado `BANK_USAC`. |
| `INTERBANK_PARTNER_BANK_CODE` | Payment, mock | Único banco emisor autorizado; predeterminado `PARTNER_MOCK`. |
| `INTERBANK_MAX_AMOUNT_MINOR` | Payment | Tope por depósito; predeterminado 100000000 centavos. |
| `INTERBANK_CALLBACK_URL` | Payment | Endpoint fijo del banco emisor. |

El chart de Helm incluye estas variables y toma el token de
`secrets.interbankPartnerToken`. Por defecto está vacío y el Gateway rechaza
solicitudes interbancarias. La URL de callback del chart apunta a loopback
como valor inerte; antes de habilitar un emisor hay que configurar una URL
alcanzable desde Payment. El mock sigue siendo opcional y local.

Payment emite `bank.interbank.deposits{result=accepted|rejected}`; la tasa de
éxito es `accepted / (accepted + rejected)` sobre decisiones nuevas. El
histograma `bank.interbank.deposit.duration` mide en segundos desde la
recepción hasta la decisión. `bank.interbank.callbacks{result=delivered|failed}`
cuenta intentos de entrega. Las etiquetas sólo contienen resultados de un
conjunto cerrado: ningún ID de cuenta, depósito o transferencia va en ellas.
Cada transición registra un evento de span `bank.interbank.state_changed` y
un log con `correlationId`, `depositId`, estado y motivo cuando aplica, sin
token ni monto. Un callback repetido se cuenta como otro intento; una
redelivery del mismo conflicto no se cuenta como otra decisión.

Para investigar un depósito, siga el `correlationId` del `202` en Gateway,
Payment y Account, y consulte `interbank_deposits` en la base **de Payment**.
`stage` muestra `ELIGIBILITY`, `CREDIT`, `ACCEPTED` o `REJECTED`;
`callback_due_at` y `callback_delivered_at` explican si el emisor ya recibió
la decisión. `interbank_conflicts` conserva los rechazos por claves repetidas
con datos diferentes. No consulte directamente la base de Account desde Payment.
