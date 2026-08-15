# Contract: anatomía de un ADR

Lo que los once ADRs comparten. Un ADR que no cumpla esto no está terminado, aunque esté
escrito.

El archivo entregado va **en inglés** (R1). La plantilla se muestra aquí en inglés por eso
mismo; las notas explicativas están en español.

---

## Plantilla

```markdown
# ADR-0NN: <the decision in one sentence>

- **Status**: Proposed | Accepted | Superseded
- **Date**: YYYY-MM-DD
- **Deciders**: Bank USAC team (approved in the `feature/T-03` pull request)
- **Assignment reference**: §X.Y "<section title>", page N (revision 2026-08-13)
  <!-- or, verbatim: "Not constrained by the assignment; team decision." -->
- **Supersedes / Superseded by**: ADR-0MM  <!-- omit when neither applies -->

## Context

<Qué fuerza esta decisión: la restricción del enunciado, el principio de la constitución, o
la necesidad técnica. Qué sería falso o imposible si no se decidiera nada.>

## Decision

<Qué se decide. Presente, voz activa, una afirmación comprobable.>

## Alternatives considered

### <Alternative 1>

<Qué es y por qué era candidata legítima.>

**Rejected because**: <razón según uno de los cuatro criterios de R4.>

### <Alternative 2>

...

## Consequences

**Easier**: <qué habilita.>

**Harder**: <el trade-off aceptado, nombrado sin suavizarlo.>

**Obligations created**: <qué queda obligado en otro ticket, con el ticket nombrado.>
```

---

## Reglas obligatorias

| # | Regla | Por qué |
| --- | --- | --- |
| C-1 | **Al menos una** alternativa descartada, con razón según R4: carga operativa local, soporte del patrón necesario, restricción o penalización citada del enunciado, o riesgo concreto | SC-002. Criterio 1.3, 10 puntos (§8.2 p. 23) |
| C-2 | Si el enunciado restringe la decisión, se cita **sección y página**. Si no, se declara literalmente "Not constrained by the assignment; team decision" | FR-002, R5. Un ADR sin cita y sin declaración se lee como un olvido |
| C-3 | La sección `Consequences` nombra el **trade-off aceptado**, no solo las ventajas | Un ADR sin costo declarado es propaganda, no una decisión |
| C-4 | Cuando la decisión obliga a otro ticket, ese ticket se **nombra** (T-05, T-06, T-15, T-21, T-22, T-24) | Es lo que convierte una consecuencia en trabajo rastreable |
| C-5 | El título es la decisión, no el tema | "Messaging" no dice qué se decidió; el índice se vuelve inútil |
| C-6 | Estado inicial `Proposed`; pasa a `Accepted` con la aprobación del PR | FR-009 |

## Afirmaciones prohibidas

| Prohibido | Razón |
| --- | --- |
| "El equipo ya conoce X" **como única razón** de descarte | Es una opinión sobre el equipo, no un trade-off técnico. Puede aparecer en `Context`, nunca como *la* razón en `Rejected because` (R4) |
| Payloads de evento, nombres de campo, esquemas de mensaje | Es **T-05**. ADR-010 declara que el sobre necesita identidad verificada; no define su forma |
| Manifiestos de Kubernetes, valores de Helm, `docker-compose` | Es **T-06**, **T-21** y **T-22** |
| Esquemas SQL, tablas, migraciones | Es la implementación de cada servicio |
| Diagramas | Son **T-07 a T-14** |
| Valores de SLI medidos | Es **T-24**. T-03 define objetivos, no resultados |
| Secretos, claves, cadenas de conexión reales | `docs/SECURITY.md`: nunca en Markdown |
| Redefinir el token de activación por correo | Es una decisión de **T-02**; ADR-010 solo lo distingue del JWT de sesión (R12, FR-005b) |

## Requisitos específicos por ADR

Además de lo anterior:

| ADR | Requisito adicional | Fuente |
| --- | --- | --- |
| ADR-001 | Cita **las tres** opciones de lenguaje (Java, TypeScript, Go) y **las dos** de framework (Spring Boot 4, NestJS) | FR-003 |
| ADR-004 | Cita **las cuatro** opciones de broker y descarta las tres no elegidas **una por una** | FR-004, R8 |
| ADR-005 | Cita las **dos** penalizaciones como reglas separadas (100 % y 50 %) | FR-006, R7 |
| ADR-007 | Documenta explícitamente **cómo alcanzan los pods las bases de datos externas al cluster** | Ticket, trade-off de kind |
| ADR-010 | Fija las cinco respuestas (librería, algoritmo, expiración, emisión, validación); declara las tres consecuencias de FR-005a; distingue el JWT de sesión del token de activación; se pronuncia sobre los principios IV y V | FR-005, FR-005a, FR-005b |
| ADR-011 | Descarta **PlantUML** con razón explícita | R9 |
