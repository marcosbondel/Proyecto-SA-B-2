# ADR-017: An account anomaly is reported, not blocked — and it is counted from the database, once per window

- **Status**: Accepted
- **Date**: 2026-10-04 — the day the high-frequency rule landed (T-42)
- **Deciders**: Bank USAC team
- **Assignment reference**: Fase III (`docs/references/780_Proyecto_3_2S2026.pdf`), §4.1 —
  *Account Service, "Monitoreo de uso de cuentas"*: "más de N operaciones sobre una misma cuenta
  en una ventana de M minutos. N y M deben ser configurables (ConfigMap)", "emitir el evento
  `AccountAnomalyDetected` hacia el broker", and "**La anomalía se registra y notifica; bloquear
  la cuenta es opcional y, si se hace, debe justificarse en la documentación**".

## Context

Account Service now watches how each account is used and flags one pattern: more than N debits
and credits on the same account inside M minutes (ten in five by default). The assignment makes
the *flagging* mandatory and the *blocking* optional, and asks that whichever is chosen be
justified here. Two further decisions had to be taken for the flag to mean anything, and they
belong beside the first because they interact with it.

## Decision

### 1. The account is not blocked

A detected anomaly is **recorded** (`account_anomalies`), **published**
(`account.anomaly.detected.v1`) and **notified** (Notification & Audit raises a `WARNING`, T-45).
Nothing about the account changes: it keeps accepting debits and credits.

### 2. The window slides, and a burst is one event

N and M come from the ConfigMap (`ANOMALY_MAX_OPERATIONS`, `ANOMALY_WINDOW_MINUTES`). "More than
N" means the N + 1st operation. The window is the M minutes before the operation just applied, not
a clock-aligned bucket, so a burst that straddles a boundary is still seen. After an anomaly the
same account is silent for M minutes, so thirty operations in a minute are one event.

Only debits and credits count — a deposit enters as a credit. Commissions are the bank's own fee
derived from a debit, and compensations are the system undoing one; counting either would flag a
single transfer that went wrong as several operations by the customer.

### 3. The count is the database's, taken outside the balance lock

The window is counted from `account_operations`, never from memory, so every replica gives the
same answer (the HPA may run up to five). The decision — cooldown check, count, insert — runs
under a per-account **advisory** lock in its own transaction, **after** `applyMovement` has
committed. It is deliberately not the `accounts` row lock: a detector that counted while holding
that lock would make every debit on a busy account wait for the count, and the ticket forbids
exactly that. A test holds the detection lock and proves a balance movement on the same account
still completes.

The anomaly row is written **before** the event is published, with a lease (`claimed_at`) on the
right to publish. A pod that crashes in between leaves a record saying "detected, never
announced"; once the lease is stale, the next movement on that account inside the window
publishes it. A slow publisher is not duplicated while it holds the lease.

## Alternatives rejected

- ***Block the account on an anomaly.*** Rejected, for four reasons:
  - **False positives are routine.** A teller registering a batch of deposits, a customer paying
    several bills in a row and a payroll run are all ten operations in five minutes, and none of
    them is abuse. A block turns a signal into an outage for a customer who did nothing wrong,
    with nobody awake to lift it.
  - **It contradicts a standing invariant.** A credit to an inactive account *reactivates* it
    (A-3). A rule that blocked the receiving account would have to be disabled the moment a
    transfer arrived, or reactivation would silently undo it.
  - **It lands in the middle of a Saga.** A debit refused because the account was blocked
    after the transfer began fails the whole transfer and, if it was the credit leg, forces a
    compensation — a customer-visible failure caused by the monitor rather than by the money.
  - **There is no state to block into.** `INACTIVE` means dormant, with its own meaning, its own
    sweep and its own reactivation rule; a `BLOCKED` state would change the account state machine
    for a rule whose thresholds are configuration anyone can change.
- ***Fixed clock buckets* (counting per calendar five-minute slot).** A burst of ten that
  straddles the boundary would be five and five, and is precisely what somebody trying to stay
  under the rule would do.
- ***Counting in memory, per replica.*** It would depend on how many replicas are running and
  on which one a given debit reached, and would forget everything on restart.
- ***Publishing on every operation over the limit.*** Twenty events for one burst bury the one
  that matters and train the reader to ignore the `WARNING`.

## Consequences

**Easier**: the rule can be tuned from the ConfigMap with no code change (and the Deployment
carries the ConfigMap's checksum, so `helm upgrade` restarts the pods); a wrong threshold costs a
noisy dashboard and not a locked-out customer; and the monitor can fail without failing a debit,
because it runs after the movement and reports its own errors as telemetry.

**Harder**: **nothing stops an abusive pattern automatically.** A person has to read the `WARNING`
and act, and staff can already do so with the existing status change (`account.set-status.v1`).
The decision is revisited if the anomaly dashboards show a low false-positive rate and a
dedicated, reversible hold state is introduced — not by reusing `INACTIVE`.

**Not solved here**: a pod that dies after writing the anomaly row and never receives another
movement on that account inside the window never announces it — the lease is only re-offered by
a later movement. The window is the bound on how long that stays true.
