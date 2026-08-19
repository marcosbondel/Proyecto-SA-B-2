# ADR-007: Run the local cluster on kind and release it with a Helm chart

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.2 "Alcance del proyecto", page 8; §4.3 "Recursos y herramientas
  a utilizar", page 14; supporting material (Helm), page 16 (revision 2026-08-13)

## Context

Kubernetes is mandatory and local: §4.2 (p. 8) requires "Despliegue del sistema en un cluster
local de Kubernetes" and §4.3 (p. 14) lists "Orquestación: Kubernetes (local)" as `Obligatorio`.
Not deploying to Kubernetes costs **100 %** of the grade (§8.3, p. 27). Constitution principle
VII restates it.

The assignment names Kubernetes but not the local distribution, and it lists Helm only as
optional supporting material (p. 16).

The cluster has an unusual shape that drives this decision: **the application workloads run
inside it, and their databases do not**. [ADR-005](ADR-005-persistence.md) puts the five
PostgreSQL instances and the broker outside the cluster as Docker containers, because §4.2
(p. 8) and §4.3 (p. 14) require it. So the cluster is not self-contained, and pods must reach
services on the Docker host. That connectivity is the part most likely to break during a
demonstration, so it has to be a decided mechanism rather than something improvised.

## Decision

The local cluster runs on **kind** (Kubernetes in Docker), and the whole system is released
through **one Helm chart** (`infra/k8s/helm/bank-usac`) with `helm upgrade --install` — not by
applying raw manifests with `kubectl apply -f`.

One chart with a `templates/<application>/` directory per workload, not seven charts: a single
release for a single-cluster academic deployment, with each application still getting its own
Deployment and Service.

### How pods reach the databases outside the cluster

Because kind nodes are themselves Docker containers, the cluster and the Compose stack can share
a Docker network. The decided approach:

1. **Attach the Compose stack to the same Docker network as the kind nodes**, so the database
   and broker containers are routable from inside the cluster.
2. **Expose each external dependency in-cluster as a selectorless `Service` backed by an
   explicit endpoint** pointing at the container's address on that network. Workloads then use a
   stable in-cluster DNS name and never carry a host address in application configuration.
3. **`host.docker.internal` is the documented fallback** where the shared-network route is
   unavailable, with the host alias made resolvable to the kind nodes.

Connection details reach the pods as chart values and Secrets, never baked into an image
([ADR-006](ADR-006-containerization.md)).

The concrete manifests, values and endpoint addresses belong to **T-22**; this ADR fixes the
mechanism so that ticket does not have to rediscover it under time pressure.

## Alternatives considered

### minikube

The most widely documented local Kubernetes distribution, with a mature addon ecosystem.

**Rejected because**: it runs the cluster inside its own VM or driver-managed environment, which
puts a boundary between the cluster and the Docker daemon that hosts the databases — precisely
the boundary this architecture has to cross on every request. Reaching a host container from
inside a minikube VM is a per-driver problem with a different answer on each machine, and the
team runs different operating systems. kind's nodes are ordinary Docker containers, so "share a
Docker network" is one mechanism that behaves the same everywhere.

### k3d (k3s in Docker)

Very close to kind in shape and lighter still, since k3s trims parts of the control plane.

**Rejected because**: k3s is a modified Kubernetes distribution with components swapped out
(notably its own ingress and storage defaults), and the assignment grades deployment to
Kubernetes. kind runs upstream Kubernetes, so what the demonstration shows is unambiguously
Kubernetes rather than a variant that needs explaining. The remaining resource saving does not
justify that explanation.

### Applying raw manifests with `kubectl apply -f`

No packaging tool: a directory of YAML files applied in sequence.

**Rejected because**: the release stops being reproducible. Image tags and connection settings
would be edited in place inside committed YAML, deleting a workload requires remembering which
files created it, and there is no single command to bring the system up. Helm gives one
versioned release, one `helm upgrade --install`, and values that vary per environment without
editing templates — which is what **T-23** needs to re-run integration tests repeatably.

### Deploying the databases into the cluster to keep everything in one release

Simpler operationally: one `helm install` and the entire system exists.

**Rejected because**: it is explicitly forbidden (§4.2 p. 8, §4.3 p. 14, constitution III). It
is recorded here because it is the obvious simplification, and rejecting it in writing stops it
being reintroduced when the external connectivity proves awkward.

## Consequences

**Easier.** kind integrates directly with Docker, so the images built in
[ADR-006](ADR-006-containerization.md) are loaded with `kind load docker-image` and the cluster
is reproducible from scratch on any team member's machine. One Helm release means one command to
stand the system up and one to tear it down, which is what makes a live demonstration
survivable. Databases outside the cluster survive `kind delete cluster`, so recreating the
cluster does not destroy test data.

**Harder.** The cluster is less production-like than a managed one — single node by default, no
real load balancer, and Ingress requires explicit setup (with `kubectl port-forward` as the
documented fallback). The external-database connectivity above is genuine additional complexity
that a self-contained cluster would not have; it is the price of a rule the assignment imposes.
Every image change costs a rebuild-and-load cycle before the cluster sees it.

**Obligations created.**

- **T-22** writes the Helm chart and documents the exact database connectivity, including the
  fallback path, and validates `helm upgrade --install` end to end.
- **T-06** must create the Compose stack on a network the kind nodes can join.
- **T-23** depends on the release being repeatable to re-run resilience tests.
- Secrets reach the cluster through chart values or `--set-file`, never committed — the chart's
  `secret.yaml` is a template, never a file with real values.
