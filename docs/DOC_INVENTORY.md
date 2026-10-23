# Documentation Inventory

> T-61 / #168 — inventory closed on **2026-10-22** after the initial 2026-10-21 review. Review dates record this documentary audit (older rows retain their content-review date), not a new approval, new authorship, rerun of historical tests, or verified production deployment. Existing named owners are preserved.

This inventory accounts for every repository-owned Markdown document with an explicit row, and for harness/vendor/template material through directory rules. It also covers diagram sources, rendered images, screenshots and machine-readable evidence. `docs/` explains the bank; `context/` explains how agents build it. Executable configuration remains in its own directories.

The final Markdown table contains **161 explicit document rows**, including the editor-alternatives index and final verification record. Harness/template trees remain covered by their directory rules.

The primary component owners remain those in [OWNERSHIP](OWNERSHIP.md). A prior document owner can differ from the component owner and is retained here; review by T-61 does not transfer that responsibility. Findings, limits and source-to-evidence mappings are in the [audit report](qa/T-61-documentation-audit.md); cloud observations are in [T-60 evidence](qa/backend/T-60-cloud-evidence.md).

## Classes and states

| Class | Meaning | Authority |
| --- | --- | --- |
| `project` | Maintained explanation, manual, runbook or architecture source. | Named human owner; records implementation or approved decisions. |
| `generated` | Projection derived from a named source, including render or emitted table. | Source remains authoritative; record the regeneration procedure and its limits. |
| `evidence` | Dated observation, screenshot, test output or incident record. | Describes that run/environment only; preserve original date, failures and provenance. |
| `reference` | Assignment, external contract or supplied source. | External author; do not rewrite the official interbank OpenAPI. |
| `template` | Scaffold copied into another artifact. | Not project truth. |
| `harness` | Agent/skill/Spec Kit instructions or feature workflow artifacts. | Governs work, not product behaviour. |
| `vendored` | Installed content maintained upstream. | Read-only external source. |

`current` means current as documentation, including stated open gaps. `historical evidence` retains its run and is not refreshed by changing this table. `superseded` retains a historical decision and its successor. The earlier blanket blocked states for frontend/product/security are replaced by the explicit limits now recorded in those documents; no blocker is presumed solved by a date change.

## Markdown documents

