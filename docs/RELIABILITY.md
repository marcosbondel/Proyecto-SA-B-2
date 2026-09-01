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

The measurement window and error budget columns in the objectives table were
**added after T-03 and change no threshold**. Every number T-03 approved is the
number that is there; what was missing was the two dimensions that make a
threshold checkable at all — over what period it is counted, and how much of it
may be spent before it is missed.

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

| # | Objective | Threshold | Measurement window | Error budget | Indicator |
| --- | --- | --- | --- | --- | --- |
| SLO-1 | Valid messages that do not end in a dead-letter queue during the final test | **≥ 99 %** | One demonstration run | 1 % of the valid messages delivered in the run | SLI-5 |
| SLO-2 | Successful transfers completing in under 5 seconds, on a stable local environment | **≥ 95 %** | One demonstration run | 5 % of the successful transfers in the run | SLI-3, SLI-2 |
| SLO-3 | Duplicate commands producing exactly one financial effect | **100 %** | Every duplicate observed in the run | None — invariant | SLI-6 |
| SLO-4 | Post-debit failures ending in compensation or an explicit pending state | **100 %** | Every post-debit failure in the run | None — invariant | SLI-2, SLI-6 |
| SLO-5 | Main-flow events carrying a visible `correlationId` | **100 %** | Every main-flow event in the run | None — invariant | SLI-4 |

**The window is one demonstration run, and naming it is not a formality.** Every
objective here is a ratio, and a ratio without a window is unfalsifiable: 99 %
of what, counted from when. The window is the run itself — the stack brought up,
the flows exercised, the evidence collected — because that is the only period in
which this system is observed at all, and the SLA below commits to nothing
outside it. Each run is judged on its own numbers: nothing carries over to the
next one, and a bad run is not amortised by measuring for longer.

**Two objectives have an error budget; three cannot have one.** SLO-1 and SLO-2
are quality goals, so their thresholds imply a budget — at 99 %, one valid
message in a hundred may be dead-lettered before the run misses the objective;
at 95 %, one successful transfer in twenty may take longer than five seconds. In
absolute terms these budgets are small, and deliberately so: a demonstration
moves a few hundred messages and a handful of transfers, so a systematic fault
exhausts the budget instead of hiding inside it, which is the whole reason to
state one at this scale. When a budget is exhausted the run is reported as
missing its objective, naming the specific messages or transfers that spent it.
There is no release to halt and no rollback to trigger, because there is no
production.

The three objectives set at 100 % are there because they **admit no degree**: a
duplicate command that moves money twice, or a debit with no compensation, is a
correctness defect rather than a degraded service. An error budget is a licence
to fail a fraction of the time, and no fraction of double-spends is acceptable —
so these three carry none, are evaluated over every occurrence rather than a
sample, and a single violation fails the objective outright. The two percentage
targets are quality goals; these three are invariants.

**"Stable local environment"** in SLO-2 means the cluster is up, with no injected
faults and no synthetic concurrent load.

### Service Level Agreement

The commitment is **observable only during the demonstration**: bring up the
cluster, run the main transfer flow, show the complete Saga — including a
compensation path — and present the evidence for the indicators above.

This is an **academic SLA**. It carries no penalty, no continuous measurement and
no commitment outside the evaluation session, and it **does not represent
production availability**. It carries no *service* window either — no hours
during which the system is promised to be up — which is a different thing from
the *measurement* window the objectives above declare: that one says over what
period a ratio is counted, not for how long the system is promised to answer.

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

Notification & Audit Service is the domain foundation for audit events and
distributed logging, and it is built: five queues, deduplication by
`(event_id, consumer)`, a payload redacted before the insert, and — since
TD-048 — the messages the system could not process drained off `bank.errors`
and recorded `INVALID` instead of discarded. What is still missing above it is
collection: `@artmizu/nuxt-prometheus` remains in the web manifest with its
justification open in TD-006, and no exporter, scrape or dashboard reads the
instrumentation the services already emit.

Every service must make correlation context, retries, failures, and eventual
completion observable without changing business outcomes. The five services carry
a `correlationId`-aware logger of their own and the Gateway mints the identifier
they propagate; the rule binds anything added after them.

## Verification

These commands run from the repository root, and between them they are
everything the project can demonstrate today without a person watching a screen.

