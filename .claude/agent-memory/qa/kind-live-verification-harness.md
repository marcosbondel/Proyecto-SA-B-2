---
name: kind-live-verification-harness
description: How to drive and observe the live kind-bank-usac deployment (sessions, mock, Prometheus/Loki/Tempo, Playwright) and which actions the auto-mode classifier blocks
metadata:
  type: reference
---

Live checks against `kind-bank-usac` (always `--context kind-bank-usac`; the ambient context is another project's GKE).

- Sessions: seeded `admin@/cajero@/cliente@bankusac.gt` with `BankUsac#2026`. A fresh funded customer = POST multipart `/api/customers`, activation link scraped from `kubectl logs` of **both** notification-audit pods (REVEAL_ACTIVATION_LINKS=true in kind), `verify-email`, cajero `identity-verdict` + `kyc-status`, open account, cajero `POST /accounts/{id}/deposit`. The simulated identity check sometimes auto-rejects a new customer (KYC REJECTED) yet still lets it open an account: handy for the "no KYC" case.
- Account status route needs `reason` (1-300 chars) even for ACTIVE.
- Observability access: own port-forwards `prometheus-server:80`, `loki:3100`, `tempo:3200` in ns `observability`. Tempo search returns trace ids without leading zeros; fetch `/api/traces/<id>` and group spans by `service.name`. Loki labels indexed: `service_name`, `deployment_environment`, `k8s_namespace_name`. Loki logs its own queries into stream `bank-observability`, so a search for a test value always "hits" there: filter `k8s_namespace_name="bank-usac"`.
- Partner mock admin: `kubectl port-forward svc/bank-usac-partner-bank-mock 13021:3021`, header `x-admin-token`. Mode flips are hot (`PUT /admin/config`). TIMEOUT + `statusBehavior: PROCESSING` resolves at ~185 s (cancel path); `UNREACHABLE` waits expiresAt+300 s (~8-9 min).
- `check-dashboards.sh --live` defaults to `--environment prod`; pass `--environment local --redaction-namespace bank-usac` or you get 93 bogus failures. It takes >2 min: run it in the background. Platform panels use `namespace=~"$environment"` and kind's namespace is `bank-usac`, so those panels are empty locally by design of the kind environment.
- Playwright + Chromium are installed (`node_modules/playwright/index.mjs`, import by absolute path). The deployed web image may be older than the repo source (placeholder `BANCO_PAREJA` vs `BANK99`).
- Auto-mode classifier denied in this session: `kubectl exec ... kill 1` (pod restart) and `test/load/scenario.sh rechazo` (its `kubectl exec` into the mock). `scenario.sh proveedor` (no exec) ran fine. Flipping the mock over its HTTP admin API was not blocked. Do not look for workarounds; report what could not be run.
