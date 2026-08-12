# Implementation Plan: Base documental de Bank USAC (T-01)

**Branch**: `001-bank-usac-baseline` | **Date**: 2026-08-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-bank-usac-baseline/spec.md`

## Summary

Convertir el scaffold genérico en la base documental de Bank USAC: reescribir `README.md` y `ARCHITECTURE.md`, crear los tres registros que hoy no existen (ownership, metodología, inventario documental), adaptar los documentos de `docs/` a lo que el enunciado y las decisiones del equipo permiten afirmar, llenar la constitución del flujo de especificación con las restricciones no negociables, y retirar de la aplicación web las dependencias que ninguna decisión justifica.

El enfoque tiene tres reglas que gobiernan cada tarea: **todo contenido es rastreable** a una de cuatro fuentes (enunciado, decisión registrada, código existente, entrega explícita del responsable); **lo que no es rastreable se marca como bloqueado**, con qué falta y a quién se le pidió; y **el único código que se toca** es el manifiesto de dependencias de la aplicación web.

## Technical Context

**Language/Version**: Markdown para todos los entregables. El único cambio de código es en manifiestos de la aplicación web existente (TypeScript 6, Nuxt 4.5, Node vía pnpm).

**Primary Dependencies**: Ninguna nueva. El trabajo retira dependencias, no las agrega.

**Storage**: N/A — este trabajo no introduce persistencia.

**Testing**: No existe suite. La verificación disponible es `pnpm install` y `pnpm build` en `apps/web/`, más comprobaciones documentales ejecutables con `grep`/`find` descritas en [quickstart.md](quickstart.md). No hay script de test ni de lint (deuda TD-004, fuera de alcance).

**Target Platform**: Repositorio. Los lectores son los tres integrantes, los agentes que abren el repo con contexto vacío, y quien califica.

**Project Type**: Monorepo documental con una aplicación web existente. El backend aún no existe (T-04).

**Performance Goals**: N/A.

**Constraints**: Regla de No Invención (FR-013, FR-014); `docs/templates/` y `docs/generated/` intocables (FR-016); `docs/DESIGN.md` solo con contenido aprobado por su responsable (FR-015); documentación duradera en inglés (FR-020); el enunciado exige que la documentación esté en formato Markdown (§4.4).

**Scale/Scope**: 118 Markdown files are present after the change. The work rewrites 3 documents (`README.md`, `ARCHITECTURE.md`, `docs/DESIGN.md`), creates 3 (`OWNERSHIP`, `METHODOLOGY`, `DOC_INVENTORY`), adapts 5 (`PRODUCT_SENSE`, `FRONTEND`, `SECURITY`, `RELIABILITY`, `QUALITY_SCORE`), edits 4 project guidance files (`AGENTS.md`, `CLAUDE.md`, `AI_PROJECT_SKILLS.md`, `TECH_DEBT.md`), fills 1 constitution, adds the required root `.dockerignore`, and prunes 2 web manifests plus the lockfile.

**Ampliación del ticket (2026-08-11)**: el ticket incorporó el style guide de `docs/DESIGN.md` como entregable, con ocho áreas mínimas y dos criterios de aceptación nuevos. Absorbido en FR-026 a FR-032 y en la historia 4. The owner supplied the primary color, typography, and spacing/layout values during implementation; they are recorded in `docs/DESIGN.md`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Estado del gate (pre-Phase 0):** the constitution was a scaffold when this plan was created. This feature fills it before the implementation work proceeds.

The pre-change `.specify/memory/constitution.md` was the unfilled template. It now contains eight executable principles with source references and conformance checks.

Este feature es el que crea el gate: FR-024 y FR-025 llenan la constitución con las restricciones no negociables del enunciado, de modo que **el siguiente** `/speckit-plan` sí tenga contra qué evaluarse. Es una dependencia circular resuelta por orden temporal, no una excepción a la regla.

**Re-check (post-Phase 1):** the implemented documentation and dependency cleanup conform to all eight principles; no service, database, or deployment code was introduced.

## Project Structure

### Documentation (this feature)

```text
specs/001-bank-usac-baseline/
├── plan.md              # Este archivo
├── spec.md              # Especificación (ya existe)
├── research.md          # Fase 0: decisiones de enfoque
├── data-model.md        # Fase 1: entidades del inventario y del ownership
├── quickstart.md        # Fase 1: guía de verificación ejecutable
├── contracts/           # Fase 1: contrato de secciones por documento
│   ├── document-contracts.md
│   └── constitution-principles.md
└── tasks.md             # Fase 2 (/speckit-tasks — no lo crea este comando)
```

### Source Code (repository root)

Los archivos que este trabajo toca, y solo esos:

```text
.
├── README.md                        # REESCRIBIR — identidad, equipo, monorepo, índice
├── ARCHITECTURE.md                  # REESCRIBIR — sistema, restricciones, capas
├── AGENTS.md                        # EDITAR — nueva sección "Project Documentation"
├── CLAUDE.md                        # EDITAR — el "Repo Status" queda obsoleto
├── docs/
│   ├── OWNERSHIP.md                 # CREAR — un responsable primario por componente
│   ├── METHODOLOGY.md               # CREAR — sprints, hitos, DoD, evidencia
│   ├── DOC_INVENTORY.md             # CREAR — clasificación de los 110 .md
│   ├── PRODUCT_SENSE.md             # ADAPTAR — usuarios y flujos, desde el enunciado
│   ├── FRONTEND.md                  # ADAPTAR — verificable contra el repo
│   ├── SECURITY.md                  # ADAPTAR PARCIAL — clases de datos del enunciado
│   ├── RELIABILITY.md               # ADAPTAR PARCIAL — SRE obligatorio del enunciado
│   ├── QUALITY_SCORE.md             # EDITAR — recalificar tras el cambio
│   ├── TECH_DEBT.md                 # EDITAR — cerrar lo obsoleto, abrir lo hallado
│   ├── DESIGN.md                    # ESCRIBIR — style guide, 8 áreas, aprobado por su responsable
│   ├── templates/                   # INTOCABLE
│   └── generated/                   # INTOCABLE
├── .specify/memory/constitution.md  # LLENAR — restricciones como principios
└── apps/web/
    ├── package.json                 # PODAR — dependencias sin justificación
    └── nuxt.config.ts               # PODAR — módulos correspondientes
