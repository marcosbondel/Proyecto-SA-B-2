---

description: "Task list for T-03 — Registro de decisiones tecnológicas y arquitectónicas"
---

# Tasks: Registro de decisiones tecnológicas y arquitectónicas (T-03)

**Input**: Design documents from `/specs/004-tech-decisions-adrs/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **ninguna.** El entregable es documentación; no hay comportamiento que ejercitar. La verificación es la de [quickstart.md](quickstart.md) — comprobaciones mecánicas, revisión de tablas y aprobación humana. El único chequeo de código es que `pnpm lint` y `pnpm test` sigan pasando **sin cambios**, porque este ticket no toca `apps/`.

**Organization**: las tareas se agrupan por historia de usuario. Cada historia entrega un bloque verificable por sí solo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: a qué historia del spec pertenece (US1…US4)
- Todas las rutas son relativas a la raíz del repositorio

## Path Conventions

Entregable en `docs/architecture/adr/` y `docs/architecture/decision-matrix.md`. Documentos
existentes editados en la raíz y en `docs/`. **`apps/` es intocable** — ningún archivo bajo
`apps/` aparece en ninguna tarea.

Todos los documentos entregados van **en inglés** (R1). Este tablero y los artefactos bajo
`specs/` siguen en español.

## Dos reglas que aplican a cada tarea de redacción

1. **Cada ADR sigue [`contracts/adr-template.md`](contracts/adr-template.md)** — las seis reglas
   C-1 a C-6 y la lista de afirmaciones prohibidas. Un ADR sin alternativa descartada, o con un
   descarte que no invoca uno de los cuatro criterios de R4, está incompleto aunque esté escrito.
2. **Nadie decide nada nuevo aquí.** Las once decisiones ya están tomadas; estas tareas escriben
   el razonamiento. Si al redactar una aparece una duda real de fondo, se detiene y se lleva al
   equipo — no se resuelve inventando una justificación.

---

## Phase 1: Setup

**Purpose**: crear el destino y capturar la evidencia previa

- [X] T001 Create the `docs/architecture/adr/` directory at the repository root
- [X] T002 [P] Capture baseline evidence: run `pnpm install && pnpm build && pnpm lint && pnpm test` from the repository root and save the output to attach to issue #10, proving the state before the change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: el formato y el índice que los once ADRs comparten

**⚠️ CRITICAL**: ninguna historia puede empezar antes de esto. Once ADRs escritos con
estructuras distintas son once documentos que no se pueden auditar en bloque, y rehacer el
formato después obliga a reeditar los once.

- [X] T003 Create `docs/architecture/adr/README.md` with: a short "Format" section stating the mandatory ADR sections from [contracts/adr-template.md](contracts/adr-template.md) (Status, Date, Deciders, Assignment reference, Context, Decision, Alternatives considered, Consequences); the index table with the eleven rows of [data-model.md](data-model.md) §1 (id, title, status `Proposed`, date, link); the governance note required by FR-011 — these decisions are design constraints for every later spec, and changing an approved one requires a new ADR that marks the previous as `Superseded`; and the status vocabulary `Proposed → Accepted → Superseded` with its legal transitions. Leave the approval register as an explicitly marked stub to be filled in T030

**Checkpoint**: formato fijado — las historias pueden empezar

---

## Phase 3: User Story 1 - Cada decisión vigente queda registrada como ADR (Priority: P1) 🎯 MVP

**Goal**: diez ADRs que registran las decisiones ya tomadas con sus alternativas descartadas y
razón técnica. La undécima (autenticación) es US2.

**Independent Test**: se toma la lista de decisiones vigentes del ticket y cada una tiene un ADR
con contexto, decisión, alternativas con razón técnica de descarte, y consecuencias. Verificable
con [quickstart.md](quickstart.md) §1 y §2 sin que exista ningún otro entregable.

**T004 y T005 van primero**: son los ADRs más restrictivos y el resto los presupone. Los ocho
siguientes son independientes entre sí.

- [X] T004 [US1] Write `docs/architecture/adr/ADR-001-backend-stack.md` — TypeScript + NestJS. **Must cite the three permitted languages (Java, TypeScript, Go) and the two frameworks (Spring Boot 4, NestJS)** as they appear in §4.2 "Flexibilidad de diseño" (p. 13) and the §4.3 table (p. 14), and justify why TypeScript + NestJS remains valid against them (FR-003). Rejected alternatives: Java + Spring Boot 4, and Go — note that Go appears in the language list but has **no** framework in the permitted framework list, which is itself a technical reason. Team familiarity may appear as Context, never as the rejection reason (R4)
- [X] T005 [US1] Write `docs/architecture/adr/ADR-003-communication-model.md` — events plus asynchronous request/reply, never HTTP between services. Cite §4.2 (pp. 8 and 13) and §6 step 3 (p. 17, "justificar la elección en términos de desacoplamiento y resiliencia"). Rejected: synchronous HTTP between services (penalised 50 %, §8.3 p. 27) and a hybrid model with occasional HTTP. Consequences must state that the envelope carries `correlationId`, `causationId` and `idempotencyKey`, and that the exact payload shape is **T-05**
- [X] T006 [P] [US1] Write `docs/architecture/adr/ADR-002-frontend-stack.md` — Vue + Nuxt 4. **Must declare verbatim "Not constrained by the assignment; team decision"** (R5, C-2): the assignment fixes no frontend. Rejected: React/Next and Angular, with a technical reason each
- [X] T007 [P] [US1] Write `docs/architecture/adr/ADR-004-message-broker.md` — RabbitMQ. **Must cite all four permitted brokers** (§4.2 p. 8; §4.3 table p. 14) and reject the other three **one by one** (R8, FR-004): Kafka (operational weight locally; the design needs queues, ack and DLQ rather than a replayable log), NATS (NATS Core does not persist by default, and a banking flow cannot drop an `account.debit.requested`), gRPC async (point-to-point transport with no broker, so no queues, retries or DLQ — leaving the Saga choreography without substrate). Record the accepted trade-off: less historical streaming and replay-from-origin capability
- [X] T008 [P] [US1] Write `docs/architecture/adr/ADR-005-persistence.md` — PostgreSQL, one database per service, outside the cluster. **Must cite the two penalties as separate rules** (R7, FR-006): shared database → 100 % (§8.3 p. 27) and a microservice connected to multiple databases → 50 % (§4.2 p. 13). Record isolation by separate credentials, databases and migrations. Rejected: a shared database, a different engine per service, and databases inside the cluster (forbidden by §4.3 p. 14)
- [X] T009 [P] [US1] Write `docs/architecture/adr/ADR-006-containerization.md` — Docker. Cite §4.3 (p. 14), where containers are listed as mandatory. Rejected: Podman and running binaries on the host, each with a technical reason
- [X] T010 [P] [US1] Write `docs/architecture/adr/ADR-007-local-orchestration.md` — kind, released through a Helm chart. Cite §4.2 (p. 8) and §4.3 (p. 14); note Helm is listed as optional supporting material (p. 16). **Must document explicitly how pods reach the databases outside the cluster** — the ticket calls this out as a required consequence. Rejected: minikube, k3d, and applying raw manifests by hand instead of a versioned release
- [X] T011 [P] [US1] Write `docs/architecture/adr/ADR-008-service-internal-architecture.md` — Clean Architecture in each service. **Must declare "Not constrained by the assignment; team decision"** (C-2). Record that the rule is executable: `pnpm lint` fails on a cross-service import, a framework import in `domain`, or an `infrastructure` import in `application` (`apps/packages/tooling/eslint.base.mjs`). Accepted trade-off: more files and more ceremony across five services. Rejected: NestJS default MVC layering and a flat structure
- [X] T012 [P] [US1] Write `docs/architecture/adr/ADR-009-distributed-transactions.md` — Saga by choreography. Cite the expected patterns (p. 7, `Saga (obligatorio)`, `Choreography (recomendada)`) and §6 step 6 (p. 17). Reference the seven-step transfer flow already written in `docs/domain/use-cases.md` **without restating it**. Rejected: orchestration (a coordinator becomes a hidden god-object, penalised on p. 7) and a distributed transaction / 2PC (impossible across separate databases with no shared transaction manager, and forbidden by constitution VI)
- [X] T013 [P] [US1] Write `docs/architecture/adr/ADR-011-diagramming-toolchain.md` — Lucid as the collaborative tool plus Mermaid as the versioned source, two artefacts per diagram that must agree. **Must reject PlantUML explicitly with the reason from R9**: a third format is a third copy that can contradict the other two, in a project where diagram inconsistency costs 25 % (§8.3 p. 27). Record that Mermaid natively covers seven of the eight diagrams and that use cases are the exception, where the Lucid artefact is authoritative. Declare "Not constrained by the assignment; team decision"
- [X] T014 [US1] Audit the ten ADRs against [contracts/adr-template.md](contracts/adr-template.md): rules C-1 to C-6, the forbidden-claims table, and the per-ADR extra requirements. Run [quickstart.md](quickstart.md) §1 and §2. Fix any ADR whose `Rejected because` states a preference rather than one of the four R4 criteria — this is the check that decides the 10 points of rubric criterion 1.3

**Checkpoint**: diez decisiones registradas y auditadas. US1 es entregable por sí sola

---

## Phase 4: User Story 2 - El mecanismo de autenticación JWT queda decidido y registrado (Priority: P1)

**Goal**: el ADR de autenticación, la única decisión que no existía en ningún documento antes de
este ticket.

**Independent Test**: el ADR responde en una lectura librería, algoritmo, expiración, punto de
emisión y punto de validación, con alternativas descartadas. Verificable con
[quickstart.md](quickstart.md) §3.

**Depende de T005** (ADR-003): la consecuencia central de este ADR —la identidad viaja en el
sobre— solo se enuncia bien una vez escrito el modelo de comunicación.

- [X] T015 [US2] Write `docs/architecture/adr/ADR-010-authentication.md` — cite §4.1 (p. 5, "Para autenticar y validar al usuario debe de hacer uso de JWT"). Record the five answers approved by the team on 2026-08-14: library from the NestJS ecosystem (`@nestjs/jwt`, with `passport-jwt` required **only** in the Gateway); **HS256**; **1 hour, no refresh token** with the reasoning from R11; **issued by the Gateway** from the claims Customer Service returns via `customer.authenticate`; **validated only by the Gateway**, with verified identity (`customerId`, `role`) travelling in the message envelope. Open the ADR by distinguishing the **session JWT** decided here from the **email activation token** already decided in T-02 (Customer Service signs and validates it, 24 h, single-use) and state that this ADR does not redefine it (FR-005b, R12)
- [X] T016 [US2] Complete `docs/architecture/adr/ADR-010-authentication.md` with the rejected alternatives and consequences: reject Customer Service as issuer (contradicts `docs/domain/message-catalog.md`, "replies with claims, not a token"), RS256 (its value — that a validator cannot sign — does not materialise when signing and validation live in the same component), per-service validation (replicates the verification config and the secret across five services), and stateful sessions (the Gateway has no database). Record the three consequences of FR-005a — the envelope needs a verified-identity field whose shape **T-05** defines; the trust model assumes nothing publishes to the broker without passing through the Gateway; the signing secret is a Kubernetes Secret and is never committed — plus the explicit statement that revocation before expiry is **out of scope** (FR-005), and a verdict against constitution principles **IV** and **V**

**Checkpoint**: las once decisiones están registradas

---

## Phase 5: User Story 3 - La definición inicial de SLI, SLO y SLA queda aprobada (Priority: P2)

**Goal**: las métricas SRE definidas antes de implementar, para que cada servicio instrumente
desde el inicio lo que hará falta medir.

**Independent Test**: cada SLI tiene indicador, fórmula y fuente; cada SLO tiene umbral numérico;
el SLA declara su alcance académico. Verificable con [quickstart.md](quickstart.md) §4.

**Independiente de US1 y US2** salvo por nombrar componentes: puede ejecutarse en paralelo desde
que termine la Fase 2.

- [X] T017 [US3] Replace the `Blocked` block in the "SLI, SLO, And SLA" section of `docs/RELIABILITY.md` with the normative text of [data-model.md](data-model.md) §3.1 and §3.2: the **six SLI** with indicator, formula and data source, and the **five SLO** with numeric thresholds (≥ 99 %, ≥ 95 %, and three at 100 %). Include the definition of "technical error" for SLI-1 — a business rejection such as insufficient funds is a correct response and does not count as unavailability — and of "local stable" for SLO-2 (FR-007)
- [X] T018 [US3] Append to `docs/RELIABILITY.md` the SLA with its academic scope ([data-model.md](data-model.md) §3.3) — observable only during the demonstration, with no service window, penalty or continuous measurement — and the instrumentation obligations of §3.4 that every service must implement from the start: envelope timestamps, structured logs with `correlationId`, retry counting, and DLQ visibility per queue. State that **T-24 measures these definitions; it does not create them**
- [X] T019 [P] [US3] Update the Reliability row of `docs/QUALITY_SCORE.md` so it no longer waits on T-03. It still waits on **T-24** for real measurements, which is a different thing from the definition

**Checkpoint**: la definición SRE está escrita y ningún marcador la sigue bloqueando

---

## Phase 6: User Story 4 - La matriz y ARCHITECTURE.md quedan consistentes con el registro (Priority: P2)

**Goal**: la vista única de decisiones → alternativas → trade-offs → consecuencias, y el resto
del repositorio alineado con el registro.

**Independent Test**: cada ADR aparece en la matriz y en `ARCHITECTURE.md`, cada trade-off del
ticket está documentado, y ninguna afirmación contradice la constitución ni `docs/domain/`.
Verificable con [quickstart.md](quickstart.md) §5 y §6.

**Depende de US1 y US2**: la matriz indexa los once ADRs y no puede escribirse antes que ellos.

- [X] T020 [US4] Create `docs/architecture/decision-matrix.md` with one row per decision and the seven columns of [data-model.md](data-model.md) §2 (Decision, ADR link, Chosen, Rejected alternatives, Accepted trade-off, Operational consequence, Assignment rule it satisfies). Include the **six trade-offs** the ticket requires verbatim and the **two penalties as separate rules** with their percentage and section. **Index, do not repeat** — the full argument stays in the ADR (R6)
- [X] T021 [US4] Edit `ARCHITECTURE.md` to link every current ADR from the matching section: "Stack" cites ADR-001, ADR-002, ADR-004, ADR-005, ADR-006, ADR-007, ADR-008 and ADR-009; "Dependency Rules" cites ADR-003 and ADR-010; "Related Docs" adds the ADR index and the decision matrix (FR-008)
- [X] T022 [US4] Edit the "Current State" section of `ARCHITECTURE.md` so it stops claiming the Gateway and backend services are future work and that `apps/web/` is the Nuxt starter (FR-008a). Describe the verified scaffolding: `apps/gateway`, the five services under `apps/services/`, `apps/web`, and `apps/packages/{contracts,messaging,tooling}` — health checks, environment validation and the shared message envelope, with `domain/` and `application/` intentionally empty. Keep as future work what genuinely is: local infrastructure (T-06), the Helm chart and the kind deployment (T-21, T-22), and all domain logic
- [X] T023 [US4] Record the definitive development, test and deployment commands in `ARCHITECTURE.md` (or link them from the section that carries them), consolidating what `AGENTS.md` and `README.md` already document plus the workspace rules: run from the repository root, `pnpm build` precedes testing a single app in a fresh clone, and `pnpm lint` enforces the architecture boundaries (FR-008). T-03 consolidates these; it does not invent new ones
- [X] T024 [P] [US4] Edit `docs/architecture/README.md`: link the `adr/` subdirectory, align the tooling wording with ADR-011, and **narrow the closing `Blocked` marker** so it no longer claims the technology decisions live unformalised in a Notion ticket — the ADRs are done; only the eight diagrams still wait on T-07 … T-14
- [X] T025 [P] [US4] Edit the "Access Model" section of `docs/SECURITY.md`: the authentication model is now decided — link ADR-010 — and narrow the `Blocked` marker to what remains open, per-endpoint authorization rules (**T-15**, the Gateway contract) and the cross-service access policy plus secret loading (**T-06**). Do not declare resolved what ADR-010 left out of scope (token revocation)
- [X] T026 [P] [US4] Add an entry to the documentation index in `AGENTS.md` pointing at `docs/architecture/adr/README.md`, worded like its neighbours: read it before introducing or changing a technology, or before writing a spec that depends on the stack
- [X] T027 [P] [US4] Add a row to `docs/design-docs/index.md` pointing at the ADR index with status `Active`. Do **not** list the eleven ADRs individually — their index is `docs/architecture/adr/README.md`, and duplicating the table would let the two diverge
- [X] T028 [P] [US4] Add `project` rows to `docs/DOC_INVENTORY.md` for the thirteen new documents (owner Marcos Bonifasi, reviewed 2026-08-15). Change `docs/RELIABILITY.md` from `blocked` to `current`; keep `docs/SECURITY.md` as `blocked` with its reason updated to T-06 and T-15
- [X] T029 [US4] Cross-review every delivered document against `.specify/memory/constitution.md` (the eight principles), `docs/domain/` (T-02) and `ARCHITECTURE.md`, and record the result as evidence on issue #10 (FR-010, SC-005). Verify in particular that ADR-010 does not contradict `docs/domain/message-catalog.md` ("replies with claims, not a token") or `docs/domain/use-cases.md`, and run the six section+page checks of [quickstart.md](quickstart.md) §5 for the corrected citations

**Checkpoint**: el registro está completo, indexado y sin contradicciones

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: aprobación, evidencia y la prueba de que no se tocó código

- [ ] T030 Fill the approval register in `docs/architecture/adr/README.md` and flip the eleven ADRs from `Proposed` to `Accepted` once the `feature/T-03` pull request is approved by the team (FR-009). **This is the only task that cannot be completed by writing** — it needs the team's review
- [X] T031 [P] Verify no code was touched: `git diff --stat -- apps/` must be empty, and `pnpm lint && pnpm test` must pass exactly as in the T002 baseline (D-1, D-2)
- [X] T032 [P] Check every link into `docs/architecture/adr/` resolves, using the loop in [quickstart.md](quickstart.md) §6, and confirm the eleven ADRs each appear in the index, the matrix and `ARCHITECTURE.md` (A-5, SC-006)
- [X] T033 [P] Confirm the thirteen new documents are in English (R1, FR-020 of T-01) and that no `Blocked` marker anywhere still names T-03 as pending (D-3, D-5)
- [X] T034 Run the full [quickstart.md](quickstart.md) end to end and attach the output to issue #10 as the ticket's evidence: reviewed ADRs, decision matrix, and the consistency review against T-02 and T-05

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias
- **Foundational (Phase 2)**: depende de Setup — **BLOQUEA todas las historias**
- **US1 (Phase 3)**: depende de Fase 2
- **US2 (Phase 4)**: depende de Fase 2 y de **T005** (ADR-003)
- **US3 (Phase 5)**: depende solo de Fase 2 — puede correr en paralelo con US1 y US2
- **US4 (Phase 6)**: depende de **US1 y US2 completas** (la matriz los indexa)
- **Polish (Phase 7)**: depende de todo lo anterior; T030 depende además de la revisión humana del PR

### User Story Dependencies

- **US1 (P1)**: independiente. Es el MVP
- **US2 (P1)**: solo depende de T005 dentro de US1; por lo demás es independiente
- **US3 (P2)**: **totalmente independiente**. Es la historia que más pronto puede empezar en paralelo
- **US4 (P2)**: depende de US1 + US2. No puede adelantarse

### Within Each Story

- En US1, **T004 y T005 van primero** y son secuenciales entre sí en importancia, no en archivo; T006 a T013 son paralelos; T014 audita y va al final
- En US2, T015 antes que T016: **mismo archivo**
- En US3, T017 antes que T018: **mismo archivo** (`docs/RELIABILITY.md`)
- En US4, T021 → T022 → T023 son secuenciales: **mismo archivo** (`ARCHITECTURE.md`). T024 a T028 son paralelos entre sí. T029 va al final

### Parallel Opportunities

- T002 en paralelo con T001
- **Ocho ADRs a la vez**: T006 a T013, archivos distintos y sin dependencias entre sí
- **US3 completa en paralelo con US1 y US2**: toca `docs/RELIABILITY.md` y `docs/QUALITY_SCORE.md`, que ninguna otra historia toca
- Cinco ediciones de índice a la vez: T024 a T028
- T031 a T033 en paralelo

---

## Parallel Example: User Story 1

```bash
# Después de T004 y T005, lanzar los ocho ADRs restantes a la vez:
Task: "Write docs/architecture/adr/ADR-002-frontend-stack.md"
Task: "Write docs/architecture/adr/ADR-004-message-broker.md"
Task: "Write docs/architecture/adr/ADR-005-persistence.md"
Task: "Write docs/architecture/adr/ADR-006-containerization.md"
Task: "Write docs/architecture/adr/ADR-007-local-orchestration.md"
Task: "Write docs/architecture/adr/ADR-008-service-internal-architecture.md"
Task: "Write docs/architecture/adr/ADR-009-distributed-transactions.md"
Task: "Write docs/architecture/adr/ADR-011-diagramming-toolchain.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Fase 1: Setup
2. Fase 2: Foundational — **crítica, bloquea todo**
3. Fase 3: US1 — diez ADRs
4. **PARAR y VALIDAR**: [quickstart.md](quickstart.md) §1 y §2

