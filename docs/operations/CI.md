# Continuous Integration

The pipeline that runs the verification every contributor is expected to run
locally, automatically, on every push to a `feature/*` branch and on every
pull request into `develop`. Built by **T-32**. Defined in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## What triggers it

| Event | Branches | Runs |
| --- | --- | --- |
| `push` | `feature/**` | `build` → `test` → `validate`, in that order |
| `pull_request` | target `develop` | `build` → `test` only |
| `workflow_dispatch` | any | `build` → `test` → `validate` |

A push to `main`, `develop` itself, or any other branch does not trigger the
workflow — those are integration or release branches, not where a contributor
lands unreviewed commits. `concurrency` cancels an in-flight run for the same
ref when a new push arrives, so a rapid sequence of fixups does not queue
redundant runs.

## The three phases

The assignment statement (`docs/references/780_Proyecto_2_2S2026.pdf`,
"Flujo de Integración y Despliegue Continuo") names three **Fases
obligatorias** — Build, Test, Validación — and requires a pull request into
`develop` to repeat only Build and Test. The pipeline mirrors that literally:
each phase is its own GitHub Actions **job**, not a step folded into a bigger
one, so the three appear as separate, independently pass/fail entries in the
checks list and none can be skipped without being visible as skipped.

`test` declares `needs: build`, and `validate` declares `needs: [build, test]`
— the chain runs strictly in the order the assignment lists it, Build then
Test then Validación, and a failure anywhere skips every phase after it
automatically. That satisfies "detener el pipeline ante cualquier fallo" and
"no se permite omitir etapas del pipeline" without any extra logic.

### Fase 1 — Build (`build`)

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | The lockfile matches every `package.json`; the workspace installs from a clean checkout | `pnpm-lock.yaml` is stale — regenerate it locally and commit it |
| Build | `pnpm build` | The seven applications and the shared packages compile, `@bank/contracts` before `@bank/messaging` before anything that imports them | A TypeScript or bundler error |

The job's last step saves Turborepo's local cache (`.turbo/`) as a GitHub
Actions cache keyed on the commit SHA. `test` and `validate` restore it before
running, so Turborepo reports a cache hit for the `build` task they both
depend on (`^build`) instead of recompiling on a second, unrelated runner —
the same "do not recompile what did not change" guarantee `turbo run build
--force` bypasses locally, applied across jobs.

### Fase 2 — Test (`test`)

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| Test | `pnpm test` | The unit suites for every application and package | A unit test regressed |
| Contract tests | `pnpm test:contract` | `@bank/contracts`'s own Jest suite | A shared contract broke |

Runs on both triggers: a `feature/**` push and a pull request into `develop`,
exactly the two points the assignment names for this phase.

### Fase 3 — Validación (`validate`)

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| No tracked `.env` files | `git ls-files` guard | No secret-bearing file was committed | A credential or config file was added by mistake; remove it and use `.env.example` instead |
| Lint | `pnpm lint` | Style **and** the architectural isolation rules in `apps/packages/tooling/eslint.base.mjs` (no cross-service import, no framework import in `domain`, no `infrastructure` import in `application`) | A style violation or an architecture boundary was crossed |
| Typecheck | `pnpm typecheck` | `tsc --noEmit` across every workspace | A type error `lint` did not already catch |

