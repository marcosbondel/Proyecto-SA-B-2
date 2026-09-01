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
| `bank.commands` | The 37 commands and requests | Gateway, Transaction |
| `bank.events` | The 33 events | Customer, Account, Transaction, Payment |
| `bank.replies` | The 21 replies | Customer, Account, Transaction, Payment, Audit |
| `bank.errors` | Whatever exhausted its retries or arrived invalid | Any consumer |

Ninety-one contracts in total, counted from
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/) and
listed message by message in [`catalog.md`](catalog.md).

**Notification & Audit publishes no events**, which is why it is absent from the `bank.events`
row and present on `bank.replies`. It hears every family and answers questions about what it
heard; it orders nothing and narrates nothing, and `test/isolation.spec.ts` in that service
fails the build if that ever changes. It is also why nobody is ever blocked waiting on it.

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
| `customer.commands` | Customer | `customer.#` on `bank.commands` |
| `account.commands` | Account | `account.#` on `bank.commands` |
| `transaction.commands` | Transaction | `transfer.requested.v1`, `transaction.status.requested.v1`, `transaction.list.query.v1`, `transaction.stats.query.v1` on `bank.commands` |
| `transaction.saga` | Transaction | The seven Saga events, plus `payment.attempt.failed.v1`, on `bank.events` |
| `payment.commands` | Payment | `payment.#` on `bank.commands` |
| `audit.customer` | Notification & Audit | `customer.#` on `bank.events` |
| `audit.account` | Notification & Audit | `account.#` on `bank.events` |
| `audit.transaction` | Notification & Audit | `transaction.#` on `bank.events` |
| `audit.payment` | Notification & Audit | `payment.#` on `bank.events` |
| `audit.query` | Notification & Audit | `audit.query.requested.v1`, `notification.list.query.v1`, `notification.inbox.query.v1`, `notification.mark-read.v1`, `audit.stats.query.v1` on `bank.commands` |

Ten declared queues, plus one more that is not declared here — see below.

**Seven of them are wildcards and three enumerate their messages, and the split is deliberate.**
The wide ones are wide because enumerating names in the broker means every new question needs a
broker change as well as a contract, and the one that gets forgotten is the binding — which is
how a route returns a timeout that nothing in the code explains. `customer.commands` is
`customer.#` rather than `customer.*.v1` for a second reason on top of that: `*` matches one
word, and a query with a longer name, such as `customer.pending-validation.query.v1`, has more
than one word between the prefix and the version, so the narrower pattern would silently route
nothing.

`transaction.commands` stays enumerated because the pattern that would replace it,
`transaction.#`, would also catch the **events** this service publishes about its own
transactions if one were ever routed to the command exchange by mistake. Four names is a small
price for a queue that cannot accidentally consume its own output.

`payment.attempt.failed.v1` is on `transaction.saga` and is **not a second way for the payment
to end**. It is how the Saga learns that a rung of the retry ladder was climbed while the
payment is still running; the transaction stays `PAYMENT_PENDING` until `payment.succeeded.v1`
or `payment.failed.v1` says otherwise. Treating it as terminal would compensate a payment about
to succeed.

Transaction Service owns two queues rather than one because its two roles are different: it
takes commands from outside, and it reacts to the Saga's events. Separating them means a
backlog of Saga events cannot delay a new transfer request.

Notification & Audit owns five, for the same kind of reason taken further. T-06 gave it a
single `audit.all` bound to `#`, and T-20 split it: one queue per event family, plus one for
the questions it answers — two at first, five now. A single queue makes every family share one
head of line and one retry ladder, so a malformed `payment.*` event that fails its way down the
ladder holds up the `customer.*` events queued behind it, and draining or replaying one family
means draining all of them. The queries are kept off the event queues because a `correlationId`
lookup is somebody waiting in front of a screen, and putting it behind a backlog of recorded
events would make the fastest thing this service does the slowest.

`audit.query` carries a **write** as well as reads: `notification.mark-read.v1` is the first
thing this service accepts from outside a flow. It belongs with the questions rather than with
the events for the reason the questions do — somebody is waiting on the answer, which is the
new unread count — and not because marking a notification read is a query.

There is no `audit.gateway`. The Gateway publishes only commands, and a command is an intention
aimed at one service rather than something that happened; what the trail records of a Gateway
request is the event the receiving service published in response.

## The reply queue

The Gateway's reply queue is **exclusive to one instance**, named after it, and auto-deleted:

```
assertQueue(`gateway.replies.${instanceId}`, { durable: false, exclusive: true, autoDelete: true })
```

It is not in the table above because it is created at runtime, once per process, and it does
not survive that process. The name is the replica's rather than the broker's — the adapter
exposes it precisely so evidence can name the queue it found in the broker — but the properties
are what actually matter, and those are unchanged.

It binds `#` on `bank.replies` — every reply in the catalogue is addressed to the Gateway — and
also **eight event patterns**, which are not a second consumer of those events:

| Pattern on `bank.events` | Why the Gateway overhears it |
| --- | --- |
| `customer.email.verified.v1`, `customer.email.verification.rejected.v1` | The verdict of an email activation, answered synchronously |
| `customer.password-reset.completed.v1`, `customer.password-reset.rejected.v1` | Somebody who just chose a new password is holding a connection open |
| `customer.password-changed.v1`, `customer.password-change.rejected.v1` | The same shape again, from inside a session |
| `account.deposited.v1`, `account.deposit.rejected.v1` | A teller is standing in front of somebody who just handed over cash |

Each of these is a flow that ends in an **event rather than a reply**, because what happened is
worth recording for everyone, and yet somebody is watching a spinner. "202, go read the audit
trail" is not an answer any of them can act on. `notification-audit-service` remains the
declared consumer of all eight and its queues receive them unchanged: adding a binding on a
topic exchange takes nothing away from anybody.

**This is not a detail.** A durable reply queue shared by every replica would have RabbitMQ
deliver replies round-robin, so the answer to instance A's question could land on instance B,
which has nobody waiting for it. The system is deployed to Kubernetes (constitution VII), where
more than one replica is normal, so a shared reply queue would work in development and fail in
the demonstration.

**The answer is not addressed to a queue.** The answerer publishes to `bank.replies` with the
reply's own message name as the routing key — `account.balance.replied.v1` goes out as
`account.balance.replied.v1`, the same rule as everywhere else — and every Gateway replica's
queue is bound `#`, so every replica receives a copy of every reply. Each one hands it to its
in-memory registry, which matches it by `correlationId`; a replica with nobody waiting for that
correlation **discards it**, which is also what happens to a reply that outlived its five-second
timeout. Neither is treated as a fault.

This is why the queue must still be exclusive per replica even though nothing is addressed to
it: a single durable queue shared by every replica would have RabbitMQ deliver each reply to
exactly one of them, round-robin, and the one that received it would usually not be the one
holding the connection open. Broadcasting a copy to every replica and letting all but one drop
it costs a message and cannot lose an answer.

The AMQP `replyTo` property is supported by the adapter and **is not used by this system**. It
would be the alternative design — the asker naming its own queue, the answerer publishing back
to that name — and it is worth recording as not-taken rather than leaving the field's existence
to imply it.

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
bodies. `replyTo` is left unset — see [The reply queue](#the-reply-queue) for how the twenty-one
requests that expect an answer get one without it.

## What this document does not decide

Replica counts, memory policy, broker users and permissions, and each application's
`RABBITMQ_URL` belong to **T-06**. This fixes the names and the arguments, not the deployment.
