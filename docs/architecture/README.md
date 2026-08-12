# Architecture

Diagrams and architecture decision records for Bank USAC. The selected target
architecture is recorded in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md);
this directory holds the decisions behind it and the diagrams that show it.

## What belongs here

- One ADR per decision, numbered and dated, with the alternatives that were
  rejected and why.
- Component, deployment and sequence diagrams — including the transfer Saga.
- The mapping from each constitution principle to where it is enforced.

The eight principles in `.specify/memory/constitution.md` are already binding
and do not wait for this directory. What is missing is the written reasoning,
not the rules.

> **Blocked**: The ADRs and diagrams are not written; the technology decisions live in the T-03 Notion ticket and are not formalised yet. Owner: Marcos Bonifasi. Arrives with: T-03 and T-07.
