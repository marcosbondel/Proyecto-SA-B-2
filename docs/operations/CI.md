# Continuous Integration

The pipeline that runs the verification every contributor is expected to run
locally, automatically, on every push to a working branch and on every pull
request into `develop`. Built by **T-32**. Defined in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). The decision to
build it on GitHub Actions, and the three alternatives rejected, is
[ADR-015](../architecture/adr/ADR-015-ci-cd-platform.md).

## What triggers it

| Event | Branches | Runs |
| --- | --- | --- |
| `push` | `feature/**`, `fix/**`, `test/**`, `docs/**`, `chore/**`, `refactor/**` | `build` → `test` → `validate`, in that order |
| `pull_request` | target `develop` | `build` → `test` only |
| `pull_request` | target `main` or `master` | `build` → `test` → `validate` |
| `workflow_dispatch` | any | `build` → `test` → `validate` |

**Six branch prefixes and not only `feature/**`.** The assignment names the
feature branches, but the team also opens `fix/`, `test/`, `docs/`, `chore/`
and `refactor/`, and on those a push used to trigger nothing at all: their code
reached `develop` with the pull request's Build and Test and without having
passed Validación — lint, typecheck, the tracked-`.env` guard — even once.

A push to `develop` or `main` themselves does not trigger this workflow: those
are integration branches, and what fires there is `cd.yml`. `concurrency`
cancels an in-flight run for the same ref when a new push arrives, so a rapid
sequence of fixups does not queue redundant runs.

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

The job declares PostgreSQL 18.4 and RabbitMQ 4.3.4 as service containers,
matching the local Compose targets. **GKE currently runs RabbitMQ
`3.13-management`**, as observed on 2026-10-21; CI therefore does not prove
compatibility with the deployed broker version (TD-097). Verify runtime database
versions separately from the image selected for CI.

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| Install Playwright Chromium | `pnpm exec playwright install --with-deps chromium` | The browser and Linux libraries required by the web app's browser integration suite | Chromium or a required runner library could not be installed |
| Test | `pnpm test` | Unit suites and the web app's integration suites for every application and package | A test regressed |
| Contract tests | `pnpm test:contract` | `@bank/contracts`'s own Jest suite | A shared contract broke |
| Two databases per service | `psql … CREATE DATABASE` | Five databases in one instance — they each run their own migrations and would collide on `schema_migrations` — plus a `_pyramid` copy of each | The service container is not up |
| Integration suites | `pnpm --filter <pkg> test` with `DATABASE_URL` / `RABBITMQ_URL` | The row lock, the optimistic version, the `CHECK` constraints, deduplication, and the Gateway against a **real broker** | A guarantee the database or the broker enforces just broke |
| Pyramid shape | `pnpm test:pyramid --require-executed --without-e2e` | The proportion between the two layers this run measured, per package and for the system | An app drifted out of proportion, or a suite did not execute |

**The E2E does not run here.** It needs the seven components standing and is
run by hand against a local stack; `test/e2e/run-all.mjs` writes its report to
`docs/qa/pyramid-e2e.json`, which is committed as evidence. That is precisely
why the pyramid step carries `--without-e2e`: a report from another machine on
another day is always sitting in the checkout, and asserting a 70/20/10 over it
is the green-that-never-ran this pipeline exists not to give. Worse, the error
would not even point at the E2E — a short one does not only lower its own
share, it raises the other two by the same arithmetic, so three deviations
appear where there is no drift at all.

With the flag the E2E row is *reported* and not asserted, and what CI checks is
the ratio between the two layers it did run: integration as a share of each
app's own tests, against the same 22.2 % already required package by package —
70:20 normalised. The three-layer number is a local command, below.

Every integration step carries the same guard: **if Jest reports any suite as
`skipped`, the step fails**. A suite that skips itself still counts green
otherwise, and that is the defect this guard exists to catch — the pipeline
would pass identically if the environment variables never reached Jest.

Before `pnpm test`, CI installs Chromium with
`pnpm exec playwright install --with-deps chromium`. The web app's
`session-guard.integration.spec.ts` exercises the client-side route middleware
in a real browser through `@nuxt/test-utils`; installing the Playwright npm
package alone does not install its browser binary or the runner's Linux
libraries.

`pnpm test:pyramid --require-executed` is the second half of that idea. Here
there is a real PostgreSQL and a real RabbitMQ, so an integration suite that
skipped is not a circumstance — it is the measurement that did not happen, and
the flag turns it into a failure rather than a footnote.

