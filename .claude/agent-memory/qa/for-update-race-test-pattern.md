---
name: for-update-race-test-pattern
description: How to prove a SELECT ... FOR UPDATE serialization guarantee against real Postgres, not assume it — decide-call counter plus Promise.all
metadata:
  type: project
---

This repo's money-moving services (`account-service`, `payment-service`, and
`transaction-service`'s row-locked state machine) all rely on
`SELECT ... FOR UPDATE` inside an explicit transaction to stop two concurrent
callers from both acting on a row they each read as still-actionable — a
double charge, a double debit, an illegal double transition. An in-memory
double can never disprove this because it has no lock at all; only a real
Postgres connection pool proves it.

**Pattern that actually falsifies the guarantee if it's missing:** don't just
assert both concurrent calls resolved without throwing — count how many times
the *decision function* itself ran.

```ts
let decideCalls = 0;
const countingDecide = (): AttemptResult => {
  decideCalls += 1;
  return { /* ... */ };
};

const [first, second] = await Promise.all([
  repository.attempt({ paymentId, expectedAttempt: 1, now, decide: countingDecide }),
  repository.attempt({ paymentId, expectedAttempt: 1, now, decide: countingDecide }),
]);

expect([first.kind, second.kind].sort()).toEqual(['RECORDED', 'SUPERSEDED']);
expect(decideCalls).toBe(1); // the real assertion — the row lock must have blocked the second reader
```

`pg.Pool` hands each concurrent repository call its own physical connection,
so `Promise.all` on the same repository instance is already a genuine race
between two transactions — no need to construct two separate `Pool`s for this
one. (A separate `Pool` *is* worth it for a different claim: proving a written
column is visible to a totally independent connection, i.e. durability rather
than concurrency — see `payment-service`'s "durable column" test.)

Ran this three times in a row in `payment-service` with zero flakiness — the
lock made the second `attempt()` call block until the first committed, not
race it. If this pattern ever produces `decideCalls === 2`, that is a real
double-charge/double-debit defect in the repository, not a flaky test — do
not retry it away.

See also [[payment-service-integration-tests]].
