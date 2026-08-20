# Contrato: el sobre de mensaje

**Vinculante.** Todo mensaje del sistema viaja dentro de esta estructura, sin excepción. Un
mensaje que no la cumple es inválido y va a la cola de errores sin ejecutar lógica de dominio.

## Forma

```json
{
  "messageId": "0f4b1d3a-9c2e-4a71-b8f5-2d6e7c0a1b93",
  "messageType": "account.debit.requested.v1",
  "messageVersion": 1,
  "producer": "transaction-service",
  "correlationId": "7c1a5e28-3b4f-4d90-a6e2-1f8b0c3d5a47",
  "causationId": "b2e9f047-5d18-4c63-9a7e-0c4d2f6b8a15",
  "idempotencyKey": "transfer-2026-08-19-4471",
  "occurredAt": "2026-08-19T14:32:07.482Z",
  "identity": { "customerId": "3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60", "role": "CLIENTE" },
  "payload": {}
}
```

## Reglas por campo

| Campo | Validación | Rechazo si |
| --- | --- | --- |
| `messageId` | UUID v4 | Ausente, malformado o repetido en el mismo flujo |
| `messageType` | `^[a-z][a-z0-9.-]*\.v[0-9]+$` | No termina en sufijo de versión |
| `messageVersion` | Entero ≥ 1 | **No coincide con el sufijo de `messageType`** |
| `producer` | `gateway` \| `customer-service` \| `account-service` \| `transaction-service` \| `payment-service` \| `notification-audit-service` | Fuera del conjunto |
| `correlationId` | UUID v4 | Ausente |
| `causationId` | UUID v4 o `null` | Ausente (`null` es un valor, no una ausencia) |
| `idempotencyKey` | String 1–128 | Vacía |
| `occurredAt` | ISO-8601 con zona UTC | Sin zona, o no parseable |
| `identity` | `{customerId, role}` o `null` | Rol fuera de los tres del enunciado |
| `payload` | Objeto conforme al contrato de `messageType` | Cualquier desviación |

## Prohibiciones

El sobre **nunca** transporta: contraseña, token de sesión, firma, secreto de firma, bytes de
imagen, ni el token de activación por correo fuera de su mensaje directo.

## Propagación

| Campo | Al iniciar un flujo | Al reaccionar a un mensaje |
| --- | --- | --- |
| `correlationId` | Se genera | **Se copia tal cual** |
| `causationId` | `null` | `messageId` del mensaje que se está manejando |
| `identity` | La que el Gateway verificó | Se copia tal cual |
| `idempotencyKey` | La del cliente, o se genera | Se deriva de forma determinista |

Regenerar el `correlationId` en un paso intermedio rompe la trazabilidad completa del flujo y
es el defecto más caro de esta feature, porque no falla: sólo hace la Saga irreconstruible.

## Supuesto de confianza, declarado

`identity` es fiable **únicamente** porque ningún productor publica al broker sin haber pasado
por el Gateway, que es el único que firma y valida el JWT (ADR-010). Si algún día un
componente publica sin ese paso, este contrato deja de garantizar nada sobre la identidad.
