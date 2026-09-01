# infra/k8s

Local Kubernetes deployment artifacts for the Bank USAC system.

This directory contains **only** cluster-level deployment configuration. All
databases, the RabbitMQ broker, and the MinIO object store run outside the
cluster in `infra/docker/` because the constitution requires persistence and
messaging infrastructure to be external (principle III).

The mechanism is fixed by
[ADR-007](../../docs/architecture/adr/ADR-007-local-orchestration.md): a
[kind](https://kind.sigs.k8s.io/) cluster whose nodes share the Compose
stack's Docker network, and one Helm chart, `helm/bank-usac`, released with
`helm upgrade --install` rather than raw `kubectl apply -f`.

```
infra/k8s/
├── kind/
│   ├── cluster.yaml                    kind cluster config (T-22)
│   ├── scripts/discover-external-ips.sh  finds the Compose containers' IPs
│   │                                      on bank-usac-local for the chart's
│   │                                      values (dockerNetwork mode)
│   └── .gitignore                      ignores the script's generated output
└── helm/bank-usac/
    ├── Chart.yaml, values.yaml, .helmignore
    └── templates/
        ├── _helpers.tpl               naming, labels, external-dependency helper
        ├── configmap.yaml             non-secret runtime config
        ├── secret.yaml                TEMPLATE — every value is `required`,
        │                              nothing real is committed (ADR-007)
        ├── customer/, account/, transaction/, payment/, notification-audit/
        │                              Deployment + ClusterIP Service per
        │                              domain service
        ├── gateway/, web/             Deployment + Service for the two
        │                              workloads that face outside the mesh
        ├── external/                  selectorless Services (+ Endpoints, or
        │                              ExternalName in the host fallback) for
        │                              the five PostgreSQL instances,
        │                              RabbitMQ and MinIO
        └── NOTES.txt                  post-install port-forward and
                                        readiness guidance
```

**Quick start** (once a kind cluster exists — see `kind/cluster.yaml` for how
it must be created):

```bash
infra/k8s/kind/scripts/discover-external-ips.sh   # dockerNetwork mode only
./infra/docker/scripts/build-images.sh --kind <cluster-name>   # prints <short-commit>

helm upgrade --install bank-usac infra/k8s/helm/bank-usac \
  --namespace bank-usac --create-namespace \
  -f infra/k8s/kind/generated-external.values.yaml \
  --set secrets.jwtSecret=... \
  --set secrets.rabbitmq.password=... \
  --set secrets.objectStorage.accessKey=... --set secrets.objectStorage.secretKey=... \
  --set secrets.databases.customer.password=... \
  --set secrets.databases.account.password=... \
  --set secrets.databases.transaction.password=... \
  --set secrets.databases.payment.password=... \
  --set secrets.databases.notificationAudit.password=... \
  --set services.customer.image.tag=<short-commit> \
  --set services.account.image.tag=<short-commit> \
  --set services.transaction.image.tag=<short-commit> \
  --set services.payment.image.tag=<short-commit> \
  --set services.notificationAudit.image.tag=<short-commit> \
  --set gateway.image.tag=<short-commit> \
  --set web.image.tag=<short-commit>
```

The seven `image.tag` flags are not optional. Every component defaults to
`dev` in `values.yaml`, and `build-images.sh --kind <cluster-name>` loads only
the short-commit tag onto the node — never `dev` — so an install that omits
them leaves every pod in `ImagePullBackOff`. See the comment above `services:`
in `values.yaml` for why the default is `dev` rather than a hardcoded commit.

`helm lint infra/k8s/helm/bank-usac` and
`helm template bank-usac infra/k8s/helm/bank-usac` (with the same `--set`
flags, since every secret is `required`) are the checks that do not need a
cluster. Installing for real, and the end-to-end transfer and degraded-case
validation the deployment ticket asks for, need `kind` on the machine
running it — not available in every environment this repository is checked
out in.
