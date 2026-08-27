# Specification Quality Checklist: API Gateway y shell de frontend (T-15)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-24
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

**Iteración 2 (2026-08-24) — todos los ítems pasan.** La spec está lista para
`/speckit-plan`.

### Qué cambió respecto de la iteración 1

La iteración 1 falló un solo ítem: quedaban tres `[NEEDS CLARIFICATION]`. Los
tres se elevaron al responsable porque en los tres casos el texto del ticket
**contradice** una decisión ya registrada y aprobada, y ninguna suposición
razonable los cerraba. Las tres quedaron resueltas y registradas en la sección
`## Clarifications` de la spec.

| Marcador | Decisión | Dónde quedó |
| --- | --- | --- |
| FR-015b — verificación de correo | **Veredicto síncrono**, con el mismo plazo de 5 s de las consultas; el silencio degrada a vencimiento del plazo, no a rechazo | FR-015b–FR-015e, historia 6, SC-012 |
| FR-021b — `paymentScenario` | **Se enmienda `transfer.requested.v1` aquí**, campo opcional aditivo y retrocompatible | FR-021b–FR-021d, historia 3 esc. 8–9, SC-013 |
| FR-041b — sesión del frontend | **Entra en el shell, con filtrado por rol** según D-06; fuera quedan renovación, persistencia y recordar credenciales | FR-041b–FR-041g, historia 7 esc. 7–11, SC-014/SC-015 |

Alcance resultante: 61 requisitos funcionales, 15 criterios de éxito, 9 historias
de usuario.

### Dos observaciones que sobreviven a la validación

**Las citas del enunciado en el ticket están mal.** Seis de las ocho referencias
apuntan a páginas equivocadas. Las páginas de la spec están verificadas contra
`docs/references/780_Proyecto_1_2S2026.pdf` y la corrección queda registrada en
la cabecera del documento.

**Los nombres de mensaje del ticket no existen.** El ticket nombra siete
mensajes que no están con ese nombre en el catálogo de T-05, escrito después. La
tabla de FR-004 fija la correspondencia completa; vinculan los del catálogo, por
exigencia del propio criterio 5 del ticket.

### Un riesgo que el plan debe absorber

`paymentScenario` toca `@bank/contracts`, que es un paquete compartido del que
dependen los cinco tickets bloqueados. La enmienda es aditiva y opcional —un
mensaje que omita el campo sigue validando, sin cambio de versión (FR-021b)—,
pero es la única escritura de esta feature fuera de `apps/gateway/` y
`apps/web/`, y merece su propia tarea y su propia prueba de retrocompatibilidad.
