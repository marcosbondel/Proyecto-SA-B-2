# Architecture

Diagrams and architecture decision records for Bank USAC. The selected target
architecture is recorded in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md);
this directory holds the decisions behind it and the diagrams that show it.

## Contents

- [`adr/`](adr/README.md) — **the eleven decision records**, written in T-03.
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

  **Diagram 1 and diagram 3 are deliberately two artefacts, not one.** The team
  considered collapsing them and decided against it, so the decision is recorded
  here rather than left implicit. Diagram 3 is formal C4 notation and answers
  *which containers exist and what messages flow between them* — it carries the
  queue and event catalogue. Diagram 1 is the panorama that opens the document
  and answers two questions C4 L2 does not make its subject: **what technology
  each component is built on**, and **where the infrastructure boundary falls** —
  what runs inside the kind cluster and what runs outside it. They must agree on
  every component name and every relationship; they differ only in what they
  make explicit. Merging them would drop one of the two §4.2 bullets the
  assignment lists separately.

## Delivery format — two required sources and generated exports

Every diagram ships **two required, versioned text sources that must agree**.
Generated visual exports are kept alongside their source when the diagram is
rendered for delivery:

1. **Mermaid** — a versioned `.mmd` source in `diagrams/`, so the architecture
   is reviewable in Git and in pull requests. **Generating it with AI is
   allowed**; shipping it unreviewed is not. Mermaid-rendered PNGs, such as
   the activity-flow exports under `diagrams/cdu/*/flujos/`, are generated
   artefacts derived from this source.
2. **PlantUML** — a versioned `.puml` source in `diagrams/`, plus its export
   (PNG, SVG or PDF) committed alongside it. **Generating it with AI is
   allowed**; shipping it unreviewed is not.
3. **LucidChart** (optional) — the editable document, plus an export committed
   to `diagrams/` if the team produces one. Register the Lucid link in the
   table above only when a Lucid document exists; it is not required for a
   diagram to be done.

This is the decision recorded in
[ADR-013](adr/ADR-013-diagramming-toolchain-revision.md), which supersedes
[ADR-011](adr/ADR-011-diagramming-toolchain.md): PlantUML is now required
alongside Mermaid, and Lucid — previously required — is optional.

If the Mermaid and PlantUML sources disagree, the diagram is not done — the
rubric penalises documentation inconsistency by 25 % (§8.3). A Lucid export
that disagrees with either required source is also not done, if one is
shipped.

Mermaid covers seven of the eight natively (`C4Context`, `C4Container`,
`C4Component`, `C4Deployment`, `sequenceDiagram`). **Use cases are the
exception**: Mermaid has no UML use-case diagram, so that one uses a
`flowchart` approximation. PlantUML covers all eight natively, including UML
use cases (`usecase`, `<<include>>`/`<<extend>>`) and C4 notation via the
`C4-PlantUML` library, so **for the use-case diagram, PlantUML is the
authoritative artefact** — it replaces Lucid in that role.
- The mapping from each constitution principle to where it is enforced.

The written use-case records that accompany diagram 7 — actor, preconditions,
postconditions, main and alternate flows, published events and errors — are
**already written** in [`../domain/use-cases.md`](../domain/use-cases.md). The
six flows recorded there are the source for diagrams 6 and 7; do not restate
them here, and do not let a diagram contradict them.

## Transversal rules

Every diagram here must satisfy the five rules the assignment applies to all
diagrams (§4.2): consistent with each other, reflecting mandatory asynchronous
communication, preserving separation of responsibilities, correctly labelled
with **technology, protocol and communication type**, and legible.

The eight principles in `.specify/memory/constitution.md` are already binding
and do not wait for this directory. What is missing is the written reasoning,
not the rules.

> **Current status**: The eight diagram source sets are present. The CDU source
> set is organized by level and microservice under `diagrams/cdu/`. PNG exports
> have been generated from the Mermaid sources for the 18 activity flows under
> `diagrams/cdu/*/flujos/`. PlantUML exports remain subject to the delivery
> rule above wherever a rendered PlantUML artefact is required.
>
> **Diagram 1 (T-07) is complete**: `01-arquitectura-general.mmd`,
> `01-arquitectura-general.puml` and the PlantUML export
> `01-arquitectura-general.png` are versioned, both sources render without
> errors, and they were checked to agree node by node and edge by edge. No
> Lucid document was produced for it, which ADR-013 permits. Its topology —
> the kind cluster boundary, RabbitMQ and the five PostgreSQL databases
> outside it — is the reference T-15 and T-22 build against, and it matches
> diagrams 3 and 5.
>
> The ADRs are **no longer blocked**: the eleven decision records were written in
> T-03 and live in [`adr/`](adr/README.md), with the consolidated view in
> [`decision-matrix.md`](decision-matrix.md).
