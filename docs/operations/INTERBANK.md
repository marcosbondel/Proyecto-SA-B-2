# Depósitos interbancarios (T-46 entrantes, T-47 salientes)

**Estado del contrato: provisional, pero ya reconciliado con el enunciado.**
El OpenAPI oficial del curso **no se ha publicado** —pedirlo es T-55 (#152)— así
que los nombres de campo siguen siendo una propuesta nuestra y no un acuerdo.
Lo que sí dejó de ser una suposición es el **§4.1 del PDF**, que está en
`docs/references/780_Proyecto_3_2S2026.pdf` desde el principio: T-56 comparó el
cuerpo implementado contra sus «datos mínimos del mensaje» y cerró las tres
divergencias que rompían la interoperabilidad (ver *Lo que T-56 reconcilió*).

Cuando llegue el contrato oficial, **manda el contrato**: habrá que comparar
nombres, tipos, autenticación y códigos campo por campo, y la divergencia se
anota aquí. Ese paso es el alcance 2 de T-56 y sigue abierto.
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
  "amount": { "amountMinor": 12500, "currency": "GTQ" },
  "timestamp": "2026-10-15T12:00:00.000Z"
}
```

El monto también se acepta en decimal, que es lo que manda un banco que piensa
en quetzales en vez de en centavos:

```json
{ "amount": { "value": "125.00", "currency": "GTQ" } }
```

Las dos formas son equivalentes y la conversión ocurre **en el borde**, con
aritmética entera: `Math.round(1.15 * 100)` da 114 en coma flotante, así que el
Gateway parte la cadena por el punto y cuenta con enteros. Un decimal de más de
dos cifras —`1.456`— se rechaza con `400` en vez de redondearse: redondear
dinero que no se pidió redondear es inventarlo. **Ningún `float` toca el
dinero**, que es la regla de Account desde T-17.

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
`BANK_NOT_AUTHORIZED`, `INVALID_REQUEST` e `IDEMPOTENCY_CONFLICT` — el conjunto
**cerrado** que pide §4.1, verificado contra el enunciado en T-56 y declarado en
un solo sitio, `payment-service/src/domain/interbank-receipt.ts`. Cerrado y no
una cadena libre porque el banco pareja tiene que poder **programar** contra
estos valores; un motivo inventado en un `if` es un cambio de contrato que nadie
acordó. Si el contrato oficial trae otro conjunto, manda el contrato.

Una cuenta inactiva nunca se reactiva por este flujo. El crédito ordinario de
una transferencia interna conserva su regla de reactivación.

El **monto máximo por operación** es `INTERBANK_MAX_AMOUNT_MINOR`, del ConfigMap
y no una constante (§4.1 lo pide configurable): llega por `environment` hasta la
función pura que lo compara, así que cambiarlo es un valor y un reinicio, no un
despliegue de código.

## Los estados del depósito **recibido**

§4.1 enumera seis estados —`PENDING`, `SENT`, `ACCEPTED`, `REJECTED`, `TIMEOUT`,
`REVERSED`— y son los del depósito que este banco **envía** (T-47,
`domain/interbank-send.ts`). Aplicarlos al recibido sería copiar un vocabulario
que no describe el flujo: no hay `SENT` porque no mandamos nada, no hay
`TIMEOUT` porque no esperamos la decisión de nadie —**la decisión es nuestra**—
y no hay `REVERSED` porque un depósito recibido que se rechaza no mueve dinero
que haya que devolver: se rechaza **antes** de acreditar.

Lo que sí tiene, y el enviado no, son los **dos pasos de la decisión**. Son
cuatro estados y cada uno responde a una pregunta distinta:

| Estado | Qué significa |
| --- | --- |
| `ELIGIBILITY` | llegó, y se le preguntó a Account si la cuenta lo admite |
| `CREDIT` | la cuenta lo admite y se ordenó el crédito. **El dinero todavía no está** |
| `ACCEPTED` | acreditado. Final, y el único que mueve el saldo |
| `REJECTED` | no se acreditó, con un motivo del conjunto cerrado. Final |

```
ELIGIBILITY ──inelegible──────────────► REJECTED
     │                                      ▲
     └──elegible──► CREDIT ──rehusado───────┘
                      │
                      └──acreditado──► ACCEPTED
