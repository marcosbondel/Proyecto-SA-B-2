# Evidencia contra infraestructura real (T-06)

**T-15** · 2026-08-24 · RabbitMQ 4.3.4 y MinIO levantados con
`docker compose up -d rabbitmq minio minio-init`, Gateway ejecutándose desde
`dist/`.

Todo lo de abajo es salida real, no simulada. Dos defectos aparecieron aquí que
ninguna prueba con dobles podía encontrar; están al final.

## La cola de respuestas del Gateway, como la ve el broker

```
gateway.replies.gw-local-1
  durable=False  exclusive=True  auto_delete=True

ligaduras:
  bank.events   <- customer.email.verification.rejected.v1
  bank.events   <- customer.email.verified.v1
  bank.replies  <- #

colas de reintento o DLQ para gateway.*:  ninguna
```

Exactamente lo que R1 y R2 diseñaron: efímera, exclusiva por réplica, sin
escalera —reintentar una respuesta encuentra al mismo ausente— y escuchando los
dos eventos de activación además de las cuatro respuestas del catálogo.

## Los cuatro comandos, observados en `bank.commands`

| Ruta | `routing_key` | `identity` en el sobre | Tamaño |
| --- | --- | --- | --- |
| `POST /api/customers` | `customer.register.v1` | `null` — ruta pública | 758 B |
| `POST /api/accounts` | `account.create.v1` | del token | 525 B |
| `POST /api/transfers` | `transfer.requested.v1` | del token | 621 B |
| `PATCH /api/customers/:id` | `customer.update.v1` | del token | 480 B |

Nombres exactos del catálogo de T-05, `producer=gateway`, `messageVersion=1`.

**El `correlationId` se conservó.** El registro se envió con
`X-Correlation-Id: 6f1c8a30-…` y el mensaje lo lleva idéntico.

**La clave de idempotencia viajó sin reinterpretarse.** Se envió
`Idempotency-Key: demo-intent-001` y el sobre lleva `demo-intent-001`, no un
UUID. Las rutas sin cabecera recibieron uno generado.

**`paymentScenario: APPROVE` viajó intacto** en `transfer.requested.v1`, y el
Gateway se comportó igual que sin él.

## La foto: referencia en el broker, bytes en MinIO

El mensaje de registro pesa **758 bytes** y lleva:

```json
"photo": {
  "objectKey": "a41188cd-4d6d-4f0d-8f70-881ec678adc1.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 2052,
  "sha256": "85dd8f7d16f5857fd6c27f4c8b70a659eaea277f0ef56e5df8312e81f1e33d4a"
}
```

La cadena de integridad de ADR-012, verificada de punta a punta:

```
SHA-256 del archivo original enviado : 85dd8f7d…33d4a
SHA-256 publicado en el mensaje      : 85dd8f7d…33d4a
SHA-256 del objeto bajado de MinIO   : 85dd8f7d…33d4a
tamaños: 2052 / 2052 / 2052
```

**El usuario de aplicación no puede listar el bucket** — `mc ls` con sus
credenciales sale vacío, y con las de root muestra los dos objetos. Es
privilegio mínimo funcionando: el Gateway solo necesita escribir.

## Los cinco modos de fallo, provocados de verdad

| Provocación | Resultado |
| --- | --- |
| `sourceAccount: "nope"`, monto 0 | `400 VALIDATION_ERROR`, `field: "sourceAccount"` |
| Sin `Authorization` | `401 UNAUTHENTICATED` |
| Token de `CLIENTE` contra `/api/audit` | `403 FORBIDDEN` |
| Consulta de saldo sin respondedor | `504 REPLY_TIMEOUT` — **esperó 5 s exactos** |
| `docker compose stop rabbitmq` | `503 BROKER_UNAVAILABLE` |

El vencimiento del plazo dice literalmente *"La operación NO fue cancelada:
consulta su resultado con el identificador de correlación."*

El broker caído dejó **log correlacionado** (FR-029):

```
[aaaa1111-9c2e-4a71-b8f5-2d6e7c0a1b93] BROKER_UNAVAILABLE: El sistema no pudo aceptar la solicitud…
```

Y mientras estuvo caído: `/health` siguió respondiendo `200`, `/ready` pasó a
`503`, y una petición malformada siguió siendo `400` y no `503` — porque la
validación ocurre antes de publicar.

## Recuperación sin reiniciar

Tras `docker compose start rabbitmq`, sin tocar el proceso del Gateway:

```
/ready               -> 200 {"broker":"connected"}
POST /api/accounts   -> 202
gateway.replies.gw-local-1  consumers=1
```

La cola exclusiva se volvió a declarar sola.

---

## Dos defectos que solo apareció aquí

Ambos estaban ocultos porque las pruebas unitarias usan un publicador falso que
**rechaza**, mientras que el adaptador real **no rechazaba**.

### 1. Una escritura con el broker caído se colgaba para siempre

`amqp-connection-manager` no rechaza un `publish` cuando la conexión está
caída: lo **encola** y lo resuelve cuando el broker vuelva. Para quien tiene una
conexión HTTP abierta eso es esperar indefinidamente, no recibir un `503`.

La primera medición se cortó a los 5 minutos sin respuesta.

**Corregido** en `apps/packages/messaging/src/broker.ts`: `publish` lleva ahora
`timeout`, con un tope por defecto de 5 s. Medido después: `503` en 5 s.

### 2. El Gateway no arrancaba con el broker caído

`waitForConnect()` tampoco vence: espera mientras el gestor reintenta. Un
`await` directo significaba que el proceso nunca terminaba de arrancar y nunca
abría su puerto — de modo que el único endpoint capaz de explicar la caída era
el que nadie podía alcanzar, y un orquestador vería un contenedor que falló al
iniciar en vez de uno que se reporta no listo.

El comentario que yo mismo había escrito en `main.ts` afirmaba lo contrario.

**Corregido**: la espera de arranque está acotada a 10 s. Verificado con
RabbitMQ apagado:

```
WARN  broker not reachable at boot; serving health and refusing writes until it returns
LOG   gateway listening on port 3000
```
