# Specification Quality Checklist: Contratos de eventos y Saga de transferencias (T-05)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Iteración 1 (2026-08-19)** — 15 de 16 ítems. Tres marcadores `[NEEDS CLARIFICATION]` abiertos deliberadamente, en los puntos donde el ticket y la documentación cerrada de T-02/T-03 admitían lecturas distintas con consecuencias distintas: alcance de los mensajes de respuesta (FR-001), lugar de la versión del mensaje (FR-005) y transporte de los bytes de la foto (FR-021).

**Iteración 2 (2026-08-19)** — 16 de 16. Las tres decisiones fueron resueltas por el equipo y quedaron incorporadas:

| # | Decisión | Dónde quedó |
| --- | --- | --- |
| Q1 | La versión viaja **en el nombre del mensaje y en el sobre**; una discrepancia entre ambos es mensaje inválido | FR-005, FR-005a, FR-005b; US1 escenario 7 |
| Q2 | Alcance **completo del ticket**: 35 mensajes de T-02 + 6 de solicitud y respuesta = **41 contratos** | FR-001a, FR-001b, SC-001 |
| Q3 | Los bytes de la foto viajan por un **almacenamiento de objetos**, nunca por el broker | FR-021a, FR-021b, FR-021c, SC-009a |

**Corrección de recuento**: al presentar la opción Q2 se dijo "43 contratos". Los mensajes nuevos son seis (dos solicitudes y cuatro respuestas), de modo que el total correcto es **41**. La especificación usa 41.

**Ambigüedades resueltas por supuesto, no por pregunta** — quedan en *Assumptions*: autoridad de T-02 sobre los nombres de los mensajes, secuencia de la Saga según `use-cases.md` (Payment reacciona a `payment.requested`, no a `account.debited`), serialización JSON UTF-8, versionado por mensaje y no por paquete, y tolerancia a campos desconocidos.

**Verificación de fuentes**: las páginas del enunciado citadas en el ticket (pp. 6, 16, 23-24) se comprobaron contra `docs/references/780_Proyecto_1_2S2026.pdf` y son **pp. 7, 17 y 25**. La especificación usa las verificadas y añade el criterio **2.8 "Manejo de fallos"** (5 o 0 puntos), que el ticket no cita y que esta feature satisface directamente.

**Trabajo generado fuera de alcance**: la decisión Q3 introduce infraestructura que ningún ADR de T-03 contempla. La especificación lo registra en *Dependencies* — nuevo ADR, provisión en T-06, diagrama en T-11 — junto con la nota de ampliación sobre `docs/domain/message-catalog.md` que exige Q2.