```

Las transiciones las decide **una función pura**,
`applyInterbankReceipt` en `domain/interbank-receipt.ts`, como pide §4.1 para
las dos direcciones. Hasta T-56 vivían como diez ternarios repartidos por el
caso de uso: cada uno correcto por separado, y juntos nada que se pudiera leer.

Dos propiedades que la función defiende y que el caso de uso no podía:

- **Un depósito ya decidido no se mueve.** Un segundo paso sobre `ACCEPTED`
  sería un segundo crédito, que es el depósito duplicado que §8.3 penaliza con
  un 50 %.
- **Un mensaje fuera de orden se registra y se descarta**, no se absorbe. La
  confirmación de un crédito que nadie ordenó, o una elegibilidad para un
  depósito ya decidido, lanzan; el llamador lo convierte en un log
  (`interbank receipt transition refused`, con su `correlationId`) y no toca el
  estado. Las mismas cuatro transiciones están escritas otra vez como `CHECK` en
  SQL: si la función y la base se contradicen, **gana la base**.

El **callback al banco pareja no es un estado**: es una entrega que se
reintenta, y vive en sus propias columnas (`callback_attempts`,
`callback_due_at`, `callback_delivered_at`). Un depósito `ACCEPTED` cuyo callback
todavía no salió está acreditado igual — el dinero no depende de que el otro
banco se haya enterado.

## Lo que T-56 reconcilió

Tres divergencias entre el cuerpo implementado en T-46 y los «datos mínimos del
mensaje» de §4.1. Las tres rompían la interoperabilidad, y ninguna necesitaba
esperar el contrato oficial:

| Qué pedía §4.1 | Qué había | Qué hay ahora |
| --- | --- | --- |
| **`timestamp` ISO 8601** entre los datos mínimos | **no estaba en el cuerpo**, y el borde era `.strict()`: un banco que lo mandaba —como pide el enunciado— recibía un `400` **por mandarlo bien** | obligatorio, validado y persistido en `partner_timestamp`, **separado** de `created_at` |
| cuenta destino | `accountId` tipado como UUID: un banco que mandara un número de cuenta recibía un `400` **sin fila y sin callback**, y se quedaba esperando hasta que venciera *su* plazo sin saber por qué | una cadena de hasta 64 caracteres. Entra, se registra, se rechaza con `ACCOUNT_NOT_FOUND` y **se le contesta por callback** |
| monto | sólo `amountMinor` entero: `"amount": 125.00` no interoperaba | los dos formatos, convertidos en el borde con aritmética entera |

**Dos sellos de tiempo y no uno**, que es la parte que no es obvia:
`partner_timestamp` es cuándo dice **él** que lo originó y `created_at` cuándo lo
recibimos **nosotros**. Con uno solo no se puede distinguir un reloj desfasado
de un depósito que tardó en llegar, y los dos se arreglan distinto.

**La decisión sobre la cuenta destino.** Las cuentas de este banco se
identifican por **UUID v4** y no existe un número de cuenta — no está en el
esquema de `accounts` y añadirlo sería una migración, un generador, una
restricción de unicidad y una pantalla. Así que la decisión es: el acuerdo de
integración (T-55) **lista los UUID de las cuentas de prueba**, y cualquier otra
forma que llegue se trata como una cuenta que no existe. Lo que cambió no es
qué aceptamos, es **cómo lo rechazamos**: con un motivo que el otro banco puede
leer en vez de un `400` que tiene que adivinar. Que un UUID sea lo que
reconocemos lo decide `couldBeOurAccount` en el dominio, no el esquema del
mensaje: es una regla de **este** banco, así que si el contrato oficial fija otro
formato cambia la regla y no el contrato.

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

---

## Depósitos salientes (T-47)

La dirección contraria: este banco manda dinero a una cuenta del banco pareja.

**Es la Saga de siempre.** El depósito sale de la cuenta del cliente y entra en
la **cuenta de liquidación interbancaria** de este banco —una cuenta propia que
representa lo que se le debe al otro—, así que para el sistema es una
transferencia interna con un paso de pago distinto. Eso significa que la
máquina de estados de la Saga, la compensación, el historial, el estado de fase
y la notificación **no cambiaron nada**. Lo único nuevo es que la respuesta no
llega al momento.

| Paso | Quién | Qué |
| --- | --- | --- |
| 1 | Gateway | `POST /api/interbank/transfers` mina el `interbankTransferId` y publica `transfer.requested.v1` con el bloque `interbank` y `targetAccount` = la cuenta de liquidación |
| 2 | Transaction | la Saga de siempre: KYC del cliente, débito bajo bloqueo de fila, y la orden de pago con el bloque copiado tal cual |
| 3 | Payment | guarda el depósito `PENDING`, lo manda al Gateway del banco pareja por HTTP y espera `202` → `SENT` |
| 4 | banco pareja | contesta por `POST /api/interbank/callbacks` con `ACCEPTED` o `REJECTED` |
| 5 | Payment | `ACCEPTED` → `payment.succeeded.v1`; `REJECTED` o vencimiento → `payment.failed.v1` |
| 6 | Transaction | completa, o **compensa**: el dinero vuelve a la cuenta origen |
| 7 | Payment | escribe `REVERSED` cuando oye la compensación — la constancia de que el dinero volvió, no de que se ordenó |

Los seis estados del depósito son `PENDING`, `SENT`, `ACCEPTED`, `REJECTED`,
`TIMEOUT` y `REVERSED`, decididos por una función pura
(`payment-service/src/domain/interbank-send.ts`) y vueltos a escribir como
cuatro `CHECK` en `interbank_sends`: la función decide y la base se niega a
guardar un estado que la función no habría producido.

**`TIMEOUT` y `REJECTED` no son sinónimos.** Los dos compensan, pero un rechazo
es una opinión del otro banco y un vencimiento es su ausencia; confundirlos hace
imposible saber si el banco pareja está caído o es estricto. La distinción vive
en el estado, en el evento `payment.interbank.sent.v1` y en la métrica
`bank.interbank.sent` por resultado.

### Configuración

| Variable | Quién la lee | Qué es |
| --- | --- | --- |
| `INTERBANK_SEND_URL` | Payment | la **entrada de depósitos** del banco pareja — con el mock propio, `http://bank-usac-partner-bank-mock:3021/deposits`. **Vacío desactiva el envío**: el bloque `interbank` se ignora y el pago va al proveedor simulado |
| `INTERBANK_CONFIRMATION_TIMEOUT_MS` | Payment | cuánto se espera la confirmación antes de rendirse. 30 s por defecto |
| `INTERBANK_PARTNER_TOKEN` | Gateway, Payment, mock | el mismo secreto compartido de T-46, en las dos direcciones |