En ese punto ya existe un registro de decisiones auditable y el criterio 1.3 de la rúbrica es
defendible, aunque falten la autenticación, las métricas y la matriz.

### Incremental Delivery

1. Setup + Foundational → formato listo
2. US1 → diez ADRs → **MVP**
3. US2 → la undécima decisión, la única que no existía antes
4. US3 → SLI/SLO/SLA (puede haber ido en paralelo desde el paso 1)
5. US4 → matriz, enlaces y consistencia
6. Polish → aprobación y evidencia

### Parallel Team Strategy

Con dos personas: una toma US1 y US2 (los once ADRs, que comparten formato y criterio de
descarte), la otra toma US3 completa desde el principio. US4 la hace quien termine primero, y
requiere que ambos lados estén listos.

---

## Ejecutado el 2026-08-15 — desviaciones respecto al plan

Tres cosas aparecieron durante la implementación y se resolvieron; se registran aquí porque
cambian el alcance que el plan había fijado.

1. **Corrección de numeración de tickets.** El plan y las tareas citaban **T-13** para la
   autorización por endpoint y **T-16** para el chart de Helm. Ambos estaban mal:
   `docs/METHODOLOGY.md` documenta la renumeración del 2026-08-14 y fija T-07…T-14 = los ocho
   diagramas, **T-15 = contrato del Gateway** (donde vive la autorización), T-16…T-20 = los
   cinco servicios, **T-21 = imágenes Docker**, **T-22 = despliegue en kind con Helm**,
   T-23 = integración, T-24 = SRE. Se corrigieron `plan.md`, `tasks.md` y ambos contratos antes
   de escribir ningún ADR, para no propagar el error a los once.
   **Pendiente para T-02**: `docs/domain/actors.md` sigue diciendo que la autorización por
   endpoint es T-13. Es un puntero obsoleto en un documento que este ticket no posee.
