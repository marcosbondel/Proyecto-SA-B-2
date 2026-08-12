---
description: "Task list for T-01 — Base documental de Bank USAC"
---

# Tasks: Base documental de Bank USAC (T-01)

**Input**: Design documents from `/specs/001-bank-usac-baseline/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: no se generan tareas de test. El repositorio no tiene suite ni script (deuda TD-004) y el spec no pide TDD. En su lugar, cada historia cierra con tareas de **verificación** tomadas de [quickstart.md](quickstart.md), que sí son ejecutables.

**Organization**: las tareas se agrupan por historia de usuario para poder entregar y verificar cada una por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1, US2, US3, US4)
- Toda tarea nombra su archivo

## Path Conventions

Monorepo documental. Rutas relativas a la raíz del repositorio. La única aplicación existente vive en `apps/web/`; no hay backend todavía (lo crea T-04).

---

## Phase 1: Setup

**Purpose**: dejar el punto de partida registrado antes de tocar nada.

- [X] T001 Crear la rama de trabajo desde `main` (`git switch -c 001-bank-usac-baseline`) para que el diff documental sea revisable como unidad
- [X] T002 [P] Capturar la evidencia **previa** a la poda ejecutando `pnpm install && pnpm build` en `apps/web/` y guardando la salida; es el punto de comparación de FR-023
- [X] T003 [P] Capturar el listado actual de Markdown con `find . -name '*.md' -not -path './.git/*' -not -path '*/node_modules/*' | sort` como insumo de `docs/DOC_INVENTORY.md` (114 archivos al 2026-08-11)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la poda de dependencias. Es el único cambio que puede romper el build, y todo lo documental describe el estado **posterior** a ella.

**⚠️ CRITICAL**: ninguna historia puede empezar hasta que T006 pase. Si el build falla, se restituye la dependencia y se reporta — no se fuerza.

- [X] T004 [P] Retirar de `apps/web/package.json` los 16 paquetes `@tiptap/*`, más `@i2d/nuxt-pdf-frame`, `@hypernym/nuxt-anime` y `@jasy/nuxt`. Conservar `nuxt`, `vue`, `vue-router`, `typescript`, `tailwindcss`, `@nuxt/ui`, `@nuxt/eslint`, `eslint` y `@artmizu/nuxt-prometheus`
- [X] T005 [P] Retirar de `apps/web/nuxt.config.ts` los módulos `@hypernym/nuxt-anime`, `@i2d/nuxt-pdf-frame` y `@jasy/nuxt`, dejando `@nuxt/eslint`, `@nuxt/ui` y `@artmizu/nuxt-prometheus`
- [X] T006 Ejecutar `pnpm install && pnpm build` en `apps/web/` y adjuntar la salida real al ticket T-01 (depende de T004 y T005)
- [X] T007 Registrar en `docs/TECH_DEBT.md` la fila de deuda para `@artmizu/nuxt-prometheus`: justificación pendiente, se resuelve en T-18. Sin esta fila, SC-010 falla aunque la poda esté hecha
- [X] T008 Verificar la poda con los comandos de [quickstart.md](quickstart.md#sc-010--las-dependencias-retiradas-ya-no-aparecen): el primer grep sin salida, el segundo con las tres apariciones esperadas

**Checkpoint**: el repositorio construye, sus dependencias son todas justificables, y el trabajo documental puede empezar.

---

## Phase 3: User Story 1 - Entender qué se construye y quién responde (Priority: P1) 🎯 MVP

**Goal**: que alguien sin contexto sepa qué es Bank USAC, con qué restricciones se construye y a quién preguntarle por cada pieza.

**Independent Test**: una persona lee solo `README.md` y `ARCHITECTURE.md` y responde correctamente cuáles son los cinco servicios, por qué no pueden hablarse de forma síncrona, dónde viven las bases y quién responde por el Payment Service.

### Implementation for User Story 1

- [X] T009 [US1] Llenar `.specify/memory/constitution.md` con los **ocho** principios de [contracts/constitution-principles.md](contracts/constitution-principles.md), versión 1.0.0 ratificada 2026-08-11, y validar que no quedan marcadores de plantilla
- [X] T010 [US1] Reescribir `ARCHITECTURE.md` completo según el contrato de [contracts/document-contracts.md](contracts/document-contracts.md): System, Services, Non-Negotiable Constraints (las **ocho**, más las conductas penalizadas de FR-002a), Stack, Layering, Dependency Rules, Current State, Related Docs. Cero texto de plantilla del scaffold (depende de T009: la constitución es la fuente que este documento refleja)
- [X] T011 [P] [US1] Crear `docs/OWNERSHIP.md` con la tabla de nueve componentes —los cinco servicios, Gateway, frontend, infraestructura/SRE y documentación— cada uno con exactamente un responsable primario, más la sección de trabajo compartido
- [X] T012 [US1] Reescribir `README.md`: identidad del proyecto (curso, sección B, grupo 2), los tres integrantes con carnet, qué construye el sistema, organización del monorepo, índice enlazado de documentación y los comandos reales de desarrollo con la ausencia declarada de test y lint. Elimina de paso la afirmación falsa de que Spec Kit no está inicializado (FR-011)

### Verification for User Story 1

- [X] T013 [P] [US1] Verificar la constitución: `grep -c '^### ' .specify/memory/constitution.md` devuelve 8 y no quedan marcadores `[PRINCIPLE_`, `[SECTION_` ni `[GOVERNANCE_`
- [X] T014 [P] [US1] Probar que la constitución es ejecutable con la propuesta inválida de [quickstart.md](quickstart.md#sc-003-y-sc-011--restricciones-registradas-y-ejecutables): "el Transaction Service lee la tabla de balances del Account Service" debe resultar **no conforme por el principio II** sin discusión
- [X] T015 [US1] Verificar que `ARCHITECTURE.md` enuncia las ocho restricciones sin contradecir la redacción de la constitución, y revisar a mano la tabla de responsables primarios de `docs/OWNERSHIP.md`: nueve componentes, ninguno con dos responsables, ninguno sin responsable

**Checkpoint**: T-02 a T-07 ya pueden arrancar. Este es el MVP del ticket.

---

## Phase 4: User Story 2 - Saber cómo trabaja el equipo (Priority: P2)

**Goal**: dejar escrita la metodología que el criterio 1.1 de la rúbrica exige evidenciar.

**Independent Test**: un evaluador lee la metodología y la verifica contra el tablero y contra el historial de commits sin que nadie se la explique.

### Implementation for User Story 2

- [X] T016 [P] [US2] Crear `docs/METHODOLOGY.md` con las seis secciones del contrato: cadencia de sprints semanales, los seis hitos H1–H6 con fecha y tickets, el tablero de Notion como fuente de verdad con sus tres estados, la definición de terminado (criterios verificados **más** evidencia enlazada), el commit por integrante como evidencia de distribución, y la regla de reportar bloqueos el mismo día

### Verification for User Story 2

- [X] T017 [US2] Verificar en `docs/METHODOLOGY.md` que cada ticket de T-01 a T-19 cae en exactamente un hito y que ninguna fecha de hito es posterior a la entrega del ticket más tardío que contiene (invariante de [data-model.md](data-model.md#hito))

**Checkpoint**: la evidencia de la rúbrica 1.1 existe y es verificable.

---

## Phase 5: User Story 4 - Construir interfaz sin inventar el diseño (Priority: P2)

**Goal**: que las decisiones visuales estén tomadas antes de que tres personas construyan cinco frontends en paralelo.

**Independent Test**: se toma el formulario de transferencia y se comprueba que cada decisión visual que lo construye ya está en `docs/DESIGN.md`.

**⚠️ Esta historia depende de una entrada externa al repositorio.** T018 no lo puede resolver un agente.

### Implementation for User Story 4

- [X] T018 [US4] **BLOQUEANTE — resuelta durante la ejecución.** Obtener de Marcos Bonifasi las tres decisiones que faltaban según [research.md R9](research.md): color primario y su carácter, familia y escala tipográfica, y unidad de espaciado con ancho de contenedor y breakpoints. The owner supplied and approved these values; they are recorded in `docs/DESIGN.md`.
- [X] T019 [US4] Escribir `docs/DESIGN.md` con las ocho secciones del contrato: Principles, Color, Typography, Spacing & Layout, Components, UI States, Accessibility, Domain Formats. The approved T018 values are explicit; any future unresolved area must use `> **Pending decision**: … Owner: … Blocks: …`, never generic filler (depends on T018)
- [X] T020 [US4] Crear en `AGENTS.md` la sección **Project Documentation** con la entrada de `docs/DESIGN.md`, la instrucción explícita de consultarlo antes de crear o modificar cualquier interfaz —páginas, componentes, estilos o textos (FR-031)— y, junto con el enlace, la nota que lo protege: no se elimina sin decisión explícita del equipo (FR-032)
- [X] T021 [US4] Replicar ese enlace en `CLAUDE.md`, ya que el archivo replica la sección de documentación del proyecto (FR-031)

### Verification for User Story 4

- [X] T022 [US4] Verificar con los comandos de [quickstart.md](quickstart.md#sc-013-y-sc-015--el-style-guide-cubre-sus-ocho-áreas-y-es-alcanzable) que las ocho áreas están presentes, que el baseline no deja pendientes sin resolver, y que el enlace existe en `AGENTS.md` y `CLAUDE.md`
- [X] T023 [US4] Correr la prueba del formulario de transferencia contra `docs/DESIGN.md`: enumerar las decisiones visuales que exige —color del botón primario, tipografía del monto, espaciado entre campos, componente de formulario, representación del estado pendiente de la Saga, formato de `Q 1,250.00`— y comprobar que las seis salen del documento

**Checkpoint**: cualquiera puede construir UI sin inventar dirección visual.

---

## Phase 6: User Story 3 - Saber a qué documento ir y cuál está vigente (Priority: P3)

**Goal**: que ningún lector —humano o agente— confunda una plantilla con documentación viva ni cite como vigente algo obsoleto.

**Independent Test**: se toma cualquier ruta `.md` del repositorio y el inventario dice su clase y su responsable.

### Implementation for User Story 3

> T024 a T027 y T032 implementan FR-033 y FR-034: adaptar los documentos heredados hasta donde llegue su fuente, y no declarar vigente nada que conserve la redacción genérica del scaffold.

- [X] T024 [P] [US3] Adaptar `docs/PRODUCT_SENSE.md`: usuario y flujos principales derivados del enunciado —registro y validación de cliente, apertura y consulta de cuenta, transferencia entre cuentas, procesamiento de pago, notificación y auditoría—. El north star y el detalle de cada flujo se marcan bloqueados y llegan con T-02
- [X] T025 [P] [US3] Adaptar `docs/FRONTEND.md` con lo verificable contra el repo: Nuxt 4.5, `@nuxt/ui` 4.10, Tailwind 4, TypeScript, organización de componentes por microservicio, comandos reales. Convenciones de estado y routing se marcan bloqueadas y llegan con T-13
- [X] T026 [P] [US3] Adaptar `docs/SECURITY.md` con las clases de datos que el enunciado nombra: identificación del cliente, documento, correo, dirección, fecha de nacimiento, balances y transacciones. Modelo de acceso y manejo de secretos se marcan bloqueados y llegan con T-03 y T-06
- [X] T027 [P] [US3] Adaptar `docs/RELIABILITY.md` con las consideraciones SRE obligatorias del enunciado —idempotencia, retries, manejo de errores, consistencia eventual, trazabilidad por `correlationId`— y la exigencia de definir SLI/SLO/SLA. La marca de bloqueo cita **T-03**, que los define; T-18 solo los mide
- [X] T028 [US3] Completar la sección **Project Documentation** de `AGENTS.md` con el resto de documentos vigentes, una línea por cada uno diciendo cuándo consultarlo, y corregir el bloque **Repo Status** que declara `ARCHITECTURE.md` como plantilla (depende de T020, mismo archivo)
- [X] T029 [US3] Actualizar el bloque **Repo Status** de `CLAUDE.md`, obsoleto en cuanto `ARCHITECTURE.md` deja de ser plantilla (depende de T021, mismo archivo)
- [X] T030 [US3] Crear `docs/DOC_INVENTORY.md` con las cuatro secciones del contrato: definición de las cinco clases, tabla por archivo de los documentos de proyecto, reglas por directorio para el andamiaje instalado, y el comando de cobertura con su salida esperada vacía. Declarar que los symlinks bajo `.claude/` y `.opencode/` apuntan a cuerpos de `.agents/` y se cubren por regla, no por fila (usa el listado de T003)
- [X] T031 [US3] Actualizar `docs/TECH_DEBT.md`: cerrar TD-001 citando este spec y TD-003 citando `.specify/`, actualizar TD-002, y dar de alta los hallazgos nuevos — `docs/templates/base-ticket.md` vacío, referencias ajenas al stack en `docs/references/`, y la ambigüedad de `docs/design-docs/` entre decisiones de diseño y ADRs
- [X] T032 [US3] Recalificar las cinco áreas de `docs/QUALITY_SCORE.md` contra el estado posterior al cambio, con la nota que justifica cada movimiento

### Verification for User Story 3

- [X] T033 [US3] Ejecutar el comando de cobertura de `docs/DOC_INVENTORY.md` y comprobar salida vacía; luego tomar tres rutas al azar del listado y verificar que el inventario da su clase y su responsable

**Checkpoint**: las tres historias están completas y el repositorio se explica solo.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T034 [P] Verificar SC-005 con el grep de placeholders de [quickstart.md](quickstart.md#sc-005-y-fr-017--sin-placeholders-sueltos): las únicas coincidencias permitidas son marcas de bloqueo con responsable y ticket
- [X] T035 [P] Verificar SC-006 con el grep de contradicciones: devuelve cero
- [X] T036 [P] Comprobar que todos los enlaces del índice de documentación del `README.md` resuelven a archivos que ya existen
- [X] T037 [P] Revisar SC-012 sobre el diff: ningún documento duradero mezcla idiomas, salvo la línea de identidad del README que nombra curso, sección y grupo
- [X] T038 [P] Verificar FR-016 y FR-019 sobre el diff completo: bajo `apps/web/` solo aparecen los dos manifiestos y el lockfile; bajo `docs/` no aparece nada de `templates/` ni de `generated/`
- [X] T039 [P] Verificar FR-034 con `grep` sobre `docs/*.md`: ningún documento de proyecto conserva la redacción genérica del scaffold
- [ ] T040 **Requiere a otra persona.** Lectura a ciegas de SC-001: alguien que no escribió el cambio lee solo `README.md` y `ARCHITECTURE.md` y responde por escrito las cuatro preguntas, en menos de diez minutos
- [ ] T041 **Requiere al equipo.** Confirmación escrita de los tres integrantes en el ticket T-01 de que conocen la metodología (SC-007)
- [ ] T042 Adjuntar toda la evidencia al ticket T-01 en Notion —salida de `pnpm build`, inventario, enlaces a los documentos, respuestas de la lectura a ciegas— y mover el estado a Done. Un criterio verificado sin evidencia enlazada no cuenta como verificado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias
- **Foundational (Fase 2)**: depende de Setup. **Bloquea todas las historias** — si el build no pasa tras la poda, nada de lo documental es cierto
- **US1 (Fase 3)**: depende de Foundational. Es el MVP
- **US2 (Fase 4)**: depende de Foundational. **Independiente de US1** — puede ir en paralelo
- **US4 (Fase 5)**: depende de Foundational y de que **T018 esté resuelta por el responsable**. Independiente de US1 y US2
- **US3 (Fase 6)**: depende de Foundational; y T028/T029 dependen de T020/T021 de US4 por escribir en los mismos archivos. El resto de US3 es independiente
- **Polish (Fase 7)**: depende de todo lo anterior

### Dentro de cada historia

- La constitución antes de `ARCHITECTURE.md`: es la fuente que el documento refleja, y escribirlas al revés las hace divergir
- El `README.md` al final de US1: es el índice, y un índice se escribe cuando existe lo que indexa
- `docs/DOC_INVENTORY.md` casi al final: registra el estado resultante, que no existe hasta que el resto está hecho

### Conflictos de archivo a vigilar

| Archivo | Tareas | Regla |
|---|---|---|
| `AGENTS.md` | T020 (US4), T028 (US3) | T020 crea la sección, T028 la completa. Nunca en paralelo |
| `CLAUDE.md` | T021 (US4), T029 (US3) | Mismo patrón |
| `docs/TECH_DEBT.md` | T007 (Fase 2), T031 (US3) | T007 agrega una fila, T031 reorganiza el resto |

### Parallel Opportunities

- T002 y T003 en paralelo
- T004 y T005 en paralelo (archivos distintos), pero T006 espera a ambas
- T011 en paralelo con T009/T010: `docs/OWNERSHIP.md` no depende de la constitución
- T013 y T014 en paralelo
- **US2 completa en paralelo con US1**: no comparten un solo archivo
- T024 a T027 en paralelo entre sí: cuatro documentos distintos
- T034 a T037 en paralelo

---

## Parallel Example: Fase 6

```bash
# Los cuatro documentos del scaffold se adaptan a la vez, son archivos distintos:
Task: "Adaptar docs/PRODUCT_SENSE.md con usuarios y flujos del enunciado"
Task: "Adaptar docs/FRONTEND.md con lo verificable contra el repo"
Task: "Adaptar docs/SECURITY.md con las clases de datos del enunciado"
Task: "Adaptar docs/RELIABILITY.md con las consideraciones SRE obligatorias"
```

---

## Implementation Strategy

### MVP primero (US1)

1. Fase 1 y Fase 2 completas: el repositorio construye y sus dependencias son justificables
2. Fase 3: constitución, `ARCHITECTURE.md`, `docs/OWNERSHIP.md`, `README.md`
3. **PARAR Y VALIDAR**: T013 a T015
4. Con esto, **T-02 a T-07 ya pueden arrancar** aunque el resto del ticket siga abierto

### Entrega incremental

1. Foundational → base cierta
2. US1 → desbloquea el diseño del proyecto (MVP)
3. US2 → cubre la rúbrica 1.1
4. US4 → desbloquea el trabajo de UI de T-08 a T-13, en cuanto llegue T018
5. US3 → cierra la navegabilidad y el estado del repositorio

### Reparto entre los tres

US1 y US2 no comparten archivos, así que pueden ir a la vez. US4 está bloqueada por una decisión del Tech Lead, no por trabajo. US3 es la única que espera, y solo por dos archivos.

---

## Notes

- Toda tarea documental está sujeta a la Regla de No Invención: si falta información, se marca la sección como bloqueada con qué falta y quién la entrega, y se sigue con el resto
- `docs/templates/` y `docs/generated/` no se tocan en ninguna tarea
- Commit por tarea o por grupo lógico; los commits son evidencia de la rúbrica, no solo higiene
- Se puede parar en cualquier checkpoint y validar la historia por separado
