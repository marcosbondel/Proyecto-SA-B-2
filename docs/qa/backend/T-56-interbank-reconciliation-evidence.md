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

## 8. Lo que queda abierto

- **El alcance 2 entero**: comparar contra el OpenAPI oficial y la prueba de
  contrato contra ese archivo. Depende de T-55 (#152).
- **Los nombres de campo siguen siendo una propuesta.** `interbankTransferId`,
  `accountId`, `amountMinor`, `timestamp`: ninguno está acordado con nadie.
  Cuando llegue el contrato, **manda el contrato**.
- **`INTERBANK_SEND_URL` apuntando al banco correcto no se valida**, sólo que
  venga de configuración
  ([ADR-019](../../architecture/adr/ADR-019-payment-http-egress.md),
  *Consequences*).
