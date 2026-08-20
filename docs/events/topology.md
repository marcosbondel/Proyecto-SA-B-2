# Broker topology

What the broker declares, and why. Binding for **T-06**, which writes the Compose file, and for
`@bank/messaging`, which declares these objects when an application connects.

The executable descriptor is
[`topology.ts`](../../apps/packages/contracts/src/routing/topology.ts). It lives in
`@bank/contracts` and not in the adapter on purpose: the adapter moves envelopes and knows no
business names, so the names are handed to it as data.

## Exchanges

Four, all `topic`, all `durable`.

| Exchange | Carries | Published by |
| --- | --- | --- |
| `bank.commands` | The 15 commands and requests | Gateway, Transaction |
| `bank.events` | The 22 events | The five services |
| `bank.replies` | The 4 replies | Customer, Account, Transaction, Audit |
| `bank.errors` | Whatever exhausted its retries or arrived invalid | Any consumer |

Commands and events are separated because they are different kinds of statement with different
rules — one handler versus many — and one exchange for both erases that distinction exactly
where the broker would otherwise enforce it.

## Routing keys

**The routing key is the message name, version suffix included.** No translation table, no
per-message exception. `account.debited.v1` is published with the key `account.debited.v1`.

The consequence is the point: a consumer bound to `account.debited.v1` never receives
`account.debited.v2`. Migrating a version is a change of binding, not a branch inside a handler.

## Work queues

One per logical consumer. Durable. **Never shared between services** — a shared queue lets the
broker hand one service's work to another, which is the superficial use criterion 2.5 of the
assignment refuses to award (§8.2, page 25).

| Queue | Owner | Bindings |
| --- | --- | --- |
| `customer.commands` | Customer | `customer.*.v1` on `bank.commands` |
| `account.commands` | Account | `account.#` on `bank.commands` |
| `transaction.commands` | Transaction | `transfer.requested.v1`, `transaction.status.requested.v1` on `bank.commands` |
| `transaction.saga` | Transaction | The seven Saga events on `bank.events` |
| `payment.commands` | Payment | `payment.requested.v1` on `bank.commands` |
| `audit.all` | Notification & Audit | `#` on `bank.events`, `audit.query.requested.v1` on `bank.commands` |

Six declared queues, plus one more that is not declared here — see below.

Transaction Service owns two queues rather than one because its two roles are different: it
takes commands from outside, and it reacts to the Saga's events. Separating them means a
backlog of Saga events cannot delay a new transfer request.

## The reply queue

The Gateway's reply queue is **exclusive to one instance**, server-named, and auto-deleted:

```
assertQueue('', { exclusive: true, autoDelete: true })
```

It is not in the table above because it is created at runtime, once per process, and it does
not survive that process.

**This is not a detail.** A durable reply queue shared by every replica would have RabbitMQ
deliver replies round-robin, so the answer to instance A's question could land on instance B,
which has nobody waiting for it. The system is deployed to Kubernetes (constitution VII), where
more than one replica is normal, so a shared reply queue would work in development and fail in
the demonstration.

The asker puts the queue name in the AMQP `replyTo` property; the answerer publishes to
`bank.replies` with that key; the two are matched by `correlationId`.

`amq.rabbitmq.reply-to` — RabbitMQ's built-in direct reply-to — solves the same problem more
cheaply, but requires consuming on the same channel that published, with `noAck`, which fits
badly with the reconnecting channel wrapper this project already uses. It is recorded as a
later optimisation, not a rejected idea.

## Retries

RabbitMQ has no delayed delivery, and the pinned image `rabbitmq:4.3.4-management` does not
carry the delayed-message plugin. The delay comes from queues with a TTL.

For every work queue `Q`:

| Queue | Arguments |
| --- | --- |
| `Q.retry.1s` | `x-message-ttl: 1000`, `x-dead-letter-exchange: ""`, `x-dead-letter-routing-key: Q` |
| `Q.retry.5s` | `x-message-ttl: 5000`, same |
| `Q.retry.30s` | `x-message-ttl: 30000`, same |
| `Q.dlq` | None. Terminal |

**The message returns to `Q`, not to the exchange it came from.** Re-publishing to the exchange
would redeliver it to every consumer bound there, including the ones that already handled it
successfully — so when Notification & Audit fails on `account.debited.v1`, Transaction Service
would receive it a second time. Idempotency would make that harmless, but "three retries" would
stop being a true statement about anything.

At most **three retries** after the first attempt: four deliveries, then the dead-letter queue.

The attempt number rides in an explicit `x-attempt` header rather than RabbitMQ's own `x-death`,
which accumulates an entry per queue traversed and is unreliable to read once three retry queues
are in the path.

## Errors

Two ways to reach a dead-letter queue, and they are not the same:

| Situation | Path | Why |
| --- | --- | --- |
| Invalid message — unknown type, unsupported version, non-conforming payload | **Straight to the DLQ, no retries** | Waiting never makes a malformed message parse |
| Handler failure on a message that was understood | 1s → 5s → 30s → DLQ | The cause may be transient |

A dead-lettered delivery arrives with its envelope untouched and these headers:

| Header | Contents |
| --- | --- |
| `x-attempt` | The last attempt number |
| `x-failure-reason` | `invalid:` or `handler-error:` and a truncated cause |
| `x-failed-at` | ISO-8601 |
| `x-original-routing-key` | The key it was published with |

`correlationId` needs no header of its own: it is in the envelope and in the AMQP property of
the same name.

The reason is truncated at 512 characters. An unbounded error message can carry a stack trace, a
connection string or a fragment of a payload into a queue that outlives the incident.

## Publishing properties

`persistent: true`, `contentType: application/json`, and `messageId`, `correlationId`, `type`
and `timestamp` mirroring envelope fields so the management UI is readable without decoding
bodies. `replyTo` is set on the four requests that expect an answer.

## What this document does not decide

Replica counts, memory policy, broker users and permissions, and each application's
`RABBITMQ_URL` belong to **T-06**. This fixes the names and the arguments, not the deployment.
