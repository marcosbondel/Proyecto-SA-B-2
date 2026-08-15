# Data Model: Registro de decisiones tecnológicas y arquitectónicas (T-03)

Fase 1. El borrador normativo de lo que se escribe en `docs/`. La implementación lo transcribe
**en inglés** (R1); aquí está en español por ser artefacto de trabajo.

Tres entidades: el **ADR**, la **matriz de decisiones** y la **definición SRE**
(SLI / SLO / SLA).

---

## 1. ADR (Architecture Decision Record)

### Campos

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `id` | Sí | `ADR-0NN`, correlativo, nunca reutilizado ni renumerado |
| `title` | Sí | La decisión en una frase, no el tema. "Use RabbitMQ as the message broker", no "Messaging" |
| `status` | Sí | `Proposed` \| `Accepted` \| `Superseded` |
| `date` | Sí | Fecha de la decisión, formato `YYYY-MM-DD` |
| `deciders` | Sí | Quién aprobó. Para T-03: el equipo, vía revisión del PR de `feature/T-03` |
| `supersedes` / `superseded-by` | Cuando aplique | Enlace al ADR relacionado. Nunca se edita un ADR reemplazado salvo para añadir este campo |
| `assignment-reference` | Sí | Sección **y página** del enunciado (rev. 2026-08-13), o la declaración explícita "not constrained by the assignment; team decision" (R5) |
| `Context` | Sí | Qué fuerza la decisión: restricción del enunciado, principio de la constitución, necesidad técnica |
| `Decision` | Sí | Qué se decide, en presente y en voz activa |
| `Alternatives considered` | Sí | **Al menos una**, cada una con su razón de descarte según uno de los cuatro criterios de R4 |
| `Consequences` | Sí | Qué se vuelve más fácil, qué más difícil, y **qué otro ticket queda obligado** |

### Estados y transiciones legales

```text
Proposed ──aprobación del equipo──> Accepted ──ADR nuevo que lo reemplaza──> Superseded
```

- `Accepted → Proposed` no existe: una decisión aprobada no retrocede, se reemplaza.
- `Superseded` es terminal. El contenido del ADR reemplazado **no se edita**; solo se le añade
  `superseded-by` (FR-011, y el edge case de la spec).
- Los once ADRs de T-03 nacen `Proposed` y pasan a `Accepted` al aprobarse el PR (FR-009).

### Invariantes

| # | Invariante | Verificación |
| --- | --- | --- |
| A-1 | Todo ADR tiene ≥ 1 alternativa descartada con razón técnica | SC-002; `grep` de la sección + juicio humano sobre R4 |
| A-2 | Todo ADR restringido por el enunciado cita sección y página | SC-002 |
| A-3 | Ningún ADR contradice la constitución ni `docs/domain/` | SC-005 |
| A-4 | Dos ADRs `Accepted` no deciden lo mismo de forma distinta | Revisión de la matriz |
| A-5 | Todo ADR aparece en el índice, en la matriz y en `ARCHITECTURE.md` | SC-006 |

### Las once decisiones

Alternativa principal descartada y el criterio de R4 que la sostiene. El argumento completo va
en cada ADR.

| ADR | Decisión | Alternativa principal descartada | Criterio | Enunciado |
| --- | --- | --- | --- | --- |
| ADR-001 | Backend en **TypeScript + NestJS** | Java + Spring Boot 4; Go (sin framework permitido en la lista) | (a) (d) | §4.2 p. 13; §4.3 p. 14 |
| ADR-002 | Frontend en **Vue + Nuxt 4** | React/Next; Angular | (d) | No restringido — el enunciado no fija frontend |
| ADR-003 | **Eventos + request/reply asíncrono**; nunca HTTP entre servicios | Llamadas HTTP síncronas; modelo híbrido con HTTP puntual | (c) | §4.2 p. 8 y p. 13; §6 paso 3 p. 17 |
| ADR-004 | **RabbitMQ** | Kafka; NATS; gRPC async | (a) (b) | §4.2 p. 8; §4.3 p. 14 |
| ADR-005 | **PostgreSQL**, una base por servicio, fuera del cluster | Base compartida; un motor por servicio distinto; base dentro del cluster | (b) (c) | §4.2 p. 13; §4.3 p. 14; §8.3 p. 27 |
| ADR-006 | **Docker** | Podman; binarios en el host | (c) | §4.3 p. 14 |
| ADR-007 | **kind** + release por **Helm** | minikube; k3d; `kubectl apply` de manifiestos sueltos | (a) (d) | §4.2 p. 8; §4.3 p. 14 |
| ADR-008 | **Clean Architecture** en cada servicio | Capas MVC por defecto de NestJS; estructura plana | (d) | No restringido — decisión del equipo |
| ADR-009 | **Saga por coreografía** | Saga por orquestación; transacción distribuida (2PC) | (b) (c) | §4.2 p. 8 (patrones esperados, p. 7) |
| ADR-010 | **JWT** emitido y validado en el Gateway, HS256, 1 h | Customer Service como emisor; RS256; validación por servicio; sesiones con estado | (b) (d) | §4.1 p. 5 |
| ADR-011 | **Lucid + Mermaid** | PlantUML (R9); solo Lucid; solo Mermaid | (d) | No restringido — decisión del equipo |

**ADR-002 y ADR-011 no citan página** y deben declararlo explícitamente (R5). El enunciado no
menciona frontend ni herramienta de diagramación; solo exige que los diagramas existan y sean
consistentes.

---

## 2. Matriz de decisiones

Una fila por decisión. **Indexa, no repite** (R6).

**Columnas**: `Decision` · `ADR` (enlace) · `Chosen` · `Rejected alternatives` ·
`Accepted trade-off` · `Operational consequence` · `Assignment rule it satisfies`.

