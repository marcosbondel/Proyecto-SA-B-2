# Architecture

Diagrams and architecture decision records for Bank USAC. The selected target
architecture is recorded in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md);
this directory holds the decisions behind it and the diagrams that show it.

## Contents

- [`adr/`](adr/README.md) — **the thirteen decision records**, begun in T-03.
  Backend and frontend stack, communication model, broker, persistence,
  containers, local orchestration, internal service architecture, distributed
  transactions, authentication and the diagramming toolchain.
- [`decision-matrix.md`](decision-matrix.md) — the consolidated view: decision,
  rejected alternatives, accepted trade-off and consequence, with the assignment
  penalties each decision avoids.
- `diagrams/` — the eight required diagrams. The versioned Mermaid and
  PlantUML sources are present; see the table below. The use-case deliverable
  is intentionally a hierarchy under `diagrams/cdu/`.

## What belongs here

- One ADR per decision, numbered and dated, with the alternatives that were
  rejected and why. **Done** — they live in [`adr/`](adr/README.md).
- The eight diagrams the assignment requires. **One ticket per diagram**
  (T-07 to T-14); the two sequence diagrams are separate tickets because the
  transfer one models the whole Saga and is far harder than the other.

  | # | Diagram | Ticket | File stem in `diagrams/` |
  | --- | --- | --- | --- |
  | 1 | General architecture | T-07 | `01-arquitectura-general` |
  | 2 | C4 L1 — Context | T-08 | `02-c4-contexto` |
  | 3 | C4 L2 — Containers | T-09 | `03-c4-contenedores` |
  | 4 | C4 L3 — Components | T-10 | `04-c4-componentes` |
  | 5 | UML — Deployment | T-11 | `05-uml-despliegue` |
  | 6 | UML — Sequence, create account | T-12 | `06-uml-secuencia-crear-cuenta` |
  | 7 | UML — Sequence, transfer with Saga | T-13 | `07-uml-secuencia-transferencia` |
  | 8 | UML — Use cases, hierarchical views | T-14 | `cdu/` (`00-alto-nivel`, `01-primera-descomposicion` and one folder per service) |

  The general architecture diagram is a deliverable in its own right: the
  assignment lists it separately from the C4 + UML block (§4.2 bullet
  "Diagramas de arquitectura"; §4.4 "Diagramas arquitectónicos").

- The mapping from each constitution principle to where it is enforced.
  **Not written.** Individual ADRs name the principles their decision rests on —
  ADR-005 and ADR-007 on III, ADR-009 on VI, ADR-010 and ADR-012 on IV and V —
  but nothing takes the eight principles of
  [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) in
  order and says, for each, where it is enforced and by what. Some are enforced
  executably and would be the easy half to record: `pnpm lint` rejects a
  cross-service import and a cross-layer one, and every service's
  `test/isolation.spec.ts` fails the build if it reads another service's
  database or opens an HTTP call.

## Delivery format — the sources actually in the repository

Every diagram ships a **versioned text source plus the render that is handed
in**. What that source is, per diagram:

| # | Diagram | Source | Render | Document that reads it |
| --- | --- | --- | --- | --- |
| 1 | General architecture | [`01-arquitectura-general.puml`](diagrams/01-arquitectura-general.puml) | `.png` | [`../architecture.md`](../architecture.md) §3 |
| 2 | C4 L1 — Context | [`02-c4-contexto.puml`](diagrams/02-c4-contexto.puml) · [`c4.dsl`](diagrams/c4.dsl) | `.png` | [`c4-context.md`](c4-context.md) |
| 3 | C4 L2 — Containers | [`03-c4-contenedores.puml`](diagrams/03-c4-contenedores.puml) · [`c4.dsl`](diagrams/c4.dsl) | `.png` | [`c4-container.md`](c4-container.md) |
| 4 | C4 L3 — Components | [`04-c4-componentes.puml`](diagrams/04-c4-componentes.puml) · [`.dsl`](diagrams/04-c4-componentes.dsl) | `.png` | [`c4-component.md`](c4-component.md) |
| 5 | UML — Deployment | [`05-uml-despliegue.puml`](diagrams/05-uml-despliegue.puml) | `.png` | [`deployment.md`](deployment.md) |
| 6 | UML — Sequence, create account | [`06-uml-secuencia-crear-cuenta.puml`](diagrams/06-uml-secuencia-crear-cuenta.puml) | `.png` | [`sequence-create-account.md`](sequence-create-account.md) |
| 7 | UML — Sequence, transfer with Saga | [`07-uml-secuencia-transferencia.puml`](diagrams/07-uml-secuencia-transferencia.puml) | `.png` | [`sequence-transfer.md`](sequence-transfer.md) |
| 8 | UML — Use cases | [`diagrams/cdu/`](diagrams/cdu/README.md) — 7 use-case diagrams and 22 activity flows, each `.puml` + `.png` | | [`use-cases-uml.md`](use-cases-uml.md) |
| — | Entity-relationship | [`diagrams/er/`](diagrams/er/README.md) — five `.dbml`, one per database | `.png` | [`../generated/db-schema.md`](../generated/db-schema.md) |

**Mermaid is gone and no ADR records it.** [ADR-013](adr/ADR-013-diagramming-toolchain-revision.md)
requires PlantUML *alongside* Mermaid, and made Lucid optional. On 2026-09-02 the
`.mmd` sources were removed (commit `9acf394`, "remove .mmd diagram sources in
favor of PlantUML, DBML, and PNG"), and Structurizr DSL and DBML — which no ADR
mentions — took their place. The repository and its ADR therefore disagree today.
The rule that a decision changes only through a superseding ADR is what makes
that a gap to close (**TD-064**), not a detail: an ADR nobody may edit is only
worth as much as the practice of writing the successor.

Three PNG exports do **not** come from the sources beside them —
`02-c4-contexto.png`, `03-c4-contenedores.png` and `05-uml-despliegue.png` were
composed by hand and restored by an explicit team decision. Where an image and
its source disagree, the source is the one to trust; `deployment.md` records the
concrete case (the port-forward is drawn reversed). Do not re-render them to
"fix" the mismatch without asking the team first.

## Transversal rules

Every diagram here must satisfy the five rules the assignment applies to all
diagrams (§4.2): consistent with each other, reflecting mandatory asynchronous
communication, preserving separation of responsibilities, correctly labelled
with **technology, protocol and communication type**, and legible.

The eight principles in `.specify/memory/constitution.md` are already binding
and do not wait for this directory. What is missing is the written reasoning,
not the rules.

> **Current status**: all eight diagram sources are present as `.puml`, with the
> ER set in DBML, and every one of them is now linked from this file or from
> [`diagrams/cdu/README.md`](diagrams/cdu/README.md). Each diagram has a document
> that reads it — the table above names which. The thirteen ADRs live in
> [`adr/`](adr/README.md) with the consolidated view in
> [`decision-matrix.md`](decision-matrix.md).
