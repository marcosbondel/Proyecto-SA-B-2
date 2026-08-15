---

description: "Task list for T-02 — Dominio y límites de los cinco servicios"
---

# Tasks: Dominio y límites de los cinco servicios (T-02)

**Input**: Design documents from `/specs/003-domain-service-boundaries/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **ninguna.** El entregable es documentación; no hay comportamiento que ejercitar. La verificación es la de [quickstart.md](quickstart.md) — comprobaciones mecánicas, revisión de tablas y aprobación humana (R13). El único chequeo de código es que `pnpm lint` y `pnpm test` sigan pasando **sin cambios**, porque FR-057 prohíbe tocar código.

**Organization**: las tareas se agrupan por historia de usuario. Cada historia entrega un documento completo de `docs/domain/` y es verificable por sí sola.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: a qué historia del spec pertenece (US1…US5)
- Todas las rutas son relativas a la raíz del repositorio

## Path Conventions

Entregable en `docs/domain/`. Documentos existentes editados en la raíz y en `docs/`.
**`apps/` es intocable** — ningún archivo bajo `apps/` aparece en ninguna tarea.

## Orden de las fases frente al orden de prioridad

Las historias se ejecutan **US1 → US2 → US4 → US3 → US5**, no en orden numérico. US4 (actores) va
antes que US3 (flujos) porque un flujo no se puede escribir sin saber quién lo dispara. La
prioridad del spec no cambia: US3 y US4 son ambas P2, y su orden relativo lo fija la dependencia
real, no la preferencia.

Todos los documentos van en **inglés**, con los literales del enunciado en español (R2).

---

## Phase 1: Setup

**Purpose**: crear el destino y capturar la evidencia previa

- [X] T001 Create the `docs/domain/` directory at the repository root
- [X] T002 [P] Capture baseline evidence: run `pnpm lint && pnpm test` from the repository root and save the output to attach to issue #9, proving the state before the change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: el vocabulario y las decisiones que los cinco documentos restantes presuponen

**⚠️ CRITICAL**: ninguna historia puede empezar antes de esto. Si el glosario cambia después,
cambian los seis documentos.

- [X] T003 Create `docs/domain/README.md` with: what this model is and is not (functional contract, not class design); the ubiquitous-language glossary with Spanish ↔ English equivalences from [data-model.md](data-model.md) §6; team decisions D-01 to D-06 each with its discarded alternative, sourced from spec §"Decisiones del equipo" and [research.md](research.md); and the change rule of FR-056. Leave the index section and the approval register as explicitly marked stubs to be filled in T024 and T025

**Checkpoint**: vocabulario fijado — las historias pueden empezar

---

## Phase 3: User Story 1 - Saber qué servicio puede modificar cada dato (Priority: P1) 🎯 MVP

**Goal**: la frontera escrita. Quien implemente cualquier servicio sabe qué datos posee, cuáles
recibe por mensajería y cuáles no puede tocar nunca.

**Independent Test**: se toma cualquier atributo del modelo —`balance`, `documento`, `status` de
una transferencia, la credencial— y el documento responde en una lectura quién lo escribe, quién
lo lee y por qué medio.

**Why first**: es lo que desbloquea T-03, T-05, T-06 y los cinco servicios, y es la restricción
que el enunciado penaliza con el 50 % de la nota. Si la frontera cambia después, arrastra a los
otros cinco documentos.

### Implementation for User Story 1

- [X] T004 [US1] Write the five bounded contexts with their single responsibility, plus the API Gateway recorded with no business entities, no database and no domain decisions, in `docs/domain/bounded-contexts.md` (FR-001, FR-006)
- [X] T005 [US1] Write the attribute-level data ownership matrix for the five services in `docs/domain/bounded-contexts.md`, transcribing [data-model.md](data-model.md) §1 — one owner per attribute, consumers, and the transport (event or async request/reply). Include the note that Transaction Service never reads `balance` (FR-002, FR-003)
- [X] T006 [US1] Write the ownership-versus-reference section in `docs/domain/bounded-contexts.md`: holding another service's identifier as an opaque reference does not confer ownership over the referenced entity or its attributes (FR-004)
- [X] T007 [US1] Write the "data that cannot cross service boundaries" section in `docs/domain/bounded-contexts.md` from [data-model.md](data-model.md) §2, with the reason for each item, plus the single bounded exception for the customer's email in `customer.activation.requested` and the R12 rationale explaining why Notification & Audit sending the activation email does not violate its "no business logic" description (FR-005, FR-041a, FR-050)
- [X] T008 [US1] Write the no-cross-database rule and its penalty in `docs/domain/bounded-contexts.md`, citing the assignment §4.2 restrictions (FR-007, FR-024), then verify SC-002, SC-008 and SC-014 using the commands in [quickstart.md](quickstart.md)

**Checkpoint**: `docs/domain/bounded-contexts.md` completo y verificado. La frontera está fijada.

---

## Phase 4: User Story 2 - Conocer el ciclo de vida y las invariantes de cada entidad (Priority: P1)

**Goal**: el catálogo de entidades. Quien implemente un servicio sabe qué estados existen, qué
transiciones son legales y qué reglas no puede violar ni ante eventos duplicados.

**Independent Test**: cada entidad tiene identificador, conjunto cerrado de estados, transiciones
legales, e invariantes con el fallo nombrado que produce intentar violarlas.

### Implementation for User Story 2

- [X] T009 [US2] Write the `Customer` and `Account` sections in `docs/domain/entities.md` from [data-model.md](data-model.md) §3 — identifier, attributes, states, legal transitions and invariants C-1…C-7 and A-1…A-6 — including the explicit independence between `emailVerifiedAt` and `identityStatus`, the automatic deactivation rule (balance below Q50.00 **and** six months without activity), and `accountType` as classification only per D-02 (FR-009 to FR-011, FR-027 to FR-029)
- [X] T010 [US2] Write the `Transaction` and `Payment` sections in `docs/domain/entities.md` with the closed state set and the legal-transition diagram, making explicit that `FAILED` means no money ever moved and `COMPENSATED` means it moved and came back, plus invariants T-1…T-7 and P-1…P-3 (FR-012, FR-013, FR-015, FR-020 to FR-022)
- [X] T011 [US2] Write the `AuditEvent` and `Notification` sections in `docs/domain/entities.md`, recording `AuditEvent` as append-only and immutable, with invariants E-1…E-3 and N-1…N-2 (FR-014)
- [X] T012 [US2] Write the cross-cutting invariants section in `docs/domain/entities.md` from [data-model.md](data-model.md) §4 (X-1…X-7), plus the money rules: quetzales, two exact decimals, rejection without rounding, and the three distinct idempotency mechanisms of R8 (FR-016 to FR-019, FR-023, FR-026)
- [X] T013 [US2] Verify SC-003 and SC-004 using the commands in [quickstart.md](quickstart.md): six of six entities complete, and zero invariants with an unnamed failure

**Checkpoint**: `docs/domain/entities.md` completo. El modelo tiene reglas, no solo estructura.

---

## Phase 5: User Story 4 - Saber quién puede hacer qué (Priority: P2)

**Goal**: los tres actores con permisos mínimos escritos y frontera explícita de lo no permitido.

**Independent Test**: se toma cualquier caso de uso del sistema y la matriz dice qué roles pueden
ejecutarlo y cuáles no.

**Why before US3**: los flujos de US3 nombran al actor que los dispara. Escribirlos antes obligaría
a inventar los roles dos veces.

### Implementation for User Story 4

- [X] T014 [US4] Write the three actors —`ADMINISTRADOR`, `CAJERO_RECEPTOR`, `CLIENTE`— in `docs/domain/actors.md`, with decision D-01: they are `Customer` records with an elevated `role`, not a separate staff entity, plus which invariants apply only to `role = CLIENTE` and the rule that staff may exist with no `Account` (FR-042, FR-043, FR-043a, FR-043b)
- [X] T015 [US4] Write the use-case × role matrix in `docs/domain/actors.md` from [data-model.md](data-model.md) §5, covering the eleven use cases from registration through audit consultation
- [X] T016 [US4] Write the explicit boundary of what each role cannot do in `docs/domain/actors.md`, including `FORBIDDEN_ACCOUNT_ACCESS` for a client operating on someone else's account, the immutability of `AuditEvent` even for administrators, the visible mark that these permissions are a team proposal and not an assignment requirement, and the pointer to T-13 for endpoint-level authorization (FR-044, FR-045, FR-058)
- [X] T017 [US4] Verify SC-009 using the commands in [quickstart.md](quickstart.md), and confirm the note that cash deposit and withdrawal are deliberately not modelled because the assignment does not describe them

**Checkpoint**: `docs/domain/actors.md` completo. Los flujos ya tienen a quién nombrar.

---

## Phase 6: User Story 3 - Ejecutar los flujos de negocio sin acoplar servicios (Priority: P2)

**Goal**: los seis flujos con actor, entrada, resultado y fallos, más el catálogo de mensajes que
los realiza. Es lo que T-05 y T-07 consumen directamente.

**Independent Test**: cada flujo nombra actor, entrada, resultado observable, la secuencia de
servicios que reaccionan, y al menos un fallo con su compensación o su rechazo.

### Implementation for User Story 3

- [X] T018 [US3] Write the create-customer, create-account and balance-query flows in `docs/domain/use-cases.md`, each with actor, preconditions, input, observable result, message sequence and at least one expected failure — recording that account creation carries `accountType` and that Account Service never queries Customer Service's database, and that the balance query is async request/reply from the Gateway (FR-030 to FR-032, FR-038)
- [X] T019 [US3] Write the email-activation and login flows in `docs/domain/use-cases.md` per decisions D-03 and D-04: Customer Service generates, signs and validates the token while Notification & Audit delivers the email; the first login with a correct password and unverified email triggers the activation email and denies access with a reason distinguishable from invalid credentials; plus the 24-hour single-use token lifecycle of R10, where a retry invalidates the previous link (FR-034 to FR-037a, FR-041, FR-041a)
- [X] T020 [US3] Write the transfer flow and the full Saga in `docs/domain/use-cases.md` from R11: the seven choreographed steps, the two compensation paths from `payment.failed` and `account.credit.rejected`, and the distinction between closing in `FAILED` and closing in `COMPENSATED` (FR-033, FR-039)
- [X] T021 [US3] Write the end-to-end `correlationId` propagation section in `docs/domain/use-cases.md`, recording that the Gateway originates it and every message carries it, and that it is not a deduplication key (FR-040, R8)
- [X] T022 [P] [US3] Create `docs/domain/message-catalog.md` from [contracts/message-catalog.md](contracts/message-catalog.md): the command/event convention, the 13 commands each with exactly one handling service, the 22 events grouped by producing service with their consumers, the declaration that Notification & Audit publishes nothing consumed for business decisions, and the written boundary with T-05 covering payload shape, versioning and topic naming (FR-046 to FR-051)
- [X] T023 [US3] Verify SC-005, SC-006 and SC-007 using [quickstart.md](quickstart.md) and coherence checks M-1 to M-6 from [contracts/message-catalog.md](contracts/message-catalog.md): 13 of 13 commands with a single handler, 22 of 22 events with a consumer, zero orphans, and both compensation paths present

**Checkpoint**: los seis documentos de `docs/domain/` existen. El modelo está completo y falta aprobarlo.

---

## Phase 7: User Story 5 - Dejar constancia de que el equipo aprobó el modelo (Priority: P3)

**Goal**: evidencia verificable de que los tres integrantes aprobaron el modelo antes de que exista
código de dominio.

**Independent Test**: un evaluador encuentra en el issue #9 la aprobación de los tres integrantes
con fecha y referencia a la versión aprobada.

- [X] T024 [US5] Fill the index section of `docs/domain/README.md`, replacing the stub from T003 with one line per document stating when to read it, linked by relative path
- [X] T025 [US5] Add the approval register table to `docs/domain/README.md` with a row per team member —Marcos Bonifasi, Enner Mendizabal, David Barrios— and columns for date and approved version, left unsigned until T027 (FR-055)
- [X] T026 [US5] Request approval in [issue #9](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/9) with a summary of decisions D-01 to D-06 and their discarded alternatives, flagging explicitly that D-05 and D-06 introduce domain rules the assignment does not fix and that nothing is implemented on them before the signature
- [ ] T027 [US5] Record the three approvals in `docs/domain/README.md` with date and the commit that identifies the approved version, once the three comments exist in issue #9 (SC-012)

> **T027 queda diferida por decisión del coordinador (2026-08-14).** La solicitud está publicada
> en [issue #9](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/9#issuecomment-5299551281)
> y sigue abierta. Registrar aprobaciones que no ocurrieron sería inventar evidencia, así que la
> tabla de `docs/domain/README.md` queda sin firmar y marcada como diferida. El trabajo
> dependiente avanza sobre el modelo; recoger los dos comentarios que faltan cierra tanto FR-055
> como el criterio 1.1 de la rúbrica.

**Checkpoint**: el modelo está escrito y verificado. La aprobación está diferida, no perdida.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: dejar el modelo indexado y demostrar que no se tocó código

Las cinco ediciones documentales **no esperan a la firma**: pueden hacerse en cuanto los seis
documentos existan (fin de T023), en paralelo con T026 y T027, que dependen de latencia humana.

- [X] T028 [P] Update the services table in `ARCHITECTURE.md` with the attributes the revised assignment adds —`accountType`, `role`, `emailVerifiedAt`, `lastActivityAt`, `identityStatus`— and add a link to `docs/domain/`. Do not touch the eight non-negotiable constraints
- [X] T029 [P] Add `docs/domain/` to the project-documentation index in `AGENTS.md` with a one-line statement of when to read it. Do not alter the permanent link to `docs/DESIGN.md`
- [X] T030 [P] Classify the six new files with their owner in `docs/DOC_INVENTORY.md`
- [X] T031 [P] Narrow the blocked note in `docs/events/README.md` so it blocks only payload shape, versioning and topic conventions (T-05), and link `docs/domain/message-catalog.md` as the existing producer/consumer catalogue
- [X] T032 [P] Replace the promised use-case records in `docs/architecture/README.md` with a link to `docs/domain/use-cases.md`, keeping the diagrams and ADRs blocked as T-07 and T-03
- [X] T033 Verify no code was touched: `git diff --name-only main -- apps/` returns nothing, and `pnpm lint && pnpm test` pass identically to the T002 baseline
- [X] T034 Run the full [quickstart.md](quickstart.md) validation and attach the command output to issue #9, covering SC-002 to SC-010 and SC-014 mechanically and SC-001, SC-011 and SC-013 by named human review
- [X] T035 Record in `docs/TECH_DEBT.md` any finding this work detected and did not resolve, including the open items listed at the end of [research.md](research.md) — differentiated `accountType` rules, teller cash operations, and endpoint-level authorization

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias
- **Foundational (Phase 2)**: depende de Setup. **Bloquea todas las historias** — el glosario y las decisiones se usan en los seis documentos
- **US1 (Phase 3)**: depende de Foundational. Bloquea a US2 y US3: si la frontera cambia, cambian las entidades y los mensajes
- **US2 (Phase 4)**: depende de US1
- **US4 (Phase 5)**: depende de Foundational únicamente. **Puede correr en paralelo con US1 y US2**
- **US3 (Phase 6)**: depende de US2 (nombra estados) y de US4 (nombra actores)
- **US5 (Phase 7)**: depende de que los seis documentos existan
- **Polish (Phase 8)**: T028–T032 dependen del fin de T023; T033–T035 son los últimos

### Within Each User Story

Los documentos se escriben en un solo archivo por historia, así que las tareas dentro de una
historia son **secuenciales por construcción** —tocan el mismo archivo— salvo T022, que es un
archivo distinto. La verificación de cada historia va siempre al final de su fase.

### Parallel Opportunities

Menos de lo habitual, y conviene decirlo: cinco de las seis historias escriben **un archivo cada
una**, así que dentro de una historia no hay paralelismo real. Lo que sí se puede paralelizar:

- **T002** con T001
- **US4 (T014–T017)** entera, en paralelo con US1 y US2 — es la única historia sin dependencia de contenido
- **T022** (`message-catalog.md`) en paralelo con T018–T021 (`use-cases.md`), porque los nombres de los mensajes ya están fijados en `contracts/message-catalog.md`
- **T028–T032**, cinco archivos distintos, todos en paralelo
- **T026/T027** (latencia humana) en paralelo con T028–T032

### Parallel Example: reparto entre los tres integrantes

```text
# Tras completar T003 (Foundational):
Integrante A: T004 → T008   (bounded-contexts.md)  → luego T009 → T013 (entities.md)
Integrante B: T014 → T017   (actors.md)            → luego T022 (message-catalog.md)
Integrante C: T028 → T032   (los cinco documentos existentes, tras T023)

