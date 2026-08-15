# ADR-006: Package every workload as a Docker container

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §4.3 "Recursos y herramientas a utilizar", page 14; §4.2 "Alcance
  del proyecto", page 8 (revision 2026-08-13)

## Context

The mandatory-resources table (§4.3, p. 14) lists **"Contenedores: Docker"** as `Obligatorio`.
It is not a choice between container runtimes; it names one. §4.2 (p. 8) adds that databases run
as "contenedores Docker o servicios locales" outside the cluster, and §8.1 (p. 20) makes
"Contenerización — todos los servicios están correctamente dockerizados" a graded requirement.

Two distinct kinds of workload need packaging, and they are packaged for different destinations:

- The **six application workloads** — the Gateway and the five services — which are deployed
  into the local Kubernetes cluster.
- The **infrastructure containers** — five PostgreSQL instances and RabbitMQ — which run
  outside the cluster ([ADR-005](ADR-005-persistence.md)).

## Decision

Every workload is packaged as a **Docker** image.

The Gateway and the five services each get their own image, built from the pnpm workspace.
Databases and the broker run as Docker containers via Compose in `infra/docker/`, never inside
the cluster.

The images the application workloads produce are consumed by the kind cluster described in
[ADR-007](ADR-007-local-orchestration.md).

## Alternatives considered

### Podman

A daemonless, rootless-by-default container engine that is largely CLI-compatible with Docker
and produces OCI images that Kubernetes can run.

**Rejected because**: the assignment names Docker explicitly as a mandatory resource (§4.3,
p. 14), and the rubric grades whether services are "correctamente dockerizados" (§8.1, p. 20).
There is also a concrete toolchain reason: the local cluster runs on **kind** — Kubernetes *in
Docker* — which loads images through `kind load docker-image` from a Docker daemon. Introducing
a second engine would mean exporting and importing images by hand on every rebuild, adding a
failure point to the loop developers repeat most often.

### Running the applications directly on the host

Skip images for the six Node applications and run them with `pnpm dev`, containerising only the
databases and the broker.

**Rejected because**: it makes Kubernetes deployment impossible, and deploying to a local
cluster is mandatory (§4.2, p. 8) with a **100 %** penalty for not doing it (§8.3, p. 27 — "No
despliegue en Kubernetes (local)"). It also breaks the parity that makes a demonstration
trustworthy: an application that only ever runs on the host has never been exercised the way it
will be shown.

## Consequences

**Easier.** One artefact format for every workload, so the same image runs on a teammate's
machine and in the cluster. Node images are small ([ADR-001](ADR-001-backend-stack.md)), which
matters when six workloads share one laptop with a kind cluster and six infrastructure
containers. Health and readiness endpoints already exist in every application, so the container
contract Kubernetes expects is satisfiable today.

**Harder.** A pnpm workspace does not containerise naively: each image must include the shared
packages (`@bank/contracts`, `@bank/messaging`, `@bank/tooling`) built to `dist/`, so the
Dockerfiles must either build from the workspace root or stage the built packages in. Every
rebuild costs a rebuild-plus-load cycle before the cluster sees the change, which is slower than
a hot reload — the price of parity with the deployed shape.

**Obligations created.**

- **T-21** writes the Dockerfiles for the six application workloads and validates the images.
- **T-06** writes the Compose stack for the infrastructure containers.
- The images must not bake secrets; the signing secret of
  [ADR-010](ADR-010-authentication.md) and database credentials arrive as environment
  configuration at run time.
