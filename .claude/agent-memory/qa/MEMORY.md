# Memory

- [payment-service integration tests](payment-service-integration-tests.md) — how to run them, container/port, what the 17 cases cover.
- [Postgres CHECK constraint isolation gotcha](postgres-check-constraint-isolation-gotcha.md) — a raw-INSERT test can trip the wrong CHECK; satisfy the others first.
- [SELECT ... FOR UPDATE race test pattern](for-update-race-test-pattern.md) — decide-call counter + Promise.all to prove, not assume, a row-lock guarantee.
- [notification-audit-service integration tests](notification-audit-integration-tests.md) — one file on purpose (parallel-worker TRUNCATE hazard), 39 cases, container/port 5437.
- [redaction misses accountNumber/iban/cuenta](redaction-accountnumber-not-covered.md) — real, proven, unfixed defect in notification-audit-service's deny-list; reported to backend, not fixed here.
- [e2e suite entrypoint breaks on spaced path](e2e-suite-entrypoint-breaks-on-spaced-path.md) — `node test/e2e/suites/*.e2e.mjs` silently no-ops here; exit 0 is not proof it ran.
- [account status route allows all roles](account-status-route-allows-all-roles.md) — POST /api/accounts/:id/status is CLIENTE+CAJERO+ADMIN, not admin-only; verify @Roles from source, not from a brief.
- [provisionCustomer activation-link race under concurrency](provisioncustomer-activation-link-race-under-concurrency.md) — a second provisionCustomer() call can grab another agent's token under heavy parallel load; a known, explained SKIP, not a suite bug.
- [GKE live verification harness](gke-live-verification-harness.md) — kubectl helper, port-forward supervisor (needs 2 h timeout), k6 drains the source account, alert timing.
- [kind live verification harness](kind-live-verification-harness.md) — sessions, mock admin, Prom/Loki/Tempo access, Playwright, and what the auto-mode classifier blocks.
