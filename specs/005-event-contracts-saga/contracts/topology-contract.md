# Contrato: topología del broker

**Vinculante para T-06**, que escribe el Compose, y para `@bank/messaging`, que declara los
objetos en el arranque de cada aplicación.

## Exchanges

Cuatro, `topic`, `durable`, sin auto-borrado.

| Exchange | Contenido | Publica |
| --- | --- | --- |
| `bank.commands` | 15 comandos y solicitudes | Gateway, Transaction |
| `bank.events` | 22 eventos | Los cinco servicios |
| `bank.replies` | 4 respuestas | Customer, Account, Transaction, Audit |
| `bank.errors` | Agotados e inválidos | Cualquier consumidor |

## Routing keys

**La routing key es el `messageType` literal.** Sin traducción ni tabla. Un mensaje
`account.debited.v1` se publica con la clave `account.debited.v1`.

Consecuencia buscada: un consumidor enlazado a `account.debited.v1` **nunca** recibe
`account.debited.v2`. La migración de versión es un cambio de binding, no un `if` dentro del
consumidor.

## Colas de trabajo

Siete consumidores lógicos, siete colas, `durable`. Ninguna compartida entre servicios.

| Cola | Bindings |
| --- | --- |
| `customer.commands` | `customer.*.v1` sobre `bank.commands` |
| `account.commands` | `account.*.v1` sobre `bank.commands` |
| `transaction.commands` | `transfer.requested.v1`, `transaction.status.requested.v1` sobre `bank.commands` |
| `transaction.saga` | Los 7 eventos de la Saga sobre `bank.events` |
| `payment.commands` | `payment.requested.v1` sobre `bank.commands` |
| `audit.all` | `#` sobre `bank.events`; `audit.query.requested.v1` sobre `bank.commands` |
| `gateway.replies.<instancia>` | `#` sobre `bank.replies`; **exclusiva y autoborrable** |

La cola del Gateway es exclusiva por instancia a propósito: una cola compartida repartiría las
respuestas entre réplicas y una respuesta llegaría a quien no preguntó. Ver
[R7](../research.md#r7).

## Reintentos y errores

Por cada cola de trabajo `Q`:

| Cola | Argumentos |
| --- | --- |
| `Q.retry.1s` | `x-message-ttl: 1000`, `x-dead-letter-exchange: ""`, `x-dead-letter-routing-key: Q` |
| `Q.retry.5s` | `x-message-ttl: 5000`, idem |
| `Q.retry.30s` | `x-message-ttl: 30000`, idem |
| `Q.dlq` | Sin TTL, sin dead-letter. Terminal |

El mensaje vuelve **a `Q`**, no al exchange. Reencolar en el exchange reentregaría el mensaje a
todos los consumidores del evento, incluidos los que ya lo procesaron bien.

### Cabeceras en la DLQ

| Cabecera | Contenido |
| --- | --- |
| `x-attempt` | Número del último intento |
| `x-failure-reason` | Causa legible, sin datos sensibles |
| `x-failed-at` | ISO-8601 |
| `x-original-routing-key` | La clave con la que se publicó |

`correlationId` viaja ya en el sobre y en la propiedad AMQP homónima.

## Propiedades de publicación

Las que `broker.ts` ya fija y que este contrato ratifica: `persistent: true`,
`contentType: 'application/json'`, `messageId`, `correlationId`, `type` = `messageType`,
`timestamp`. Se añade `replyTo` en las cuatro solicitudes que esperan respuesta.

## Lo que la topología no decide

Réplicas, política de memoria, usuarios y permisos del broker, y el `RABBITMQ_URL` de cada
aplicación son de **T-06**. Este contrato fija los nombres y los argumentos, no el despliegue.