### Probarlo en local

El mock del banco pareja corre dentro del clúster (T-57), así que el flujo
completo se ejercita sin la nube y sin el otro grupo:

```bash
pnpm local:up          # banco + observabilidad + mock, en kind
# y para los escenarios de fallo, sin apagar nada de nadie:
pnpm load:scenario rechazo         # el pareja dice no a todo
pnpm load:scenario sin-respuesta   # el pareja no contesta
pnpm load:scenario lento           # el pareja tarda 12 s
```

Las tres mueven `partnerMock.callbackMode`, corren la carga, comprueban que los
saldos cuadran y devuelven el modo a `ACCEPT` — incluso si se interrumpen.

**Dos cosas que la primera corrida real descubrió** (T-51) y que vale la pena
saber antes de desplegar esto en otro sitio:

1. **El chart no tenía `interbank.sendUrl`.** La ruta contestaba `202`, la Saga
   terminaba `COMPLETED` y el dinero se quedaba en la cuenta de liquidación sin
   que nadie lo hubiera mandado a ninguna parte. El único rastro era una línea
   al arrancar: `envio interbancario desactivado: falta INTERBANK_SEND_URL`.
2. **El mock no sabía contestar un depósito nuestro.** Su `POST /transfers` es
   el mock haciendo de banco que nos *origina* un depósito; el `POST /deposits`
   —que llegó con T-51— es el mock haciendo de banco que *recibe* uno nuestro y
   lo decide según `callbackMode`. Son dos direcciones y dos rutas: apuntar
   `sendUrl` a la primera hace que el banco se mande depósitos a sí mismo.

La pantalla es `/transferencias/interbancaria`, y el seguimiento es el de
cualquier transferencia: `/transferencias/{transactionId}`.