Los seis trade-offs que el ticket exige documentar, y que deben aparecer literalmente en la
columna correspondiente:

| Decisión | Trade-off aceptado |
| --- | --- |
| RabbitMQ | Menor capacidad de *streaming* histórico y de reprocesar desde el origen; a cambio, colas, ack, retries y DLQ de primera clase y menor carga operativa local |
| PostgreSQL, base por servicio | Más instancias que administrar y ninguna consulta que cruce dominios; a cambio, transacciones y locking para demostrar consistencia de balances |
| kind | Menos parecido a un cluster productivo; a cambio, se integra con Docker y reproduce el cluster local. **La conectividad de pods hacia bases externas debe documentarse explícitamente** |
| Lucid + Mermaid | Dos artefactos por diagrama que deben concordar; a cambio, colaboración visual y revisión en Git |
| Clean Architecture | Más archivos y más ceremonia en cinco servicios; a cambio, la autonomía y separación de responsabilidades que la rúbrica evalúa |
| JWT sin estado | La revocación antes de la expiración queda fuera de alcance; a cambio, el Gateway valida identidad sin base de datos propia y sin consultar servicios en cada request |

**Las dos penalizaciones, como reglas separadas** (R7, FR-006), en la fila de ADR-005:

| Regla del enunciado | Penalización | Fuente | Cómo la evita la decisión |
| --- | --- | --- | --- |
| Una sola base de datos compartida | **100 %** de la nota | §8.3 p. 27 | Una base y unas credenciales por servicio |
| Microservicio conectado a múltiples bases de datos (antipatrón) | **50 %** de la nota | §4.2 p. 13 | Cada servicio abre conexión solo a la suya; lo ajeno llega por evento |

---

## 3. Definición SRE

Texto normativo para la sección "SLI, SLO, And SLA" de `docs/RELIABILITY.md`, que hoy es un
bloque `Blocked` (R10).

### 3.1 SLI — seis indicadores

Cada uno con **indicador, fórmula y fuente**. La fuente es lo que hace la definición
verificable en vez de vaga (criterio 2.9, §8.2 p. 26: 5 puntos o 0, sin rango intermedio).

| # | Indicador | Fórmula | Fuente |
| --- | --- | --- | --- |
| SLI-1 | Disponibilidad del Gateway | `requests atendidas sin error técnico / requests recibidas` | Logs del Gateway |
| SLI-2 | Tasa de finalización de transferencias | `transferencias COMPLETED / transferencias aceptadas` | Transaction Service |
| SLI-3 | Duración de la Saga (P50 / P95) | `timestamp del estado final − timestamp de transfer.requested` | Timestamps del sobre de mensaje |
| SLI-4 | Latencia de eventos | `timestamp de consumo exitoso − occurredAt` | Sobre de mensaje |
| SLI-5 | Tasa de retry y mensajes en DLQ, **por cola** | `retries / entregas`; conteo absoluto en cada DLQ | RabbitMQ |
| SLI-6 | Consistencia funcional | `transferencias cuyo estado final concuerda con balances y auditoría / transferencias finalizadas` | Comparación entre Transaction, Account y Notification & Audit |

"Error técnico" en SLI-1 significa fallo de la petición (5xx, timeout, conexión perdida). Un
rechazo de negocio —saldo insuficiente, cuenta inactiva— es una respuesta correcta y **no**
cuenta como indisponibilidad; contarlo mediría el dominio, no la disponibilidad.

### 3.2 SLO — cinco objetivos con umbral

| # | Objetivo | Umbral | SLI |
| --- | --- | --- | --- |
| SLO-1 | Mensajes válidos que no terminan en DLQ durante la prueba final | **≥ 99 %** | SLI-5 |
| SLO-2 | Transferencias exitosas completadas en menos de 5 s, en local estable | **≥ 95 %** | SLI-3, SLI-2 |
| SLO-3 | Comandos duplicados que producen un único efecto financiero | **100 %** | SLI-6 |
| SLO-4 | Fallos posteriores al débito que terminan en compensación o en estado pendiente explícito | **100 %** | SLI-2, SLI-6 |
| SLO-5 | Eventos del flujo principal con `correlationId` visible | **100 %** | SLI-4 |

Los tres objetivos del 100 % lo son porque **no admiten grado**: un comando duplicado que
mueve dinero dos veces, o un débito sin compensación, no son degradaciones del servicio sino
defectos de corrección. "En local estable" en SLO-2 significa: cluster levantado, sin fallos
inyectados y sin carga sintética concurrente.

### 3.3 SLA — alcance académico

Compromiso **observable únicamente durante la demostración**: levantar el cluster, ejecutar el
flujo principal de transferencia, mostrar la Saga completa —incluido un camino de
compensación— y presentar las evidencias de los SLI anteriores.

**No representa disponibilidad productiva.** No hay ventana de servicio, ni penalización, ni
medición continua, ni compromiso fuera de la sesión de evaluación. Declararlo evita que un SLA
académico se lea como una promesa operativa que el proyecto no puede sostener.

### 3.4 Obligación que esto impone al resto del proyecto

Cada servicio implementa **desde el inicio** la instrumentación que estos SLI requieren, o los
datos no existirán cuando T-24 vaya a medirlos:

- Timestamps de emisión y consumo en el sobre de mensaje (SLI-3, SLI-4).
- Logs estructurados con `correlationId` en todo el flujo (SLI-5, SLO-5).
- Conteo de reintentos y visibilidad de las DLQ por cola (SLI-5).
- Estado final de la transferencia consultable junto a balances y auditoría (SLI-6).

Esta es la razón por la que la definición pertenece al paso 7 de la metodología (§6 p. 17),
**antes** del paso 8 de implementación, y no a T-24.
