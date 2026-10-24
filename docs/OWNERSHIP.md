# Ownership

Primary ownership means that one named person makes the component's day-to-day
decisions, keeps its documentation current, and coordinates review. It does
not remove the shared work listed below.

## Primary Owners

| Component | Type | Primary owner | Scope |
| --- | --- | --- | --- |
| Customer Service | Service | Enner Esai Mendizabal Castro (202302220) | Customer registration, identity/KYC lifecycle, customer data and lifecycle telemetry. |
| Account Service | Service | Enner Esai Mendizabal Castro (202302220) | Account lifecycle, balances, state and activity/anomaly detection. |
| Transaction Service | Service | David Estuardo Barrios Ramirez (202300670) | Transfer state, Saga coordination, history and transfer performance telemetry; funds verdicts remain in Account. |
| Payment Service | Service | David Estuardo Barrios Ramirez (202300670) | Payment attempts, runtime failure simulation and interbank send/receive/reconciliation. |
| Notification & Audit Service | Service | Marcos Daniel Bonifasi de Leon (202202410) | Notifications, redacted audit, traceability, inboxes and SLO alert ingestion. |
| API Gateway | Gateway | Marcos Daniel Bonifasi de Leon (202202410) | External entry point, routing, authentication, and aggregation without domain logic. |
| Frontend | Frontend | Marcos Daniel Bonifasi de Leon (202202410) | Nuxt 4, shared UI, role workflows, audit/trace links and interbank screens. |
| Infrastructure / SRE | Infrastructure | Marcos Daniel Bonifasi de Leon (202202410) | Docker/kind, Terraform/GKE/Cloud Run, Helm, CI/CD, telemetry, dashboards, alerts and runbooks. |
| Documentation | Documentation | Marcos Daniel Bonifasi de Leon (202202410) | Project documentation, architecture records, Spec Kit constitution, and indexes. |

Reviewed for Phase III on 2026-10-21. The primary owners are unchanged; this
revision updates the scope they maintain, not authorship or ticket assignment.

## Shared Work

All three members participate in:

- Event contracts and compatibility review.
- Cross-service integration and end-to-end validation.
- Tests and failure-scenario verification.
- Final review and evidence collection.

Shared work is collaborative, but it does not create a second primary owner for
any component.

## How To Use This

Ask the primary owner first when a decision affects the component's scope,
implementation, or documentation. Bring cross-service changes to the shared
event-contract and integration review. Escalate unresolved architectural,
infrastructure, frontend, SRE, or documentation questions to Marcos Bonifasi.
