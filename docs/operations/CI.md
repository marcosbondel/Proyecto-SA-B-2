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

The job declares PostgreSQL 18.4 and RabbitMQ 4.3.4 as service containers —
the same versions `infra/docker/docker-compose.yml` runs, because testing
against a different PostgreSQL than production ships checks something nobody
will deploy.

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| Install Playwright Chromium | `pnpm exec playwright install --with-deps chromium` | The browser and Linux libraries required by the web app's browser integration suite | Chromium or a required runner library could not be installed |
| Test | `pnpm test` | Unit suites and the web app's integration suites for every application and package | A test regressed |
| Contract tests | `pnpm test:contract` | `@bank/contracts`'s own Jest suite | A shared contract broke |
| Two databases per service | `psql … CREATE DATABASE` | Five databases in one instance — they each run their own migrations and would collide on `schema_migrations` — plus a `_pyramid` copy of each | The service container is not up |
| Integration suites | `pnpm --filter <pkg> test` with `DATABASE_URL` / `RABBITMQ_URL` | The row lock, the optimistic version, the `CHECK` constraints, deduplication, and the Gateway against a **real broker** | A guarantee the database or the broker enforces just broke |
| E2E — configure the stack | `cp .env.example .env`, move the broker's published ports | Compose has the variables it substitutes, and nothing collides with the job's own service containers | — |
| E2E | `node test/e2e/run-all.mjs` against the full Docker stack | The flows end to end through the seven components | A business flow broke where no single-component test could see it |
| Pyramid shape | `pnpm test:pyramid --require-executed` | The 70/20/10 split, measured per package and for the system | An app drifted out of proportion, or a suite did not execute |

**The pyramid is measured after the E2E, not before.** Its E2E layer is read
from the report `run-all.mjs` writes, so measuring first measures the *previous*
run — and that report is committed as evidence, so a stale one is always
present to be read by mistake. The configure step deletes it for that reason:
an E2E that never writes its own should make the pyramid say the report is
missing, not silently grade last week's.

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

The E2E steps used to share the Fase 3 job's gating rule — neither ran on a
pull request into `develop` — and that is no longer true of the E2E. The
pyramid's third layer *is* the E2E, so a run without it does not measure the
pyramid: it grades whichever report happened to be committed. Thirteen
containers on every iteration is a real cost, and it buys the only number that
makes `--require-executed` mean what it says. Fase 3 keeps the old rule, which
is the one the assignment actually writes down: into `develop`, Build and Test.

Build and Test run on both triggers — a `feature/**` push and a pull request
into `develop` — exactly the two points the assignment names for this phase.

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

This section used to say the pipeline exercised none of the guarantees the
database and the broker enforce, because it started neither. **That is no
longer true** — TD-069 closed it, and the integration and E2E steps above now
run against real dependencies. What a green run still does not prove:

- **MinIO is never a live dependency here.** A GitHub Actions service container
  cannot override a container's `command`, and `minio/minio` needs `server
  /data`, so object storage stays doubled in the unit suites and is only
  exercised for real by the E2E steps, which use Docker Compose rather than
  service containers.
- **The E2E stack is the development one, in watch mode.** `docker-compose.dev.yml`
  bind-mounts the workspace and runs each application through its `dev` script,
  so a green E2E says the flows work against the code as written — not against
  the images `pnpm images:build` produces, which is what a deployment runs.
- **`pnpm format:check` is still not a step** (see below).
- A green pyramid is a statement about *proportion*, not about *quality*. It
  counts cases; it cannot tell a sharp assertion from a decorative one.

## Scope: what this pipeline deliberately does not run

- `pnpm images:build` / `images:smoke` / `images:flow` — need Docker and
  produce the seven runtime images; that is continuous **deployment**
  territory (T-33), not verification of a pull request.
- Anything needing MinIO as a service container, for the reason above.

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

# Fase 2 — E2E (necesita las siete aplicaciones, no solo la infraestructura)
SEED_DEMO_DATA=true REVEAL_ACTIVATION_LINKS=true pnpm dev
node test/e2e/run-all.mjs

# Fase 2 — la forma de la pirámide, despues del E2E: su tercera capa sale
# del informe que run-all.mjs acaba de escribir
pnpm test:pyramid

# Fase 3 — Validación (skip these two if only reproducing a pull-request run)
pnpm lint
pnpm typecheck
```

`pnpm test:pyramid` without the infrastructure still prints the table — the
cases are *declared* either way — but it lists everything that did not execute
and says so. Add `--require-executed` to make that a failure, which is how the
pipeline runs it; locally that also needs
`PYRAMID_DATABASE_URL_TEMPLATE`, since the script composes each package's
`DATABASE_URL` from it before handing the environment to Jest.

Turbo caches `test`, so a second run reports `FULL TURBO` without executing
anything. That is a real pass when the inputs are identical, but when you need
to *see* a suite run, add `--force`.

## Delivery and Deployment

CI is one of three workflows. The other two carry the assignment's delivery and
deployment phases, and they are wired differently from each other on purpose.

| Workflow | Fires on | What it does |
| --- | --- | --- |
| `ci.yml` | push to `feature/**`, PR into `develop` or `main` | Build → Test → Validación |
| `release.yml` | push to `release/**`, tag `v*` | Generates the version, **publishes** seven versioned images to `ghcr.io` |
| `cd.yml` | push to `main` | Deploys to GKE, namespace `prod`. The `dev` deploy was removed — see **TD-071** |

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

### Environment separation, and what is *not* separated

`dev` and `prod` are two namespaces in the same GKE cluster. Each gets its own
pods, its own in-cluster RabbitMQ and its own MinIO, so compute and messaging
are genuinely independent.

**The five PostgreSQL databases are shared.** Both environments read the same
`INFRA_ADDRESSES` and the same `HELM_SECRETS`, so a deploy to `dev` writes to
production's rows and a migration that lands there alters production's schema.
This is a known, accepted deviation from the assignment's "mantener separación
entre entornos" — recorded as **TD-070** with the reason and the remedy.

The remedy is databases per environment on the same VMs, which the assignment
allows: it asks for databases *on VMs*, not for a VM per environment. It is not
applied because it cannot be applied from the pipeline — Terraform gives the VMs
no public IP, `pg_hba.conf` admits only `10.0.0.0/8`, and each service's role is
created without `CREATEDB`. Creating those databases needs a person with access
to the machines. See TD-070 for the exact commands.

### Why there is no `dev` deploy

There was one, and it worked: nine Deployments at `1/1` with HPAs measuring real
CPU. It was removed on 2026-09-25 because the cluster cannot hold it.

The GKE cluster runs **one** node while `variables.tf` declares three. On that
node the original manual release, `dev` and `prod` together reserve more CPU
than exists — it reached 1911m requested of ~1930m allocatable, 99%, while
actually using 11%. Production's first real deploy left seven pods in
`FailedScheduling: Insufficient cpu`.

`retire-development` (Actions → CD → Run workflow → `retire_dev`) uninstalls the
dev release and frees its 450m. It is idempotent and needs no gcloud access.

The real fix is the node count, and it needs no code change:

```bash
gcloud container clusters resize bank-usac-vpc-gke \
  --node-pool bank-usac-vpc-node-pool --num-nodes 3 \
  --zone us-central1-a --quiet
```

With three nodes the dev job can be restored exactly as it was.
