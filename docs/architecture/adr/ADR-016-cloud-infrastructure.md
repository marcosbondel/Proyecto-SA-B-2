# ADR-016: Provision the cloud with Terraform — GKE for the workloads, Compute Engine for the databases, Cloud Run for the frontend

- **Status**: Accepted
- **Date**: 2026-09-20 — the day `infra/terraform/gcp/` landed (`70e98dc`)
- **Deciders**: Bank USAC team
- **Assignment reference**: Fase II (`docs/references/780_Proyecto_2_2S2026.pdf`), §4.2 page 8 —
  *alcance obligatorio*: "Uso de **Terraform** para provisionamiento", "Bases de datos en
  **máquinas virtuales (VMs)**", "Despliegue en Kubernetes", "Implementación de **autoescalado
  (HPA)**"; §4.3 pages 8–9 — *IaC: Terraform* and *Base de datos: Ejecutadas en VM*, both
  `Obligatorio`; §4.1 pages 7–8 — HPA at 80 % CPU, CPU and memory requests and limits, one
  container per service, `dev` / `prod` separation; §6 steps 6–8, pages 10–11; §8.3 page 13 —
  "Terraform no reproducible o infraestructura creada manualmente", 50 %.
- **Recorded**: 2026-09-26, retroactively, for the reason given in
  [ADR-014](ADR-014-cloud-provider.md).

## Context

Two earlier decisions already fix most of the shape, and neither is reopened here:

- [ADR-005](ADR-005-persistence.md) gives every service its own PostgreSQL database **outside**
  the cluster. Fase I satisfied that with five Docker containers; Fase II's §4.2 restates it as
  virtual machines.
- [ADR-007](ADR-007-local-orchestration.md) releases the whole system through **one Helm chart**
  and reaches the out-of-cluster databases through selectorless Services backed by explicit
  Endpoints. It scopes itself to the local kind cluster and says so.

What is genuinely open is the cloud arrangement: which managed services hold which part, how
the chart written for kind reaches databases that are now VMs in a VPC, and how `dev` and
`prod` coexist on a fixed credit balance. §8.3 also sets the standard for the answer — anything
created by hand rather than declared costs half the grade — so "what Terraform owns" is part of
the decision and not an implementation detail.

## Decision

One Terraform root module, `infra/terraform/gcp/`, `google` provider `~> 5.15`, Terraform
`>= 1.5.0`, **local state**. Six parts:

### 1. One VPC, two subnets, no public database

[`vpc.tf`](../../../infra/terraform/gcp/vpc.tf) declares `bank-usac-vpc` with
`auto_create_subnetworks = false` and two purposeful subnets:

| Subnet | Range | Holds |
| --- | --- | --- |
| `bank-usac-vpc-gke-subnet` | `10.10.0.0/20`, secondaries `10.20.0.0/16` (pods) and `10.30.0.0/20` (services) | The GKE data plane |
| `bank-usac-vpc-db-subnet` | `10.40.0.0/24` | The five database VMs |

A Cloud Router and Cloud NAT give the VMs outbound access — `apt-get install postgresql` has to
work — **without any of them holding a public IP**. Three firewall rules: traffic between the
four internal ranges, SSH from Google's IAP range `35.235.240.0/20` only, and the load-balancer
health-check ranges.

### 2. Five Compute Engine VMs, one database each

[`compute_vms.tf`](../../../infra/terraform/gcp/compute_vms.tf) iterates a map of the five
services into five `e2-medium` Debian 12 instances — `bank-db-customer`, `bank-db-account`,
`bank-db-transaction`, `bank-db-payment`, `bank-db-notification-audit` — each with a 20 GB disk,
an interface on the database subnet and **no `access_config` block**, which is how a GCE
instance ends up with no external address.

Each one provisions itself: a `metadata_startup_script` installs PostgreSQL, sets
`listen_addresses = '*'`, admits `10.0.0.0/8` in `pg_hba.conf`, and creates exactly one role and
one database — `customer_app` owning `customer`, and so on. One machine, one database, one
credential: ADR-005's isolation is enforced by the provisioning, not by convention.

