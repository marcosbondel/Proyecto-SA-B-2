---
name: provisioncustomer-activation-link-race-under-concurrency
description: provisionCustomer() (test/e2e/support/seed.mjs + activation.mjs) can silently fetch a DIFFERENT customer's activation token when many suites/agents register customers concurrently — fromLogs() grabs the last matching link in the whole shared log, not one scoped to this call's correlationId.
metadata:
  type: project
---

`test/e2e/support/activation.mjs`'s `getActivationLink()` → `fromLogs()` scans
the shared dev-host log (or `docker compose logs`) for the **last** line
matching `/\/activar\?token=.../`, with no filter on the registration's own
`correlationId`. Under this repo's heavy multi-agent E2E sessions (several
suites/agents each calling `provisionCustomer()` concurrently against the
same live stack), the "last" activation link in the log frequently belongs to
a *different* customer registered by another agent milliseconds later.

**Observed failure shapes**, both from the same root cause:
- `verify-email` on the wrong (someone-else's, already-consumed) token →
  `409 ACTIVATION_TOKEN_INVALID` at `provisionCustomer`'s `'activate'` step.
- `verify-email` succeeds (200) — because the grabbed token happened to
  belong to a still-unverified other customer — but *this* call's own
  customer was never actually activated, so the subsequent `loginApi(email,
  password)` call fails `401 UNAUTHENTICATED` at the `'login'` step, even
  though the credential is correct.

Confirmed via `test/e2e/suites/accounts-deposits.e2e.mjs`: the suite's own
first `provisionCustomer()` call reliably succeeds (it runs before any other
concurrent registration in that suite's timeline), but a **second**
`provisionCustomer()` call made shortly after — needed for a two-customer
case like `FORBIDDEN-ACCESS-01` or `RBAC-STATUS-03` — intermittently (not
always) hits this race under heavy concurrent load from other parallel
agents' suites, and gets skipped with a clear `login`/`activate`-step reason
rather than a false pass or a hang. That graceful skip is `provisionCustomer`
working as designed (per its own doc comment: never throw, report the step
that failed); the race itself is in `activation.mjs`.

**Why this matters:** a suite that provisions two customers in quick
succession (needed for any cross-customer authorization case) should expect
this as a flaky-but-explained `SKIP`, not chase it as a suite-local bug. Do
not "fix" it by weakening the assertion or looping retries inside the suite
— the fix belongs in `activation.mjs`, filtering `fromLogs()` by the
envelope's `correlationId` (the log line does carry one) the same way
`fromAudit()` already does.

**How to apply:** when a two-customer case skips with an `'activate'` (409
`ACTIVATION_TOKEN_INVALID`) or `'login'` (401) reason from
`provisionCustomer`, check whether other E2E suites/agents were running
concurrently before treating it as a defect in the suite under test. Rerun
solo (no concurrent agents) to confirm the case passes when isolated — if it
does, this race is the explanation, not a new bug.
