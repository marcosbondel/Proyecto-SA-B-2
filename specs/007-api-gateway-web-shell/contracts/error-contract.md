# Contrato de errores

**Fase 1** · 2026-08-24 · [plan.md](../plan.md)

Una sola forma para todas las maneras de fallar. Siete códigos: los **cinco**
que FR-027 nombra, más los dos de la frontera de autenticación, que FR-041d
obliga a distinguir de un rechazo de negocio.

---

## La forma

```json
{
  "type": "BUSINESS_REJECTION",
  "message": "La cuenta origen no tiene saldo suficiente.",
  "correlationId": "6f1c…",
  "failureCode": "INSUFFICIENT_FUNDS",
  "field": null
}
```

| Campo | Presente |
| --- | --- |
| `type` | siempre |
| `message` | siempre — apto para mostrar a una persona |
| `correlationId` | **siempre, también aquí** (FR-019) |
| `failureCode` | solo en `BUSINESS_REJECTION` — el código del catálogo, intacto (FR-030) |
| `field` | solo en `VALIDATION_ERROR` |

### Lo que ninguna respuesta de error lleva jamás

Rastro de pila · cadena de conexión · credencial · nombre de servicio interno ·
nombre del bucket · punto final del broker · el nombre del host (FR-028).

---

## Los siete códigos

| `type` | HTTP | Significa | ¿Se publicó algo? |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | `400` | La petición no cumple la forma declarada | **No** |
| `UNAUTHENTICATED` | `401` | Token ausente, mal firmado o caducado | **No** |
| `FORBIDDEN` | `403` | Token válido, rol no autorizado por D-06 | **No** |
| `BUSINESS_REJECTION` | ver tabla | Un servicio dijo que no | Sí, y respondió |
| `REPLY_TIMEOUT` | `504` | Nadie contestó en 5 s | Sí. **La operación no fue cancelada** |
| `BROKER_UNAVAILABLE` | `503` | No se pudo publicar | No |
| `INTERNAL_ERROR` | `500` | Cualquier otra cosa | Indeterminado |

Los tres primeros comparten una propiedad que SC-004 mide: **no publican nada**.
Cero mensajes espurios en toda la batería negativa.

### `REPLY_TIMEOUT` dice más que los demás

Su `message` debe declarar explícitamente que la operación **no fue cancelada** y
que su resultado se puede consultar por `correlationId` (FR-026, FR-015d). No
hay mensaje de cancelación en el catálogo de T-05: el vencimiento significa que
el Gateway dejó de esperar, no que algo se deshizo.

El prototipo de diseño ya trae esta copia escrita para una persona y se porta
tal cual:

> *"La operación sigue en el sistema pero no recibimos confirmación en el tiempo
> esperado. No asumas que falló: guarda el transactionId y actualiza el estado.
> Reintentar es seguro, la operación es idempotente y no se duplica."*

### `BROKER_UNAVAILABLE` no existe en el prototipo

Es el quinto estado que `bonking.dc.html` no dibuja. Se compone en su mismo
idioma —familia ámbar `#B4740A` / `#7A4F06`, la del vencimiento— con copia
propia: el sistema no pudo aceptar la solicitud, no se hizo nada, y reintentar es
seguro. Queda registrado como adición intencional en la evidencia.

Además, siempre deja un **registro correlacionado** en el log del Gateway
(FR-029). Es lo que hace verificable el criterio 3 del ticket.

---

## `BUSINESS_REJECTION` → HTTP

Una **tabla de datos**, no una cadena de condicionales. La diferencia no es
estilística: es la línea entre traducir un veredicto ajeno y tomar uno propio, y
es donde se pierde el criterio 2.4 del enunciado sin darse cuenta (R5).

| `failureCode` | HTTP |
| --- | --- |
| `ACCOUNT_NOT_FOUND` | `404` |
| `IDENTITY_OBJECT_NOT_FOUND` | `404` |
| `DOCUMENT_ALREADY_REGISTERED` | `409` |
| `EMAIL_ALREADY_REGISTERED` | `409` |
| `IDEMPOTENCY_KEY_CONFLICT` | `409` |
| `ACTIVATION_TOKEN_INVALID` | `409` |
| `ACTIVATION_TOKEN_EXPIRED` | `409` |
| `ILLEGAL_TRANSITION` | `409` |
| `ACCOUNT_INACTIVE` | `409` |
| `INVALID_BIRTH_DATE` | `422` |
| `ROLE_NOT_ELIGIBLE` | `422` |
| `INVALID_AMOUNT` | `422` |
| `INVALID_AMOUNT_PRECISION` | `422` |
| `SAME_ACCOUNT_TRANSFER` | `422` |
| `INSUFFICIENT_FUNDS` | `422` |
| `IDENTITY_DOCUMENT_UNREADABLE` | `422` |
| `IDENTITY_DIGEST_MISMATCH` | `422` |
| `PAYMENT_DECLINED` | `422` |
| `PAYMENT_RETRIES_EXHAUSTED` | `422` |
| `INVALID_CREDENTIALS` | `401`, y con el rechazo genérico de inicio de sesión |

Son los veinte valores de `failureCode` en
`apps/packages/contracts/src/schemas/primitives.ts`. **Ni uno más ni uno menos.**

**Prueba obligatoria**: una que recorra el enum y falle si algún valor no está en
la tabla. Sin ella, un código nuevo cae en el genérico y nadie se entera — que es
exactamente cómo esta tabla se pudre.

---

## Lo que el frontend hace con cada uno

`useGatewayApi` normaliza los siete. `SharedAsyncStateAlert` pinta **cinco
estados**: pendiente, éxito, rechazo de negocio, vencimiento e indisponibilidad
del broker.

`UNAUTHENTICATED` y `FORBIDDEN` **no llegan al componente**: los atiende la capa
de sesión. El primero descarta la sesión y lleva a `/login` (FR-041d); el segundo
no debería ocurrir, porque la navegación ya ocultó la ruta — y si ocurre, es
señal de que el filtrado del frontend y la matriz del Gateway se desincronizaron.

Un `type` desconocido se normaliza a `INTERNAL_ERROR`. Un frontend que se rompe
ante un código que no conoce es peor que uno que dice "algo falló".
