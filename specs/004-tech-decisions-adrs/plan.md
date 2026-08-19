# Implementation Plan: Registro de decisiones tecnológicas y arquitectónicas (T-03)

**Branch**: `feature/T-03` | **Date**: 2026-08-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-tech-decisions-adrs/spec.md`

## Summary

Escribir el registro de decisiones de Bank USAC: **once ADRs** bajo
`docs/architecture/adr/`, una **matriz de decisiones** que los consolida, y la **definición
inicial de SLI, SLO y SLA** en `docs/RELIABILITY.md`, que hoy es un bloque `Blocked` que
nombra a T-03 como responsable. Ocho documentos existentes se editan para que el registro
quede indexado, enlazado y sin contradecir lo ya escrito.

El trabajo no inventa decisiones: diez de las once ya están tomadas y dispersas entre
`ARCHITECTURE.md`, la constitución y el ticket. Lo que falta es **el razonamiento** —
alternativas descartadas con razón técnica— que es exactamente lo que la rúbrica califica en
el criterio 1.3 (10 puntos, §8.2 p. 23). La undécima, autenticación JWT, se decidió durante
`/speckit-specify` el 2026-08-14 y aquí se registra.

Tres reglas gobiernan cada tarea. **Documentación, cero código**: `git diff -- apps/` debe
salir vacío. **Cada alternativa descartada lleva razón técnica**, no preferencia — una
alternativa rechazada "porque no nos gusta" pierde el punto que el ADR existe para ganar.
**Lo que se afirma se verifica contra el enunciado**: cada ADR restringido por el PDF cita
sección y página, y las páginas de este spec ya fueron verificadas una por una contra el
documento de 27 páginas.

El plan corrige además **tres inconsistencias reales** que la spec asumió mal o que el repo
arrastra; están en [research.md](research.md) como R1, R2 y R9, y se resumen abajo.

## Technical Context

**Language/Version**: Markdown. Ningún cambio de código. La prosa duradera va en **inglés**,
no en español como asumió la spec: FR-020 de T-01 obliga a que `README.md`,
`ARCHITECTURE.md`, `AGENTS.md` y todo `docs/` estén en inglés, y `docs/domain/` (T-02) ya lo
cumple. Los artefactos bajo `specs/` siguen en español por ser documentos de trabajo. Ver
**R1**.

**Primary Dependencies**: ninguna nueva y ninguna retirada. Los ADRs *nombran* librerías
(`@nestjs/jwt`, `passport-jwt`) como decisión registrada; **no** las instalan. `package.json`
no se toca en este ticket.

**Storage**: N/A. ADR-005 decide PostgreSQL con una base por servicio fuera del cluster, pero
no crea esquemas, migraciones ni instancias — eso es T-06.

**Testing**: no hay suite que ejercite un documento. La verificación es la de
[quickstart.md](quickstart.md): comprobaciones mecánicas (`grep`/`find`) por criterio de
éxito, una tabla de trazabilidad requisito → artefacto, y la revisión del equipo. `pnpm lint`
y `pnpm test` deben seguir pasando **sin cambios**, que es la prueba de que no se tocó código.

**Target Platform**: repositorio. Lectores: los tres integrantes, los agentes que abren el
repo con contexto vacío, quien implementa cada servicio en T-15 en adelante, quien dibuja los
ocho diagramas en T-07 a T-14, y quien califica.

**Project Type**: entregable documental sobre un monorepo pnpm con siete aplicaciones ya
construidas (Gateway, cinco servicios, frontend) y tres paquetes compartidos, con las capas
`domain` y `application` vacías a propósito.

**Performance Goals**: N/A para el entregable. Los umbrales que este ticket **define** (no
mide) son los cinco SLO: ≥99 % de mensajes válidos fuera de DLQ, ≥95 % de transferencias
exitosas < 5 s, y tres objetivos del 100 % sobre idempotencia, compensación y trazabilidad.

**Constraints**: cero código bajo `apps/` (FR-001 es documental). Cero payloads de evento —
el formato del campo de identidad en el sobre es **T-05** (FR-005a). Cero manifiestos de
Kubernetes o Helm — son **T-06**, **T-21** y **T-22**. Cero diagramas — son **T-07 a T-14**. Cero
medición de SLI — es **T-24**. Ninguna decisión puede contradecir la constitución ni
`docs/domain/`.

**Scale/Scope**: 13 archivos nuevos (11 ADRs + índice + matriz), 8 editados, 0 archivos de
código. Cubre 11 decisiones, 6 SLI, 5 SLO, 1 SLA.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Estado del gate (pre-Phase 0): CONFORME.** T-03 es el artefacto que *escribe la
justificación* de seis de los ocho principios. No puede violarlos: los documenta. Los dos
principios que no fija por sí mismo se declaran explícitamente, porque la constitución exige
un veredicto por principio y un "no aplica" razonado es un veredicto legítimo.

| # | Principio | Veredicto | Dónde se sostiene |
| --- | --- | --- | --- |
| I | Exactamente cinco microservicios | **No aplica** | T-03 decide tecnologías, no fronteras de servicio. Las cinco las fijó T-02 y ningún ADR las altera |
| II | Una base por servicio, sin acceso cruzado | **Conforme — lo justifica** | ADR-005 registra PostgreSQL con una base y credenciales por servicio, y cita las **dos** penalizaciones como reglas separadas: 100 % por base compartida (§8.3 p. 27) y 50 % por servicio conectado a múltiples bases (§4.2 p. 13) |
| III | Bases fuera del cluster | **Conforme — lo justifica** | ADR-005 y ADR-007; la conectividad de pods hacia bases externas queda documentada como consecuencia, que es el punto que el ticket exige explícitamente |
| IV | Comunicación asíncrona únicamente | **Conforme — lo justifica** | ADR-003 (modelo de comunicación) y ADR-004 (broker). ADR-010 se revisa contra este principio: validar el JWT solo en el Gateway **no** introduce ninguna llamada síncrona entre servicios |
| V | Gateway como único entrypoint sin lógica de negocio | **Conforme — lo justifica** | ADR-010. Firmar un token a partir de claims que Customer Service ya decidió es autenticación, no una decisión de dominio; el Gateway sigue sin base de datos y sin reglas bancarias |
| VI | Saga para operaciones distribuidas | **Conforme — lo justifica** | ADR-009 registra coreografía y cita el flujo de siete pasos que T-02 ya escribió en `docs/domain/use-cases.md` |
| VII | Despliegue en Kubernetes local | **Conforme — lo justifica** | ADR-006 (Docker) y ADR-007 (kind + Helm). El ADR decide; **T-06, T-21 y T-22 materializan** |
| VIII | SRE desde el diseño | **Conforme — lo cumple** | La definición de SLI/SLO/SLA en `docs/RELIABILITY.md` es literalmente el paso 7 de la metodología (§6 p. 17), exigido **antes** del paso 8 de implementación |

El único "no aplica" es el principio I, y es deliberado: un ADR de tecnología no puede
conformar ni violar una regla sobre el número de servicios.

**Re-check (post-Phase 1)**: al final de este documento.

## Project Structure

### Documentation (this feature)

```text
specs/004-tech-decisions-adrs/
├── plan.md                      # Este archivo
├── spec.md                      # Especificación (ya existe)
├── research.md                  # Fase 0: 12 decisiones de enfoque, 3 de ellas correctivas
├── data-model.md                # Fase 1: anatomía del ADR, matriz, SLI/SLO/SLA normativos
├── quickstart.md                # Fase 1: verificación por criterio de éxito
├── checklists/requirements.md   # Calidad del spec (ya existe)
├── contracts/
│   ├── adr-template.md          # Fase 1: secciones obligatorias y prohibidas de un ADR
│   └── document-contracts.md    # Fase 1: qué debe contener cada documento entregado
└── tasks.md                     # Fase 2 (/speckit-tasks — no lo crea este comando)
```

### Source Code (repository root)

Los archivos que este trabajo toca, y solo esos. **Ninguno bajo `apps/`.**

```text
.
├── ARCHITECTURE.md                          # EDITAR — enlazar ADRs; corregir "Current State" (FR-008a)
├── AGENTS.md                                # EDITAR — una entrada de índice hacia el registro de ADRs
├── docs/
│   ├── architecture/
│   │   ├── README.md                        # EDITAR — acotar el bloqueo a los diagramas; enlazar adr/
│   │   ├── adr/                             # CREAR — el entregable principal
│   │   │   ├── README.md                    #   índice: 11 ADRs, estado, fecha, aprobación
│   │   │   ├── ADR-001-backend-stack.md
│   │   │   ├── ADR-002-frontend-stack.md
│   │   │   ├── ADR-003-communication-model.md
│   │   │   ├── ADR-004-message-broker.md
│   │   │   ├── ADR-005-persistence.md
│   │   │   ├── ADR-006-containerization.md
│   │   │   ├── ADR-007-local-orchestration.md
│   │   │   ├── ADR-008-service-internal-architecture.md
│   │   │   ├── ADR-009-distributed-transactions.md
│   │   │   ├── ADR-010-authentication.md
│   │   │   └── ADR-011-diagramming-toolchain.md
│   │   └── decision-matrix.md               # CREAR — decisión → alternativas → trade-off → consecuencias
│   ├── RELIABILITY.md                       # EDITAR — sustituir el bloqueo por 6 SLI, 5 SLO y 1 SLA
│   ├── SECURITY.md                          # EDITAR — "Access Model": el modelo de auth ya está decidido
│   ├── DOC_INVENTORY.md                     # EDITAR — clasificar los 13 documentos nuevos
│   ├── design-docs/index.md                 # EDITAR — una fila que apunta al índice de ADRs
│   └── QUALITY_SCORE.md                     # EDITAR — la fila Reliability ya no espera a T-03
└── apps/                                    # INTOCABLE
```

**Structure Decision**: los ADRs van a **`docs/architecture/adr/`**, no a `docs/adr/` como
asumió la spec. `docs/architecture/README.md` ya se declara el hogar de los ADRs —"this
directory holds the decisions behind it and the diagrams that show it", "One ADR per decision,
numbered and dated, with the alternatives that were rejected and why"— y ya carga el marcador
`Blocked … Arrives with: T-03 and T-07`. Crear `docs/adr/` habría dejado dos directorios
compitiendo por el mismo rol y un bloqueo que nunca se levanta. El subdirectorio `adr/` es
hermano del `diagrams/` que T-07 a T-14 llenarán, con el índice en `README.md` de cada uno.
Ver **R2**.

Los ADRs viven en `docs/` y no dentro de `specs/004-…/` porque deben seguir siendo verdaderos
cuando este ticket se archive. Es la separación de dos altitudes que ya gobierna el
repositorio: lo que se archiva al entregar vive con el spec; lo que debe permanecer cierto
vive en `docs/`.

Once archivos y no uno solo porque un ADR es la unidad de reemplazo: cuando una decisión se
sustituya, se marca *superseded* ese archivo y no se toca el resto. Un documento único
obligaría a editar la historia para cambiar una línea, que es exactamente lo que el registro
existe para impedir (FR-011).

## Phase 0: Research

Ver [research.md](research.md). Doce decisiones, ninguna pendiente. **Tres son correctivas** —
arreglan algo que la spec asumió mal o que el repo arrastra— y son las de mayor consecuencia:

- **R1 — Los ADRs se escriben en inglés, no en español.** La spec asumió español "como el
  resto de la documentación funcional". Es falso: FR-020 de T-01 obliga a inglés en todo
  `docs/`, y `docs/domain/`, `ARCHITECTURE.md`, `RELIABILITY.md` y `SECURITY.md` ya están en
  inglés. Escribirlos en español habría dejado el repo a medio traducir, que es justo lo que
  FR-020 prohíbe.
- **R2 — Los ADRs van a `docs/architecture/adr/`, no a `docs/adr/`.** Ver *Structure
  Decision*.
- **R9 — PlantUML no se adopta.** El ticket dice "Mermaid y PlantUML para fuentes versionables",
  pero `docs/architecture/README.md` ya fijó **dos** artefactos por diagrama —Lucid + Mermaid—
  y Mermaid cubre siete de los ocho diagramas de forma nativa. Añadir un tercer formato crea
  una tercera copia que puede contradecir a las otras dos, en un proyecto donde la
  inconsistencia entre diagramas cuesta el 25 % (§8.3 p. 27). ADR-011 registra Lucid + Mermaid
  y **descarta PlantUML explícitamente con esa razón**, en vez de dejar el ticket y el repo
  discrepando en silencio.

Las demás fijan el enfoque de redacción:

- **R3 — Un ADR por decisión, once en total**, aunque Docker y kind pudieran fusionarse.
  SC-001 cuenta decisiones con ADR; fusionarlas haría el conteo ambiguo y acoplaría dos
  reemplazos independientes.
- **R4 — El descarte se argumenta con el criterio que el enunciado o la rúbrica hacen
  observable** (carga operativa local, soporte de colas/ack/DLQ, penalización citada, riesgo),
  nunca con madurez del equipo a secas.
- **R6 — La matriz no repite los ADRs, los indexa.** Una fila por decisión con enlace; el
  argumento vive en el ADR. Duplicar el razonamiento garantiza que un día se contradigan.
- **R10 — `docs/RELIABILITY.md` recibe los SLI/SLO/SLA**, en lugar de crear un documento SRE
  nuevo: ese archivo ya existe, ya está indexado en `AGENTS.md` y ya declara el bloqueo que
  este ticket levanta.
- **R11 — La expiración del JWT se fija en 1 hora**, con la razón registrada; sin refresh
  token, coherente con que la revocación quede fuera de alcance.

## Phase 1: Design & Contracts

- **[data-model.md](data-model.md)** — el borrador normativo: la anatomía del ADR (campos,
  estados y transiciones legales de `Proposed → Accepted → Superseded`), la tabla de las once
  decisiones con su alternativa principal descartada, y los **6 SLI con fórmula y fuente, los
  5 SLO con umbral y el SLA** redactados tal como deben quedar en `docs/RELIABILITY.md`. La
  implementación lo transcribe a `docs/` en inglés.
- **[contracts/adr-template.md](contracts/adr-template.md)** — las secciones obligatorias de
  un ADR, las afirmaciones prohibidas y la regla de cita del enunciado. Es lo que convierte
  "el ADR está escrito" en algo falsable.
- **[contracts/document-contracts.md](contracts/document-contracts.md)** — por cada documento
  entregado o editado: qué debe contener, qué no puede afirmar y cuál es su fuente autorizada.
- **[quickstart.md](quickstart.md)** — una comprobación por criterio de éxito, separando lo
  mecánico (`grep`) de lo que exige juicio humano (¿es *técnica* esta razón de descarte?).

**Actualización del contexto del agente**: el paso está en la plantilla del comando, pero esta
instalación de Spec Kit (0.12.2) no incluye el script correspondiente —
`.specify/scripts/bash/` solo trae `common.sh`, `setup-plan.sh`, `setup-tasks.sh`,
`check-prerequisites.sh` y `create-new-feature.sh`. El contexto se actualiza por la vía que
este repositorio ya usa: la entrada del registro de ADRs en `AGENTS.md`, que es tarea de este
plan.

**Orden de ejecución sugerido para `/speckit-tasks`** (dependencias reales, no preferencia):

1. **`contracts/adr-template.md` primero**, materializado como el formato que los once
   comparten. Once ADRs escritos con estructuras distintas son once documentos que no se
   pueden auditar en bloque.
2. **ADR-001 y ADR-003** (stack y modelo de comunicación). Son los que más restringen: el
   resto los presupone.
3. **ADR-002, ADR-004 a ADR-009, ADR-011** en paralelo. Son independientes entre sí.
4. **ADR-010 (autenticación)** después de ADR-003, porque su consecuencia —la identidad viaja
   en el sobre— solo se enuncia bien una vez que el modelo de comunicación está escrito.
5. **`decision-matrix.md`**, que indexa los once y no puede escribirse antes que ellos.
6. **`docs/RELIABILITY.md`** (SLI/SLO/SLA), independiente de los ADRs salvo por nombrar
   componentes; puede ir en paralelo desde el paso 2.
7. **Las ediciones de índice y consistencia al final** —`ARCHITECTURE.md`, `AGENTS.md`,
   `SECURITY.md`, `DOC_INVENTORY.md`, `design-docs/index.md`, `QUALITY_SCORE.md`,
   `architecture/README.md`— porque enlazan archivos que deben existir ya.
8. **La revisión cruzada contra la constitución y `docs/domain/`** como último paso: es
   SC-005 y no puede hacerse sobre un registro incompleto.

## Complexity Tracking

> Sin violaciones que justificar. El Constitution Check no registra ninguna infracción, y el
> único "no aplica" (principio I) está razonado arriba.

## Post-Design Constitution Re-check

**Estado: CONFORME.** El diseño de la Fase 1 no introdujo ninguna desviación:

- Los artefactos son Markdown bajo `docs/` y `specs/`; **ninguno bajo `apps/`**, así que
  ningún principio sobre servicios, bases o despliegue puede violarse por construcción.
- ADR-010 se revisó contra los principios IV y V y pasa ambos: la validación en el Gateway no
  añade llamadas síncronas entre servicios (IV) y firmar sobre claims ajenos no le da al
  Gateway ninguna decisión de dominio (V).
- El único punto donde el diseño **añade** una obligación futura es la consecuencia de ADR-010:
  el sobre de mensaje necesitará un campo de identidad verificada. Queda registrado como
  entrada para T-05, no resuelto aquí — coherente con el corte que T-02 ya trazó entre "qué
  conversación existe" y "cómo se serializa".