| Path | Class | Owner | State | Last reviewed |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `ARCHITECTURE.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `CLAUDE.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `E2E.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/gateway/src/application/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/gateway/src/domain/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/packages/contracts/scripts/catalog-preamble.md` | template | Marcos Bonifasi | current | 2026-10-21 |
| `apps/packages/contracts/src/events/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/packages/tooling/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/services/account-service/src/application/README.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `apps/services/account-service/src/domain/README.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `apps/services/customer-service/src/application/README.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `apps/services/customer-service/src/domain/README.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `apps/services/notification-audit-service/src/application/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/services/notification-audit-service/src/domain/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `apps/services/payment-service/src/application/README.md` | project | David Barrios | current | 2026-10-21 |
| `apps/services/payment-service/src/domain/README.md` | project | David Barrios | current | 2026-10-21 |
| `apps/services/transaction-service/src/application/README.md` | project | David Barrios | current | 2026-10-21 |
| `apps/services/transaction-service/src/domain/README.md` | project | David Barrios | current | 2026-10-21 |
| `apps/web/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `context/AI_PROJECT_AGENTS.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `context/AI_PROJECT_SKILLS.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `context/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `context/prompt-mockup.md` | project | Marcos Bonifasi | superseded | 2026-10-21 |
| `docs/DESIGN.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/DOC_INVENTORY.md` | project | Marcos Bonifasi | current | 2026-10-22 |
| `docs/FRONTEND.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/METHODOLOGY.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/OWNERSHIP.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/PRODUCT_SENSE.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/QUALITY_SCORE.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/RELIABILITY.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/SECURITY.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/TECHNICAL_DOCUMENT.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/TECH_DEBT.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/adr.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-001-backend-stack.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-002-frontend-stack.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-003-communication-model.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-004-message-broker.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-005-persistence.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-006-containerization.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-007-local-orchestration.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-008-service-internal-architecture.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-009-distributed-transactions.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-010-authentication.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-011-diagramming-toolchain.md` | project | Marcos Bonifasi | superseded; historical record | 2026-10-21 |
| `docs/architecture/adr/ADR-012-object-storage.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-013-diagramming-toolchain-revision.md` | project | Marcos Bonifasi | superseded; historical record | 2026-10-21 |
| `docs/architecture/adr/ADR-014-cloud-provider.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-015-ci-cd-platform.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-016-cloud-infrastructure.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-017-account-anomaly-reports-not-blocks.md` | project | David Barrios | current | 2026-10-21 |
| `docs/architecture/adr/ADR-018-observability-stack.md` | project | Enner Mendizabal | current; partly superseded by ADR-023 | 2026-10-21 |
| `docs/architecture/adr/ADR-019-payment-http-egress.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-020-slo-error-budgets.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-021-interbank-protocol-v1.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-022-diagramming-sources-and-image-editing.md` | project | Marcos Bonifasi | historical; graphic policy partly superseded by ADR-024 | 2026-10-22 |
| `docs/architecture/adr/ADR-023-observability-evolution.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/adr/ADR-024-native-lucid-and-png-delivery.md` | project | Marcos Bonifasi | current policy; native exports require separate verification | 2026-10-22 |
| `docs/architecture/adr/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/c4-component.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/c4-container.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/c4-context.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/decision-matrix.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/deployment.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/architecture/diagrams/alternativas-editor/README.md` | project | Enner Mendizabal | current | 2026-10-22 |
| `docs/architecture/diagrams/cdu/README.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/diagrams/er/README.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/sequence-create-account.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/sequence-transfer.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/architecture/use-cases-uml.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/dda.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/domain/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/domain/actors.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/domain/bounded-contexts.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/domain/entities.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/domain/message-catalog.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/domain/use-cases.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/events/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/events/catalog.md` | generated | Marcos Bonifasi | current | 2026-10-21 |
| `docs/events/envelope.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/events/saga-transfer.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/events/topology.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/generated/db-schema.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/images/fase3/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/images/kubernetes/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual-tecnico.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual-usuario.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual/recorrido-fase3.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual/recorrido-visual.md` | project | Enner Mendizabal | current | 2026-10-21 |
| `docs/manual/rol-administrador.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual/rol-cajero-receptor.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/manual/rol-cliente.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/CI.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/CLOUD.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/CONTAINERS.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/DEPLOYMENT.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/EMAIL_RESEND.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/INTERBANK-AGREEMENT.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/INTERBANK.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/MONOREPO.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/consumer-lag.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/dead-letter.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/gateway-availability-burn.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/gateway-latency.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/partner-bank.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/restarts.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/operations/runbooks/transfer-latency.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/process/implementations.md` | project | David Barrios | current | 2026-10-21 |
| `docs/qa/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/qa/T-61-documentation-audit.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/qa/backend/T-26-kyc-evidence.md` | project | Enner Mendizabal | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-27-account-type-rules-evidence.md` | project | Enner Mendizabal | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-28-transaction-history-evidence.md` | project | David Barrios | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-29-payment-provider-evidence.md` | project | David Barrios | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-30-event-classification-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-31-integration-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-41-customer-lifecycle-telemetry-evidence.md` | project | Enner Mendizabal | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-42-account-activity-monitoring-evidence.md` | project | David Barrios | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-43-transfer-performance-telemetry-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-44-payment-failure-simulation-evidence.md` | project | Enner Mendizabal | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-45-audit-traceability-evidence.md` | project | David Barrios | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-46-interbank-receipt-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-47-interbank-send-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-48-observability-package-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-49-observability-stack-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-50-dashboards-alerts-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-51-load-and-failures-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-56-interbank-reconciliation-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-57-local-stack-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-58-telemetry-catalog-evidence.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/qa/backend/T-60-cloud-evidence.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/qa/guia-validacion-manual-fase3.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/qa/happypath.md` | project | Enner Mendizabal | historical baseline; see T-61 evidence | 2026-10-21 |
| `docs/qa/pyramid.md` | generated | — | historical baseline; see T-61 evidence | 2026-10-21 |
| `docs/qa/validation-report.md` | project | Enner Mendizabal | historical baseline; see T-61 evidence | 2026-10-21 |
| `docs/qa/verification/T-61-verification.md` | evidence | Marcos Bonifasi | current | 2026-10-22 |
| `docs/references/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/sre/postmortems/2026-10-15-banco-pareja.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/sre/postmortems/2026-10-15-latido-amqp.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/sre/postmortems/2026-10-15-pod-eliminado.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/sre/postmortems/2026-10-15-proveedor-de-pagos.md` | project | Marcos Bonifasi | historical evidence; preserve original run | 2026-10-21 |
| `docs/sre/postmortems/2026-10-19-rabbitmq-persistence-cookie.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/sre/postmortems/2026-10-21-cloud-baseline-latency.md` | evidence | Marcos Bonifasi | current; dated cloud observation | 2026-10-21 |
| `docs/sre/postmortems/2026-10-21-cloud-pod.md` | evidence | Marcos Bonifasi | current; dated cloud observation | 2026-10-21 |
| `docs/sre/postmortems/2026-10-21-cloud-provider.md` | evidence | Marcos Bonifasi | current; dated cloud observation | 2026-10-21 |
| `docs/sre/postmortems/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/sre/sli-slo-sla.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `docs/sre/telemetry-catalog.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `infra/docker/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `infra/k8s/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `infra/k8s/helm/bank-observability/dashboards/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |
| `infra/terraform/gcp/README.md` | project | Marcos Bonifasi | current | 2026-10-21 |

