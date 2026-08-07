# Technical Debt Tracker

Track debt as small, actionable items. Debt arrives here from two places: a
spec's Carried Debt section at `/spec-close`, and review findings labelled taste
rather than blocking. Cite the spec number it came from — that is what keeps the
trail intact after the spec is archived.

An item that grows past a few lines is not debt, it is a spec. Open one with
`/spec-new` and `type: debt`.

| ID | Area | Issue | Impact | Proposed Fix | From | Status |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | Documentation | Product scope is not defined yet. | Agents lack product context. | Answer the open questions in `specs/001-new-user-onboarding/spec.md`. | — | Open |
| TD-002 | Architecture | Runtime and module boundaries are not defined. | Future changes may drift, and every implementing role is blocked by design until a stack is chosen. | Update `ARCHITECTURE.md` after stack selection. | — | Open |
