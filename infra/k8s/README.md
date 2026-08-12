# infra/k8s

Kubernetes manifests for the local `kind` cluster. Deployment is mandatory and
local (constitution VII): the seven applications run in the cluster, the
databases do not (constitution III).

## What belongs here

- Deployment, Service and ConfigMap per application.
- Ingress or gateway exposure for `apps/gateway` only — a client never reaches
  a service directly (constitution V).
- Secret references, never secret values.

## What does not

- Any manifest that deploys PostgreSQL or RabbitMQ inside the cluster. Those
  are containers on the host, defined in [`../docker`](../docker).

> **Blocked**: No Kubernetes manifest is written yet; this ticket explicitly excludes them (FR-017). Owner: Marcos Bonifasi. Arrives with: T-16.
