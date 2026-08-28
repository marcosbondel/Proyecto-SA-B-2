# Quickstart & Validation: Audit Remediation

Runnable scenarios that prove each phase works end to end. Commands run from the
repository root. This is a validation guide, not implementation detail — the code
lives in the phases defined in [plan.md](./plan.md) and the tasks in `tasks.md`.

## Prerequisites

- Node 24.19.0 (`nvm use`), pnpm 11.21.0 (`corepack enable`), Docker running.
- `kind` and `helm` installed (US1).
- `pnpm install` once.

## Phase P1 — grade and money

### US1 — deploys and runs on local Kubernetes

```bash
pnpm dev:infra                              # external deps on the bank-usac-local network
kind create cluster --config infra/k8s/kind/cluster.yaml
pnpm images:build -- --kind bank-usac       # build 7 images, load into the kind node
helm upgrade --install bank-usac infra/k8s/helm/bank-usac \
  --set-file secrets=... --namespace bank-usac --create-namespace
kubectl -n bank-usac get pods               # all 7 workloads Ready
kubectl -n bank-usac port-forward svc/gateway 3000:3000 &
kubectl -n bank-usac port-forward svc/web 3010:3010 &
```

**Expected**: all seven pods reach `Ready`; the five Postgres, RabbitMQ, and MinIO
run **outside** the cluster (`docker ps`, not `kubectl get pods`); a transfer
completes end to end through the forwarded Gateway; stopping a database leaves its
pod `Running` but not `Ready` (never `CrashLoopBackOff`).

### US2 — deliverables complete and consistent

- `docs/manual/` exists and covers each role × functionality.
- The C4 context diagram shows the API Gateway; render both sources and confirm
  they agree: `pnpm` diagram render (PlantUML + Mermaid) with **no** diff.
- Every path a diagram names exists: the deployment diagram's Helm chart path
  resolves to `infra/k8s/helm/bank-usac`.
- The integrator technical document maps each §4.4 deliverable to its file.

### US3 — money survives broker failure

```bash
DATABASE_URL=... pnpm --filter transaction-service test   # incl. outbox integration
DATABASE_URL=... pnpm --filter payment-service test       # NEW integration tests
DATABASE_URL=... pnpm --filter account-service test       # dedup + compensation guard
pnpm images:flow                                          # 3 saga shapes, balances asserted
```

**Expected**:
- With a broker publish failure injected at the commit/publish boundary, the
  compensation and the terminal payment event are **eventually delivered** by the
  relay; no transfer stays frozen in `PAYMENT_PENDING`.
- Two `payment succeeded` messages (distinct message ids, same transfer) → exactly
  **one** credit.
- A compensation for a never-debited transfer → **zero** credit, anomaly recorded.
- `images:flow` still proves COMPLETES / COMPENSATES-first-attempt /
  COMPENSATES-after-ladder, asserted on balances.

### US4 — act only within your authority

- As a `CLIENTE`, `PATCH /api/customers/{otherId}` → **refused** by Customer
  Service (not a silent success).
- A `customer.register.v1` on the broker with `role: ADMINISTRADOR` and no
  administrator identity → **rejected** (`ROLE_NOT_ELIGIBLE`).
- Two concurrent updates to one customer → neither field lost; no event announces
  a change that did not persist (covered by a new integration test).
- A whitespace-only name/document → rejected.

## Phase P2 — durability, coverage, surface

### US5 — nothing unprocessable is lost

- Publish a malformed envelope → recorded `INVALID` in the audit store (query the
  audit trail), not discarded.
- Force a message to exhaust its retry ladder → it lands in the bound, consumed
  error queue and is recorded, not dropped.

### US6 — every function exercisable from the UI

Via the running stack (`/run` skill):
- As a teller, open `/clientes/validaciones`, pick a pending customer, **approve**
  → the account moves to the expected state; **reject** works too.
- As a `CLIENTE`, register from `/registro`; the confirmation resolves to a
  **definitive** outcome (confirmed/failed), not perpetual pending.
- Open a customer in the update form → fields are **populated** from the read path.

### US7 — public surface hardened

- Hammer `POST /api/auth/login` and `POST /api/customers` → rate-limited after the
  threshold.
- Request activation repeatedly → only the **latest** token validates; the prior
  links are dead.
- Drop the delivery channel briefly, then restore → the pending activation
  notification is **retried and delivered**.
- Inspect the images compose → `REVEAL_ACTIVATION_LINKS` is **off** by default.

## Phase P3 — hygiene, jobs, docs

### US8 — clean checkout comes up right

```bash
cp infra/docker/.env.example infra/docker/.env
bash infra/docker/scripts/write-host-env.sh
pnpm dev:host
```

**Expected**: the ports the scripts generate match the ports the stack publishes
(5673/15673/9002/9003) with **zero** manual correction; the broker authenticates
with the developer's configured password (no `changeme` override); the env-parsing
scripts do not evaluate file contents.

### US9 — scheduled work runs

- Restart account-service on an interval shorter than the job interval → the
  deactivation job still runs (startup and/or catch-up).
- Two retry sweepers → each due row claimed once.
- A manual deactivation with a reason → the reason appears in the audit trail.

### US10 — docs and contracts consistent

```bash
pnpm --filter @bank/contracts schema:emit    # regenerate
pnpm --filter @bank/contracts test           # drift test now guards it
```

**Expected**: exported schema count matches the 55-contract catalog; the
`DOC_INVENTORY` coverage claim is accurate; the ADR count and blocked-state notes
match reality.

## Global gates (every phase)

```bash
pnpm lint          # architecture rules + isolation
pnpm test          # unit everywhere
pnpm test:contract # contracts
pnpm typecheck
```

All must stay green; no change may introduce a synchronous inter-service call or
cross-database access (the `isolation.spec.ts` suites fail the build if it does).
