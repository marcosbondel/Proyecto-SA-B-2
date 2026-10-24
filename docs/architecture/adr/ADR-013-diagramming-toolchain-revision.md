# ADR-013: Require PlantUML alongside Mermaid; Lucid becomes optional

- **Status**: Superseded by [ADR-022](ADR-022-diagramming-sources-and-image-editing.md)
- **Date**: 2026-08-20
- **Deciders**: Bank USAC team
- **Supersedes**: [ADR-011](ADR-011-diagramming-toolchain.md)
- **Assignment reference**: Not constrained by the assignment; team decision. The assignment
  requires the diagrams and their properties (§4.2, page 13; §4.4, page 14; §6 step 5, page 17)
  but names no tool.

## Context

[ADR-011](ADR-011-diagramming-toolchain.md) shipped every diagram as two required artefacts — a
Lucid document and a Mermaid source — and rejected PlantUML as a third format: a third copy is a
third thing that can drift, and PlantUML's one real advantage over Mermaid, native UML use-case
support, was already covered by treating Lucid as authoritative for that single diagram.

The team has revisited that trade-off. Lucid is a proprietary, non-diffable artefact: it cannot
be reviewed in a pull request. Under ADR-011 that was tolerable for seven of the eight diagrams
because Mermaid was the diffable, authoritative source for them — but for the use-case diagram
the diffable `.mmd` was only a `flowchart` approximation, so the one artefact people could
actually review in Git was not the one that governed. PlantUML closes that gap: a text source
that renders UML use-case notation natively, lives in Git, and diffs like any other source file.

## Decision

Every diagram now ships **two required, versioned text sources that must agree**, plus one
optional visual artefact:

1. **Mermaid** (required) — a versioned `.mmd` source in `docs/architecture/diagrams/`,
   reviewable in Git and rendering natively on GitHub. Covers seven of the eight diagrams
   natively (`C4Context`, `C4Container`, `C4Component`, `C4Deployment`, `sequenceDiagram`); for
   the use-case diagram it remains a `flowchart` approximation, as under ADR-011.
2. **PlantUML** (required) — a versioned `.puml` source in the same directory, plus an export
   (PNG, SVG or PDF) committed alongside it. Covers all eight diagrams natively, including UML
   use cases (`usecase`, `<<include>>`/`<<extend>>`) and C4 notation via the `C4-PlantUML`
   library. **For the use-case diagram, PlantUML is now the authoritative artefact** — it
   replaces Lucid in that role, since it is both native UML notation and a diffable Git source.
3. **LucidChart** (optional) — the editable document, with an export committed to `diagrams/` if
   the team produces one. When present, its link is registered in the table in
   `docs/architecture/README.md`, and it must agree with the Mermaid and PlantUML sources; a
   Lucid export is never a substitute for either required source.

If the Mermaid and PlantUML sources for a diagram disagree, the diagram is **not done**. A Lucid
export that disagrees with either required source is also not done, if one is shipped.

Generating a Mermaid or PlantUML source with AI is allowed; shipping either unreviewed is not.

## Alternatives considered

### Keep Lucid required, add PlantUML as a third required artefact

Every diagram would ship three required, mutually agreeing artefacts — ADR-011's rejected
"PlantUML as a third format" option, made mandatory instead of avoided.

**Rejected because**: this is the exact three-copies-to-keep-in-sync burden ADR-011 rejected,
now applied to all eight diagrams instead of none. It also keeps a non-diffable, proprietary
artefact mandatory on a project graded partly on documentation review, when a diffable
substitute now exists for the one diagram that needed it.

### Drop Mermaid, keep PlantUML + Lucid

One required diffable source (PlantUML) instead of two.

**Rejected because**: Mermaid renders natively inline on GitHub with no external tool or render
server; PlantUML normally needs a local Java toolchain or a hosted renderer to preview. Losing
Mermaid's zero-setup, in-page rendering across all eight diagrams to save one source per diagram
is not a good trade, and the two required sources rarely diverge in effort since both describe
the same already-reviewed model.

### Leave ADR-011 unchanged

**Rejected because**: superseded by this decision — see Decision above.

## Consequences

**Easier.** The use-case diagram gets a real, diffable, authoritative source for the first time
(PlantUML), closing the asymmetry ADR-011 accepted as a trade-off. Lucid stops being a hard
blocker on any diagram ticket: a diagram can ship complete with only the two required text
sources, which lowers the bar for T-07 … T-14 when there is no time to also produce a polished
Lucid export.

**Harder.** Two required sources must still be kept in sync, exactly as under ADR-011, and
PlantUML adds a rendering dependency (a local Java toolchain, a PlantUML server, or a CI/CD
render step) that Mermaid alone did not need. A diagram that keeps an optional Lucid export now
has three artefacts that must agree instead of two.

**Obligations created.**

- **T-07 to T-14** each deliver the two required sources (`.mmd` and `.puml`, plus PlantUML's
  export) for their diagram; a Lucid document and its link in `docs/architecture/README.md` are
  optional, not blocking.
- T-14 specifically: PlantUML replaces Lucid as the authoritative artefact for UML use-case
  notation.
- Any change to the architecture updates both required sources in the same change, or the
  diagram is inconsistent by definition.
- The five transversal properties of §4.2 (p. 13) apply to every diagram, unchanged from
  ADR-011.
