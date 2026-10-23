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
| `idempotencyKey` | Caller key when supplied; otherwise generated messageId | Explicitly supplied by caller when business identity must remain stable; otherwise each new follow-up gets its new messageId |

Regenerating `correlationId` at an intermediate step is the most expensive defect this contract
can suffer, because nothing fails: the flow simply stops being reconstructible.

`followUpEnvelope` exists so that no service has to remember these rules by hand.

## Identity

`identity` carries the customer and role that the Gateway **already verified**. The Gateway is
the only component that signs and validates the session token (ADR-010); by the time a message
reaches the broker the token is gone.

It is `null` for work nobody originated — the automatic deactivation of an idle account has no
user behind it.

**Trust boundary:** authenticated external requests enter through Gateway, but internal services also publish follow-ups and system work. The broker credential/publisher boundary must therefore remain trusted. The envelope is not independently signed and a compromised authorized publisher could forge identity; it is not per-service JWT validation.

## What never travels here

Session JWTs, signing secrets and image bytes do not belong to envelope metadata. Plaintext credentials and activation/recovery tokens appear in the specific payloads needed to register, authenticate, deliver or replace a credential; they are not limited to one catalogue message in the implemented system. They must never be logged, echoed into unrelated replies or persisted in the audit payload. Customer retains digests/hashes; the notification channel handles delivery. See [data ownership](../domain/bounded-contexts.md).

## Serialization

UTF-8 JSON, published with `contentType: application/json` and `persistent: true`. The AMQP
properties `messageId`, `correlationId`, `type` and `timestamp` mirror envelope fields so the
broker's management UI is readable without decoding the body.


## W3C context is transport metadata

`correlationId` is a business flow identifier, not an OpenTelemetry traceId. W3C `traceparent` travels in HTTP/AMQP headers, with PRODUCER injection and CONSUMER extraction in `@bank/messaging`; it is not an extra mandatory field of the JSON envelope. The two identifiers remain distinct even when they identify the same operation in the operator's view.

Deferred work persists the context it must continue, including Payment attempts/outbox, interbank callbacks/probes/cancellation/reversals and Customer creation-to-review links. A valid context continues the trace; without a registered SDK/context, absence is honest. External-bank calls generate a non-sampled W3C context if necessary because the official wire contract requires the header. Audit's optional traceId is derived from transport and is never substituted for correlationId or idempotency.
