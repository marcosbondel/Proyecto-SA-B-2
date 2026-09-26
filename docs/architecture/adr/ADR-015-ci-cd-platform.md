# ADR-015: Run the pipeline on GitHub Actions, as four workflows

- **Status**: Accepted
- **Date**: 2026-09-12 — the day `ci.yml` landed (`e0360b7`, T-32); extended on 2026-09-21 with
  `release.yml` and `cd.yml` (`2811e89`) and on 2026-09-24 with `changes.yml` (`50d3290`)
- **Deciders**: Bank USAC team
- **Assignment reference**: Fase II (`docs/references/780_Proyecto_2_2S2026.pdf`), §4.3 page 8 —
  *CI/CD: GitHub Actions / GitLab CI / similar*, `Obligatorio`; §4.1 pages 6–8 — the mandatory
  phases, the branch flow and the delivery and deployment stages; §8.1 page 12 — "CI/CD
  funcional: pipeline completo implementado"; §8.3 page 13 — "Pipeline CI/CD no funcional" and
  "Omitir etapas del pipeline" are penalised at 100 % and 25 %.
- **Recorded**: 2026-09-26, retroactively, for the reason given in
  [ADR-014](ADR-014-cloud-provider.md).

## Context

The assignment does not just require a pipeline; it prescribes its shape. §4.1 names three
**fases obligatorias** — Build, Test, Validación — on every push to a `feature/<nombre>` branch,
requires Build and Test to repeat on the merge request into `develop`, defines a delivery phase
on `release/<version>` branches or `vX.X.X` tags that publishes versioned images to a registry,
and defines a production deployment on the merge into `main` that consumes *those* images and
performs a rolling update. §8.3 makes omitting any of it expensive.

Two properties follow from that and drive the choice of platform:

1. **Each phase has to be visibly separate.** "No se permite omitir etapas" is a claim somebody
   has to be able to check by looking, not by reading YAML. A platform where the three phases
   appear as three independent pass/fail entries makes the claim self-evidencing.
2. **The pipeline must reach GKE.** The deployment stages authenticate against a cloud provider
   ([ADR-014](ADR-014-cloud-provider.md)) whose organisation policy forbids downloadable service
   account keys, so the platform has to be able to present a federated identity.

There is also a fact that is not a preference: **the repository lives on GitHub.** §8.1 requires
commits in the repository and the teaching assistant added as a collaborator, and that
repository is `github.com/marcosbondel/Proyecto-SA-B-2`.

## Decision

The pipeline runs on **GitHub Actions**, split into **four workflows** rather than one:

| Workflow | Fires on | Responsibility |
| --- | --- | --- |
| [`ci.yml`](../../../.github/workflows/ci.yml) | push to a work branch; PR into `develop` or `main` | Build → Test → Validación, as **three jobs** |
| [`changes.yml`](../../../.github/workflows/changes.yml) | `workflow_call` | Which components a change touched |
| [`release.yml`](../../../.github/workflows/release.yml) | push to `release/**`; tag `v*` | Generate the version, publish seven versioned images |
| [`cd.yml`](../../../.github/workflows/cd.yml) | push to `develop`; push to `main` | Deploy to namespace `dev`; rolling update in `prod` |

Three deliberate consequences of that split:

- **The three phases are three jobs, not three steps.** `test` declares `needs: build` and
  `validate` declares `needs: [build, test]`, so the order the assignment lists is enforced by
  the graph and a failure anywhere skips everything after it. The checks list shows
  `Fase 1: Build`, `Fase 2: Test`, `Fase 3: Validacion` as separate entries.
- **The path filter is a reusable workflow, not a copied job.** The map from directories to
  components *is* the monorepo strategy ([`../../operations/MONOREPO.md`](../../operations/MONOREPO.md));
  holding it in two places is how one service ends up deployed by one workflow and not the
  other without anybody deciding it.
- **Production never builds an image.** `cd.yml`'s production job resolves the newest `v*` tag
  and deploys what `release.yml` already published. If no tag exists it fails rather than
  inventing one.

Authentication to GCP is **Workload Identity Federation**, configured as repository variables;
a service-account key is accepted as a fallback for anyone running the workflows under a
personal project.

## Alternatives considered

### GitLab CI

