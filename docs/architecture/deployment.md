# Despliegue en GCP — Fase III

La única vista de despliegue del entregable representa GCP: Terraform, GKE,
Cloud Run y Helm. Se edita con figuras y conectores nativos en Lucid y se
exporta sólo a PNG. El PUML conserva el contenido para cotejo semántico;
renderizarlo no reproduce la distribución manual de Lucid.
[ADR-024](adr/ADR-024-native-lucid-and-png-delivery.md),
[procedencia y hashes](../qa/verification/T-61-diagram-provenance.json) y
[auditoría](../qa/T-61-documentation-audit.md).

## GCP: Terraform, GKE, Cloud Run y Helm

![Despliegue cloud](diagrams/08-despliegue-cloud-gcp.png)

[PUML](diagrams/08-despliegue-cloud-gcp.puml),
[página nativa cloud](https://lucid.app/lucidchart/c7a15874-cdcd-42fa-a48c-b6c4124a6fbc/edit?page=K~JxJFM6TNS-).
Terraform declara VPC/subredes, Router/NAT, GKE, cinco VMs privadas PostgreSQL,
Artifact Registry, IP reservada y Cloud Run. GitHub Actions publica imágenes
versionadas y despliega por Helm mediante WIF; `terraform apply` sigue siendo
un procedimiento humano. El clúster observado es `bank-usac-vpc-gke`,
`us-central1-c`, tres nodos `e2-standard-2`, Dataplane V2.

| Límite | Estado contrastado el 2026-10-21 |
| --- | --- |
| `prod` | Siete aplicaciones v1.3.6, RabbitMQ con PVC 2Gi, MinIO y mock BANK99. |
| `dev` | Siete aplicaciones, broker/PVC y MinIO propios; banco externo desactivado. |
| Datos fuera de GKE | Cinco VMs sin IP pública; bases `customer`, `account`, `transaction`, `payment`, `notification_audit` y sus equivalentes `_dev`. |
| Observabilidad | Collector, tres agentes de logs, Prometheus/Tempo/Loki PVC 10Gi cada uno; Grafana PVC 2Gi; retención cloud configurada 7d. |
| Escalado | Siete HPA CPU 80%, mínimo 1/máximo 5; Account usa un lease distribuido. |
| Acceso público | Cloud Run HTTPS; Gateway y Grafana observados por HTTP. Las API keys no cifran el canal. |
| Red | Dataplane V2 habilitado; ninguna NetworkPolicy aplicada en los tres namespaces. |

El frontend Cloud Run y la carga `web` de GKE son despliegues distintos del
mismo componente. Las VMs/capacidad y observabilidad son compartidas; los datos
dev/prod están separados por nombre de base. No inferir aislamiento físico.
La existencia de plantillas de seguridad no prueba su activación. Inventarios,
pruebas y limitaciones: [evidencia cloud](../qa/backend/T-60-cloud-evidence.md).
Runbook completo: [CLOUD.md](../operations/CLOUD.md).

## Lectura de los bloques y conexiones

Los nombres de infraestructura, entornos y componentes aparecen en negrita;
las tecnologías, puertos y límites operativos mantienen peso normal. La paleta
gris y las figuras nativas conservan el estilo del documento original.

La línea **OTLP :4317 / :4318 — Trazas y métricas** es un canal de comunicación
hacia el Collector, no un componente independiente. Conecta el Gateway con
el bloque de observabilidad mediante una línea sin puntas de flecha; su
etiqueta identifica el protocolo, los puertos y la telemetría transportada.
El bloque también recibe telemetría de los otros cinco procesos NestJS, como
se indica dentro de la figura. `observability` es un namespace de GKE separado
de `prod` y `dev`; su ubicación fuera del marco de `prod` no significa que
esté fuera del clúster. Prometheus obtiene las métricas Web por scraping.
