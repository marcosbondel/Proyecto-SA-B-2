# infra/k8s

Kubernetes deployment artifacts for local kind and cloud GKE, Bank USAC.

The PostgreSQL engines stay **outside Kubernetes**, as constitution principle
III requires. The local kind procedure also keeps RabbitMQ and MinIO in
Compose; cloud GKE runs them inside each application namespace. The database
constraint does not require every persistence/messaging component to be external.

Two charts are versioned here: **`helm/bank-usac`** for the seven bank
applications and optional mock/infra, and **`helm/bank-observability`** for
Collector, agent, Prometheus, Tempo, Loki and Grafana. Terraform provisions the
GKE substrate under `infra/terraform/gcp/`; Helm releases the workloads.

The mechanism is fixed by
[ADR-007](../../docs/architecture/adr/ADR-007-local-orchestration.md): a
[kind](https://kind.sigs.k8s.io/) cluster whose nodes share the Compose
stack's Docker network. Its bank chart, `helm/bank-usac`, is released with
`helm upgrade --install` rather than raw `kubectl apply -f`.

```
infra/k8s/
├── scripts/
│   ├── create-cluster.sh               creates the kind cluster on the shared
│   │                                     Docker network (pnpm k8s:cluster)
│   ├── install.sh                      discovers IPs, reads infra/docker/.env,
│   │                                     runs helm upgrade --install
│   └── capture-evidence.sh             read-only capture of the running
│                                         cluster into specs/…/evidence/
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

**Quick start.** The full procedure — prerequisites with pinned versions, how
the cluster must be created, the port-forwards and the troubleshooting — is
[docs/operations/DEPLOYMENT.md](../../docs/operations/DEPLOYMENT.md). From a
clean machine it is four commands:

```bash
pnpm dev:infra      # the databases, broker and MinIO, outside the cluster
pnpm k8s:cluster    # create the kind cluster on the shared Docker network
pnpm images:build -- --kind bank-usac
pnpm k8s:install    # discovers the external IPs, then helm upgrade --install
```

`pnpm k8s:install` wraps the real invocation, which needs seven `image.tag`
flags and the secret values that `templates/secret.yaml` conditionally marks
`required` — it reads them from `infra/docker/.env` so the same credentials
serve Compose and the cluster. `infra/k8s/scripts/install.sh --help` prints the
underlying `helm upgrade --install` if you want to run it by hand.

The seven `image.tag` flags are not optional: every component defaults to `dev`
in `values.yaml`, which names no registry. `build-images.sh --kind <cluster>`
loads both the short-commit tag and `dev` onto the node, so a default install
does resolve — but it resolves to whatever was built last, which is why
`install.sh` always passes the commit tag explicitly. See the comment above
`services:` in `values.yaml`.

`helm lint infra/k8s/helm/bank-usac` and
`helm template bank-usac infra/k8s/helm/bank-usac` (with the same `--set`
flags, since every secret is `required`) are the checks that do not need a
cluster. They are not the only ones that have run: **the chart is installed
and exercised against a real kind cluster**, all seven workloads reaching
`1/1 Ready` against the PostgreSQL, RabbitMQ and MinIO outside it. That run
found two defects `helm template` could not — a bash 4 associative array that
broke on macOS's bash 3.2, and `values.yaml` database defaults that pointed
every pod at the wrong role — which is exactly why rendering is not enough.

`pnpm k8s:evidence` re-captures the cluster's state into
`specs/008-audit-remediation/evidence/`; the evidence is a script rather than a
paste so it can be re-run rather than trusted.

## Revisión documental T-61 — 2026-10-21

La vista consolidada y las diferencias entre local y cloud están en
[el índice de arquitectura](../../docs/architecture/README.md).
Para esta revisión no se ejecutó Terraform apply ni se cambió infraestructura
persistente. GKE observado: `us-central1-c`, tres nodos, prod v1.3.6; bases
dev con sufijo `_dev`. La evidencia y sus límites están en
[T-60 cloud](../../docs/qa/backend/T-60-cloud-evidence.md).

## Phase III operations

`pnpm local:up` also installs the observability chart and local partner mock;
`pnpm k8s:obs` installs observability separately. Kind overrides differ from
cloud: ClusterIP access, Prometheus 2 h without PVC, Tempo 24 h with 5 GiB PVC,
Loki 2 GiB PVC and Grafana without PVC. These values are not the cloud retention
of seven days. See [DEPLOYMENT](../../docs/operations/DEPLOYMENT.md).

The [dated GKE inventory](../../docs/qa/load/2026-10-21-gke-observability-inventory.txt)
shows public Grafana LoadBalancer, three log agents and the four Bound store/UI
PVCs. Dataplane V2 is active, but no NetworkPolicies were applied at inspection;
chart templates alone do not restrict traffic. See
[ADR-023](../../docs/architecture/adr/ADR-023-observability-evolution.md).
