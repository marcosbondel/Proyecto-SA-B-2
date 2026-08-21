# Contract: Broker Topology

This contract restates the topology that the RabbitMQ broker MUST declare at boot time. The authoritative source is [`docs/events/topology.md`](../../docs/events/topology.md); this file exists so the T-06 implementation can be checked against a single contract.

## Exchanges

Four `topic` durable exchanges:

- `bank.commands`
- `bank.events`
- `bank.replies`
- `bank.errors`

## Work queues

One durable queue per logical consumer. Each queue has a single owner service and explicit bindings.

| Queue | Owner | Bindings |
|---|---|---|
| `customer.commands` | Customer Service | `customer.*.v1` on `bank.commands` |
| `account.commands` | Account Service | `account.#` on `bank.commands` |
| `transaction.commands` | Transaction Service | `transfer.requested.v1`, `transaction.status.requested.v1` on `bank.commands` |
| `transaction.saga` | Transaction Service | `account.debited.v1`, `account.debit.rejected.v1`, `account.credited.v1`, `account.credit.rejected.v1`, `account.debit.compensated.v1`, `payment.succeeded.v1`, `payment.failed.v1` on `bank.events` |
| `payment.commands` | Payment Service | `payment.requested.v1` on `bank.commands` |
| `audit.all` | Notification & Audit Service | `#` on `bank.events`; `audit.query.requested.v1` on `bank.commands` |

## Retry ladder

For every work queue `Q`, three retry queues exist:

| Queue | Arguments |
|---|---|
| `Q.retry.1s` | `x-message-ttl: 1000`, `x-dead-letter-exchange: ""`, `x-dead-letter-routing-key: Q` |
| `Q.retry.5s` | `x-message-ttl: 5000`, `x-dead-letter-exchange: ""`, `x-dead-letter-routing-key: Q` |
| `Q.retry.30s` | `x-message-ttl: 30000`, `x-dead-letter-exchange: ""`, `x-dead-letter-routing-key: Q` |

## Dead-letter queues

For every work queue `Q`, a terminal queue `Q.dlq` exists with no special arguments.

## Publishing properties

All messages published through the broker MUST carry:

- `persistent: true`
- `contentType: application/json`
- `messageId`, `correlationId`, `type`, `timestamp`
- `replyTo` for the four request/reply contracts

## Header contract for dead-lettered messages

A message that reaches any `Q.dlq` MUST carry these headers:

| Header | Contents |
|---|---|
| `x-attempt` | Last attempt number |
| `x-failure-reason` | `invalid:` or `handler-error:` plus truncated cause (max 512 chars) |
| `x-failed-at` | ISO-8601 timestamp |
| `x-original-routing-key` | Routing key at first publish |

## What MUST NOT be declared

- The Gateway reply queue is exclusive, server-named, and auto-deleted; it is created at runtime, not in this topology.
- No queue is shared between two services.
