# ADR-014: Deploy to Google Cloud Platform

- **Status**: Accepted
- **Date**: 2026-09-20 — the day `infra/terraform/gcp/` landed (`70e98dc`)
- **Deciders**: Bank USAC team
- **Assignment reference**: Fase II (`docs/references/780_Proyecto_2_2S2026.pdf`), §4.3
  "Recursos y herramientas a utilizar", page 8 — *Cloud: AWS, GCP o Azure*, `Obligatorio`; and
  §4.4 "Entregables", page 9 — the frontend deploys to "una instancia virtual o un servicio
  despliegue rápido en la nube, **como Google cloud run**. No se aceptará despliegues en S3."
- **Recorded**: 2026-09-26. The decision was taken and implemented on 2026-09-20; this record
  was written afterwards, when the audit against the grading sheet found the reasoning had
  never been put on paper. Nothing here is a new decision — it is the argument that was made
  in conversation, checked against what the repository actually contains.

## Context

The assignment fixes the shape of the deployment and leaves the provider open: §4.3 lists
`AWS, GCP o Azure` as `Obligatorio` without preferring one. Everything else about the target is
already constrained — Kubernetes for the workloads, Terraform for provisioning, the five
databases on virtual machines, a frontend on a fast-deploy service that is explicitly **not**
S3.

Three facts narrow the choice more than any feature comparison does:

1. **The deliverable is a system that answers, not a design.** §8.1 (p. 12) makes "Despliegue en
   nube: sistema accesible" a requirement *to be allowed to be graded at all*. The provider that
   wins is the one that gets three students from an empty project to a reachable URL inside the
   four weeks §7 allows, with time left to build the functional extensions.
2. **The budget is a fixed pot of trial credit, not a monthly bill.** Whatever is provisioned
   stays up through grading day. A control plane that bills by the hour while idle is a
   different kind of cost than one that does not.
3. **One example is printed in the statement.** §4.4 names *Google Cloud Run* as the archetype
   of the accepted frontend target. Matching the named example removes a question the team would
   otherwise have to answer in the defence.

## Decision

The system deploys to **Google Cloud Platform**, project `project-0d3c28c7-a4e0-44ad-a4e`,
region `us-central1`, zone `us-central1-a`.

The provider's services map onto the assignment's requirements one to one:

| Requirement | GCP service | Where it is declared |
| --- | --- | --- |
| Kubernetes cluster | GKE Standard, zonal | [`gke.tf`](../../../infra/terraform/gcp/gke.tf) |
| Databases on VMs, outside the cluster | Compute Engine × 5 | [`compute_vms.tf`](../../../infra/terraform/gcp/compute_vms.tf) |
| Network | VPC, two subnets, Cloud Router + Cloud NAT | [`vpc.tf`](../../../infra/terraform/gcp/vpc.tf) |
| Frontend on a fast-deploy service | Cloud Run | [`cloud_run.tf`](../../../infra/terraform/gcp/cloud_run.tf) |
| Versioned image registry | Artifact Registry | *not yet in Terraform — see Consequences* |

The topology those services are arranged into is a separate decision, recorded in
[ADR-016](ADR-016-cloud-infrastructure.md). This record answers only *which provider*.

## Alternatives considered

### Amazon Web Services

The most widely documented of the three, and the one whose vocabulary most course material
uses. EKS for the cluster, EC2 for the five database VMs, App Runner or an EC2 instance for the
frontend.

**Rejected because** of what an idle cluster costs against a fixed credit balance. At the time
of the decision GKE's free tier covered the cluster-management fee for **one zonal cluster per
billing account** — which is exactly the shape deployed here — while EKS billed its control
plane by the hour with no equivalent allowance. The cluster is not torn down between working
sessions: it stays up from the first deploy through grading day, so the control-plane fee is
charged for the whole period rather than for the hours somebody is working. Dropping to ECS or
App Runner to avoid it is not available: §4.2 (p. 8) requires Kubernetes.

The secondary reason is the distance to the first green deploy. Reaching an EKS cluster from a
CI runner means VPC and IAM work plus the cluster's own authentication mapping, and every hour
spent there is an hour not spent on the five functional extensions §4.1 grades.