```

**Structure Decision**: no se introduce estructura nueva. El repositorio ya separa las dos altitudes que importan —conocimiento duradero en `docs/`, mapa de alto nivel en la raíz— y este trabajo la llena en lugar de reorganizarla. Los tres documentos nuevos van a `docs/` y no a la raíz porque la raíz debe seguir siendo un índice corto: `README.md` y `ARCHITECTURE.md` enlazan, `docs/` desarrolla. La estructura del monorepo backend (`apps/`, `services/`, `packages/`) es decisión de T-04 y no se anticipa aquí.

## Phase 0: Research

Ver [research.md](research.md). Ocho decisiones de enfoque resueltas, ninguna pendiente. Las de mayor consecuencia:

- **R1 — Dónde vive cada entregable.** Tres archivos nuevos en `docs/` en lugar de secciones dentro del README.
- **R2 — Cómo se inventaría sin podrirse.** Tabla por archivo para los ~15 documentos de proyecto, reglas por directorio para los ~95 del andamiaje, y un comando que demuestra cobertura del 100%.
- **R4 — Las restricciones reales del enunciado.** Verificadas contra el PDF: el ticket omite tres exigencias obligatorias y sus citas de página están corridas.
- **R5 — Qué dependencias se retiran exactamente**, y por qué el exportador de métricas se queda marcado como pendiente.

## Phase 1: Design & Contracts

- **[data-model.md](data-model.md)** — las cuatro entidades del spec (Documento, Componente, Restricción, Hito) con sus atributos, reglas de validación y el estado en que puede estar cada documento.
- **[contracts/document-contracts.md](contracts/document-contracts.md)** — qué secciones debe contener cada documento entregado, qué afirmaciones tiene prohibidas, y cuál es su fuente autorizada. Es el contrato que hace verificable la Regla de No Invención.
- **[contracts/constitution-principles.md](contracts/constitution-principles.md)** — los ocho principios que se escribirán en la constitución, cada uno con su cita del enunciado y con el criterio por el cual un plan futuro se declara conforme o no conforme.
- **[quickstart.md](quickstart.md)** — la guía de verificación: un comando o una comprobación concreta por cada criterio de éxito del spec.

**Orden de ejecución sugerido para `/speckit-tasks`** (dependencias reales, no preferencia):

1. **Poda de dependencias** primero y sola, con su verificación. Es el único cambio que puede romper algo; hacerlo al inicio evita que un fallo de build se mezcle con cambios documentales.
2. **Constitución** después. Es la fuente que `ARCHITECTURE.md` va a reflejar; escribirla primero evita que los dos textos diverjan.
3. **`ARCHITECTURE.md` y `docs/OWNERSHIP.md`**, que dependen de la constitución y de las decisiones del equipo.
4. **`docs/METHODOLOGY.md`**, independiente de los anteriores; puede ir en paralelo.
5. **`docs/DESIGN.md`**, the style guide. It was blocked until the owner supplied the primary palette, typography, and spacing/layout values; those decisions were supplied during implementation and are now recorded in the document.
6. **Adaptación de los `docs/*.md` restantes**, cada uno con su corte entre lo afirmable y lo bloqueado.
7. **`README.md`**, penúltimo: es el índice, y un índice se escribe cuando ya existe lo que indexa.
8. **`DOC_INVENTORY.md`, `AGENTS.md`, `CLAUDE.md`, `TECH_DEBT.md`, `QUALITY_SCORE.md`** al final: son los que registran el estado resultante, y ese estado no existe hasta que lo anterior está hecho. `AGENTS.md` carga además el enlace permanente a `docs/DESIGN.md` que exige FR-031.

## Complexity Tracking

Sin violaciones que justificar: el diseño de este feature no introduce servicios, dependencias ni estructura de aplicación nueva. The root `.dockerignore` is configuration required by the selected Docker target.

Una sola desviación respecto del ticket, ya acordada con el responsable y registrada en el spec: **T-01 deja de ser puramente documental** al incorporar la poda de dependencias (FR-021). Se acota con FR-019 —ningún otro archivo de la aplicación web se modifica— y con la verificación obligatoria de FR-023.

| Desviación | Por qué se acepta | Alternativa rechazada |
|-----------|------------|-------------------------------------|
| Tocar código en un ticket documental | `ARCHITECTURE.md` debe describir el sistema real. Documentar cinco dependencias que nadie decidió sería inventar una decisión; omitirlas dejaría el documento incompleto | Registrarlas como deuda y resolverlas en T-04: descartada por el responsable, porque arrastra hasta T-04 un `ARCHITECTURE.md` que no describe el repositorio |

## Constitution Re-Check (post-Phase 1)

Reevaluated against the eight principles in
[constitution-principles.md](contracts/constitution-principles.md): conforming.
T-01 creates no service, database, communication path, deployment manifest, or
Saga code. It preserves the metrics exporter as pending debt so the SRE
constraint remains visible, and `ARCHITECTURE.md` records the same eight
constraints as the constitution.
