# transaction-service / domain

Entities, value objects, domain errors and invariants for the movement of money: deposits, withdrawals and the transfer saga steps it participates in.

This layer imports nothing — not another layer, not a framework, not another
service. That is enforced by lint, not by convention (FR-006, FR-007).

> **Blocked**: The domain model (entities, value objects and invariants) is not defined yet. Owner: Marcos Bonifasi. Arrives with: T-02.
