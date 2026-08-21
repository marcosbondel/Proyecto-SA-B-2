# Reliability

## Required Design Concerns

The project assignment requires every service to address:

- Idempotency for repeated commands and event deliveries.
- Retries with bounded behavior and safe retry classification.
- Explicit error handling for business and infrastructure failures.
- Eventual consistency across independently owned databases.
- End-to-end traceability through a propagated `correlationId`.

Distributed transfer and payment workflows use Saga steps and compensation
events. A request accepted by the system is not treated as complete until the
owning workflow confirms completion.

## SLI, SLO, And SLA

Defined and approved in **T-03**, before implementation, because the assignment
places SRE metrics at step 7 of its methodology (§6, page 17) — ahead of step 8,
which is implementation. **T-24 measures these definitions; it does not create
them.** Changing a value here requires a recorded team amendment, not a silent
edit.

### Service Level Indicators

Each indicator names its formula and the data source that produces it. An
indicator without a source is not measurable, however precise its formula reads.

| # | Indicator | Formula | Source |
| --- | --- | --- | --- |
| SLI-1 | Gateway availability | `requests served without technical error / requests received` | Gateway logs |
| SLI-2 | Transfer completion rate | `transfers reaching COMPLETED / transfers accepted` | Transaction Service |
| SLI-3 | Saga duration (P50 / P95) | `timestamp of final state − timestamp of transfer.requested` | Message-envelope timestamps |
| SLI-4 | Event latency | `timestamp of successful consumption − occurredAt` | Message envelope |
| SLI-5 | Retry rate and dead-lettered messages, **per queue** | `retries / deliveries`; absolute count in each DLQ | RabbitMQ |
| SLI-6 | Functional consistency | `transfers whose final state agrees with balances and audit / transfers finalised` | Transaction, Account and Notification & Audit compared |

**"Technical error" in SLI-1** means the request itself failed: 5xx, timeout, or
a dropped connection. A business rejection — insufficient funds, an inactive
account — is a *correct* response and does **not** count as unavailability.
Counting it would measure the domain rather than the service.

### Service Level Objectives

| # | Objective | Threshold | Indicator |
| --- | --- | --- | --- |
| SLO-1 | Valid messages that do not end in a dead-letter queue during the final test | **≥ 99 %** | SLI-5 |
| SLO-2 | Successful transfers completing in under 5 seconds, on a stable local environment | **≥ 95 %** | SLI-3, SLI-2 |
| SLO-3 | Duplicate commands producing exactly one financial effect | **100 %** | SLI-6 |
| SLO-4 | Post-debit failures ending in compensation or an explicit pending state | **100 %** | SLI-2, SLI-6 |
| SLO-5 | Main-flow events carrying a visible `correlationId` | **100 %** | SLI-4 |

The three objectives set at 100 % are there because they **admit no degree**: a
duplicate command that moves money twice, or a debit with no compensation, is a
correctness defect rather than a degraded service. The two percentage targets
are quality goals; these three are invariants.

**"Stable local environment"** in SLO-2 means the cluster is up, with no injected
faults and no synthetic concurrent load.

### Service Level Agreement

The commitment is **observable only during the demonstration**: bring up the
cluster, run the main transfer flow, show the complete Saga — including a
compensation path — and present the evidence for the indicators above.

This is an **academic SLA**. It carries no service window, no penalty, no
continuous measurement and no commitment outside the evaluation session, and it
**does not represent production availability**.

### What This Obliges Every Service To Build

These indicators only exist if the instrumentation exists first. Each service
implements from the start:

- Emission and consumption timestamps in the message envelope (SLI-3, SLI-4).
- Structured logs carrying `correlationId` through the whole flow (SLI-5, SLO-5).
- Retry counting and per-queue dead-letter visibility (SLI-5).
- A final transfer state that can be compared against balances and audit records
  (SLI-6).

This is precisely why the definition belongs to design and not to T-24: a metric
agreed after implementation has no data behind it.

## Observability

Notification & Audit Service provides the domain foundation for audit events and
distributed logging. The project retains `@artmizu/nuxt-prometheus` in the web
manifest while its justification remains open in TD-006 for T-24.

Every future service must make correlation context, retries, failures, and
eventual completion observable without changing business outcomes.

## Verification

The current executable check is `pnpm install && pnpm build` from `apps/web/`.
Integration, resilience, failure, and observability checks arrive with the
service implementation and integration tickets.

## Incident Notes

There are no runtime incidents to record because the backend services and
deployment have not been implemented yet.
