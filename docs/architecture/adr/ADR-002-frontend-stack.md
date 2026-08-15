# ADR-002: Build the frontend in Vue with Nuxt 4

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: Not constrained by the assignment; team decision.

## Context

The assignment fixes the backend language, framework, orchestration, containers, messaging and
database (§4.2 p. 13, §4.3 p. 14) but says nothing about the frontend. It requires a user
manual (§4.4, p. 14) and three user roles — `ADMINISTRADOR`, `CAJERO_RECEPTOR`, `CLIENTE`
(p. 7) — which implies a usable interface, but leaves the technology entirely open.

The frontend is a client of the API Gateway and nothing else. It never talks to a service, never
touches the broker and never reads a database, so this decision is contained: it constrains no
other part of the architecture.

The repository already carries a Nuxt application at `apps/web`, so this ADR records a decision
that predates it rather than proposing a change.

## Decision

The frontend is **Vue** with **Nuxt 4**, using `@nuxt/ui` and Tailwind CSS.

Verified in the workspace: Nuxt 4.5.2, `@nuxt/ui` 4.10.0, Tailwind CSS 4.3.3 and TypeScript
6.0.3.

The application is the only external client of the Gateway. It holds the session JWT issued
under [ADR-010](ADR-010-authentication.md) and sends it with each request.

## Alternatives considered

### React with Next.js

The most widely used option, with the largest ecosystem and the deepest hiring pool.

**Rejected because**: it offers no capability this project needs that Nuxt does not already
provide — the interface is a set of authenticated forms and tables over a REST-shaped Gateway,
not a rendering-heavy product. Choosing it would mean rebuilding the existing `apps/web`
scaffolding for a benefit the requirements never exercise, which is delivery risk spent on
nothing. Ecosystem size is not a technical differentiator at this scope.

### Angular

A complete, opinionated framework whose structure would echo the layering used on the backend.

**Rejected because**: its build and testing toolchain is separate from the Vite/Nitro toolchain
the workspace already standardises on, which would add a second frontend build system to a pnpm
monorepo that currently has one. For a three-person team delivering six backend workloads in
parallel, a second toolchain is operational cost with no matching return.

### A server-rendered interface from the Gateway itself

Let the Gateway render HTML directly and skip the separate frontend application.

**Rejected because**: it would put presentation concerns inside the component the constitution
requires to stay thin (principle V — the Gateway routes, authenticates and aggregates). It also
couples the interface's release cycle to the Gateway's, and makes the "single entry point" role
harder to reason about.

## Consequences

**Easier.** One language across the whole repository, since the backend is TypeScript
([ADR-001](ADR-001-backend-stack.md)) — types describing Gateway requests and responses can be
shared rather than restated. `@nuxt/ui` supplies accessible components, so the three role-based
surfaces can be built without designing a component library first. File-based routing keeps the
three role areas visibly separate.

**Harder.** `apps/web` has **no component test framework**; its `test` script is a single
`node --test` smoke test, not a Vue suite (recorded as TD-010). Frontend correctness is
therefore verified by review and manual exercise, not by automated component coverage, and no
work in this repository may claim component coverage for the web app until that debt is closed.

**Obligations created.**

- **T-15** defines the Gateway contract this application consumes.
- The per-service frontend surfaces are built alongside their services in **T-16 to T-20**.
- TD-010 stays open: if component coverage becomes necessary, adding a Vue test framework is a
  separate decision.
