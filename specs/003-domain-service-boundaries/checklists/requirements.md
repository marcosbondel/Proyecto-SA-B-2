# Specification Quality Checklist: Dominio y límites de los cinco servicios (T-02)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-14
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

**Iteración 1 (2026-08-14)** — Tres marcadores [NEEDS CLARIFICATION] abiertos, todos por
decisiones que el enunciado deja explícitamente al equipo y que el ticket prohíbe inventar.
Se añadió una cuarta pregunta sobre FR-037, que estaba redactado sin marcador pero dejaba
la relación entre login y activación sin resolver.

**Iteración 2 (2026-08-14)** — Las cuatro preguntas fueron respondidas y los marcadores
eliminados. Las decisiones quedan registradas como D-01 a D-04 en la sección
"Decisiones del equipo" del spec, con su alternativa descartada:

| # | FR | Pregunta | Resolución |
| --- | --- | --- | --- |
| Q1 | FR-043 | Representación de Administrador y Cajero Receptor en el dominio de Customer Service. | D-01 — `Customer` con `role` elevado; invariantes de cuentahabiente solo para `CLIENTE`. |
| Q2 | FR-029 | Reglas diferenciadas entre `MONETARIA` y `AHORRO`. | D-02 — clasificación pura en Fase 1, sin efecto en invariantes ni flujos. |
| Q3 | FR-041 | Servicio responsable del envío del correo de activación. | D-03 — Customer Service genera y valida el token; Notification & Audit entrega el correo. |
| Q4 | FR-037 | Relación entre el primer login y la activación por correo. | D-04 — el primer login dispara el correo y niega el acceso, con motivo distinguible. |

Todos los ítems pasan. El spec queda listo para `/speckit-plan`.

Notas sobre los demás ítems:

- *No implementation details*: el documento nombra RabbitMQ y PostgreSQL solo en
  Assumptions, como contexto ya decidido en T-01, y declara explícitamente que el modelo
  no depende de ellos. Los nombres de entidades y atributos (`customerId`, `accountType`)
  son vocabulario de dominio tomado del enunciado, no estructuras de código; FR-057 y la
  nota del ticket prohíben prescribir clases concretas.
- *Success criteria technology-agnostic*: SC-001 a SC-014 miden propiedades del modelo
  documentado (cobertura, unicidad de propietario, trazabilidad, tiempo de comprensión),
  no comportamiento de un sistema construido, porque el entregable de T-02 es el contrato
  funcional y no software en ejecución.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
