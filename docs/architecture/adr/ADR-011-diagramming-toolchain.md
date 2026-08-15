# ADR-011: Ship every diagram as a Lucid document and a Mermaid source

- **Status**: Proposed
- **Date**: 2026-08-15
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: Not constrained by the assignment; team decision. The assignment
  requires the diagrams and their properties (§4.2, page 13; §4.4, page 14; §6 step 5, page 17)
  but names no tool.

## Context

The assignment demands eight diagrams — general architecture, C4 context/containers/components,
and UML deployment, two sequence diagrams and use cases — and it grades them twice: criterion
1.4 "Claridad en diagramas" (10 points, §8.2 p. 23) and "Consistencia de diagramas" in the §8.1
requirements (p. 20). It also imposes five properties on all of them (§4.2, p. 13): consistent
with each other, reflecting mandatory asynchronous communication, preserving separation of
responsibilities, correctly labelled with technology, protocol and communication type, and
legible.

The penalty that shapes this decision is §8.3 (p. 27): **"Inconsistencia entre diagramas y
código — 25 %"**. The risk is not drawing a bad diagram; it is maintaining several
representations of the same architecture that drift apart.

Two needs pull in different directions. Collaborative editing and a legible export favour a
visual tool. Review inside pull requests, where the architecture actually changes, favours a
text source that lives in Git and renders in a diff.

## Decision

Every diagram ships as **two artefacts that must agree**:

1. **Lucid** — the editable document, with an export (PNG, SVG or PDF) committed to
   `docs/architecture/diagrams/`.
2. **Mermaid** — a versioned `.mmd` source in the same directory, so the architecture is
   reviewable in Git and renders directly on GitHub.

If the Lucid export and the Mermaid source disagree, the diagram is **not done**.

Mermaid covers seven of the eight natively (`C4Context`, `C4Container`, `C4Component`,
`C4Deployment`, `sequenceDiagram`). **Use cases are the exception**: Mermaid has no UML
use-case diagram, so that one uses a `flowchart` approximation and the Lucid artefact is
authoritative.

Generating a Mermaid source with AI is allowed; shipping it unreviewed is not.

## Alternatives considered

### PlantUML as a third versioned format

Named in the T-03 ticket alongside Mermaid as a source for versionable or automated diagrams. It
has genuine strengths: real UML support including proper use-case diagrams — the one gap in
Mermaid's coverage — and C4 support through the `C4-PlantUML` library.

**Rejected because**: it would add a **third copy of every diagram**, and each copy is another
thing that can drift from the other two in a project where diagram inconsistency costs **25 %**
(§8.3, p. 27). The gap it closes is one diagram out of eight, and Lucid already covers that one
authoritatively. It also needs a rendering toolchain — a JVM or a render server — that neither
Lucid nor Mermaid requires, and PlantUML's C4 support depends on an external library rather than
being native. Paying a third format's maintenance cost across eight diagrams to improve one is a
poor trade at this scale.

This rejection is recorded rather than silently dropped, because the ticket proposed PlantUML
and a future reader deserves to know it was considered.

### Lucid only

One artefact, no duplication, and the best-looking output.

**Rejected because**: a binary or exported image cannot be reviewed in a pull request. A change
to the architecture would arrive as an opaque image swap, with no way to see what changed, and
nothing would connect the diagram to the commit that invalidated it — which is how diagrams and
code drift apart.

### Mermaid only

Everything in Git, fully diffable, no external tool at all.

**Rejected because**: Mermaid has no UML use-case diagram, so one of the eight required diagrams
would ship as an approximation with nothing authoritative behind it. Its automatic layout is
also hard to control for the larger diagrams, and "legible" is an explicit requirement (§4.2,
p. 13) and a graded criterion (1.4, §8.2 p. 23).

## Consequences

**Easier.** Architecture changes are visible in pull requests through the `.mmd` diff, so a
reviewer can see what changed without opening an external tool. Mermaid renders natively on
GitHub, so the diagrams are readable where the code is read. Lucid gives the polished,
presentable version for the demonstration and the final document.

**Harder.** Two artefacts per diagram means sixteen artefacts, and **they must be kept in
sync** — this is the accepted trade-off and the main maintenance cost of the decision. The
use-case diagram is asymmetric: its Mermaid version is an approximation, so the two artefacts
are not equivalent there and the Lucid one governs.

**Obligations created.**

- **T-07 to T-14** each deliver both artefacts for their diagram and register the Lucid link in
  the table in `docs/architecture/README.md`.
- Any change to the architecture updates both artefacts in the same change, or the diagram is
  inconsistent by definition.
- The five transversal properties of §4.2 (p. 13) apply to every diagram, including the
  labelling of technology, protocol and communication type.