| Command | What it establishes |
| --- | --- |
| `pnpm lint` | Style, and the architecture rules that are executable rather than written: a cross-service import, a framework import in `domain`, or an `infrastructure` import in `application` fails the run. The rules live in `apps/packages/tooling/eslint.base.mjs`. |
| `pnpm typecheck` and `pnpm build` | The seven applications and the three shared packages compile. |
| `pnpm test` | The unit suites of the six NestJS applications, plus a `node --test` suite over `apps/web/app/lib/` — `apps/web` has no component test framework (TD-010), so everything in the shell that decides something lives there as a pure function. Each service also carries a `test/isolation.spec.ts` that fails the build if it queries another service's table or opens an HTTP call. |
| `pnpm test:contract` | The message catalogue in `@bank/contracts` — 91 contracts, each with an accepted and a refused case generated *from the catalogue itself*, so a new contract without a test cannot exist. |
| `pnpm images:smoke` | Per image: the identifying labels, the declared port, a non-root user, and no credential in any layer. Per running container: liveness answers, readiness reports on every dependency it has, and **liveness keeps answering while a dependency is unreachable** — the property that separates the two probes, and the one nobody notices is broken until Kubernetes restarts a pod for an outage it cannot fix. |
| `pnpm images:flow` | The assignment's own flow through the built images: register, activate, sign in, open two accounts, then the Saga in its three shapes — one `COMPLETED`, one `COMPENSATED` on a payment the provider refuses, and one `COMPENSATED` after the retry ladder is climbed to its end — with the source balance read before and after each. The compensation is asserted as a fact about the money, not as a status somebody wrote down. The source balance is seeded with SQL rather than through the deposit route, which is a shortcut in the script and not a gap in the system. |

Two suites need real infrastructure and skip without it rather than failing.
Each service's `test/repository.integration.spec.ts` covers concurrency,
idempotency and the database constraints, and skips without `DATABASE_URL`;
`apps/packages/messaging/test/broker.integration.spec.ts` exercises publish and
consume, `correlationId` propagation, the retry ladder, dead-letter headers and
reconnection against a live RabbitMQ.

The Helm chart has been installed on a real kind cluster (v0.33.0) on
2026-08-28: the seven pods reached `1/1 Ready` against the PostgreSQL, RabbitMQ
and MinIO running outside the cluster, the port-forwarded Gateway answered, and
a transfer ran the Saga through the cluster to a terminal state. That state was
`FAILED` via `DEBIT_REJECTED` on a zero-balance account — the failure-handling
shape, not the completion one — and **no evidence of the run was captured in the
repository**: `specs/008-audit-remediation/quickstart.md` records what to expect,
not what happened.

**What none of this measures is the indicators above.** Every command here is a
pass-or-fail check on behaviour; not one of them computes SLI-1 … SLI-6 or
compares a result against a threshold in this document. The instrumentation those
numbers depend on exists — the envelope carries emission and consumption
timestamps, the logs carry `correlationId` through the whole flow, RabbitMQ holds
the retry counts and the parked messages, and `bank.errors` is now drained into
the audit trail (TD-048) — but nothing collects it and nothing reads it back
(TD-006). Producing the numbers is T-24's work, and until it lands the objectives
above are definitions with no measurement behind them. That is the honest state
of this document: the metrics are agreed and instrumentable, and they have not
been measured.

## Incident Notes

None recorded, and the reason is that there is nothing to record against. The
system has run on development machines, in a Docker Compose stack and once on a
kind cluster; no run has been operated long enough for an incident to mean
anything, and an SLA observable only during a demonstration has no window in
which one could accrue.

What those runs *did* find is filed as debt rather than as incidents, which is
the same information under a different name and is worth reading here: TD-049 (a
fresh broker volume seeded no user, so the containerised stack could not come up
from clean), TD-048 (the `bank.errors` exchange had no queue bound to it, so a
message the system could not process vanished silently — for a system whose
promise is to record what happened, the worst possible failure mode), TD-031 and
TD-047 (the commit-then-publish window on Transaction and Payment Service, where
a crash could leave money debited and a Saga that never heard), and TD-030 with
TD-045 (a test suite green on rerun and not green under load). The first four are
resolved. The flakiness is open, and it is the one on this list that could still
let a real regression through.
