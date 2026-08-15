# Reliability

## Required Design Concerns

The project assignment requires every service to address:

- Idempotency for repeated commands and event deliveries.
- Retries with bounded behavior and safe retry classification.
- Explicit error handling for business and infrastructure failures.
- Eventual consistency across independently owned databases.
- End-to-end traceability through a propagated `correlationId`.

Distributed transfer and payment workflows use Saga steps and compensation
events. A request accepted by the system is not treated as complete until the
owning workflow confirms completion.

## SLI, SLO, And SLA

> **Blocked**: Service-level indicators, objectives, agreements, formulas,
> sources, and target values have not been approved. Owner: Marcos Bonifasi.
> Arrives with: T-03. T-24 measures the definitions; it does not create them.

## Observability

Notification & Audit Service provides the domain foundation for audit events and
distributed logging. The project retains `@artmizu/nuxt-prometheus` in the web
manifest while its justification remains open in TD-006 for T-24.

Every future service must make correlation context, retries, failures, and
eventual completion observable without changing business outcomes.

## Verification

The current executable check is `pnpm install && pnpm build` from `apps/web/`.
Integration, resilience, failure, and observability checks arrive with the
service implementation and integration tickets.

## Incident Notes

There are no runtime incidents to record because the backend services and
deployment have not been implemented yet.
