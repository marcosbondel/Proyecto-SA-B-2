# notification-audit-service / domain

Entities, value objects, domain errors and invariants for notifications sent to customers and the append-only audit record of every domain event observed.

This layer imports nothing — not another layer, not a framework, not another
service. That is enforced by lint, not by convention (FR-006, FR-007).

> **Blocked**: The domain model (entities, value objects and invariants) is not defined yet. Owner: Marcos Bonifasi. Arrives with: T-02.