### Phase III additions and reproducibility

- ADR-020 records existing SLO populations/error budgets; ADR-021 records official interbank translation and the receiver hard-expiry gap; ADR-022 records the first T-61 diagram policy; ADR-023 records the deployed observability evolution. ADR-024 partially supersedes ADR-022 following the 22/oct request for native Lucid UML editing and PNG-only diagrams. Historical decision bodies remain unchanged.
- The 134-contract catalogue is derived from emitted schemas through the documented adapter in [events/README](events/README.md). The versioned generator still classifies only 48/134; the adapter and its verification are embedded in documentation rather than dependent on an untracked temporary script.
- Physical schema coverage includes all cumulative migrations and the technical migration table in each database. [ER README](architecture/diagrams/er/README.md) contains DBML validation and model limits. The five generated ER PNGs and Pillow drawing procedure were withdrawn; the requester will export the diagrams from DBML.
- Technical sources and PNG exports are indexed below. Native Lucid editing applies to use-case and deployment diagrams; PUML remains a semantic reference, C4 retains DSL/CLI and sequences retain PUML. Editor image variants remain historical alternatives. [ADR-024](architecture/adr/ADR-024-native-lucid-and-png-delivery.md) records the current policy and its verification requirement.

## Sources, images, references and evidence

The patterns below cover existing historical assets and additions in T-61. A grouped row does not imply that an optional alternative or a missing screenshot was created. Refer to the report/manual for the exact captured asset and scenario. The **2026-10-22** format revision removed every documentary SVG under `docs/` and the five generated ER PNGs; five DBML files were preserved unchanged during that removal. Native Lucid work and C4 exports are under review. Final counts and hashes must be regenerated after those exports: manifests produced before the format revision temporarily describe the earlier asset set, not the current checkout. No source-to-PNG parity is asserted for the intentionally unexported ER set.

| Paths / asset family | Class | Owner | Source, provenance or review requirement |
| --- | --- | --- | --- |
| `docs/architecture/diagrams/*.puml`, `docs/architecture/diagrams/cdu/**/*.puml` | project | Enner Mendizabal | UML/architecture semantic sources; preserve technical labels, participants and sequence. |
| `docs/architecture/diagrams/*.dsl` | project | Enner Mendizabal | Structurizr model/views, including c4.dsl; use source-linked render procedure. |
| `docs/architecture/diagrams/er/*.dbml` | project | Enner Mendizabal | Five physical schemas accumulated from service migrations; no cross-service FK. PNG export is pending from the requester. |
| `docs/architecture/diagrams/0[1-8]*.png` | generated | Enner Mendizabal | Architecture/C4/deployment/sequence PNGs; deployment must be checked against the native Lucid document before claiming a completed replacement. |
| `docs/architecture/diagrams/04-componentes-{gateway,customer,account,payment,audit}.png` | generated | Enner Mendizabal | Additional per-component C4 exports from 04-c4-componentes.dsl; Transaction remains in the original component view. |
| `docs/architecture/diagrams/09-secuencia-envio-interbancario.{puml,png}` | project / generated | Enner Mendizabal | New official send, callback, TIMEOUT, resolution and compensation view. |
| `docs/architecture/diagrams/10-secuencia-recepcion-interbancaria.{puml,png}` | project / generated | Enner Mendizabal | New idempotent receiver/credit/cancel view, with hard-expiry limitation visible. |
| `docs/architecture/diagrams/11-secuencia-reintentos-pago.{puml,png}` | project / generated | Enner Mendizabal | New provider retry/outbox/compensation view. |
| `docs/architecture/diagrams/12-observabilidad-y-alertas.{puml,png}` | project / generated | Enner Mendizabal | New telemetry, collectors, engines and alert return path. |
| `docs/architecture/diagrams/13-casos-uso-fase3.{puml,png}` | project / generated | Enner Mendizabal | Phase III use-case semantic source and PNG; native Lucid export requires separate verification. |
| `docs/architecture/diagrams/**/*.png` outside the named main/ER families | generated | Enner Mendizabal | CDU exports and historical editor variants; identify source/version before claiming parity or native Lucid provenance. |
| `docs/architecture/diagrams/alternativas-editor/*-editor.png` | generated | Enner Mendizabal | Ten ImageGen alternatives for 01 and 05–13; labels/source comparisons in the directory README; canonical technical renders remain separate. |
| `docs/images/fase3/manifest.json` | evidence | Marcos Bonifasi | Manifest of actual JPEG captures: source URL, role, UTC file timestamp, dimensions and SHA-256. The 22/oct inventory contains 25 JPEG originals; compare each manifest entry with its file and record any missing entry. Audit review date does not replace capture time. |
| `docs/images/fase3/manual/*.{jpg,png}` | evidence | Marcos Bonifasi | Actual browser captures; role, URL and date in manual/evidence. No generated substitute for a missing screen. |
| `docs/images/fase3/observability/*.{jpg,png}` | evidence | Marcos Bonifasi | Actual Grafana/Explore captures, with environment, filters and time window. |
| `docs/qa/load/2026-10-{21,22}-*/**`, `docs/qa/load/2026-10-{21,22}-*` | evidence | Marcos Bonifasi | GKE inventory/isolation, k6 output, summaries, timelines, metrics, balances and final 22/oct readiness from dated scenarios. Preserve failures and pre/post state. |
| `docs/qa/verification/**` | evidence | Marcos Bonifasi | Dated final T-61 verification report and supporting verification output when present; preserve command, result and environment. |
| `docs/events/examples/*.json` | generated | Marcos Bonifasi | Three validated historical reduced Saga examples; not a trace of a deployed execution. |
| `docs/qa/*.{json,txt}`, `docs/qa/automated_test/**`, `docs/qa/screenshots/**` | evidence / generated | Enner Mendizabal | Historical E2E/test output and screenshots; execution timestamps remain authoritative. |
| `docs/images/kubernetes/**` and other historical `docs/images/**` outside fase3 | evidence | Marcos Bonifasi | Original environment evidence; do not relabel kind screenshots as GKE. |
| `docs/references/*.pdf` | reference | Course / original author | Phase statements and supplied reference material; preserve original bytes. |
| `docs/references/interbank-contract-v1.openapi.yaml` | reference | Course teaching assistant | Official v1.0.0, preserved byte for byte; adaptation is in application code and explanatory docs. |

