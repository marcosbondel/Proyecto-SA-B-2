# Implementation Plan: Dominio y límites de los cinco servicios (T-02)

**Branch**: `main` | **Date**: 2026-08-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-domain-service-boundaries/spec.md`

## Summary

Escribir el modelo de dominio de Bank USAC como contrato funcional, en seis documentos bajo
`docs/domain/`: los cinco bounded contexts con su matriz de ownership de datos, el catálogo de
entidades con estados e invariantes, los tres actores con sus permisos mínimos, los seis flujos
de negocio con sus fallos y compensaciones, y el catálogo inicial de comandos y eventos con
productor y consumidores. Cinco documentos existentes se editan para que el modelo quede
indexado y no contradiga lo ya escrito.

El enfoque tiene tres reglas que gobiernan cada tarea. **Documentación, cero código**: FR-057
prohíbe clases, esquemas y contratos de mensaje, así que `git diff -- apps/` debe salir vacío.
**Nada se inventa en silencio**: lo que el enunciado no fija se marca como decisión del equipo
(D-01 a D-06) con su alternativa descartada. **El corte con T-05 es el payload**: este trabajo
dice qué conversación existe entre servicios, no cómo se serializa.

El ticket no cierra con los documentos escritos, sino con la aprobación de los tres integrantes
(FR-055). Es el único criterio que ninguna comprobación mecánica sustituye.

## Technical Context

**Language/Version**: Markdown. Ningún cambio de código. La prosa va en inglés (documentación
duradera, FR-020 de T-01) y los literales del enunciado se conservan en español —
`MONETARIA`, `AHORRO`, `ADMINISTRADOR`, `CAJERO_RECEPTOR`, `CLIENTE` (R2).

**Primary Dependencies**: ninguna nueva y ninguna retirada. `apps/packages/contracts/` no se
toca: su `src/events/` es de T-05.

**Storage**: N/A. El modelo declara que hay una base por servicio y de quién es cada una, sin
esquemas, tablas ni motores.

**Testing**: no hay suite que ejercite un documento. La verificación es la de
[quickstart.md](quickstart.md): comprobaciones mecánicas (`grep`/`find`) por criterio de éxito,
una tabla de trazabilidad requisito → sección, y la revisión de los tres integrantes. `pnpm
lint` y `pnpm test` deben seguir pasando **sin cambios**, que es la prueba de que no se tocó
código.

**Target Platform**: repositorio. Lectores: los tres integrantes, los agentes que abren el repo
con contexto vacío, quien implementa cada servicio en T-08 a T-13, y quien califica.

**Project Type**: entregable documental sobre un monorepo pnpm con siete aplicaciones ya
construidas y capas `domain`/`application` vacías a propósito.

**Performance Goals**: N/A. El enunciado exige SLI, SLO y SLA, pero como entregable de otro
ticket.

**Constraints**: FR-057 (cero código), FR-051 (cero payloads — es T-05), FR-058 (cero
autorización por endpoint — es T-13), FR-036 (cero emisión de JWT — es T-03), FR-059 (cero OCR,
préstamos, tarjetas o integraciones bancarias reales). Regla de trazabilidad FR-052 y FR-053.
Cero marcadores pendientes sin responsable.

**Scale/Scope**: 6 documentos nuevos, 5 editados, 0 archivos de código. El modelo cubre 6
entidades, 13 comandos, 22 eventos, 6 flujos de negocio, 3 actores y 7 invariantes
transversales.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Estado del gate (pre-Phase 0): CONFORME.** T-02 no introduce servicios, comunicación,
persistencia ni despliegue; refuerza por escrito seis de los ocho principios y declara los
otros dos fuera de su alcance.

| # | Principio | Veredicto | Dónde se sostiene |
| --- | --- | --- | --- |
| I | Exactamente cinco microservicios | **Conforme** | El modelo define cinco bounded contexts y un Gateway sin entidades. FR-001, FR-006 |
| II | Una base por servicio, sin acceso cruzado | **Conforme — lo refuerza** | Matriz de ownership con un solo propietario por atributo; X-1 y FR-024 |
| III | Bases fuera del cluster | **No aplica** | Un modelo de dominio no ubica infraestructura. Es T-06 |
| IV | Comunicación asíncrona únicamente | **Conforme** | Todo dato ajeno llega por evento o request/reply; FR-007, X-2 |
| V | Gateway como único entrypoint sin lógica de negocio | **Conforme** | FR-006 y X-7; el Gateway origina el `correlationId` y traduce, no decide |
| VI | Saga para operaciones distribuidas | **Conforme** | Los siete pasos y los dos caminos de compensación de R11; FR-033, FR-039 |
| VII | Despliegue en Kubernetes local | **No aplica** | Es T-06 y T-16 |
| VIII | SRE desde el diseño | **Conforme** | Idempotencia (R8, T-3 a T-5), reintentos (`Payment.attempt`), manejo de errores (cada invariante con fallo nombrado), consistencia eventual (la Saga), `correlationId` (X-3, FR-040) |

Los dos "no aplica" son veredictos legítimos, no omisiones: la constitución exige que cada
artefacto se pronuncie sobre cada principio, y un modelo de dominio no puede conformar ni
violar una regla de despliegue. Que sean explícitos es lo que hace verificable SC-011.

**Re-check (post-Phase 1)**: al final de este documento.

## Project Structure

### Documentation (this feature)

```text
specs/003-domain-service-boundaries/
├── plan.md                          # Este archivo
├── spec.md                          # Especificación (ya existe)
├── research.md                      # Fase 0: 14 decisiones de enfoque
├── data-model.md                    # Fase 1: matriz de ownership, 6 entidades, invariantes, actores, glosario
├── quickstart.md                    # Fase 1: verificación por criterio de éxito
├── checklists/requirements.md       # Calidad del spec (ya existe)
├── contracts/
│   ├── message-catalog.md           # Fase 1: 13 comandos y 22 eventos, productor y consumidores
│   └── domain-document-contracts.md # Fase 1: qué debe contener cada documento entregado
└── tasks.md                         # Fase 2 (/speckit-tasks — no lo crea este comando)
```

### Source Code (repository root)

Los archivos que este trabajo toca, y solo esos. **Ninguno bajo `apps/`.**

```text
.
├── ARCHITECTURE.md                     # EDITAR — completar datos poseídos, enlazar docs/domain/
├── AGENTS.md                           # EDITAR — índice de documentación
├── docs/
│   ├── domain/                         # CREAR — el entregable
│   │   ├── README.md                   #   índice, glosario, D-01…D-06, aprobación
│   │   ├── bounded-contexts.md         #   5 contextos, matriz de ownership, datos que no cruzan
│   │   ├── entities.md                 #   6 entidades: identidad, estados, transiciones, invariantes
│   │   ├── actors.md                   #   3 actores, matriz caso de uso × rol, frontera
│   │   ├── use-cases.md                #   6 flujos con fallos, la Saga, el correlationId
│   │   └── message-catalog.md          #   13 comandos, 22 eventos, frontera con T-05
│   ├── DOC_INVENTORY.md                # EDITAR — clasificar los seis nuevos
│   ├── events/README.md                # EDITAR — acotar el bloqueo a payload/versionado/topics
│   └── architecture/README.md          # EDITAR — enlazar los registros de casos de uso
└── apps/                               # INTOCABLE
```

**Structure Decision**: el modelo va a `docs/domain/` y no dentro de `specs/003-…/` porque
debe seguir siendo verdadero cuando este ticket se archive — es la separación de dos altitudes
que ya gobierna el repositorio, y promover el conocimiento duradero fuera del spec es
exactamente lo que evita que el repo se pudra.

Se divide en seis archivos y no en uno porque cada uno responde a un criterio de aceptación
distinto y sirve a un lector distinto: quien implementa Account Service lee `entities.md` y
`bounded-contexts.md`; quien diseña los eventos en T-05 lee `message-catalog.md`; quien
construye la interfaz en T-08 a T-13 lee `actors.md`. Las invariantes **no** llevan archivo
propio: viven junto a la entidad que protegen, porque separarlas produciría dos documentos que
se contradicen en cuanto uno cambie. El razonamiento completo está en R1.

`docs/domain/` es un directorio nuevo, hermano de `docs/architecture/` y `docs/events/`, que ya
existen con la misma lógica: el mapa de alto nivel en la raíz, el desarrollo en `docs/`.

## Phase 0: Research

Ver [research.md](research.md). Catorce decisiones, ninguna pendiente. Las de mayor
consecuencia:

- **R4 — El identificador de login es el correo, no el username.** El enunciado genera el
  username a partir del nombre, así que el cliente no lo elige ni lo conoce; autenticar con él
  sería incoherente con D-04, donde el flujo entra por el correo.
- **R6 y R7 — La regla de desactivación de Q50.00 / seis meses.** Las dos condiciones se
  aplican con "y", consultar el saldo no cuenta como actividad, y una cuenta `INACTIVE` puede
  recibir dinero y reactivarse pero no puede ser origen de una transferencia. Rechazar el
  crédito entrante habría creado compensaciones que el emisor no puede prever ni corregir.
- **R8 — Tres mecanismos distintos que no hay que confundir**: la clave de idempotencia de la
  transferencia, la deduplicación por `eventId` en cada consumidor, y el `correlationId` que
  solo traza. Usar el `correlationId` para deduplicar deduplicaría el flujo entero.
- **R11 — La Saga en siete pasos, con `FAILED` distinto de `COMPENSATED`.** En uno nunca salió
  dinero; en el otro salió y volvió. La auditoría tiene que poder distinguirlos.
- **R12 — La tensión de D-03 verificada**: que Notification & Audit envíe el correo de
  activación no viola su descripción de "no afecta lógica de negocio", porque enviar es un
  efecto y no una decisión — la activación la decide Customer Service cuando el token vuelve.
  Se documenta la razón para que un revisor no lo lea como una violación.

Seis decisiones están marcadas **(requiere aprobación)** — R4 a R10 introducen reglas de
dominio que el enunciado no fija. Se agrupan como **D-05** (reglas derivadas) y **D-06**
(permisos por actor) para que se aprueben como bloque junto a D-01…D-04 del spec. No se
implementa nada sobre ellas antes de esa firma (FR-055).

## Phase 1: Design & Contracts

- **[data-model.md](data-model.md)** — el borrador normativo: matriz de ownership atributo por
  atributo con los cinco servicios y el Gateway, la lista de datos que no cruzan límites, las
  seis entidades con identidad, estados, transiciones legales e invariantes con fallo nombrado,
  las siete invariantes transversales, la matriz de actores × casos de uso, y el glosario del
  lenguaje ubicuo. La implementación lo transcribe a `docs/domain/` en inglés.
- **[contracts/message-catalog.md](contracts/message-catalog.md)** — 13 comandos con su único
  servicio receptor y 22 eventos con sus consumidores, más seis comprobaciones de coherencia
  (M-1 a M-6) que un revisor puede ejecutar sobre las tablas sin ver código.
- **[contracts/domain-document-contracts.md](contracts/domain-document-contracts.md)** — por
  cada documento entregado: secciones obligatorias, afirmaciones prohibidas y fuente
  autorizada. Es lo que convierte "está documentado" en algo falsable.
- **[quickstart.md](quickstart.md)** — una comprobación por criterio de éxito, separando lo
  mecánico de lo que exige juicio humano.

**Actualización del contexto del agente**: el paso está en la plantilla del comando, pero esta
instalación de Spec Kit (0.12.2) no incluye el script correspondiente —
`.specify/scripts/bash/` solo trae `common.sh`, `setup-plan.sh`, `setup-tasks.sh`,
`check-prerequisites.sh` y `create-new-feature.sh`. El contexto de los agentes se actualiza
por la vía que este repositorio ya usa: la entrada de `docs/domain/` en `AGENTS.md`, que es
tarea de este plan.

**Orden de ejecución sugerido para `/speckit-tasks`** (dependencias reales, no preferencia):

1. **`bounded-contexts.md` primero.** Es la frontera; todo lo demás la presupone. Si la matriz
   de ownership cambia, cambian las entidades y los mensajes.
2. **`entities.md`** después, que necesita saber qué atributo es de quién.
3. **`actors.md`**, independiente de los dos anteriores; puede ir en paralelo.
4. **`use-cases.md`**, que necesita entidades (para nombrar estados) y actores (para nombrar
   quién dispara cada flujo).
5. **`message-catalog.md`**, que necesita los flujos: un evento sin flujo es un nombre sin
   causa.
6. **`README.md` del modelo**, penúltimo: es el índice y el glosario, y un índice se escribe
   cuando ya existe lo que indexa.
7. **Los cinco documentos existentes** (`ARCHITECTURE.md`, `AGENTS.md`, `DOC_INVENTORY.md`,
   `docs/events/README.md`, `docs/architecture/README.md`), que registran el estado resultante
   y no pueden enlazar lo que todavía no existe.
8. **La aprobación de los tres integrantes** al final, sobre el modelo completo. Aprobar
   documento por documento invitaría a firmar una frontera y descubrir después que el flujo no
   cabe en ella.

## Complexity Tracking

Sin violaciones que justificar. El diseño no introduce servicios, dependencias, estructura ni
código; los dos "no aplica" del Constitution Check son veredictos sobre principios de
infraestructura, no excepciones solicitadas.

Una tensión real, resuelta y documentada en lugar de silenciada:

| Tensión | Cómo se resuelve | Alternativa rechazada |
| --- | --- | --- |
| D-03 pone a Notification & Audit a enviar el correo de activación, y §4.1 (p. 7) lo describe como "altamente desacoplado" y "no afecta lógica de negocio" | Enviar es un efecto, no una decisión: no genera el token, no lo valida, y no publica ningún evento que otro consuma para decidir (FR-050). Si el envío falla, el `Customer` no cambia de estado. Se escribe la razón en `bounded-contexts.md` (R12) | Que Customer Service enviara el correo con su propio adaptador, que le quita a Notification & Audit la función que el enunciado le asigna |

Un riesgo que este plan no puede cerrar solo: **la aprobación depende de dos personas que no
ejecutan el ticket**. Las decisiones D-01 a D-04 las tomó el coordinador, y R4 a R10 añaden seis
reglas de dominio más. Si Enner o David objetan una frontera, el retrabajo cae sobre
`bounded-contexts.md` y arrastra a los cinco documentos restantes — por eso el orden de
ejecución pone esa frontera primero y la aprobación al final, sobre el conjunto.

## Constitution Re-Check (post-Phase 1)

Reevaluado contra los ocho principios tras producir `data-model.md`, los dos contratos y
`quickstart.md`: **conforme, sin cambios respecto del gate previo**.

El diseño de Fase 1 refuerza el veredicto en tres puntos concretos. El principio II queda
sostenido por una matriz atributo por atributo donde `balance` tiene un solo escritor y
Transaction Service no figura entre sus lectores. El principio IV queda sostenido porque las
22 filas de eventos y las 13 de comandos no contienen ninguna interacción síncrona entre
servicios; la única respuesta directa es el request/reply asíncrono del Gateway. El principio
VI queda sostenido por los dos caminos de compensación de R11, verificables con la
comprobación M-4.

Los principios III y VII siguen siendo "no aplica" por la misma razón que en el gate previo, y
esa justificación está escrita para que SC-011 pueda comprobarse.
