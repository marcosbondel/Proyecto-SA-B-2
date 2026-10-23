---
name: gke-live-verification-harness
description: How to drive and measure the live GKE prod deployment (kubectl helper, port-forwards, Prometheus/Loki/Tempo/Grafana APIs, k6 gotchas, alert timing) and the traps that cost time
metadata:
  type: reference
---

Prod on GKE (ns `prod`, observability in `observability`). Never use plain `kubectl`; use `tmp/t60/k-gke.sh` (token per call; DNS flakes make it fall back to the wrong user — a Forbidden error means retry, not a permissions fact).

- Port-forwards: run `tmp/t60/qa/pf.sh <ns> <svc> <local:remote>` (a retry loop) with Bash `run_in_background` AND `timeout: 7200000`; the default 30 min limit kills them silently mid-test. `nohup ... &` inside a normal call dies when the call returns. Ports used: grafana 13002, prometheus 13090, loki 13100, tempo 13200, mock 13021.
- Scripts in `tmp/t60/qa/`: `libp.mjs`/`ibp.mjs` (prod versions of lib/ib, creds from `tmp/t60/secretos-nube.env`), `gr.py` (Grafana API without echoing the password), `gr_alerts.py`, `settle.mjs` (reconcile a window by `/api/transfers?from&to` slices), `transfer-const.js` (k6 constant-rate wrapper around test/load/support.js), `runnerp.sh` (partner-mock scenarios), `shots*.mjs` (Playwright to Grafana/Cloud Run web).
- Never write `G="curl -u admin:$PW ..."; $G url` in zsh: it breaks and prints the Grafana password in the error. Use the python helper.
- Prometheus label for the environment is `environment` (not `deployment_environment`); Loki/Tempo use `deployment_environment` / `deployment.environment`. OTel metrics lag ~60 s behind the event.
- Gateway returns `x-trace-id` and `x-correlation-id` headers: easiest way to find a trace. `GET /api/transfers` max `limit=100`, no pagination: slice by `from`/`to`.
- k6 transfer scripts move Q1.00 MONETARIA -> AHORRO per iteration and DRAIN the seeded Q2500 source after ~2500 transfers; then every iteration fails INSUFFICIENT_FUNDS in 0.2 s and silently invalidates latency/alert experiments. Check the balance first; refill with a cajero `POST /accounts/{id}/deposit`.
- `PUT /api/payments/simulation` is shared state: latencyMs=6500 makes every transfer miss SLO-2 (5 s); always reset (`{reset:true}`).
- Alert timing: rules are `for` 2-30 min over recording rules; a burst of fast/FAILED transfers resets a `pending` alert, so slow traffic must be continuous. Multi-window burn rules use `min(1h,5m)` so a 1h window diluted by earlier good traffic will not fire FastBurn.
- `kyc-status` body is `{status}` only (extra `reason` => 400). Registering a customer in prod is possible but activation links are masked, so no new customer can log in; identity-verdict/kyc-status still work on pending customers; KYC VERIFIED cannot be flipped to REJECTED (ILLEGAL_TRANSITION, ignored silently with a 202).
- RabbitMQ in prod does mount a PVC (`rabbitmq-data`, 2Gi; checked on the live Deployment 2026-10-22), yet scaling it to 0 still lost in-flight work (saw 1 Saga stuck PENDING). Gateway pods crash (unhandled REPLY_TIMEOUT) when the broker disappears.
- Dev and prod share the 5 DBs; dev pods' outbox relays/sweepers will process prod rows if dev services run (see project memory).