### Microsoft Azure

AKS offers a free control-plane tier, so the cost argument above does not separate it from GKE.
Container Apps is a credible equivalent of Cloud Run, and Azure Database and virtual machines
cover the rest.

**Rejected because** the statement names Cloud Run and does not name Container Apps. That is a
weak technical argument and a strong delivery one: §4.4 prints one example of an acceptable
frontend target, §8.3 (p. 13) penalises "Frontend desplegado en S3 o en un servicio no
permitido" at 10 %, and "Container Apps is the Azure equivalent of the service your statement
names" is an argument the team would have to win under examination rather than a box it can
simply tick. With the functional scope already large, the provider choice was made where it
needed the least defending.

### Splitting the system across two providers

Nothing forbids running the cluster on one provider and the databases on another.

**Rejected because** it doubles everything that is not application code: two credential systems
in CI, two Terraform providers, two networks with no private path between them — so the
database traffic that currently never leaves a private VPC subnet would have to cross the public
internet or a VPN somebody has to build. It buys nothing the assignment asks for.

## Consequences

**Easier**: Cloud Run gives the frontend a managed HTTPS origin and certificate with no
load balancer or DNS work, which is what makes the public URL a one-line output of Terraform
(`cloud_run_web_url`). GKE ships the Horizontal Pod Autoscaler in the control plane
(`addons_config.horizontal_pod_autoscaling` in `gke.tf`), so the mandatory autoscaling at 80 %
CPU needed no metrics-server installation — the seven HPAs work against the managed metrics
pipeline. A single `google` Terraform provider covers the network, the VMs, the cluster and the
serverless frontend, so there is one provider block and one credential to configure.

**Harder — and this one cost real time**: USAC's Google Workspace organisation enforces
`constraints/iam.disableServiceAccountKeyCreation`, so `gcloud iam service-accounts keys create`
fails outright and no downloadable key can authenticate CI. The pipeline authenticates through
**Workload Identity Federation** instead, which is the better practice anyway — nothing is
stored, so nothing can leak — but it was not a choice, and the setup is longer than pasting a
JSON key into a secret. The full procedure is in
[`../../operations/CI.md`](../../operations/CI.md#authentication-workload-identity-federation-or-a-key).
`cd.yml` still accepts a key as the alternative path, so the workflow is not unusable for
somebody running it under a personal project with no such policy.

**Harder**: the credit balance is finite and shared by everything running, which is the root of
two recorded compromises. The cluster runs three `e2-standard-2` nodes and not more, `dev` and
`prod` are two namespaces in that one cluster rather than two clusters, and the five databases
share the smallest VM size that runs PostgreSQL comfortably. The environment separation that
was given up is [TD-070](../../TECH_DEBT.md); what happened when the node pool was smaller than
`variables.tf` declared is [TD-071](../../TECH_DEBT.md).

**What this decision does and does not couple to GCP**: the coupling is
`infra/terraform/gcp/`, four repository variables (`GCP_PROJECT_ID`, `GKE_CLUSTER`, `GKE_ZONE`,
`ARTIFACT_REPO`) and the authentication steps in two workflows. The Helm chart, the seven
images and every line of application code are provider-neutral — object storage is MinIO
speaking the S3 API rather than Google Cloud Storage, for the reasons in
[`../deployment.md`](../deployment.md) §5, and the databases are PostgreSQL on plain Debian
rather than Cloud SQL, because [ADR-016](ADR-016-cloud-infrastructure.md) had no choice. Moving
providers means rewriting the Terraform module and the two authentication steps, not the system.

**Obligations created**:

- [ADR-016](ADR-016-cloud-infrastructure.md) decides the topology these services are arranged
  into, and records what Terraform does not yet own.
- [ADR-015](ADR-015-ci-cd-platform.md) decides how the pipeline authenticates against this
  provider.
- [`../../operations/CLOUD.md`](../../operations/CLOUD.md) is the procedure from an empty GCP
  project to a running system, including the steps that are still manual.