### 3. GKE Standard, zonal, with the node count declared

[`gke.tf`](../../../infra/terraform/gcp/gke.tf): a zonal cluster in `us-central1-a`, default node
pool removed and replaced by a managed pool of `gke_node_count = 3` × `e2-standard-2`, release
channel `REGULAR`, auto-repair and auto-upgrade on, Workload Identity enabled, and
`addons_config.horizontal_pod_autoscaling` explicitly **not** disabled — the HPA the assignment
requires is a control-plane feature here, not something installed into the cluster.

### 4. Cloud Run for the frontend

[`cloud_run.tf`](../../../infra/terraform/gcp/cloud_run.tf): `bank-usac-web`, port 8080, 1 vCPU
and 512 MiB, scaling from **0** to 5 instances, public (`allUsers` as `run.invoker`), with
`NUXT_PUBLIC_API_BASE_URL` pointing at the Gateway. §4.4 (p. 9) names this service as the
archetype of what it will accept and names S3 as what it will not.

### 5. The same Helm chart as the local cluster

No cloud-specific chart and no cloud-specific values file. `infra/k8s/helm/bank-usac` installs
on GKE exactly as it installs on kind; the five database hosts, the broker and the object store
arrive as `--set` values from `INFRA_ADDRESSES`. The mode is still called `dockerNetwork`
because that is the name Fase I gave it, and it has always meant *"a selectorless Service backed
by an explicit host and port"* — which is precisely what a VM's private IP is.

### 6. `dev` and `prod` as two namespaces of that one cluster

Each namespace runs its own copy of the seven applications, **its own RabbitMQ and its own
MinIO** (`rabbitmq.inCluster` / `minio.inCluster`), and the seven HPAs at 80 % CPU with the CPU
and memory requests and limits §4.1 (p. 8) asks for. `dev` receives `dev-<sha>` images on every
merge into `develop`; `prod` receives `vX.Y.Z` images on every merge into `main`.

## Alternatives considered

### Cloud SQL instead of five self-managed VMs

Managed backups, managed failover, managed patching, private IP, and no `pg_hba.conf` to edit by
startup script. On every engineering axis except one, the better answer.

**Rejected because the assignment forbids it.** §4.2 (p. 8) lists "Bases de datos en **máquinas
virtuales (VMs)**" in the mandatory scope and §4.3 (p. 9) repeats it as
*Base de datos: Ejecutadas en VM*, `Obligatorio`. §8.1 (p. 12) makes "DB en VM correctamente
implementadas" a condition for being graded at all. Cloud SQL would be a managed service, not a
virtual machine, and choosing it would trade a requirement for a quality nobody asked for.

### GKE Autopilot instead of GKE Standard

No node pool to size, no capacity to plan, and billing per pod request rather than per node.

**Rejected because the sizing has to be controllable, and because it already went wrong once.**
Autopilot bills every pod's requests, and this system asks for twenty-odd pods across two
namespaces; against a fixed credit balance the team needed to be able to *choose* the ceiling
rather than have it follow the workload. The failure that makes the point is
[TD-071](../../TECH_DEBT.md): when the pool was running one node instead of the three
`variables.tf` declares, three copies of the application reserved 1911m of ~1930m allocatable
CPU — 99 % reserved while 11 % was in use — and production's first real deploy left seven pods
in `FailedScheduling: Insufficient cpu`. With a declared node pool that is one `resize` command
away from correct, and the declaration in Terraform says what correct is.

### RabbitMQ and MinIO on their own virtual machines

Symmetric with the databases, and it would have kept all stateful components off the cluster.

**Rejected because** the assignment requires *databases* on VMs and says nothing about the
broker or the object store, and putting them in-cluster is what buys the only environment
isolation the two namespaces actually have. `dev` and `prod` each get their own broker and their
own bucket, so a message published in `dev` cannot be consumed in `prod` and a document uploaded
in one is invisible to the other. Two more VMs would have cost budget and given the opposite —
one shared broker for both environments.

### Two clusters, one per environment

