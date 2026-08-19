# Operations

Runbooks and the reliability targets they defend. The constitution requires
SRE concerns to be answered at design time, not after the first incident
(principle VIII).

## What belongs here

- Runbooks: how to bring the local stack up, how to drain a queue, what to do
  when a Saga stalls mid-compensation.
- The retry, timeout and dead-letter policy each consumer follows.
- How a `correlationId` is followed across services during an investigation.

The transport-level half already exists in code: the shared envelope carries
`correlationId`, `causationId` and `idempotencyKey`, and the broker adapter
dead-letters a message it cannot read rather than requeueing it forever.

**The reliability targets are defined.** T-03 fixed six SLI with formulas and
sources, five SLO with numeric thresholds and an academic SLA; they live in
[`../RELIABILITY.md`](../RELIABILITY.md) and are not restated here. T-24 measures
them.

> **Blocked**: The runbooks are not written, and the retry, timeout and
> dead-letter policy per consumer is not defined. Owner: Marcos Bonifasi.
> Arrives with: T-06 for bringing the local stack up, T-05 for the per-consumer
> policy, and T-23 for the stalled-Saga procedure.