The other platform the assignment names by name, with a mature `.gitlab-ci.yml` stage model
that maps onto Build / Test / Validación at least as directly as Actions' jobs do, and native
support for environments and manual deployment gates.

**Rejected because** the repository is on GitHub and §8.1 makes *that* repository the
deliverable — commits before the deadline, auxiliary added as a collaborator. Using GitLab CI
means mirroring the repository to GitLab and keeping two remotes in step, so a pipeline run
becomes a statement about a copy of the code rather than about the code that is handed in. A
mirror that falls behind is a green pipeline that verified the wrong commit, which is the exact
failure mode this project has spent effort eliminating elsewhere.

### Google Cloud Build

Native to the chosen provider: no cross-cloud identity federation, no Workload Identity
Federation setup, and pushes to Artifact Registry with the project's own credentials. Two
`cloudbuild*.yaml` files in the repository root are left over from using it to bootstrap the
first images.

**Rejected as the pipeline of record because the triggers are not in the repository.** A Cloud
Build trigger — which branch, which file, which substitutions — lives in the GCP console or in
`gcloud` state, so a change to *when* the pipeline runs is not reviewable in the pull request
that causes it, and cannot be read by anybody who only has the repository. The assignment's
three phases would also be steps in one build rather than three independent checks, which
weakens exactly the property §8.3 punishes losing.

The two files stay as a documented manual escape hatch for building an image when the pipeline
cannot — they are not wired to any trigger, and `cloudbuild.yaml` refuses to default its tag to
`latest` for the same reason `helm-deploy.sh` does.

### Jenkins, or any self-hosted runner

Complete control, no usage limits, and the ability to place the runner **inside** the VPC —
which would have let the pipeline reach the database VMs and would have closed
[TD-070](../../TECH_DEBT.md).

**Rejected because** it is a server to provision, secure, patch and keep alive for a four-week
academic project, on the same fixed credit balance that is already paying for the cluster. It
also adds a component whose own failure looks like a pipeline failure, at the point in the
project where the pipeline is the thing being graded.

## Consequences

**Easier**: the three mandatory phases are three checks, so "no phase was omitted" is visible
in the pull request rather than asserted in a document. `strategy.matrix` gives per-component
parallelism for both the release build (seven images at once) and the selective dev build.
Docker layer caching comes from the platform itself (`cache-from: type=gha`, scoped per
component), and dependency caching from `actions/setup-node`'s pnpm support plus a Turborepo
cache keyed on the commit and shared between the three jobs. The reusable `changes.yml` gives
the selective deployment one definition with two consumers.

**Harder — and it is why one debt stays open**: GitHub-hosted runners live outside the VPC.
The deployment reaches GKE through the cluster's public control-plane endpoint, which is fine,
but the database VMs have no public IP and `pg_hba.conf` admits only `10.0.0.0/8`, so **no
workflow can reach a database**. That is the reason [TD-070](../../TECH_DEBT.md)'s remedy —
creating `customer_dev`, `account_dev` and the rest so the two environments stop sharing rows —
cannot be applied from the pipeline and waits on a person with IAP SSH access.

**Harder**: Workload Identity Federation is more setup than a pasted key, and its
`attribute-condition` must pin the repository or any repository on GitHub could mint a token
the provider accepts. The commands are in
[`../../operations/CI.md`](../../operations/CI.md#authentication-workload-identity-federation-or-a-key)
so nobody reconstructs them from memory.

**Accepted for now**: `pnpm format:check` is not a pipeline step, because Prettier's YAML
parser rejects the Helm templates' Go template syntax. Wiring a check that fails for reasons
unrelated to the change would make every push red. Recorded in
[`../../operations/CI.md`](../../operations/CI.md#why-pnpm-formatcheck-is-not-a-step).

**Obligations created**:

- [`../../operations/CI.md`](../../operations/CI.md) is the runbook for all four workflows —
  triggers, what each phase verifies, what a green run does **not** prove, and the secrets and
  variables `cd.yml` refuses to run without.
- [`../../operations/MONOREPO.md`](../../operations/MONOREPO.md) owns the directory-to-component
  map `changes.yml` implements.
- Any new workflow that deploys must keep production consuming published images rather than
  building its own, or the delivery phase stops meaning anything.
