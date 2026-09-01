# ADR-004: Use RabbitMQ as the message broker

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.2 "Alcance del proyecto", page 8; §4.3 "Recursos y herramientas
  a utilizar", page 14; §6 step 3, page 17 (revision 2026-08-13)

## Context

The assignment closes the broker to an explicit list of four, stated twice — in §4.2 (p. 8,
"Uso de un mecanismo de mensajería, el cual puede ser seleccionado por el equipo") and again in
the mandatory-resources table (§4.3, p. 14, "Mensajería: Kafka, RabbitMQ, NATS o gRPC async"):

1. **Kafka**
2. **RabbitMQ**
3. **NATS**
4. **gRPC (asynchronous mode)**

§6 step 3 (p. 17) requires the choice to be justified "en términos de desacoplamiento y
resiliencia".

[ADR-003](ADR-003-communication-model.md) already fixed *what* the broker must carry: thirteen
commands with a single handler each, twenty-two events with one or more consumers, and two
asynchronous request/reply interactions. The transfer Saga
([ADR-009](ADR-009-distributed-transactions.md)) adds harder requirements — a failed step must
be retried a bounded number of times and then parked somewhere a human can inspect, and a
message that moves money must not be silently lost.

Concretely, the broker must provide: per-consumer queues, explicit acknowledgement, bounded
retries, dead-letter queues, message durability across a broker restart, and a request/reply
pattern. It runs on a laptop during a demonstration, not on a managed cluster.

## Decision

The broker is **RabbitMQ**, with event-driven communication and asynchronous request/reply.

The workspace already depends on `amqplib` and `amqp-connection-manager`
(`apps/packages/messaging`), which provide the reconnection behaviour a local demonstration
needs.

## Alternatives considered

### Kafka

A distributed, partitioned, replayable log. Excellent when consumers need to re-read history,
when throughput is very high, or when the event log itself is the system of record.

**Rejected because**: its model is a log, not a queue, and the operations this design depends
on are queue operations. Per-message acknowledgement, per-message retry and dead-letter routing
are native in RabbitMQ; in Kafka they are patterns the application must build — offset
management, retry topics, a dead-letter topic and the code to move messages between them.
Operationally it is also the heaviest of the four locally: a broker plus coordination, with a
memory footprint that competes with six service workloads and a kind cluster on one machine.
The capability it would buy — replaying history from the origin — is not something any flow in
`docs/domain/use-cases.md` needs.

### NATS

Very lightweight, very fast, with a simple operational story — the closest competitor on the
"low local overhead" criterion, which is the main reason RabbitMQ is preferred over Kafka.

**Rejected because**: NATS Core is fire-and-forget and **does not persist messages by default**;
a subscriber that is down when a message is published simply misses it. A banking transfer
cannot lose an `account.debit.requested`, and the Saga's correctness depends on messages
surviving a consumer restart. Durability requires adopting JetStream, which is a second
subsystem to configure and reason about — at which point the operational simplicity that made
NATS attractive is gone, and its queue semantics are still less direct than RabbitMQ's.

### gRPC in asynchronous mode

Permitted by the assignment and efficient, with strong schema typing through protobuf.

**Rejected because**: it is a **point-to-point transport, not a broker**. There is no queue, no
acknowledgement of the kind retries depend on, no dead-letter destination and no store-and-
forward: if the target service is down, there is nothing holding the message. That removes the
substrate the Saga choreography runs on and reintroduces exactly the temporal coupling
[ADR-003](ADR-003-communication-model.md) was written to eliminate — each service would need to
know the address and liveness of the next. Streaming makes the call asynchronous in shape, but
it does not decouple the participants in time.

## Consequences

**Easier.** Queues, explicit ack, bounded retries and dead-letter queues are first-class, so
SLI-5 (retry rate and DLQ depth per queue, `docs/RELIABILITY.md`) can be measured from broker
state rather than from application bookkeeping. Durable queues mean a consumer can restart
mid-flow without losing work. The management UI makes queue depth and dead-lettered messages
visible during the demonstration, which is direct evidence for the Saga's failure paths. It is
the lightest of the four that still satisfies durability.

**Harder.** No historical streaming and no replay from origin: once a message is acknowledged
it is gone, so any need to reconstruct past state must be served by the audit records that
Notification & Audit Service keeps, not by re-reading the broker. This is the accepted
trade-off. RabbitMQ also offers weaker horizontal scaling than Kafka — irrelevant at this scale,
and named here so the choice is not mistaken for a claim of general superiority.

**Obligations created.**

- **T-05** defines exchange and routing-key naming, payload shapes, the serialization format
  and the concrete retry and dead-letter policy per queue.
- **T-06** provisions RabbitMQ locally through Docker Compose, outside the cluster alongside the
  databases. `infra/docker/README.md` already pins `rabbitmq:4.3.4-management` and names the
  topic exchange `bank.events`; that version floor is not negotiable, because community support
  for the 4.2.x series ended on 2026-07-31.
- **T-24** measures SLI-5 from the queues and dead-letter queues this decision makes available.
