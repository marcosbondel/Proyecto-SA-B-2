---
name: notification-audit-integration-tests
description: How to run notification-audit-service's real-PostgreSQL integration suite, why it is one file on purpose, and what it covers as of Sep 2026
metadata:
  type: project
---

`apps/services/notification-audit-service/test/repository.integration.spec.ts`
is the **only** integration file for this service — 39 cases as of 2026-09-25
(12 original + 27 added). Gated by `describe.skip` when `DATABASE_URL` is
unset, `migrate(pool)` in `beforeAll`, `TRUNCATE audit_events, notifications,
processed_messages` in `beforeEach`.

Run it against the dev container (`postgres-notification-audit`, port 5437):

```bash
cd apps/services/notification-audit-service
DATABASE_URL=postgresql://notification_audit_app:changeme@localhost:5437/notification_audit npx jest
```

Confirm the skip path stays green with the env var unset too — same total test
count, all skipped rather than failed.

**Deliberately kept as one file, not split by concern.** Jest's default
scheduler runs separate test *files* in separate worker processes in
parallel. Every case here shares the same three tables in the same real
Postgres and the same `beforeEach TRUNCATE`. A second `*.integration.spec.ts`
file hitting those tables concurrently would truncate rows out from under
this file's in-flight assertions (and vice versa) — flaky for a reason that
has nothing to do with the code under test. `payment-service` and
`transaction-service` show the same one-file pattern for the same reason (see
[[payment-service-integration-tests]]); extend the existing file rather than
adding a sibling `*.integration.spec.ts` here unless the new cases genuinely
never touch `audit_events`/`notifications`/`processed_messages`.

Covers, beyond the original 12: the inbox and its read state (scoping,
unread counts, `markRead` no-ops for another customer's id and for an
already-read row), `trailFor`/`notificationsFor` isolation across two
different correlations, `listRecentEvents` pagination (`limit`/`offset` vs.
`total`) and its severity filter — **not** producer/type/date-range, because
`listRecentEvents`'s real signature only takes `limit`/`offset`/`severity`;
`listNotifications` is the one with `type`/`status`/`correlationId`/`severity`
filters, tested there instead — `stats()` across a real Guatemala-calendar-day
boundary (a fixed 24h step back always lands on yesterday since Guatemala
carries no DST, so no injected clock is needed), and the CHECK/UNIQUE
constraints not already covered by the original file
(`processing_status`, notification `severity`, `processed_when_settled` both
directions, and the `(caused_by, type)` one-notification-per-event unique
index). See [[postgres-check-constraint-isolation-gotcha]] before adding more
raw-INSERT CHECK tests to this table set — `audit_events` and `notifications`
each carry 2+ CHECKs that can trip each other.

See also [[redaction-accountnumber-not-covered]] — a real defect this suite's
privacy tests found and left red on purpose.