This is the phase the assignment describes only as "verificación básica del
sistema (ejecución o sanity check)": with no running system to smoke-test at
this stage (building and deploying Docker images is T-33's job, not a pull
request's), the sanity check this pipeline can perform is static — no secret
committed, no architectural boundary crossed, no type error — which is what
`git diff`/review cannot catch as reliably as a machine can.

`validate` carries `if: github.event_name != 'pull_request'`, so it does not
run on a pull request into `develop` — the assignment and the ticket only ask
that moment to repeat Build and Test.

Node and pnpm versions are read from `.nvmrc` and the `packageManager` field
in the root `package.json` in every job — nothing in the workflow pins a
version separately, so bumping either file is the only change a toolchain
upgrade needs.

## Why `pnpm format:check` is not a step

It fails today against files this ticket has no reason to touch: the Helm
templates under `infra/k8s/helm/bank-usac/templates/` use Go template syntax
(`{{- $component := ... }}`) that is not valid YAML, so Prettier's YAML parser
rejects them, plus a handful of pre-existing warnings elsewhere in the
workspace. Wiring a failing check into a required pipeline would make every
push red for a reason unrelated to the change being verified. Whoever
resolves those files can add the step back; until then, `pnpm format:check`
stays a local, non-blocking habit.

## What a green run does **not** prove

Every service's `test/repository.integration.spec.ts` is gated
`describe.skip` when `DATABASE_URL` is unset, and
`apps/packages/messaging/test/broker.integration.spec.ts` is gated the same
way on `RABBITMQ_URL`. This pipeline sets neither, by design (see Scope
below), so a green `test` job:

- Never exercises the row lock a concurrent debit relies on, the optimistic
  `version` that rejects a stale write, or the `CHECK (balance >= 0)`
  constraint.
- Never exercises deduplication by `(idempotency_key, type)` or by the
  envelope's `messageId`.
- Never exercises the outbox surviving a crash between commit and publish.

Those are exactly the idempotency and failure-handling claims this project is
judged on — see the same warning in [`AGENTS.md`](../../AGENTS.md#commands).
This gap is tracked as TD-069 in [`docs/TECH_DEBT.md`](../TECH_DEBT.md).

## Scope: what this pipeline deliberately does not run

- `pnpm test:e2e` / `pnpm test:e2e:happypath` — need the full Docker stack and
  a browser; they belong to a slower, separate pipeline.
- `pnpm images:build` / `images:smoke` / `images:flow` — need Docker and
  produce the seven runtime images; that is continuous **deployment**
  territory (T-33), not verification of a pull request.
- Anything that needs PostgreSQL, RabbitMQ or MinIO as a live dependency.

## Secrets

The workflow references no `secrets.*` value anywhere, so there is nothing
that can leak into a log line. If a future step genuinely needs one:

- Add it as a repository secret (Settings → Secrets and variables → Actions),
  never as a literal in the YAML.
- Pass it as `env:` on the one step that needs it — not at job or workflow
  level, so no other step inherits it by accident.
- Never `echo` it, and never pass it as a command-line argument (arguments are
  visible in the runner's process list and in some log renderings).

## Reproducing it locally

The same commands, from a clean checkout, grouped by the phase that runs
them:

```bash
pnpm install --frozen-lockfile

# Fase 1 — Build
pnpm build

# Fase 2 — Test
pnpm test
pnpm test:contract

# Fase 3 — Validación (skip these two if only reproducing a pull-request run)
pnpm lint
pnpm typecheck
```

To also exercise the suites the pipeline skips, follow the "Check the ports
before trusting them" section of [`AGENTS.md`](../../AGENTS.md#commands) —
`pnpm dev:infra` plus a `DATABASE_URL`/`RABBITMQ_URL` per service.

## Delivery and Deployment

CI is one of three workflows. The other two carry the assignment's delivery and
deployment phases, and they are wired differently from each other on purpose.

| Workflow | Fires on | What it does |
| --- | --- | --- |
| `ci.yml` | push to `feature/**`, PR into `develop` or `main` | Build → Test → Validación |
| `release.yml` | push to `release/**`, tag `v*` | Generates the version, **publishes** seven versioned images to `ghcr.io` |
| `cd.yml` | push to `develop` / `main` | Deploys to GKE: namespace `dev` from `develop`, namespace `prod` from `main` |

**Production never builds an image.** `cd.yml`'s production job resolves the
newest `v*` tag and deploys the images `release.yml` already published, which is
what the assignment means by "el pipeline utilizará las imágenes previamente
generadas". If no tag exists the job fails rather than inventing one — a
production deploy of an unpublished artifact is the thing the release phase
exists to prevent.

**No tag is ever `latest`.** `release.yml` tags with the version, `cd.yml`'s dev
job tags with `dev-<sha12>`, and `helm-deploy.sh` refuses `latest` outright so
the rule holds even when the script is run by hand.

### What `cd.yml` needs before it can deploy

`cd.yml` starts with a `preflight` job that **fails** when the configuration
below is missing, naming what is absent in the run summary. That is deliberate:
a deployment workflow that prints success without deploying hides the problem
from the only person who could fix it.

Under *Settings → Secrets and variables → Actions*:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `GCP_PROJECT_ID` | the GCP project id |
| Variable | `GKE_CLUSTER` | `bank-usac-vpc-gke` (see `infra/terraform/gcp/gke.tf`) |
| Variable | `GKE_ZONE` | `us-central1-a` (see `variables.tf`) |
| Variable | `ARTIFACT_REPO` | the Artifact Registry repository, e.g. `bank-images` |
| Variable | `GATEWAY_PUBLIC_URL` | the Gateway address **as a browser reaches it** (Terraform's `gateway_public_url`) |
| Variable | `WEB_PUBLIC_URL` | *optional* — the frontend's origin, for the Gateway's `CORS_ALLOWED_ORIGINS` |
| Secret | `GCP_SA_KEY` | service-account JSON with `container.developer` and `artifactregistry.writer` |
| Secret | `HELM_SECRETS` | the eleven `secrets.*` values the chart marks `required`, one `key=value` per line |
| Secret | `INFRA_ADDRESSES` | the seven `external.*.dockerNetwork.host` addresses, one per line |

`HELM_SECRETS` and `INFRA_ADDRESSES` are multi-line on purpose. Eighteen
separate GitHub secrets for one consumer is the same problem spread across
eighteen places, and the chart already treats them as one set — the same set
`infra/k8s/scripts/install.sh` assembles for the local kind cluster.

`INFRA_ADDRESSES` holds the private IPs of the machines Terraform provisions
(`terraform output` in `infra/terraform/gcp/`). The databases run on Compute
Engine VMs rather than inside the cluster, so the chart has to be told where
they are; `external.mode` stays `dockerNetwork`, which despite its name means
"an explicit host and port" and is exactly what a VM address is.

### The one component without an HPA

`account-service` ships with `autoscaling.enabled: false`. It is not an
oversight: besides consuming its queue it runs the inactive-account sweep on an
interval with no leader election, so N replicas would make the sweep run N
times. Six of the seven components autoscale at 80% CPU; this one is pinned to
a single replica until that job has an owner.

### Why CI also fires on pull requests into `main`

The assignment only asks for Build and Test to repeat on the way into
`develop`, and that is what happens. `main` is listed as a trigger anyway
because the `main_protection` ruleset requires all three phase checks to report
before a merge is allowed, and it covers `main` as well as `develop`. Without
that trigger a pull request into `main` runs no CI at all, the three required
checks never report, and the merge sits blocked in `pending` forever — it does
not fail, which would be easier to diagnose; it simply never advances.

Validación does run on a pull request into `main`, unlike one into `develop`.
That branch is the last gate before a production deploy, and skipping lint, the
typecheck and the tracked-`.env` guard precisely there would be the worst
possible moment to save two minutes.

### Why `GATEWAY_PUBLIC_URL` is required and not defaulted

The chart defaults `web.apiBaseUrl` to `http://localhost:3000`, which is right
for a kind cluster reached through `kubectl port-forward` and silently useless
on GKE. Left at the default, a deploy **succeeds** and hands back a frontend
that cannot reach its own backend — the deployment is green, the pods are
`Ready`, and the application does not work. `helm-deploy.sh` refuses to run
without it so that outcome has no way to happen.

`WEB_PUBLIC_URL` is optional and deliberately has no derived default. It is the
origin the *browser* loads the frontend from, not the Gateway's own address, and
guessing it wrong would open CORS to the wrong list without anyone noticing
until a legitimate request is refused.
