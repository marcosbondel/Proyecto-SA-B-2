# Methodology

## Cadence

The team works in weekly sprints aligned with the Bank USAC milestones. The
Notion project board is the operational source of truth for ticket ownership,
delivery dates, and status. The repository is the source of truth for durable
decisions and implementation evidence.

## Milestones

| Milestone | Date | Tickets | Objective |
| --- | --- | --- | --- |
| H1 - Complete design | 2026-08-18 | T-01 to T-05 | Domain, decisions, contracts, architecture, and the documented repository baseline are complete. |
| H2 - Local foundation and shell | 2026-08-20 | T-06, T-07, T-13 | Local infrastructure, diagrams, Gateway contract, and frontend shell are available. |
| H3 - Services and frontends | 2026-08-26 | T-08 to T-12 | All five services and their assigned frontend surfaces are implemented. |
| H4 - Containers and Kubernetes | 2026-08-30 | T-15, T-16 | Docker images and the local kind deployment are validated. |
| H5 - Integration and resilience | 2026-08-31 | T-17 | Saga integration, failure handling, and resilience tests are complete. |
| H6 - Final evidence and SRE | 2026-09-02 | T-18, T-19 | SRE measurements, final documentation, and traceability evidence are complete. |

T-14 was absorbed into the per-service frontend work in T-08 through T-12 and
does not represent a separate delivery item. The project has a delivery buffer
through 2026-09-03.

## Source Of Truth

The Notion board tracks each ticket with an owner, an `Entrega` date, and one of
three statuses: `Not started`, `In progress`, or `Done`. A status change in the
board is the authoritative workflow transition. Repository documents record the
decisions and evidence that make the status meaningful.

## Definition Of Done

A ticket is done only when every acceptance criterion is verified and the
evidence is linked in that ticket. A passing command without linked evidence is
not sufficient. The evidence may be command output, a repository path, a
review response, or a linked design decision, depending on the criterion.

## Evidence Of Distribution

Each member commits work in the service or module they own. The commit history,
ownership table, and ticket assignments together provide the distribution
evidence required by the project rubric. Shared contracts, integration, tests,
and final review may appear in any member's commit, but the component owner
remains accountable for coordination.

## Blockers

Any blocker is reported in the affected Notion ticket on the same day it is
discovered. The report names the missing decision or dependency, its impact,
the owner who can resolve it, and the next check. Blockers are not deferred to
the end of the sprint.