# T018–T021 (use-cases.md) los toma quien quede libre después de US2 y US4.
```

---

## Implementation Strategy

### MVP (solo US1)

1. Phase 1: Setup
2. Phase 2: Foundational — bloquea todo
3. Phase 3: US1 — `docs/domain/bounded-contexts.md`
4. **PARAR y VALIDAR**: SC-002, SC-008, SC-014

Con solo esto, el equipo ya puede empezar T-06 (una base por servicio, se sabe de quién es cada
una) y evitar la violación que penaliza con el 50 % de la nota. Es el incremento que más riesgo
retira por unidad de trabajo.

### Entrega incremental

1. Setup + Foundational → vocabulario fijado
2. + US1 → frontera fijada → **desbloquea T-06**
3. + US2 → reglas fijadas → desbloquea la implementación de cada servicio
4. + US4 → actores fijados → desbloquea T-13 y la interfaz
5. + US3 → flujos y mensajes fijados → **desbloquea T-05 y T-07**
6. + US5 → aprobado → autoriza escribir código de dominio

### Riesgo a vigilar

La aprobación (US5) depende de dos personas que no ejecutan el ticket, y D-05 y D-06 añaden reglas
de dominio que ellos no decidieron. Una objeción sobre la frontera de US1 arrastra los otros cinco
documentos. Por eso US1 va primero y la aprobación va al final sobre el conjunto: firmar
documento por documento invitaría a aprobar una frontera y descubrir después que el flujo no cabe
en ella.

---

## Notes

- `[P]` = archivo distinto, sin dependencias pendientes
- Ningún archivo bajo `apps/` aparece en ninguna tarea. T033 lo demuestra
- Sin tareas de test: no hay comportamiento que ejercitar (ver encabezado)
- Prosa en inglés, literales del enunciado en español (R2)
- Cero marcadores `TBD`/`TODO` en los entregables (D-R3 de [contracts/domain-document-contracts.md](contracts/domain-document-contracts.md))
- Cada tarea contra su contrato: [contracts/domain-document-contracts.md](contracts/domain-document-contracts.md) dice qué secciones son obligatorias y qué afirmaciones están prohibidas por documento
- Commit por tarea o por grupo lógico, atribuido según la convención del repositorio
