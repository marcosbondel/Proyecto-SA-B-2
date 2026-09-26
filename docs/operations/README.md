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

**The delivery policy is defined.** T-05 fixed the per-consumer retry ladder
(1 s, 5 s, 30 s, three retries at most), the dead-letter queue of every consumer
and the headers a parked message carries. It lives in
[`../events/topology.md`](../events/topology.md) and is not restated here.

## The runbooks

- [DEPLOYMENT.md](DEPLOYMENT.md) — taking the system to the **local** Kubernetes
  cluster (kind) from a clean machine: prerequisites, the four commands, how to
  verify it, how to run the Saga against it, and what each failure mode looks
  like.
- [CLOUD.md](CLOUD.md) — taking it to **GCP**, from an empty project to a system
  that answers: Terraform, the identity the pipeline deploys with, the variables
  and secrets, the first published version, and the three steps that are still
  manual. This is the Fase II procedure.
- [MONOREPO.md](MONOREPO.md) — how the repository is laid out per component and
  how a change to one service triggers the build and redeployment of only that
  service.
- [CONTAINERS.md](CONTAINERS.md) — the image inventory: one row per component
  with its Dockerfile, port, health checks and required runtime variables.
- [CI.md](CI.md) — the GitHub Actions pipeline: what triggers it, what each
  stage verifies, and what a green run does not prove.
- [EMAIL_RESEND.md](EMAIL_RESEND.md) — sending real activation email instead of
  the simulated channel.

> **Still open**: the stalled-Saga procedure — what to do when a compensation
> does not arrive — is not written. Owner: Marcos Bonifasi. Arrives with T-23.
