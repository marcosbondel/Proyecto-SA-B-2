# The message envelope

Every message in the system travels inside this structure. A message that does not conform is
invalid: it is rejected before any domain logic runs and it never reaches a handler.

The executable definition is [`envelope.ts`](../../apps/packages/contracts/src/envelope.ts) and
its schema is [`envelope.schema.ts`](../../apps/packages/contracts/src/schemas/envelope.schema.ts).
This document explains the reasoning; the code is the contract.

## Shape

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

## Fields

| Field | Rule | Rejected when |
| --- | --- | --- |
| `messageId` | UUID v4, unique per message | Absent or malformed |
| `messageType` | Name plus version suffix; also the routing key | It does not end in `.vN` |
| `messageVersion` | Integer ≥ 1 | **It disagrees with the suffix of `messageType`** |
| `producer` | One of the seven applications | Outside the closed set |
| `correlationId` | UUID v4, set once per flow | Absent |
| `causationId` | UUID v4 or `null` | Absent — `null` is a value, not an omission |
| `idempotencyKey` | 1–128 characters | Empty |
| `occurredAt` | ISO-8601 with UTC designator | No zone, or unparseable |
| `identity` | `{customerId, role}` or `null` | Role outside the three the assignment defines |
| `payload` | Conforms to the contract named by `messageType` | Any deviation |

## Why the version is written twice

`messageType` carries it because the routing key carries it: a consumer bound to
`account.debited.v1` never receives `account.debited.v2`. Migration is a change of binding, not
an `if` inside a handler.

`messageVersion` carries it because a consumer that does receive an unexpected version should
reject it explicitly rather than half-interpret it.

The redundancy only buys anything if disagreeing is an error, so it is one: a mismatch between
the suffix and the field makes the message invalid.

## Traceability

| Field | Starting a flow | Reacting to a message |
| --- | --- | --- |
| `correlationId` | Generated | **Copied unchanged** |
| `causationId` | `null` | The `messageId` being handled |
| `identity` | The one the Gateway verified | Copied unchanged |
| `idempotencyKey` | The client's, or generated | Derived deterministically |

Regenerating `correlationId` at an intermediate step is the most expensive defect this contract
can suffer, because nothing fails: the flow simply stops being reconstructible.

`followUpEnvelope` exists so that no service has to remember these rules by hand.

## Identity

`identity` carries the customer and role that the Gateway **already verified**. The Gateway is
the only component that signs and validates the session token (ADR-010); by the time a message
reaches the broker the token is gone.

It is `null` for work nobody originated — the automatic deactivation of an idle account has no
user behind it.

**The trust assumption, stated rather than implied**: this is safe only while no producer
publishes to the broker without having passed through the Gateway. If that ever stops being
true, the envelope guarantees nothing about identity.

## What never travels here

Passwords, session tokens, signing secrets, activation tokens and image bytes. The credential
and the activation token appear in exactly one message each, in the payload, and are named in
[`catalog.md`](catalog.md); they never reach the envelope, a log, or an audit event.

## Serialization

UTF-8 JSON, published with `contentType: application/json` and `persistent: true`. The AMQP
properties `messageId`, `correlationId`, `type` and `timestamp` mirror envelope fields so the
broker's management UI is readable without decoding the body.
