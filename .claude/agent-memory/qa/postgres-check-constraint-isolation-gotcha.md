---
name: postgres-check-constraint-isolation-gotcha
description: A raw-INSERT test meant to prove one CHECK constraint can fail on a different one instead — isolate the row so only the target constraint can trip
metadata:
  type: project
---

When a table carries several CHECK constraints (this repo's five services all
do — `payments`, `accounts`, `transfers` etc. each have 4-6), an INSERT built
to violate constraint A can also, incidentally, violate constraint B — and
PostgreSQL does not promise to report the one the test intended. It reports
whichever it evaluates first, which is not reliably creation order.

Hit this in `payment-service`: an INSERT with `status = 'BOGUS'` was meant to
prove `payments_status_known`, but tripped `payments_settled_has_decision`
instead — `(status = 'PENDING') = (decided_at IS NULL)` fails for *any*
non-`'PENDING'` status when `decided_at` is left NULL, including an invalid
one. `expect(...).rejects.toThrow(/payments_status_known/)` failed with the
wrong constraint name in the message.

**Why:** found via `systematic-debugging` — read the actual rejection message
rather than assuming the regex would obviously match once the query rejected
at all.

**How to apply:** when writing a raw-INSERT test for one specific CHECK,
first re-derive by hand which of the table's *other* CHECK constraints the
row would also trip, and set enough of the remaining columns (here,
`decided_at = now()`) so every constraint except the one under test is
satisfied. Then assert on the specific constraint name in the error message,
not just "it threw" — a passing-for-the-wrong-reason test would keep passing
even if the intended constraint were dropped entirely. Applies to any table
in this repo with `payments_settled_has_decision`/`payments_failed_has_reason`
-style paired invariants (`account-service`, `transaction-service` have
similar CHECK clusters).