2. **Dos archivos editados fuera de la lista del plan**, ambos porque bloqueaban un criterio de
   este ticket:
   - `docs/operations/README.md` — tenía un marcador `Blocked` que nombraba a T-03 para los
     SLI/SLO/SLA. Dejarlo habría violado D-5. Ahora apunta a `docs/RELIABILITY.md` y su bloqueo
     se acota a runbooks (T-06, T-05, T-23).
   - `docs/TECH_DEBT.md` — **TD-009 se cierra**. Esa deuda decía literalmente "Set one
     convention and update the index in the architecture decision ticket", y este *es* ese
     ticket. La convención queda fijada: los ADRs en `docs/architecture/adr/`, `design-docs/`
     para registros de diseño que no son ADRs.
3. **Recuento final**: 13 documentos nuevos y **10 editados** (los 8 del plan más los dos de
   arriba). Cero archivos bajo `apps/`, confirmado con `git diff --stat -- apps/` vacío.

**T030 sigue abierta a propósito.** Es la única tarea que no se puede completar escribiendo: los
once ADRs están en `Proposed` y pasan a `Accepted` cuando el equipo apruebe el PR.

## Notes

- **34 tareas, 0 archivos bajo `apps/`.** Si una tarea te lleva a editar código, la tarea está
  mal entendida
- Ninguna tarea inventa una decisión: las once ya están tomadas. Lo que se escribe es el
  razonamiento y las alternativas descartadas
- **T030 no se puede completar escribiendo**: necesita la aprobación del equipo en el PR. Es el
  único criterio que ninguna comprobación mecánica sustituye
- Commit por tarea o por grupo lógico; los ocho ADRs paralelos son ocho commits naturales
- Cuidado con las citas del enunciado: seis de las heredadas estaban desplazadas y ya se
  corrigieron (R5). Copiar una cita vieja de un documento anterior reintroduce el error
