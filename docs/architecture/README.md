# Architecture

Diagrams and architecture decision records for Bank USAC. The selected target
architecture is recorded in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md);
this directory holds the decisions behind it and the diagrams that show it.

## What belongs here

- One ADR per decision, numbered and dated, with the alternatives that were
  rejected and why.
- The seven diagrams the assignment requires, each with an editable source
  (Lucid link, Mermaid or PlantUML file), a readable export, and a short
  written explanation:

  | # | Diagram | Assignment source |
  | --- | --- | --- |
  | 1 | General architecture | §4.2 bullet "Diagramas de arquitectura"; §4.4 "Diagramas arquitectónicos" |
  | 2 | C4 L1 — Context | §4.2 mandatory diagrams |
  | 3 | C4 L2 — Containers | §4.2 mandatory diagrams |
  | 4 | C4 L3 — Components | §4.2 mandatory diagrams |
  | 5 | UML — Deployment | §4.2 mandatory diagrams |
  | 6 | UML — Sequence (create account + transfer with Saga) | §4.2, minimum two cases |
  | 7 | UML — Use cases (three actors) | §4.2 mandatory diagrams |

  The general architecture diagram is a deliverable in its own right: the
  assignment lists it separately from the C4 + UML block.
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

> **Blocked**: The ADRs and diagrams are not written; the technology decisions live in the T-03 Notion ticket and are not formalised yet. Owner: Marcos Bonifasi. Arrives with: T-03 and T-07.