For that to be true the script needs the database and not only the broker.
`pnpm test:pyramid` runs each package's Jest as a child process, and the child
inherits this step's environment: without `DATABASE_URL` the eight repository
suites close behind `describe.skip` and the flag reports all eight. It arrives
as `PYRAMID_DATABASE_URL_TEMPLATE`, one template with `{db}` where the name
goes, because a package's database is named by `test/pyramid.manifest.json` and
the script has no business knowing the host or the password. The names end in
`_pyramid`: these suites assume a virgin database — they create their rows and
check unique constraints against them — and the integration step above already
spent the other five.

Fase 3 does not run on a pull request into `develop`, which is the rule the
assignment writes down: into `develop`, Build and Test.

Build and Test run on both triggers — a `feature/**` push and a pull request
into `develop` — exactly the two points the assignment names for this phase.

### Fase 3 — Validación (`validate`)

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| No tracked `.env` files | `git ls-files` guard | No secret-bearing file was committed | A credential or config file was added by mistake; remove it and use `.env.example` instead |
| Lint | `pnpm lint` | Style **and** the architectural isolation rules in `apps/packages/tooling/eslint.base.mjs` (no cross-service import, no framework import in `domain`, no `infrastructure` import in `application`) | A style violation or an architecture boundary was crossed |
| Typecheck | `pnpm typecheck` | `tsc --noEmit` across every workspace | A type error `lint` did not already catch |
| Charts de Helm | `helm lint` + `helm template` + `check-chart-deps.sh` | Both charts render: `bank-usac` in the shape production deploys (including `gateway.loadBalancerIP`, which TD-080 left uncovered for three weeks), and `bank-observability` with the four greps that distinguish a stack that measures from one that is merely green | A chart change broke the render, or `Chart.yaml`, `Chart.lock` and `charts/` drifted apart |

**Why the Helm step renders and does not only lint.** `helm lint` passes on a
chart whose `values.yaml` names a key no subchart knows — that is exactly how
`loki.otlpConfig` sat there doing nothing until the render was read. And the
render alone is not enough either: it succeeds happily against a stale
`charts/*.tgz`, which is why `check-chart-deps.sh` compares `Chart.yaml`,
`Chart.lock` and the vendored archives **without touching the network**. The
charts were not validated anywhere before 2026-10-13; `pnpm lint` reads
TypeScript and `pnpm format:check` is out of the pipeline for the reason below.
A chart CI never renders breaks at deploy time, and `bank-observability` *is*
the deployment of the stack — which §8.3 prices at 25 % if it has to be done by
hand.

