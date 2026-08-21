# infra/k8s

Local Kubernetes deployment artifacts for the Bank USAC system.

This directory contains **only** cluster-level deployment configuration. All
databases, the RabbitMQ broker, and the MinIO object store run outside the
cluster in `infra/docker/` because the constitution requires persistence and
messaging infrastructure to be external (principle III).

The concrete Helm chart, selectorless Services for external dependencies, and
the kind cluster configuration belong to **T-22**.