The clean reading of §4.1's "mantener separación entre entornos (dev / prod)": separate control
planes, separate node pools, no way for one to starve the other.

**Rejected on budget**, and the cost of rejecting it is written down rather than hidden. Two
namespaces give separated compute and messaging; what they do not separate is the five
PostgreSQL databases, which both environments read through the same `INFRA_ADDRESSES` — so a
migration landing in `dev` alters production's schema. That is [TD-070](../../TECH_DEBT.md),
open and accepted, with the remedy (databases per environment on the same VMs, which the
assignment allows) and the reason it is not applied both recorded there.

### A second Helm chart, or a `values-cloud.yaml`

The usual shape: a base chart plus a per-environment values file.

**Rejected because** two definitions of the same deployment diverge, and the divergence is
discovered in production. Everything that differs between kind and GKE is an address or an image
tag, and both already arrive as `--set` values from the caller —
[`helm-deploy.sh`](../../../.github/scripts/helm-deploy.sh) for the pipeline,
[`install.sh`](../../../infra/k8s/scripts/install.sh) for the local cluster. A values file would
add a third place for the same facts to disagree.

## Consequences

**Easier**: `terraform apply` on an empty project produces the network, the five provisioned
database machines and the cluster in one command, and `terraform output` hands back the private
IPs the chart needs (`database_private_ips`) and the `gcloud` line that configures `kubectl`.
Because the chart never learned it was running somewhere else, a change to a Deployment is
tested on kind and deployed to GKE without a translation step.

**Harder — and it is the root of the open environment debt**: the VMs have no public IP,
`pg_hba.conf` admits only `10.0.0.0/8`, and each service's role is created with
`CREATE ROLE … WITH LOGIN PASSWORD` and no `CREATEDB`. Together those three facts mean **nobody
outside the VPC can create a database** — not a GitHub runner, not the application user. The
security posture is right and the operational consequence is real: closing
[TD-070](../../TECH_DEBT.md) needs a person with IAP SSH access to the machines.

**Harder**: the internal firewall rule allows all TCP and UDP ports between the four internal
ranges rather than only 5432 from the GKE ranges. The blast radius is contained by the VPC
having no other tenant, but it is broader than it needs to be and should be narrowed to the
ports actually in use.

**What Terraform does not own yet.** Three pieces of the running production system are created
outside this module, which is exactly what §8.3 penalises, and they are recorded rather than
left to be discovered:

| Piece | Why it matters | Debt |
| --- | --- | --- |
| The Artifact Registry repository `bank-images` | From an empty project, `terraform apply` produces no registry, and the first image push fails | [TD-079](../../TECH_DEBT.md) |
| The Gateway's public `LoadBalancer` | The chart renders `type: ClusterIP`; the public entry point survives only because Helm's three-way merge leaves an out-of-band patch alone. Delete it and nothing in the repository rebuilds it | [TD-080](../../TECH_DEBT.md) |
| The Cloud Run revision serving the real frontend | `cloud_run.tf` defaults `web_image` to Google's hello container, and no workflow updates the service | [TD-081](../../TECH_DEBT.md) |

**In-cluster state is ephemeral.** The RabbitMQ and MinIO Deployments declare no volumes, so
both write to the container's writable layer and lose everything when a pod is replaced. For
MinIO that is close to harmless — an identity photo is a transfer buffer with a 24-hour
retention window ([ADR-012](ADR-012-object-storage.md)) — and for RabbitMQ it means queued
messages do not survive a restart of the broker pod. Recorded as [TD-082](../../TECH_DEBT.md).

**Obligations created**:

- [`../../operations/CLOUD.md`](../../operations/CLOUD.md) is the procedure this decision
  implies, from an empty project to a reachable system, and marks each step that is still manual.
- [`../../../infra/terraform/gcp/README.md`](../../../infra/terraform/gcp/README.md) stays the
  reference for the module's own variables and outputs.
- Any new cloud resource is declared in this module, or it gets a debt row on the day it is
  created by hand. The three above are the standing exceptions, not a precedent.
