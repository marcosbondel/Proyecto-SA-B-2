# Ownership

Primary ownership means that one named person makes the component's day-to-day
decisions, keeps its documentation current, and coordinates review. It does
not remove the shared work listed below.

## Primary Owners

| Component | Type | Primary owner | Scope |
| --- | --- | --- | --- |
| Customer Service | Service | Enner Esai Mendizabal Castro (202302220) | Customer registration, identity validation, and customer data. |
| Account Service | Service | Enner Esai Mendizabal Castro (202302220) | Account lifecycle, balances, and account state. |
| Transaction Service | Service | David Estuardo Barrios Ramirez (202300670) | Transfer validation, transaction state, and Saga participation. |
| Payment Service | Service | David Estuardo Barrios Ramirez (202300670) | Internal and external payment processing. |
| Notification & Audit Service | Service | Marcos Daniel Bonifasi de Leon (202202410) | Notifications, audit records, and distributed logging foundations. |
| API Gateway | Gateway | Marcos Daniel Bonifasi de Leon (202202410) | External entry point, routing, authentication, and aggregation without domain logic. |
| Frontend | Frontend | Marcos Daniel Bonifasi de Leon (202202410) | Nuxt shell, shared UI direction, and frontend integration. |
| Infrastructure / SRE | Infrastructure | Marcos Daniel Bonifasi de Leon (202202410) | Docker, local kind cluster, reliability practices, and observability. |
| Documentation | Documentation | Marcos Daniel Bonifasi de Leon (202202410) | Project documentation, architecture records, Spec Kit constitution, and indexes. |

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
