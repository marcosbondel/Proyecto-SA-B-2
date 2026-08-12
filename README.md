# Bank USAC

**Software Avanzado | Second Semester 2026 | Section B | Group 2**

Bank USAC is a distributed banking system built as an academic project. It
uses five independently owned microservices, an API Gateway, asynchronous
RabbitMQ messaging, separate PostgreSQL databases outside a local Kubernetes
cluster, and a Nuxt frontend. The architecture applies Clean Architecture and
Saga choreography so distributed operations remain observable and resilient.

## Team

| Member | Student ID | Role |
| --- | --- | --- |
| Enner Esai Mendizabal Castro | 202302220 | AI Engineer; Customer and Account Services |
| David Estuardo Barrios Ramirez | 202300769 | AI Engineer; Transaction and Payment Services |
| Marcos Daniel Bonifasi de Leon | 202202410 | AI Project Manager and Tech Lead; Gateway, frontend, infrastructure, SRE, Notification & Audit, and documentation |

All three members share responsibility for event contracts, integration,
testing, and final review. See [docs/OWNERSHIP.md](docs/OWNERSHIP.md) for the
single primary owner of every component.

## What This Is

The system models the core flows of a banking platform:

- Customer registration and identity validation.
- Bank account creation, balance queries, and account state changes.
- Transfers between accounts through an asynchronous Saga.
- Internal and external payment processing.
- Notifications, audit events, and distributed observability foundations.

The current repository is the documented starting point. The backend and
business features are not implemented yet.

## Repository Layout

- `apps/web/` - the Nuxt frontend application.
- `docs/` - durable project documentation, decisions, ownership, methodology,
  and quality records.
- `specs/` - archived and active Spec Kit artifacts for feature work.
- `.specify/` - Spec Kit workflow state, templates, and constitution.
- `.agents/` - canonical role and skill definitions used by the agent harness.
- `.claude/` and `.opencode/` - tool integrations that link to canonical
  harness content.
- `docs/references/` - assignment and external reference material.

The future backend service layout is deliberately not described here; it is a
decision for T-04.

## Documentation

- [Architecture](ARCHITECTURE.md) - system shape, constraints, stack, and
  dependency rules.
- [Design system](docs/DESIGN.md) - visual tokens, components, states, and
  domain formats.
- [Ownership](docs/OWNERSHIP.md) - primary owners and shared work.
- [Methodology](docs/METHODOLOGY.md) - sprints, milestones, evidence, and
  blockers.
- [Product sense](docs/PRODUCT_SENSE.md) - users and core workflows.
- [Frontend](docs/FRONTEND.md) - verified frontend stack and conventions.
- [Security](docs/SECURITY.md) - data classes and security scope.
- [Reliability](docs/RELIABILITY.md) - SRE requirements and observability.
- [Quality score](docs/QUALITY_SCORE.md) - current quality assessment.
- [Technical debt](docs/TECH_DEBT.md) - actionable open debt.
- [Documentation inventory](docs/DOC_INVENTORY.md) - classification and
  coverage rules for every Markdown file.
- [AI project agents](docs/AI_PROJECT_AGENTS.md) - agent roles and boundaries.
- [AI project skills](docs/AI_PROJECT_SKILLS.md) - installed and deferred
  skills.
- [Design documents](docs/design-docs/index.md) - durable design records.

## Development

Run commands from `apps/web/`:

```bash
pnpm install
pnpm dev
pnpm build
pnpm generate
pnpm preview
```

There is currently no test script and no lint script in `apps/web/package.json`.
The available automated application check is `pnpm build`; adding test or lint
commands is separate technical debt recorded in `docs/TECH_DEBT.md`.

Spec-driven work uses [Spec Kit](https://github.com/github/spec-kit) under
`.specify/`. The available workflows are documented in [AGENTS.md](AGENTS.md).
