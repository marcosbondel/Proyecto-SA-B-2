---
name: payment-service-integration-tests
description: How to run payment-service's real-PostgreSQL integration suite, and what it covers as of Sep 2026
metadata:
  type: project
---

`apps/services/payment-service/test/repository.integration.spec.ts` is the one
integration file for this service (17 cases as of 2026-09-25: 10 original +
7 added for the outbox/CHECK/sweeper/concurrency gaps). Gated by
`describe.skip` when `DATABASE_URL` is unset, same pattern as
`transaction-service`'s canonical file — `migrate(pool)` in `beforeAll`,
`TRUNCATE outbox_messages, payment_attempts, payments` in `beforeEach`.

Run it against the dev container (already running in this repo's local setup
under `docker ps` as `postgres-payment`, port 5436):

```bash
cd apps/services/payment-service
DATABASE_URL=postgresql://payment_app:changeme@localhost:5436/payment npx jest
```

Confirm the skip path stays green by also running `npx jest` with the env var
unset — it should report the same total test count, all skipped rather than
failed, not just "fewer suites ran".

Covers: `open`'s dedup on both unique keys, the transactional outbox (TD-047)
end to end including "broker away, delivered on recovery", the provider-result
CHECK, `list` filter combinations, `attemptsOf` ordering, `stats()` on an empty
table, the `payments_status_known` CHECK via raw INSERT, `due()`'s boundary
(`<=`, not `<`) seeded via `repository.open({ nextAttemptAt })` rather than raw
SQL, the `SELECT … FOR UPDATE` double-charge guard under `Promise.all`, and
`next_attempt_at`'s durability across a second, independent `Pool`.

See also [[for-update-race-test-pattern]] and
[[postgres-check-constraint-isolation-gotcha]] for the two least-obvious
techniques used in that file.
