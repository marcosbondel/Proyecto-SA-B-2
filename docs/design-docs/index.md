# Design Docs Index

Catalogue durable design documents here. Each entry should include status,
owner, last reviewed date, and verification notes.

| Doc | Status | Last Reviewed | Notes |
| --- | --- | --- | --- |
| [../architecture/adr/](../architecture/adr/README.md) | Active | 2026-08-15 | **Architecture decision records** — the eleven technology and architecture decisions, each with rejected alternatives and trade-offs. Indexed there, not here: duplicating the table would let the two diverge. Consolidated view in [decision-matrix.md](../architecture/decision-matrix.md). |
| [core-beliefs.md](core-beliefs.md) | Active | 2026-08-05 | Agent-first operating principles. |
| [PROMPT_MOCKUP.MD](PROMPT_MOCKUP.MD) | Draft | 2026-08-14 | Master prompt for generating the frontend prototype in Google Stitch. Feeds on `docs/DESIGN.md`; it is an input to prototyping, not a source of truth for the domain. |

## Status Values

- Draft: being shaped.
- Active: accepted and currently true.
- Superseded: replaced by a newer decision.
- Archived: retained for history only.
