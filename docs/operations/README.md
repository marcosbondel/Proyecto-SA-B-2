# Operations

Runbooks and the reliability targets they defend. The constitution requires
SRE concerns to be answered at design time, not after the first incident
(principle VIII).

## What belongs here

- SLI, SLO and SLA definitions per service, with the measurement that backs
  each one.
- Runbooks: how to bring the local stack up, how to drain a queue, what to do
  when a Saga stalls mid-compensation.
- The retry, timeout and dead-letter policy each consumer follows.
- How a `correlationId` is followed across services during an investigation.

The transport-level half already exists in code: the shared envelope carries
`correlationId`, `causationId` and `idempotencyKey`, and the broker adapter
dead-letters a message it cannot read rather than requeueing it forever.

> **Blocked**: SLI/SLO/SLA definitions and runbooks are not written; the reliability targets are not approved yet. Owner: Marcos Bonifasi. Arrives with: T-03 and T-07.