This is the phase the assignment describes only as "verificación básica del
sistema (ejecución o sanity check)": with no running system to smoke-test at
this stage (building and deploying Docker images is T-33's job, not a pull
request's), the sanity check this pipeline can perform is static — no secret
committed, no architectural boundary crossed, no type error — which is what
`git diff`/review cannot catch as reliably as a machine can.

`validate` carries
`if: github.event_name != 'pull_request' || github.base_ref == 'main' || github.base_ref == 'master'`,
so it does not run on a pull request into `develop` — the assignment and the
ticket only ask that moment to repeat Build and Test — and it **does** run on
one into `main`, which the assignment does not cover and which is the last gate
before a production deploy.

Node and pnpm versions are read from `.nvmrc` and the `packageManager` field
in the root `package.json` in every job — nothing in the workflow pins a
version separately, so bumping either file is the only change a toolchain
upgrade needs.

## Why `pnpm format:check` is not a step

It fails today against files this ticket has no reason to touch: the Helm
templates under `infra/k8s/helm/` use Go template syntax
(`{{- $component := ... }}`) that is not valid YAML, so Prettier's YAML parser
rejects them, plus a handful of pre-existing warnings elsewhere in the
workspace. Wiring a failing check into a required pipeline would make every
push red for a reason unrelated to the change being verified. Whoever
resolves those files can add the step back; until then, `pnpm format:check`
stays a local, non-blocking habit.

## What a green run does **not** prove

This section used to say the pipeline exercised none of the guarantees the
database and the broker enforce, because it started neither. **That is no
longer true** — TD-069 closed it, and the integration steps above now run
against a real PostgreSQL and a real RabbitMQ. What a green run still does not
prove:

- **No end-to-end flow is exercised.** The E2E suites run locally, against a
  stack somebody stood up by hand, and their report is committed as evidence.
  A green CI says every component behaves; it does not say a transfer completes
  across all seven of them. `docs/qa/pyramid-e2e.json` is the only claim about
  that, and it is as old as the last time somebody ran it.
- **MinIO and the deployable images are never exercised.** Object storage stays
  doubled in the unit suites, and nothing here runs what `pnpm images:build`
  produces — which is what a deployment actually starts.
- **`pnpm format:check` is still not a step** (see below).
- A green pyramid is a statement about *proportion*, not about *quality*. It
  counts cases; it cannot tell a sharp assertion from a decorative one.

## Scope: what this pipeline deliberately does not run

- `pnpm images:build` / `images:smoke` / `images:flow` — need Docker and
  produce the seven runtime images; that is continuous **deployment**
  territory (T-33), not verification of a pull request.
- Anything needing MinIO as a service container, for the reason above.

## Secrets

The CI workflow references no repository `secrets.*` value. This limits its
credential inputs; it is not proof that arbitrary command output is secret-free. If a future step genuinely needs one:

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

# Fase 2 — las suites de integración, contra dependencias reales.
# Una por paquete, cada una con su propia variable: ver la sección "Check the
# ports before trusting them" de AGENTS.md para las cinco URLs.
pnpm dev:infra
DATABASE_URL=postgresql://customer_app:changeme@localhost:5433/customer \
  pnpm --filter customer-service test
RABBITMQ_URL=amqp://bank_app:changeme@localhost:5673 \
  pnpm --filter gateway test
RABBITMQ_URL=amqp://bank_app:changeme@localhost:5673 \
  pnpm --filter @bank/messaging test

# Fase 2 — la forma de la pirámide, como la corre el pipeline
pnpm test:pyramid --without-e2e

# Fase 3 — Validación (skip these two if only reproducing a pull-request run)
pnpm lint
pnpm typecheck
```

`pnpm test:pyramid` without the infrastructure still prints the table — the
cases are *declared* either way — but it lists everything that did not execute
and says so. Add `--require-executed` to make that a failure, which is how the
pipeline runs it; locally that also needs `PYRAMID_DATABASE_URL_TEMPLATE`,
since the script composes each package's `DATABASE_URL` from it before handing
the environment to Jest.

### The E2E, and the only run that measures all three layers

CI does not run it. To exercise the flows end to end, and to get a pyramid
whose third layer is a measurement rather than a citation:

```bash
# Las siete aplicaciones, no solo la infraestructura
SEED_DEMO_DATA=true REVEAL_ACTIVATION_LINKS=true pnpm dev
node test/e2e/run-all.mjs

# Ahora sí, las tres capas contra 70/20/10 — sin --without-e2e
pnpm test:pyramid
```

`run-all.mjs` writes `docs/qa/pyramid-e2e.json`; commit it, because that file
is the repository's only evidence that a flow crosses all seven components.
Run the two commands in that order — the pyramid reads the report, so measuring
first measures the previous run.

Turbo caches `test`, so a second run reports `FULL TURBO` without executing
anything. That is a real pass when the inputs are identical, but when you need
to *see* a suite run, add `--force`.

## Delivery and Deployment

There are **four workflows**: `ci.yml`, reusable `changes.yml`,
`release.yml` and `cd.yml`. The reusable classifier selects development image
builds; release and CD implement delivery and deployment.

| Workflow | Fires on | What it does |
| --- | --- | --- |
| `ci.yml` | push to any work branch (`feature/**`, `fix/**`, `test/**`, `docs/**`, `chore/**`, `refactor/**`), PR into `develop` or `main` | Build → Test → Validación |
| `changes.yml` | `workflow_call` from CD | Classifies shared and component paths for selective development builds |
| `release.yml` | push to `release/**` or `release-*`, tag `v*`, or manual dispatch | Generates the version, **publishes** seven versioned images to Artifact Registry (`<region>-docker.pkg.dev/<project>/<repo>`) |
| `cd.yml` | push to `develop` | Builds only the **modified** components and deploys them to GKE, namespace `dev` |
| `cd.yml` | push to `main` | Deploys the newest `v*` tag's images to GKE, namespace `prod`, with a rolling update |

**Production never builds an image.** `cd.yml`'s production job resolves the
newest `v*` tag and deploys the images `release.yml` already published, which is
what the assignment means by "el pipeline utilizará las imágenes previamente
generadas". If no tag exists the job fails rather than inventing one — a
production deploy of an unpublished artifact is the thing the release phase
exists to prevent.

**No tag is ever `latest`.** `release.yml` tags with the version, `cd.yml`'s dev
job tags with `dev-<commit sha>` — defined once as the workflow-level
`DEV_IMAGE_TAG`, because when the building job and the deploying job each
composed it separately they disagreed on its length and the deploy referenced an
image that was never pushed — and `helm-deploy.sh` refuses `latest` outright so
the rule holds even when the script is run by hand.

### Promoting to production: the order matters

**Historical diagnosis (2026-10-16):** `main` was behind development and the
newest tag was `v1.2.2`, before Phase III. The production inventory of
2026-10-21 now shows **v1.3.6**; the old commit counts are not the present state.
The release-order failure described below remains relevant:

> Before the version-containment gate, merging without a new published tag
> could deploy **the previous version**. `cd.yml` resolves `git tag -l 'v*' --sort=-v:refname | head -n 1`,
> which is the highest tag *in the repository*, not the tag of the commit being
> deployed. The rollout reaches `Ready`, the summary is green, and production
> runs Phase II.

Measured on 2026-10-16: `main` was 113 commits ahead of `v1.2.2`, so the first
Phase III deploy would have stood up Phase II.

`cd.yml` now **refuses** that. The check is the reverse of the one you write
first: not "is the tag an ancestor of this commit?" — `v1.2.2` was, which is why
a plain `--is-ancestor` does not catch it — but **"is this commit contained in
the tag?"**. If it is not, the images carrying that tag do not contain this
code, and the job fails naming how many commits ahead `HEAD` is.

So the promotion is four steps, in this order:

```bash
# 1. Merge after review and current conflict checks; the old rehearsal is not a current guarantee.
git checkout main && git pull && git merge --no-ff develop && git push

# 2. Tag the commit that is now main's tip. This is what gets built.
git tag -a v1.3.0 -m "Fase III: interbancario, observabilidad y nube" && git push origin v1.3.0

# 3. WAIT for release.yml to publish the seven images. Production does not
#    build: it deploys what this run pushed to Artifact Registry. Deploying
#    before it finishes is an ImagePullBackOff, not an error message.
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status

# 4. Only then, the production deploy. The push to main in step 1 already
#    triggered cd.yml — and it will have FAILED at the version check, because
#    the tag did not exist yet. Re-run it:
gh workflow run cd.yml --ref main
```

Step 3 is the one that looks skippable and is not. Steps 1 and 2 can be done in
one push (`git push origin main v1.3.0`), which avoids the failed run in step 4
— but then nothing proves the tag landed before the deploy started, so the
sequence above keeps them apart.

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
| Variable | `GKE_ZONE` | `us-central1-c`, current Terraform default and live cluster |
| Variable | `ARTIFACT_REPO` | the Artifact Registry repository, e.g. `bank-images` |
| Variable | `GATEWAY_PUBLIC_URL` | the Gateway address **as a browser reaches it** (Terraform's `gateway_public_url`) |
| Variable | `WEB_PUBLIC_URL` | *optional* — the frontend's origin, for the Gateway's `CORS_ALLOWED_ORIGINS` |
| Variable | `WIF_PROVIDER` | *(preferred)* the Workload Identity provider resource name |
| Variable | `WIF_SERVICE_ACCOUNT` | the service account WIF impersonates |
| Secret | `GCP_SA_KEY` | *(alternative)* service-account JSON — see the note below before creating one |
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

### The component that used to have no HPA

All seven autoscale at 80% CPU. `account-service` did not, and the reason was
real: besides consuming its queue it runs the inactive-account sweep on an
interval, and with N replicas there are N timers, so the sweep ran N times.
The scheduler's in-process guard cannot help — it is one guard per process.

`PostgresSweepLease` gives that job the owner it was waiting for. Each replica
takes a `pg_try_advisory_lock` before sweeping: the one that gets it sweeps, the
others skip their turn rather than queue behind it, since the next tick will try
again anyway. The lock is held by a session, so a pod that dies mid-sweep
releases it by disconnecting — there is no stale lease to clean up by hand.

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

### Authentication: Workload Identity Federation, or a key

The CD workflow accepts either, and `preflight` is satisfied by whichever is
present. **Prefer Workload Identity Federation.**

A downloaded service-account key is a permanent credential: it does not expire,
it lives in a secret store forever, and a copy of it is a copy of the account.
Workload Identity Federation instead trades the OIDC token GitHub mints for
*this run* for short-lived GCP credentials. Nothing is stored, so nothing can
leak.

It is also, frequently, the only option available. Many organisations — USAC's
Google Workspace domain among them — enforce
`constraints/iam.disableServiceAccountKeyCreation`, which makes
`gcloud iam service-accounts keys create` fail outright. That policy is applied
at the organisation level and is not something a project owner can waive.

Setting it up creates no key at all:

```bash
PROJECT_ID=<tu-proyecto>
PROJECT_NUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
REPO=marcosbondel/Proyecto-SA-B-2
SA=github-actions-cd@"$PROJECT_ID".iam.gserviceaccount.com

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT_ID"

gcloud iam service-accounts create github-actions-cd \
  --display-name="GitHub Actions CD" --project="$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role="roles/container.developer"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role="roles/artifactregistry.writer"

gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions" --project="$PROJECT_ID"

# `attribute-condition` is not optional: without it, any repository on GitHub
# could mint a token this provider accepts.
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'" \
  --project="$PROJECT_ID"

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" \
  --project="$PROJECT_ID"

echo "WIF_PROVIDER=projects/$PROJECT_NUM/locations/global/workloadIdentityPools/github/providers/github-provider"
echo "WIF_SERVICE_ACCOUNT=$SA"
```

The last two lines print the two repository **variables** to set. There is no
secret to store, which is the point.

### The registry the release publishes to

`release.yml` publishes to the **same Artifact Registry the deployment pulls
from** — `<region>-docker.pkg.dev/<project>/<ARTIFACT_REPO>` — derived from the
same `GKE_ZONE`, `GCP_PROJECT_ID` and `ARTIFACT_REPO` the CD workflow uses.

It published to `ghcr.io` once, and the production deploy failed against
`v1.1.0` with `context deadline exceeded`: the images existed, verifiably, in a
registry nobody was pulling from. A delivery phase that hands over artifacts the
deployment cannot reach has not delivered anything. Both halves now read the
same three variables, so they cannot drift apart again.

### Credentials missing is red; infrastructure missing is skipped

`cd.yml`'s `preflight` job answers two questions, and treats the answers
differently on purpose:

| What is missing | What happens | Why |
| --- | --- | --- |
| A credential, variable or secret | The job **fails**, naming it | A misconfiguration is a human error and deserves a red X |
| The GKE cluster or the Artifact Registry repository | The build and deploy jobs are **skipped**, with the reason and the remedy written into the run summary | The infrastructure of this project is switched on and off deliberately — it costs about 0.50 USD/hour — so its absence is not a defect of the commit |

Neither path ever prints a deployment that did not happen, which is the rule
this workflow is built around. A skipped job is visually distinct from a passing
one; it is not a green tick for work that was not done.

This was added on 2026-10-14 because **every merge into `develop` had been red
since 2026-10-06**, all of them failing at the first `docker push` with
`Repository "bank-images" not found` — the registry had gone with the
infrastructure. A check that is permanently red reports nothing: when CD breaks
for a real reason, nobody will notice it among the noise. The fix restores the
signal without weakening the guarantee.

To bring the infrastructure back: `pnpm cloud:up`, then `pnpm cloud:cost` to see
what is running. The procedure is in
[CLOUD.md § 5.2](CLOUD.md). Note that §8.1 of the assignment requires the system
deployed and reachable in the cloud **on grading day**.

### The observability stack deploys from `main` only

`cd.yml` has a fifth job, **«Stack de observabilidad»**, that installs
`infra/k8s/helm/bank-observability` as its own release in the `observability`
namespace: the two OpenTelemetry Collectors, Prometheus, Tempo, Loki and
Grafana (T-49, [ADR-018](../architecture/adr/ADR-018-observability-stack.md) and its partial successor [ADR-023](../architecture/adr/ADR-023-observability-evolution.md)).

Unlike every other deploy job, it does **not** run on a push to `develop`. The
stack is *one* for both environments — `dev` and `prod` send their telemetry to
the same Collector and are read in the same Grafana, told apart by the
`deployment.environment` attribute from T-48 — so a development commit able to
update it would change production's monitoring. That is the same class of
problem as TD-070, except this one costs nothing to avoid. To iterate on the
stack without a merge: *Actions → CD → Run workflow → `deploy_observability`*.

It needs `GRAFANA_ADMIN_PASSWORD` (at least 16 characters) and
`ALERT_WEBHOOK_TOKEN` (at least 32), shared with the Gateway alert webhook. The job fails naming it rather than installing a Grafana with the
chart's public default password.

The job runs no `helm dependency build`. The subcharts are vendored in
`charts/` (372 KB) precisely so the deploy does not depend on the Grafana,
Prometheus and OpenTelemetry repositories answering, and `dependency build`
refreshes the repository index over the network — it would put back the
dependency that vendoring removed.

Two things it wires that are easy to miss:

- `OTEL_EXPORTER_OTLP_ENDPOINT` now **defaults** to
  `http://otel-gateway.observability.svc.cluster.local:4318` in both app deploy
  jobs. It used to be a repository variable somebody had to remember to set,
  and the cost of forgetting was that every instrumented line in the codebase
  exported nothing — which §8.3 prices at 50 %. The variable still exists, and
  is now only for pointing at a different Collector.
- The in-cluster RabbitMQ enables the `rabbitmq_prometheus` plugin and publishes
  on `:15692`, which is where the broker's consumer lag — a mandatory SLI —
  comes from. There is one broker per namespace, so Prometheus scrapes two
  targets and the `environment` label is what separates them.

### Environment separation, and what is *not* separated

`dev` and `prod` are two namespaces in the same GKE cluster. Each gets its own
pods, its own in-cluster RabbitMQ and its own MinIO. Messaging objects are
separate; nodes, databases hosts and the observability stack still share capacity.

**Los datos dev/prod están separados por base desde la configuración actual.**
`DEV_DATABASE_SUFFIX=_dev` llega al chart como `databaseSuffix`; las cinco URLs
efectivas se comprobaron el 2026-10-21: `customer_dev`, `account_dev`,
`transaction_dev`, `payment_dev`, `notification_audit_dev`, frente a las cinco
bases sin sufijo en prod. Las VMs, la capacidad y observabilidad se comparten.
La [evidencia sanitizada](../qa/load/2026-10-21-database-isolation.json) no
contiene contraseñas. TD-070 queda cerrada en cuanto a mezcla de filas/esquemas;
no demuestra aislamiento físico ni habilita ejecutar TRUNCATE en una demo viva.

### The `dev` deploy, and the two weeks it did not exist

Every merge into `develop` builds the modified components and deploys them to
the `dev` namespace: nine Deployments at `1/1` — the seven applications, its own
RabbitMQ and its own MinIO — with seven HPAs at 80% CPU.

It was not always there. The job was removed on 2026-09-25 because the cluster
could not hold it: GKE ran **one** node while `variables.tf` declared three, and
on that node the original manual release, `dev` and `prod` together reserved
more CPU than existed — 1911m requested of ~1930m allocatable, 99%, while
actually using 11%. Production's first real deploy left seven pods in
`FailedScheduling: Insufficient cpu`.

The historical fix needed no code change. The command below records that
2026-09-26 operation in the old zone; it is **not** a command for the present
`us-central1-c` cluster:

```bash
gcloud container clusters resize bank-usac-vpc-gke \
  --node-pool bank-usac-vpc-node-pool --num-nodes 3 \
  --zone us-central1-a --quiet
```

`retire-development` (Actions → CD → Run workflow → `retire_dev`) stays as the
escape hatch: it uninstalls the dev release and deletes its namespace, freeing
its 450m. It is idempotent and needs no gcloud access. **Run it from a branch
that is neither `develop` nor `main`** — the other jobs are gated on those refs,
so dispatching from `develop` would retire `dev` and redeploy it in the same
run, and dispatching from `main` would deploy production.

## Verification snapshot — 2026-10-21

The [production inventory](../qa/load/2026-10-21-gke-prod-inventory.txt),
[development inventory](../qa/load/2026-10-21-gke-dev-inventory.txt) and
[database names](../qa/load/2026-10-21-database-isolation.json) are evidence of
those specific deployments, not proof that this branch passed every workflow.
Grafana is public over HTTP, Dataplane V2 is active, and no NetworkPolicies
were applied at inspection. The old `cd.yml`/Helm NOTES message saying Grafana
has no LoadBalancer contradicts its current values (tracked under #167).

The seven development applications can be Ready while interbank testing is
unavailable: `INTERBANK_PARTNER_BASE_URL` is empty and no mock runs in `dev`.
Do not substitute a production fault injection for that missing test setup.
