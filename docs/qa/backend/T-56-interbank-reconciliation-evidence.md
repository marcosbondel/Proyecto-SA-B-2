# T-56 — Reconciliar el mensaje interbancario con el enunciado: evidencia

Fecha: **2026-10-15**. Rama `feature/T-56`.

## 1. Qué cubre este ticket y qué no

T-56 tiene dos mitades y **sólo una se podía hacer**:

| Alcance | Estado |
| --- | --- |
| **1 y 3** — lo que exige §4.1 del enunciado, que está en `docs/references/` desde el principio | **hecho** |
| **2** — comparar campo por campo contra el **OpenAPI oficial del curso** y una prueba de contrato contra ese archivo | **bloqueado**: el archivo no existe. Pedirlo es T-55 (#152) |

La premisa del ticket era que `docs/operations/INTERBANK.md` decía *«no se
recibió el PDF de Fase 3 ni el OpenAPI oficial»* y que **la primera mitad de esa
frase era falsa**. Lo era: el PDF estaba, nadie había comparado el cuerpo contra
su §4.1, y la comparación encontró tres divergencias que rompían la
interoperabilidad.

## 2. Las tres divergencias, y por qué cada una era un fallo de verdad

| Qué pedía §4.1 | Qué había | Qué le pasaba al banco pareja |
| --- | --- | --- |
| **`timestamp` ISO 8601** entre los datos mínimos del mensaje | no estaba en el cuerpo, y el borde era `.strict()` | un banco que lo mandaba **como pide el enunciado** recibía un `400` **por mandarlo bien** |
| cuenta destino | `accountId` tipado como `uuidV4` | un número de cuenta —lo que manda un banco real— daba `400` **sin fila y sin callback**: su depósito se quedaba colgado hasta que venciera *su* plazo, sin saber por qué, y nuestra bitácora no tenía constancia de nada |
| monto | sólo `amountMinor` entero | `"amount": { "value": 125.00 }` no interoperaba |

Las tres son el mismo tipo de defecto: **un rechazo que no explica nada**. Un
`400` del borde no deja fila, no emite evento y no dispara callback, así que el
otro equipo no tiene con qué depurar y nosotros no tenemos con qué demostrar que
el depósito llegó.

## 3. Lo que ahora acepta el borde

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

y el monto, equivalentemente, como `{ "value": "125.00", "currency": "GTQ" }`.

**La conversión no usa coma flotante.** `Math.round(1.15 * 100)` da **114**,
porque `1.15 * 100` es `114.99999999999999`. `interbankMinorUnits` parte la
cadena por el punto y cuenta con enteros:

```
interbankMinorUnits('1.15')   → 115
interbankMinorUnits('125.00') → 12500
interbankMinorUnits('0.01')   → 1
interbankMinorUnits('7')      → 700
interbankMinorUnits('125.456')→ null   (se rechaza, no se redondea)
interbankMinorUnits('125,00') → null
```

Un decimal de más de dos cifras se **rechaza** en vez de redondearse: redondear
dinero que nadie pidió redondear es inventarlo. Es la misma regla que Account
aplica desde T-17 — ningún `float` toca el dinero.

**Dos sellos de tiempo y no uno.** `partner_timestamp` es cuándo dice **él** que
lo originó; `created_at` cuándo lo insertamos **nosotros**. Con uno solo no se
puede distinguir un reloj desfasado de un depósito que tardó en llegar, y los
dos se arreglan distinto.

**La cuenta destino, decidida y escrita.** Este banco identifica sus cuentas por
**UUID v4** y no tiene número de cuenta: no está en el esquema de `accounts`, y
añadirlo sería una migración, un generador, una restricción de unicidad y una
pantalla. Así que la decisión es que el acuerdo de integración (T-55) **lista los
UUID de las cuentas de prueba**, y cualquier otra forma se trata como una cuenta
que no existe. Lo que cambió no es qué aceptamos: es **cómo lo rechazamos** —
con un `ACCOUNT_NOT_FOUND` que el otro banco puede leer, registrar y reintentar,
en vez de un `400` que tiene que adivinar.

Qué cuenta como cuenta nuestra lo decide `couldBeOurAccount` **en el dominio**,
no el esquema del mensaje: es una regla de este banco, así que si el contrato
oficial fija otro formato cambia la regla y no el contrato.

## 4. Los cuatro estados del depósito recibido (alcance 3)

§4.1 enumera seis estados y son los del depósito **enviado** (T-47). Aplicarlos
al recibido sería copiar un vocabulario que no describe el flujo: no hay `SENT`
porque no mandamos nada, no hay `TIMEOUT` porque **la decisión es nuestra**, y no
hay `REVERSED` porque un recibido que se rechaza no mueve dinero que devolver —
se rechaza **antes** de acreditar.

```
ELIGIBILITY ──inelegible──────────────► REJECTED
     │                                      ▲
     └──elegible──► CREDIT ──rehusado───────┘
                      │
                      └──acreditado──► ACCEPTED
```

| Estado | Qué significa |
| --- | --- |
| `ELIGIBILITY` | llegó, y se le preguntó a Account si la cuenta lo admite |
| `CREDIT` | la cuenta lo admite y se ordenó el crédito. **El dinero todavía no está** |
| `ACCEPTED` | acreditado. Final, y el único que mueve el saldo |
| `REJECTED` | no se acreditó, con un motivo del conjunto cerrado. Final |

Los dos pasos son dos porque los decide **otro servicio** y cada respuesta llega
en su propio mensaje; colapsarlos dejaría un depósito «decidido» antes de que el
saldo se hubiera movido.

**Las transiciones las decide una función pura**, `applyInterbankReceipt` en
`domain/interbank-receipt.ts`, como §4.1 pide para las dos direcciones. Hasta
este ticket eran **diez ternarios repartidos** por el caso de uso
(`reason === null ? 'ELIGIBILITY' : 'REJECTED'`, y así nueve veces más): cada uno
correcto por separado, y juntos nada que se pudiera leer — para saber si un
`ACCEPTED` podía venir de `ELIGIBILITY` había que reconstruir el grafo de
memoria.

Dos propiedades que la función defiende y que diez ternarios no podían:

- **Un depósito ya decidido no se mueve.** Un segundo paso sobre `ACCEPTED`
  sería un **segundo crédito**, que es el depósito duplicado que §8.3 penaliza
  con un 50 %.
- **Un mensaje fuera de orden se registra y se descarta.** La confirmación de un
  crédito que nadie ordenó, o una elegibilidad para un depósito ya decidido,
  lanzan `IllegalInterbankReceiptTransition`; el caso de uso lo convierte en
  `interbank receipt transition refused` con su `correlationId` y **no toca el
  estado**.

Y un detalle que el compilador ahora sostiene: el tipo de aterrizaje de una
transición **excluye `ELIGIBILITY`**, porque ahí un depósito *empieza* —lo pone
el `INSERT`— y nunca es donde *cae*. Lo encontró el propio `tsc` al conectar la
función con el repositorio, cuyo `to` ya era estrecho.

El **callback no es un estado**: es una entrega que se reintenta, en sus propias
columnas. Un `ACCEPTED` cuyo callback no ha salido está acreditado igual — el
dinero no depende de que el otro banco se haya enterado.

## 5. Lo que ya estaba bien, verificado y no supuesto

- **El conjunto cerrado de motivos de rechazo** coincide con §4.1: los ocho,
  `ACCOUNT_NOT_FOUND` · `ACCOUNT_INACTIVE` · `AMOUNT_EXCEEDS_LIMIT` ·
  `UNSUPPORTED_CURRENCY` · `WRONG_DESTINATION_BANK` · `BANK_NOT_AUTHORIZED` ·
  `INVALID_REQUEST` · `IDEMPOTENCY_CONFLICT`. Ahora se declaran **una vez**, en
  el dominio, y el caso de uso los importa en vez de repetir la unión.
- **El monto máximo por operación ya era configurable** (§4.1 lo pide):
  `INTERBANK_MAX_AMOUNT_MINOR` sale del ConfigMap, pasa por `environment` y se
  inyecta en la función pura que lo compara. No hay constante dura — se
  comprobó, no se asumió.
- **El log por cambio de estado ya existía y no lleva datos sensibles**:
  `interbank deposit state changed` con `correlationId`, `depositId`, `status`,
  `reason` y `durationMs`. Ni monto, ni cuenta, ni nada que `redactFields`
  tuviera que limpiar.
- **La transición ilegal va al log y no a una métrica.** Un contador con `from`
  y `event` como etiquetas serían dieciséis series para un suceso que
  idealmente no pasa nunca; el catálogo de telemetría justifica cada serie que
  existe.

## 6. Verificado contra el despliegue real, no sólo con dobles

Tres peticiones al Gateway del clúster local, con las imágenes de esta rama:

```
1. monto DECIMAL                   → HTTP 202
2. cuenta que NO es UUID           → HTTP 202
3. sin timestamp                   → HTTP 400
   {"type":"VALIDATION_ERROR","field":"timestamp",
    "message":"Invalid input: expected string, received undefined"}
```

Y las dos filas que dejaron:

```
external_transfer_id | destination_account_id                | amount_minor | stage    | reason            | callback | entregado | partner_timestamp
4DFB97C8-…           | b0000000-0000-4000-8000-000000000003  |          115 | ACCEPTED | -                 |        1 | t         | 2026-10-15 23:58:00+00
148B7D54-…           | 001-2345-6                            |         5000 | REJECTED | ACCOUNT_NOT_FOUND |        1 | t         | 2026-10-15 23:58:30+00
```

Cuatro cosas en esas dos filas, y las cuatro son el ticket:

1. **`"1.15"` se guardó como `115`**, no como `114` — que es lo que da
   `Math.round(1.15 * 100)`.
2. **`001-2345-6` se guardó tal cual** en una columna que hasta la migración
   `011` era `UUID`. Antes, esto no llegaba a ser un rechazo de negocio: era un
   error de tipo que el borde convertía en `400`.
3. **Las dos tienen `callback_attempts = 1` y entregado.** Incluido el rechazo:
   el otro banco se enteró del motivo. Es la diferencia entre interoperar y
   devolver un silencio.
4. **`partner_timestamp` guarda el sello que mandó él** (23:58:00 y 23:58:30),
   distinto del momento en que lo insertamos.

Y el dinero, medido por el saldo y no por un estado:

```
saldo antes:   250115
saldo después: 250230
delta:         115      (el decimal "1.15" acreditó 115, no 114)
```

La migración corrió sola en el despliegue:

```
{"level":"info","serviceName":"payment-service","message":"schema migrations applied",
 "outcome":"011_interbank_deposits_partner_fields"}
```

## 7. Validación

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 14 de 14 |
| `pnpm typecheck` | 14 de 14 |
| `pnpm --filter @bank/contracts test` | 947 pasan (+8: el cuerpo del pareja y la conversión del monto) |
| `pnpm --filter gateway test` | 414 pasan (+6: el renombrado del sello, el decimal, la cuenta no-UUID, y los dos `400` que siguen siendo `400`) |
| `pnpm --filter payment-service test` | 207 pasan (+15: la máquina del recibido, incluidos los mensajes fuera de orden) |
| `pnpm --filter partner-bank-mock test` | 13 pasan |
| `DATABASE_URL=… pnpm --filter payment-service test` | **267 pasan, 0 omitidos** (+2 de integración: el sello persistido y la referencia que la columna `UUID` impedía) |
| `pnpm --filter gateway openapi:emit` | el OpenAPI versionado refleja el cuerpo nuevo |

Las dos pruebas de integración nuevas son las únicas que pueden demostrar la
migración `011`: **un tipo de columna que se ensancha se prueba escribiendo el
valor que antes no cabía**, y un `ALTER … USING` se prueba corriéndolo. Un doble
habría aceptado cualquier cadena desde el principio.

## 8. El contrato oficial llegó: el análisis operación por operación

**2026-10-16.** El auxiliar entregó el contrato base, versionado sin modificar
en
[`docs/references/interbank-contract-v1.openapi.yaml`](../../references/interbank-contract-v1.openapi.yaml)
(SHA-256 `4888b951aa48f95d8d30…`). Esto desbloquea el **alcance 2** del ticket, y
el resultado de la comparación es más grande de lo que el ticket preveía: el
contrato tiene **siete operaciones** y el repositorio implementaba **dos**, con
nombres y formatos distintos en las dos.

Lo que el contrato confirma de lo que ya se había decidido sin él: el monto va
como **texto** y no como número (por la misma razón que §3 de este documento),
la idempotencia es obligatoria y por identificador del emisor, el `traceparent`
viaja en todas las operaciones, y el rechazo se informa **por callback** y no por
el código HTTP. Las tres divergencias que T-56 cerró a ciegas iban en la
dirección correcta.

### 8.1 Las siete operaciones

| # | Operación del contrato | Rol | Teníamos | Veredicto |
| --- | --- | --- | --- | --- |
| 1 | `POST /transfers` | receptor | `POST /api/interbank/deposits` | **ruta, autenticación y cuerpo distintos** |
| 2 | `GET /transfers/{id}` | receptor | — | **falta** |
| 3 | `POST /transfers/{id}/cancel` | receptor | — | **falta** |
| 4 | `POST /transfers/{id}/result` | **emisor** | `POST /api/interbank/callbacks` | **ruta y cuerpo distintos**; la URL se *deriva*, no se configura |
| 5 | `POST /reversals` · `GET /reversals/{id}` | receptor | — | **falta** |
| 6 | `GET /reconciliation?date=` | receptor | — | **falta** |
| 7 | `GET /health` | ambos | `/health` propio | existe, con **otra forma** y fuera del prefijo |

### 8.2 Campo por campo, lo que el contrato exige del depósito

| Campo del contrato | Teníamos | Qué hay que cambiar |
| --- | --- | --- |
| prefijo `/interbank/v1` | `/api/interbank` | ruta nueva; la vieja es nuestra y sigue sirviendo al frontend |
| `X-Api-Key`, **identifica al banco que llama** | `Authorization: Bearer` compartido | autenticación nueva, y un mapa clave → banco |
| `Idempotency-Key` **igual a** `interbankTransferId` | `idempotencyKey` en el cuerpo | mover al header y validar la igualdad (`400` si no) |
| `BankCode` `^BANK[0-9]{2}$` | `BANK_USAC`, `PARTNER_MOCK` | **ninguno de los dos cumple**: pasamos a `BANK02` |
| `originAccount` **obligatorio** | no se recibía ni se enviaba | campo nuevo en las dos direcciones |
| `AccountNumber` `^[A-Za-z0-9-]{1,34}$` | UUID v4 | **un UUID son 36 caracteres: no cabe.** Hace falta un número de cuenta propio |
| `Amount` texto `^[0-9]{1,5}\.[0-9]{2}$`, 0.01–10000.00 | entero de centavos | formatear al salir, parsear al entrar; el máximo baja a `1000000` centavos |
| `createdAt` y `expiresAt` (= +180 s) | `timestamp` (añadido en T-56) | dos campos, y el vencimiento **se respeta** |
| `ReasonCode` de siete valores | ocho valores, cuatro con otro nombre | ver §8.3 |
| `202` con `{interbankTransferId, status: PROCESSING, receivedAt}` | `{depositId, correlationId}` | cuerpo nuevo |
| `200` al repetir la **misma** solicitud, con el estado actual | `202` otra vez | respuesta distinta para el duplicado |
| `409` al repetir el id con contenido distinto | se registraba el conflicto y se avisaba por callback | **`409` sincrónico**, que es más simple y es lo que pide |
| `422` si llega después de `expiresAt` | no existía el concepto | rechazo sincrónico por vencimiento |

### 8.3 Los motivos de rechazo: siete, no ocho

| El contrato | Nosotros | Qué pasa |
| --- | --- | --- |
| `ACCOUNT_NOT_FOUND` | igual | ✓ |
| `ACCOUNT_INACTIVE` | igual | ✓ |
| `AMOUNT_LIMIT_EXCEEDED` | `AMOUNT_EXCEEDS_LIMIT` | **se renombra** |
| `CURRENCY_NOT_SUPPORTED` | `UNSUPPORTED_CURRENCY` | **se renombra** |
| `EXPIRED` | — | **nuevo** |
| `CANCELLED` | — | **nuevo** |
| `PROCESSING_ERROR` | `INVALID_REQUEST` | **se renombra** |
| — | `WRONG_DESTINATION_BANK` | no existe en el contrato: pasa a `PROCESSING_ERROR` |
| — | `BANK_NOT_AUTHORIZED` | no existe: es un `401`, no un motivo de rechazo |
| — | `IDEMPOTENCY_CONFLICT` | no existe: es un `409` sincrónico |

Tres de los nuestros **no son motivos de rechazo en el contrato, son códigos
HTTP**, y eso es más que un renombrado: un banco no autorizado no recibe un
callback explicándole que no lo está — recibe un `401` y se queda sin saber nada
de la transferencia, que es lo correcto.

### 8.4 Lo que el contrato pide y no teníamos ni parecido: el protocolo de TIMEOUT

Nuestro envío esperaba la confirmación **30 segundos** y después compensaba. El
contrato define algo bastante más cuidadoso, y la diferencia importa porque es
donde se pierde dinero:

1. El emisor **reserva** el monto; no lo debita definitivamente.
2. `expiresAt` son **180 s**. Al vencer, la transferencia pasa a `TIMEOUT` y **el
   monto sigue reservado** — nuestra versión ya habría devuelto el dinero aquí.
3. El emisor **consulta** `GET /transfers/{id}`: `ACCEPTED` confirma el débito,
   `REJECTED` o `CANCELLED` liberan, `404` o `PROCESSING` pasan al paso 4.
4. El emisor **cancela** con `POST /transfers/{id}/cancel`: `CANCELLED` libera,
   `ALREADY_ACCEPTED` confirma, `ALREADY_REJECTED` libera.
5. Si el receptor no contesta ni a la consulta ni a la cancelación, sólo se puede
   liberar después de `expiresAt` **+ 300 s**, y **hay que alertar**.
6. Un `ACCEPTED` que llega sobre una transferencia ya liberada es un **incidente
   de nivel ERROR** y se pide la devolución con `POST /reversals`.

El paso 5 es el que no se puede improvisar: **liberar antes del margen es
acreditar dos veces** —el receptor puede haber acreditado y estar reintentando su
callback— y es exactamente el 50 % que §8.3 penaliza. Y el paso 6 es la razón de
que existan los reversos, que es la operación que más fácil se omite por parecer
un caso raro.

### 8.5 Lo implementado

| # | Operación | Estado |
| --- | --- | --- |
| 1 | `POST /transfers` | **hecho** — con el `202`, el `200` del duplicado, el `409` del conflicto y el `422` del vencido |
| 2 | `GET /transfers/{id}` | **hecho** — con el `404` que para el emisor significa «nunca lo recibí» |
| 3 | `POST /transfers/{id}/cancel` | **hecho** — con las tres respuestas y la constancia del depósito que nunca llegó |
| 4 | `POST /transfers/{id}/result` | **hecho** — el callback que exponemos como emisor |
| 5 | `POST /reversals` · `GET /reversals/{id}` | **hecho** — con `original_transfer_id UNIQUE` |
| 6 | `GET /reconciliation?date=` | **hecho** — por banco y día UTC, paginado |
| 7 | `GET /health` | **hecho** — sin autenticación, como el contrato pide |

Y lo transversal:

- **`BANK02`**, y el patrón `^BANK[0-9]{2}$` aplicado en los contratos: los dos
  códigos que el repositorio usaba —`BANK_USAC` y `PARTNER_MOCK`— no cumplían, y
  ningún banco pareja los habría aceptado.
- **El número de cuenta `02-NNNNNNNNN`**, porque un UUID no cabe en 34
  caracteres.
- **`X-Api-Key`, que identifica al banco que llama**, y de eso dependen dos
  reglas del contrato que un token compartido no puede cumplir.
- **El monto como texto**, convertido con aritmética entera en los dos sentidos.
- **`createdAt` y `expiresAt`**, y el **barrido del vencimiento** — el único de
  este servicio que previene una pérdida en vez de recuperarse de una.
- **Los siete motivos de rechazo**, con los tres nuestros que en realidad eran
  códigos HTTP traducidos a `PROCESSING_ERROR`.
- **El cuerpo de error del contrato** en las siete rutas, decidido por la ruta
  porque es una propiedad del canal: el mismo error sale en una forma hacia el
  frontend y en otra hacia el otro banco.

### 8.6 Las siete, contra el clúster

No contra dobles. Las imágenes de esta rama en el clúster local, con
`X-Api-Key` y el banco `BANK99` identificado por ella:

```
GET  /health                              {"status":"UP","bankCode":"BANK02"}                     200
GET  /reconciliation            (sin key) {"code":"UNAUTHORIZED",…}                               401
POST /transfers                 (nuevo)   {"interbankTransferId":"90cac2e1…","status":"PROCESSING",
                                           "receivedAt":"2026-10-16T02:19:49.320Z"}               202
POST /transfers                 (igual)   {…,"status":"PROCESSING","updatedAt":"…49.353Z"}        200
POST /transfers                 (999.00)  {"code":"IDEMPOTENCY_CONFLICT",…}                       409
GET  /transfers/{id}                      {…,"status":"PROCESSING","updatedAt":"…49.353Z"}        200
GET  /transfers/{otro}                    {"code":"NOT_FOUND",…}                                  404
POST /transfers/{id}/cancel               {…,"result":"CANCELLED"}                                200
POST /transfers/{id}/cancel     (otra vez){…,"result":"CANCELLED"}                                200
POST /transfers                 (vencido) {"code":"EXPIRED","message":"El depósito venció antes
                                           de llegar; no se procesa."}                            422
GET  /reconciliation?date=                {"date":"2026-10-16","page":1,"pageSize":3,"totalItems":1,
                                           "items":[{…,"amount":"150.00","status":"CANCELLED"}]}   200
POST /reversals                 (sin orig){"code":"NOT_FOUND",…}                                  404
POST /reversals                 (válido)  {"reversalId":"62536908…","status":"PROCESSING"}         202
GET  /reversals/{id}                      {"reversalId":"62536908…","status":"PROCESSING"}         200
POST /reversals                 (2º igual){"status":"FAILED","reasonMessage":"Ese depósito ya tiene
                                           un reverso (62536908…)."}                              202
```

Cinco cosas en esa tabla que no son el camino feliz:

1. **El cuerpo de error es el del contrato** —`code`, `message`, `timestamp`— y
   no el nuestro. Sin `type`, sin `correlationId`, sin `field`.
2. **`422` y no `400`** para el vencido: la solicitud era sintácticamente
   perfecta y llegó tarde.
3. **El duplicado trae `updatedAt` y el nuevo trae `receivedAt`.** Son dos
   cuerpos distintos del contrato, y la diferencia le dice al emisor si fue
   admitido ahora o si ya lo teníamos.
4. **La conciliación formatea el monto como texto** y refleja el `CANCELLED`
   que la cancelación dejó.
5. **El segundo reverso del mismo depósito falla**, con el identificador del
   primero en el mensaje. Lo impide `original_transfer_id UNIQUE`, no un `if`.

### 8.7 Lo que queda del protocolo de TIMEOUT

El **lado emisor** del protocolo —reserva, consulta, cancelación, margen de
300 s y alerta— es el paso 6 de la lista y es el único que no está. Lo que hay
hoy es lo de T-47: un plazo de 30 s configurable y una compensación directa.
Falta:

1. **`expiresAt` de 180 s** en lugar de los 30 s configurables, y que el
   vencimiento **no libere** la reserva todavía.
2. **La consulta** `GET /transfers/{id}` contra la pareja al vencer.
3. **La cancelación** cuando la consulta da `404` o `PROCESSING`.
4. **El margen de 300 s** antes de liberar si no contesta ninguna de las dos, y
   la **alerta** que el contrato exige en ese caso.
5. **El incidente y el reverso** cuando llega un `ACCEPTED` sobre una
   transferencia ya liberada.

El paso 4 es el que no se puede improvisar: **liberar antes del margen es
acreditar dos veces** —el receptor puede haber acreditado y estar reintentando
su callback— y es el 50 % que §8.3 penaliza. Queda registrado como
[TD-095](../../TECH_DEBT.md) con el detalle, porque es la diferencia entre
cumplir el contrato y cumplir su camino feliz.

### 8.8 La lista de trabajo original

En este orden, porque cada uno habilita al siguiente:

1. **`BANK02` y el número de cuenta** — sin un `AccountNumber` válido no hay
   ninguna operación que pueda completarse.
2. **El prefijo `/interbank/v1`, `X-Api-Key` y el mapa clave → banco.**
3. **`POST /transfers`** con el cuerpo del contrato, `createdAt`/`expiresAt`, el
   `200` del duplicado, el `409` del conflicto y el `422` del vencido.
4. **`POST /transfers/{id}/result`** como lo define el contrato, con la URL
   derivada de la base de la pareja.
5. **`GET /transfers/{id}`** y **`POST /transfers/{id}/cancel`**.
6. **El protocolo de TIMEOUT del emisor**: reserva, 180 s, consulta, cancelación,
   margen de 300 s y alerta.
7. **`POST /reversals` y `GET /reversals/{id}`**.
8. **`GET /reconciliation`**.
9. **`GET /health`** bajo el prefijo, sin autenticación, con `{status, bankCode}`.

Lo acordado con la pareja —URL, claves, formato de cuenta, horario— vive en
[`../../operations/INTERBANK-AGREEMENT.md`](../../operations/INTERBANK-AGREEMENT.md)
y no aquí: esto es el estado del código contra el contrato, y eso es el acuerdo
entre dos equipos.

## 9. Validación del contrato oficial

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 14 de 14 |
| `pnpm typecheck` | 14 de 14 |
| `pnpm --filter @bank/contracts test` | **1 036** — incluidos los 17 que comprueban los esquemas contra los ejemplos del propio archivo del curso |
| `pnpm --filter gateway test` | **439** |
| `RABBITMQ_URL=… pnpm --filter gateway test -- publish-routing` | **50 de 50** contra el broker real (eran 43) |
| `pnpm --filter payment-service test` | **247** |
| `DATABASE_URL=… pnpm --filter payment-service test` | **322, 0 omitidos** |
| `pnpm test:pyramid` | sin desviaciones por paquete; quedan las dos de sistema que ya estaban en `HEAD` |
| las siete rutas contra el clúster | §8.6 |

**Los siete casos nuevos de `publish-routing.integration.spec.ts` son los que
importan**, y no por el número: esa suite publica contra un **broker real** y
comprueba el exchange y la routing key de cada ruta. Las siete operaciones se
desplegaron devolviendo `500` porque sus doce contratos no estaban en el
catálogo, y las 25 pruebas del controlador pasaban porque **el arnés dobla el
publicador** — a un doble el catálogo le da igual. Añadirlas aquí es cerrar el
hueco por el que entró el defecto, no subir una cifra.

El guardián de la pirámide también pidió 28 casos unitarios en `payment-service`
para reequilibrar los 15 de integración. Se añadieron **12**, los que cubren
camino real que estaba sin probar: la consulta de un depósito ajeno, la
paginación que el contrato pide repetir, el formateo del mínimo y el máximo, el
reverso de otro banco, y las tres carreras del barrido. No se añadieron 28:
inflar una suite para satisfacer una proporción es exactamente lo que vacía de
sentido a la proporción.

## 10. Lo que queda abierto

- **El alcance 2 entero**: comparar contra el OpenAPI oficial y la prueba de
  contrato contra ese archivo. Depende de T-55 (#152).
- **Los nombres de campo siguen siendo una propuesta.** `interbankTransferId`,
  `accountId`, `amountMinor`, `timestamp`: ninguno está acordado con nadie.
  Cuando llegue el contrato, **manda el contrato**.
- **`INTERBANK_SEND_URL` apuntando al banco correcto no se valida**, sólo que
  venga de configuración
  ([ADR-019](../../architecture/adr/ADR-019-payment-http-egress.md),
  *Consequences*).
