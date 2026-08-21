# @bank/contracts / events

The contract for every message the system can put on the broker: one file per
message, versioned in its name (`account.debited.v1`), each one a payload that
travels inside the shared `MessageEnvelope`.

Events are the only interface between services (constitution IV), so this
directory is the seam the whole system leans on.

## Layout

Forty-two contracts, grouped by the prefix of their name:

| Directory | Contracts |
| --- | --- |
| `customer/` | 15 |
| `account/` | 15 |
| `transaction/` | 7 |
| `payment/` | 3 |
| `audit/` | 2 |

`index.ts` collects them into `catalog`, checks the names are unique, and
exposes `contractFor(messageType)`.

## How a contract is written

Each file exports one `defineContract` call. `defineContract` refuses, at module
load, anything that breaks the rules `docs/domain/message-catalog.md` states: a
command with more than one handler, an event with no consumer, a reply with more
than one recipient, a name without a version suffix, or a contract that lists its
own producer as a consumer. A malformed catalogue is not importable, so no
service can build against one.

The schema is written in Zod and the TypeScript type is derived from it with
`z.infer`. There is one object, not a type and a validator that can drift apart.

## Adding a message

1. Decide whether it belongs here at all: *which* conversations exist is fixed by
   [`docs/domain/message-catalog.md`](../../../../../docs/domain/message-catalog.md),
   and adding one there is a domain decision, not a transport one.
2. Write `<name>.v1.ts` in the right directory.
3. Add it to `index.ts`.
4. Write its prose entry in `scripts/catalog-prose.json` — preconditions,
   effects and error behaviour. The documentation generator fails on a contract
   with no prose rather than publishing an empty section.
5. Run `pnpm test`. The catalogue tests check the count, the coherence with the
   domain catalogue, the routing, the payload size and the absence of secrets.

## Documentation

[`docs/events/catalog.md`](../../../../../docs/events/catalog.md) is generated
from these files with `pnpm --filter @bank/contracts docs:catalog`. The
machine-readable JSON Schema comes from `pnpm --filter @bank/contracts
schema:emit`.