Brace alternatives and `**` in this table describe families, not shell commands. The inventory audit enumerates the actual files before comparing coverage; it does not manufacture an absent member of a family.

## Directory rules for harness and scaffolding

| Glob | Class | Owner | Note |
| --- | --- | --- | --- |
| `.agents/roles/**/*.md` | harness | — | Canonical agent roles. |
| `.agents/skills/**/*.md` | harness | — | Canonical skills and installed supporting references. |
| `.claude/agent-memory/**/*.md` | harness | — | Agent-maintained memory, not an approved domain decision. |
| `.claude/agents/**/*.md`, `.claude/skills/**/*.md` | harness | — | Symlinked canonical bodies; do not duplicate/edit the linked copies. |
| `.opencode/commands/**/*.md` | harness | — | Linked command entry points. |
| `.specify/memory/**/*.md` | harness | — | Active constitution and workflow memory. |
| `.specify/templates/**/*.md` | template | — | Spec Kit scaffolds. |
| `specs/**/*.md` | harness | — | Historical/active Spec Kit feature artifacts retain their own state. |

Installed dependencies, `.git`, caches and `tmp/` are execution material and excluded. A README beside application code is explicitly listed above with its existing/component owner; there is no blanket apps rule that hides a new undocumented Markdown file.

## Coverage check

Run from the repository root with Python. This reads the explicit Markdown rows and fails for a new unclassified file. Harness prefixes are excluded only through the directory rules stated above; application/docs subtrees cannot silently bypass coverage. Temporary/cached files and dependency trees are ignored.

```python
from pathlib import Path
import os
import re

root = Path.cwd()
inventory = root / "docs/DOC_INVENTORY.md"
text = inventory.read_text(encoding="utf-8-sig")
rows = {
    path for path in re.findall(
        r"^\| `([^`]+)`\s+\| (?:project|template|generated|harness|vendored|reference|evidence)\s+\|",
        text, re.MULTILINE,
    )
    if path.endswith(".md") and not any(char in path for char in "*?{")
}
excluded = {".git", "node_modules", ".turbo", ".pnpm-store", "tmp"}
harness = (".agents/", ".claude/", ".opencode/", ".specify/", "specs/")
files = set()
for base, directories, names in os.walk(root, followlinks=False):
    directories[:] = [name for name in directories if name not in excluded]
    for name in names:
        if name.endswith(".md"):
            files.add((Path(base) / name).relative_to(root).as_posix())
uncovered = sorted(p for p in files if p not in rows and not p.startswith(harness))
stale = sorted(p for p in rows if p.endswith(".md") and not (root / p).is_file())
for path in uncovered:
    print("UNCLASSIFIED", path)
for path in stale:
    print("MISSING", path)
assert not uncovered and not stale, "Documentation inventory drift"
print("Markdown inventory covers", len(files), "files including harness rules")
```

A passing inventory check proves classification and presence. It does not prove content accuracy, broken-anchor absence, test success, image quality or cloud behaviour; those require the independent evidence recorded by T-61.
