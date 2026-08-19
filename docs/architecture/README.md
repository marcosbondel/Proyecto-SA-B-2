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
- `diagrams/` — the eight required diagrams. Not written yet; see the table
  below.

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
  | 8 | UML — Use cases, three actors | T-14 | `08-uml-casos-de-uso` |

  The general architecture diagram is a deliverable in its own right: the
  assignment lists it separately from the C4 + UML block (§4.2 bullet
  "Diagramas de arquitectura"; §4.4 "Diagramas arquitectónicos").

## Delivery format — two artefacts per diagram

Every diagram ships **both**, and they must agree:

1. **LucidChart** — the editable document, plus an export committed to
   `diagrams/` as **image (PNG or SVG) and/or PDF**. Register the Lucid link
   in the table above as each diagram lands.
2. **Mermaid** — a versioned `.mmd` source in `diagrams/`, so the architecture
   is reviewable in Git and in pull requests. **Generating it with AI is
   allowed**; shipping it unreviewed is not.

This two-artefact rule is the decision recorded in
[ADR-011](adr/ADR-011-diagramming-toolchain.md), which also rejects PlantUML as a
third format: each additional copy is another thing that can drift from the
others, and the gap it would close — Mermaid's missing UML use-case diagram — is
already covered authoritatively by Lucid.

If the Lucid export and the Mermaid source disagree, the diagram is not done —
the rubric penalises documentation inconsistency by 25 % (§8.3).

Mermaid covers seven of the eight natively (`C4Context`, `C4Container`,
`C4Component`, `C4Deployment`, `sequenceDiagram`). **Use cases are the
exception**: Mermaid has no UML use-case diagram, so that one uses a
`flowchart` approximation and the LucidChart artefact is authoritative.
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

> **Blocked**: The eight diagrams are not drawn. Owner: Marcos Bonifasi. Arrives
> with: T-07 to T-14, one ticket per diagram.
>
> The ADRs are **no longer blocked**: the eleven decision records were written in
> T-03 and live in [`adr/`](adr/README.md), with the consolidated view in
> [`decision-matrix.md`](decision-matrix.md).
