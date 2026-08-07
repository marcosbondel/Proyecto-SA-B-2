# Architecture

This document is the top-level map of the system. It should stay compact and
point to deeper sources of truth in `docs/`.

## Current Status

The repository has just been scaffolded with an agent-first knowledge structure.
Application architecture has not been selected yet.

## Intended Shape

When implementation begins, document:

- Runtime and framework choices.
- Package or module boundaries.
- Data ownership and dependency direction.
- External services and integration boundaries.
- How local development, tests, and deployment work.

## Layering

Define the project layers here once code exists. A common starting point:

- Interface: screens, routes, commands, or API handlers.
- Application: use cases, workflows, orchestration.
- Domain: business rules and domain types.
- Infrastructure: persistence, queues, third-party clients, runtime adapters.
- Observability: logs, metrics, traces, dashboards, and local diagnostics.

## Dependency Rules

Document allowed dependency direction once modules exist. Prefer rules that can
be verified mechanically by tests, lint rules, or small scripts.

## Related Docs

- [docs/DESIGN.md](docs/DESIGN.md)
- [docs/FRONTEND.md](docs/FRONTEND.md)
- [docs/RELIABILITY.md](docs/RELIABILITY.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/design-docs/index.md](docs/design-docs/index.md)
