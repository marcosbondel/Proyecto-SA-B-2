# Methodology

## Cadence

The team works in weekly sprints aligned with the Bank USAC milestones. The
[GitHub Projects board Bonking](https://github.com/users/marcosbondel/projects/4) is the operational source of truth for ticket ownership,
delivery dates, and status. The repository is the source of truth for durable
decisions and implementation evidence.

## Milestones

| Milestone | Date | Tickets | Objective |
| --- | --- | --- | --- |
| H1 - Complete design | 2026-08-18 | T-01 to T-05 | Domain, decisions, contracts, architecture, and the documented repository baseline are complete. |
| H2 - Local foundation and shell | 2026-08-20 | T-06, T-07 to T-14, T-15 | Local infrastructure, the eight diagrams, Gateway contract, and frontend shell are available. |
| H3 - Services and frontends | 2026-08-26 | T-16 to T-20 | All five services and their assigned frontend surfaces are implemented. |
| H4 - Containers and Kubernetes | 2026-08-30 | T-21, T-22 | Docker images and the local kind deployment are validated. |
| H5 - Integration and resilience | 2026-08-31 | T-23 | Saga integration, failure handling, and resilience tests are complete. |
| H6 - Final evidence and SRE | 2026-09-02 | T-24, T-25 | SRE measurements, final documentation, and traceability evidence are complete. |

The project has a delivery buffer through 2026-09-03.

### Renumbering, 2026-08-14

The original T-07 bundled all mandatory diagrams into one ticket. It was split
into **one ticket per diagram** (T-07 to T-14) so each has its own owner,
acceptance criteria and delivery format; the two sequence diagrams are separate
tickets because the transfer one models the entire Saga.

Everything after shifted: the Gateway moved to **T-15** — ahead of the services,
which is its real execution order, since they build their frontends against it —
the five services became **T-16 to T-20**, and the rest ran through **T-25**.

The old frontend ticket T-14 had already been absorbed into the per-service
frontend work and is retired; its number now belongs to the use-case diagram.

## Source Of Truth

[GitHub Projects Bonking](https://github.com/users/marcosbondel/projects/4) tracks
tickets, owners and their current status fields. The associated GitHub issue
holds acceptance criteria; no status is inferred merely from a local document.
A confirmed change in the board is the authoritative workflow transition. Repository documents record the
decisions and evidence that make the status meaningful.

## Definition Of Done

A ticket is done only when every acceptance criterion is verified and the
evidence is linked in that ticket. A passing command without linked evidence is
not sufficient. The evidence may be command output, a repository path, a
review response, or a linked design decision, depending on the criterion.

For any ticket that creates or changes frontend UI, the evidence MUST also show
that the implementation was compared with the Claude Design reference in
`docs/DESIGN.md`. The evidence names the inspected source file, covers the
relevant responsive and interaction states, and records intentional deviations.

## Evidence Of Distribution

Each member commits work in the service or module they own. The commit history,
ownership table, and ticket assignments together provide the distribution
evidence required by the project rubric. Shared contracts, integration, tests,
and final review may appear in any member's commit, but the component owner
remains accountable for coordination.

## Blockers

Any blocker is reported in the affected GitHub issue on the same day it is
discovered. The report names the missing decision or dependency, its impact,
the owner who can resolve it, and the next check. Blockers are not deferred to
the end of the sprint.

## Fase III: código y documentación

[T-60 / #167](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/167)
concentra código/despliegue y
[T-61 / #168](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/168)
su documentación. El [plan y matriz T-61](qa/T-61-documentation-audit.md)
registran alcance, evidencia, validaciones y bloqueos. No cerrar un criterio
cloud con una ejecución kind ni declarar todas las pruebas verdes si hay
umbrales fallidos, suites omitidas o dependencias ausentes. Los experimentos
autorizados se limitan a dev y restauran la simulación; prod se consulta en
modo lectura. Las fechas de H1–H6 anteriores describen Fase I, no un calendario
vigente de entrega Fase III.
