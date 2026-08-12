# Technical Debt Tracker

Debt is actionable work that is not required to complete the current ticket.
Each item names its impact, proposed resolution, source, and status. A debt
item that grows into a design or feature belongs in a new spec.

| ID | Area | Issue | Impact | Proposed Fix | From | Status |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | Documentation | The initial product scope was absent from the scaffold. | Agents lacked product context. | Resolved by the Bank USAC specification and `docs/PRODUCT_SENSE.md`. | T-01 | Closed |
| TD-002 | Architecture | The backend service directory and module layout are not implemented yet. | Future changes need concrete boundaries to validate against. | Define and implement the backend layout in T-04, keeping `ARCHITECTURE.md` synchronized. | T-01 | Open |
| TD-003 | Tooling | The repository's active Spec Kit workflow had not been reflected in the old debt record. | The workflow's traceability and constitution gate were not visible in the debt tracker. | Resolved by the versioned `.specify/` artifacts and the workflow documentation in `AGENTS.md`. | T-01 | Closed |
| TD-004 | Verification | `apps/web/package.json` defines no test and no lint script. | The repository can verify the web build, but not a test suite or lint policy. | Add a test runner and wire `@nuxt/eslint` to a `lint` script. | — | Open |
| TD-005 | Harness | Hooks that once blocked unspecced writes and mutating infrastructure commands are not present. | The boundaries are prose conventions rather than executable enforcement. | Reintroduce appropriate checks if the team decides the current Spec Kit workflow needs them. | T-01 | Open |
| TD-006 | Observability | `@artmizu/nuxt-prometheus` remains installed because SRE metrics are plausible, but no accepted decision justifies it yet. | Removing it prematurely could conflict with the observability work planned for T-18. | Confirm or remove the exporter and record the decision in T-18. | T-01 | Open |
| TD-007 | Documentation | `docs/templates/base-ticket.md` is empty. | Future ticket authors have no reusable base-ticket content. | Decide whether to populate or remove the template in a documentation-maintenance ticket. | T-01 | Open |
| TD-008 | References | `docs/references/uv-llms.txt` and `docs/references/nixpacks-llms.txt` do not match the selected project stack. | Agents may consult irrelevant runtime or deployment guidance. | Remove or relocate the files after the team confirms they are not needed. | T-01 | Open |
| TD-009 | Documentation | `docs/design-docs/` is ambiguous between design decisions and architecture decision records. | Future decisions may be filed inconsistently. | Set one convention and update the index in the architecture decision ticket. | T-01 | Open |

## Maintenance Rule

Every new debt item must have a ticket or a named follow-up owner. Closing an
item requires a link to the change or evidence that removed its impact.
