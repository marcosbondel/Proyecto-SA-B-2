# infra/k8s

Helm chart for the local `kind` cluster. Deployment is mandatory and local
(constitution VII): the seven applications run in the cluster, the databases
do not (constitution III). The cluster is still plain `kind` + Kubernetes;
Helm is the packaging and release tool used instead of applying raw YAML with
`kubectl apply -f`.

## Layout

```
infra/k8s/
  helm/
    bank-usac/
      Chart.yaml
      values.yaml              # defaults: image tags, resources, ports
      values-dev.yaml          # local kind overrides (optional)
      templates/
        _helpers.tpl
        gateway/
          deployment.yaml
          service.yaml
        web/
          deployment.yaml
          service.yaml
        customer-service/
          deployment.yaml
          service.yaml
        account-service/
          deployment.yaml
          service.yaml
        transaction-service/
          deployment.yaml
          service.yaml
        payment-service/
          deployment.yaml
          service.yaml
        notification-audit-service/
          deployment.yaml
          service.yaml
        configmap.yaml          # non-secret shared config
        secret.yaml             # templated from --set / values, never committed values
        namespace.yaml
```

One chart with one `templates/<service>/` directory per application keeps a
single `helm install`/`helm upgrade` release for the whole system, while still
giving every service its own Deployment and Service. Do not create seven
separate charts unless a specific reason (independent versioning, independent
release cadence) is documented as a decision — the assignment does not require
it and it adds operational overhead for a single-cluster academic deployment.

## What belongs here

- One Helm chart (`bank-usac`) with a Deployment + Service template per
  application, parameterized through `values.yaml` (image repository/tag,
  replica count, resource requests/limits, env vars, health-check paths).
- A `namespace.yaml` template (or `--namespace` on `helm install`) so the
  release lives in a dedicated namespace, not `default`.
- Ingress or gateway exposure for `apps/gateway` only — a client never reaches
  a service directly (constitution V). Expressed as a Helm template gated by a
  `values.yaml` toggle (e.g. `gateway.ingress.enabled`), with a `kubectl
  port-forward` fallback documented for a clean install without Ingress.
- `Secret` templates that read values from `--set`/`-f values-secret.yaml`
  (git-ignored) or from `helm install --set-file`, never hardcoded secret
  values inside a committed template.
- Readiness/liveness probe blocks per Deployment template, matching the health
  endpoints each service exposes.

## What does not

- Any template that deploys PostgreSQL or RabbitMQ inside the cluster. Those
  are containers on the host, defined in [`../docker`](../docker).
- Raw `kubectl apply -f *.yaml` manifests applied by hand. Every workload in
  this directory is rendered and released through the Helm chart so that
  `helm upgrade --install` (not a sequence of `kubectl apply` commands) is the
  single deployment command T-16 documents and T-17 relies on for repeatable
  test runs.
- Hardcoded image tags inside templates — tags are chart values so the same
  chart can be released against different builds without editing templates.

> **Blocked**: No Helm chart is written yet; this ticket explicitly excludes
> it (FR-017). Owner: Marcos Bonifasi. Arrives with: T-16.
