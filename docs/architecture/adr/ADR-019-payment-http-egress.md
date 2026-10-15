# ADR-019: Ningún servicio llama a otro por HTTP, y las dos salidas HTTP que existen van a terceros

- **Status**: Accepted
- **Date**: 2026-10-15
- **Deciders**: Bank USAC team
- **Assignment reference**: Fase III (`docs/references/780_Proyecto_3_2S2026.pdf`), §4.1
  — "Payment Service envía la solicitud al API Gateway del banco pareja" y "Propagar el
  `traceparent` hacia y desde el banco pareja"; §4.2 — la comunicación entre microservicios
  propios es 100 % asíncrona por el broker; §8.2 criterio 1.4 (justificación de decisiones);
  §8.3 — "Comunicación sincrónica entre microservicios" penalizada.
- **Ticket**: T-59 (#156), para una decisión tomada en T-46 (#133) y ampliada en T-47 (#160)

## Context

La regla de comunicación de este sistema es ADR-003: los servicios se hablan por el broker, con
eventos para lo que ya pasó y `request/reply` para lo que hay que preguntar. No hay un cliente
HTTP entre servicios y no debe haberlo: el enunciado penaliza la comunicación sincrónica entre
microservicios en §8.3, y una llamada directa reintroduce el acoplamiento temporal que la Saga
existe para evitar — si A llama a B por HTTP, A no puede terminar cuando B está caído.

T-46 abrió una grieta en esa regla porque el enunciado la exige: el depósito interbancario
**sale** de Payment Service hacia el Gateway de **otro banco**, por HTTP, y su respuesta vuelve
por un callback. No hay broker compartido con el otro grupo, y no puede haberlo.

La pregunta que este ADR responde no es «¿se permite HTTP?». Es **«cómo se distingue una
salida legítima hacia un tercero de la llamada entre servicios que está prohibida, de forma que
la diferencia la compruebe una máquina y no una revisión»**.

## Decision

### 1. La regla, escrita como se cumple

> Ningún servicio de este sistema llama a otro servicio de este sistema por HTTP.

No «ningún servicio hace HTTP». La distinción importa porque el sistema tiene **dos** salidas
HTTP y ninguna de las dos va a un servicio propio:

| Salida | Servicio | Archivo único | Destino |
| --- | --- | --- | --- |
| el depósito interbancario y su callback | `payment-service` | `src/infrastructure/http/partner-callback.ts` | el Gateway del banco pareja |
| el correo transaccional | `notification-audit-service` | `src/infrastructure/notification/resend-notification.adapter.ts` | la API de Resend |

**El ticket que pidió este ADR lo planteaba como «por qué Payment, y sólo Payment, habla HTTP».
No es exacto**, y conviene que quede dicho: el adaptador de correo esquivaba la expresión que
busca el `fetch` global porque lo recibe inyectado (`this.#fetch`), así que la prueba de
aislamiento de Payment nunca lo vio — pero la de Notification & Audit sí, y lo acota igual de
estrecho. Son dos excepciones con la misma forma, no una.

Lo que **ninguna** de las dos es: una llamada a un `*-service`. El Gateway tampoco hace HTTP
hacia dentro — su `identity-document.use-case.ts` tiene un método **llamado** `fetch` que por
debajo es `askAndWait` sobre el broker, que es la trampa de lectura que esta sección existe para
desactivar.

### 2. Por qué la salida va en Payment y no en el Gateway

El enunciado lo fija en §4.1 («Payment Service envía la solicitud al API Gateway del banco
pareja»), pero coincide con lo que el diseño querría de todos modos:

- **La decisión de pagar ya vive ahí.** Payment tiene la escalera de reintentos, el plazo de
  confirmación como columna y la máquina de estados del depósito. Mover la salida al Gateway
  partiría una decisión en dos procesos: uno que sabe cuándo reintentar y otro que sabe hablar.
- **El Gateway no tiene estado y no debe tenerlo.** Un depósito que espera 30 segundos a una
  confirmación que puede no llegar necesita una fila; el Gateway no tiene base de datos (ADR-008)
  y no va a tenerla.
- **La asimetría es del enunciado, no nuestra.** La salida sale de Payment; la **entrada** —el
  depósito que el otro banco nos manda y su callback— entra por el **Gateway** (§4.2). Por eso
  los controladores de Payment siguen siendo exactamente dos, `health` y `ready`: el callback
  del otro banco no llega a Payment por HTTP, llega al Gateway y de ahí al broker.

### 3. Por qué la excepción es segura

Tres propiedades, y las tres son comprobables:

1. **El destino sale de la configuración, nunca de un mensaje.** Las dos llamadas del adaptador
   son `fetch(this.endpoint, …)`, y `this.endpoint` viene de `INTERBANK_SEND_URL` o
   `INTERBANK_CALLBACK_URL`. Un `fetch(payload.callbackUrl)` sería un banco al que cualquiera le
   dice a dónde mandar el dinero.
2. **`redirect: 'error'`.** Un `302` del otro banco no se sigue. Seguir un redirect es dejar que
   el destino configurado se convierta en otro en tiempo de ejecución, que es la misma debilidad
   del punto 1 por la puerta de atrás.
3. **Tiempo límite explícito**, `AbortSignal.timeout(5_000)`, y el fallo se devuelve como
   ausencia de acuse en vez de propagarse: si lanzara, el comando se reencolaría y el broker
   decidiría el reintento cuando la escalera de ese depósito ya está en su columna
   `next_attempt_at`. Dos mecanismos de reintento sobre el mismo dinero es como se acredita dos
   veces.

Y una cuarta que no es del adaptador sino del flujo: **la cuenta de destino se valida por
`request/reply` con Account a través del broker**, no leyendo su tabla ni llamándola por HTTP. Un
depósito a una cuenta inexistente vuelve `REJECTED` con `ACCOUNT_NOT_FOUND` porque Account lo
dijo, y eso viaja por donde viaja todo lo demás.

### 4. Cómo se hace cumplir

`apps/services/payment-service/test/isolation.spec.ts`, en la prueba *«makes HTTP calls only
through the fixed partner-bank callback adapter»*:

```ts
// En todos los archivos menos el adaptador: ni fetch global, ni librerías.
expect(source.text).not.toMatch(/(?<![.#\w])fetch\(|axios|node-fetch|HttpService/);

// Y en el adaptador, TODAS las llamadas apuntan a configuración:
const llamadas = adapter?.text.match(/(?<![.#\w])fetch\(/g) ?? [];
const configuradas = adapter?.text.match(/(?<![.#\w])fetch\(this\.[A-Za-z]+/g) ?? [];
expect(llamadas).toHaveLength(2);
expect(configuradas).toHaveLength(llamadas.length);
```

Tres detalles del predicado que son la decisión y no el estilo:

- **`(?<![.#\w])`** antes de `fetch(` para no confundir un método privado del propio servicio
  —o un `.fetch(` de un SDK— con el global. Es lo que permite que el Gateway tenga un método
  `fetch` sobre el broker sin que nadie lo confunda con una llamada HTTP.
- **`toHaveLength(2)` y no `toBeGreaterThan(0)`.** T-46 dejó una salida y bastaba comprobar que
  existía; T-47 añadió la segunda y con dos la pregunta deja de ser «¿hay una salida fija?» y
  pasa a ser **«¿son fijas todas?»**. Con la comprobación anterior, un `fetch` nuevo con destino
  arbitrario habría pasado mientras el primero siguiera correcto.
- **El número está fijado a mano, a propósito.** Añadir una tercera llamada rompe la prueba, que
  es exactamente lo que debe pasar: obliga a volver a este ADR en vez de ampliar la grieta en
  silencio.

Más la prueba *«exposes HTTP for health and readiness only»*, que fija los controladores de
Payment en uno y sus rutas en dos. Es la mitad que suele olvidarse: una excepción de **salida**
no autoriza una **entrada**.

`notification-audit-service/test/isolation.spec.ts` hace lo equivalente para el correo —una sola
llamada, desde un solo archivo, y comprobando que el destino no contiene `customer|account|
payment|transaction-service`.

### 5. Qué rompería esto

| Cambio | Qué prueba lo detiene |
| --- | --- |
| un `fetch(` en cualquier archivo de Payment que no sea el adaptador | *makes HTTP calls only through…* |
| un `fetch(algoQueNoEsThis.x)` dentro del adaptador | el conteo de `configuradas` vs `llamadas` |
| una tercera llamada HTTP, incluso legítima | `toHaveLength(2)` |
| un `@Controller` nuevo en Payment, o una ruta de negocio | *exposes HTTP for health and readiness only* |
| `axios`, `node-fetch` o `HttpService` en cualquier sitio | la misma expresión |
| quitar `redirect: 'error'` | `expect(adapter?.text).toMatch(/redirect: 'error'/)` |

## Alternatives considered

### Un servicio pasarela nuevo, sólo para la salida

Un `interbank-gateway-service` que fuera el único con permiso de HTTP, y que Payment le pidiera
el envío por el broker.

Descartada. Añade un proceso, una imagen, un chart, una sonda y un salto de red para **mover de
sitio** la misma excepción, sin eliminarla: ese servicio seguiría hablando HTTP con el otro banco
y seguiría necesitando una prueba que acote su destino. Y empeora lo que importa: el plazo de
confirmación y la escalera de reintentos viven en la fila de Payment, así que la pasarela sería un
servicio sin estado al que Payment tendría que preguntarle «¿ya contestaron?» — o un servicio con
estado, y entonces hay dos sitios que creen saber en qué estado está un depósito. El enunciado
además dice explícitamente que la salida sale de Payment.

### Sacar la llamada al Gateway

El Gateway ya habla HTTP con el mundo, así que la salida interbancaria cabría ahí sin excepción
nueva.

Descartada por §4.2 y por ADR-008: el Gateway **no tiene `domain/` y nunca lo tendrá**, no tiene
base de datos, y un depósito que espera una confirmación durante 30 segundos necesita las dos
cosas. También rompería la simetría del enunciado, que pone la salida en Payment y la entrada en
el Gateway a propósito: el Gateway es el borde para quien **nos** llama.

### Permitir HTTP entre servicios para «consultar» y prohibirlo para «ordenar»

La tentación habitual: una lectura síncrona parece inofensiva.

Descartada. Es exactamente lo que §8.3 penaliza, y la razón técnica es la misma que la de la
Saga: una lectura síncrona acopla la disponibilidad de quien pregunta a la de quien responde. Lo
que este sistema usa en su lugar es `request/reply` sobre el broker, con techo de cinco
segundos — y el techo es la parte que lo hace distinto de HTTP, no el transporte.

## Consequences

- **Lo bueno**: la regla es una línea («ningún servicio llama a otro por HTTP») y su cumplimiento
  es automático, no una convención. Las dos excepciones están en dos archivos nombrados, con el
  destino en configuración, y ampliarlas exige romper una prueba a propósito.
- **El coste**: el número `2` del predicado es frágil por diseño. Una tercera salida legítima
  —un segundo banco pareja, otro proveedor— rompe la prueba y obliga a actualizar este ADR. Es
  el precio de que no se pueda ampliar sin darse cuenta.
- **La deuda que queda**: la prueba comprueba la **forma** del destino (viene de `this.x`), no su
  **valor**. Que `INTERBANK_SEND_URL` apunte al banco pareja y no a un servicio propio es una
  propiedad del despliegue, y hoy nada la valida. T-51 encontró el caso contrario —la variable
  **vacía**, que apaga el envío en silencio— y lo arregló en el chart; un valor *equivocado*
  seguiría pasando.
- **Lo que esto habilita**: el `traceparent` cruza el límite HTTP en las dos direcciones, así que
  un depósito tiene **el mismo `traceId`** en los dos bancos, que es lo que §4.1 pide. Con el
  broker eso sería automático; aquí es el adaptador el que lo pone a mano, y es la razón por la
  que la propagación vive en el mismo archivo que la excepción.
