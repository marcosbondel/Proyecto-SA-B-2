# Feature Specification: Registro de decisiones tecnológicas y arquitectónicas (T-03)

**Feature Branch**: `004-tech-decisions-adrs`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "trabajemos el ticket T-03 (https://github.com/marcosbondel/Proyecto-SA-B-2/issues/10), consultando el código fuente actual y el documento del proyecto docs/references/780_Proyecto_1_2S2026.pdf"

**Ticket origen**: [T-03 Registrar decisiones tecnológicas y arquitectónicas](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/10) — responsable Marcos Bonifasi (Tech Lead), entrega 2026-08-15. Depende de T-02. Bloquea T-04, T-05, T-06, T-07 y la implementación.

**Enunciado**: `docs/references/780_Proyecto_1_2S2026.pdf`, revisión del 2026-08-13 (27 páginas). Secciones aplicables, con la página verificada contra el PDF: §4.1 "Customer Service" — autenticación con JWT (p. 5); §4.2 Alcance — definición de SLI, SLO y SLA como documentación obligatoria y las cuatro opciones de mensajería (p. 8); §4.2 Restricciones arquitectónicas — antipatrón de microservicio conectado a múltiples bases de datos, penalización del 50 % (p. 13); §4.2 Flexibilidad de diseño — lenguaje (Java/TypeScript/Go) y framework (Spring Boot 4/NestJS) (p. 13); §4.3 Recursos — tabla de tecnologías obligatorias, incluida mensajería (Kafka/RabbitMQ/NATS/gRPC async) y base de datos externa al cluster (p. 14); §4.4 Entregables — "Definición de SLI, SLO y SLA" y "Justificación de decisiones arquitectónicas" (p. 14); §6 Metodología — paso 3 (modelo de comunicación justificado) y paso 7 (métricas SRE, antes de la implementación del paso 8) (p. 17); §8.1 Requisitos — "Definición SRE" y "Justificación técnica" (pp. 20-21); §8.2 criterio 1.3 "Justificación de decisiones", 10 puntos (p. 23) y criterio 2.9 "Definición de métricas", 5 puntos (p. 26); §8.3 Comentarios generales — penalizaciones (p. 27).

**Qué es este documento**: la especificación de los **entregables documentales** de T-03: los ADRs, la matriz de decisiones y la definición inicial de SLI/SLO/SLA. Las decisiones que aquí se registren son **restricciones de diseño para todas las specs siguientes**: ninguna spec posterior puede rediscutir el stack ni introducir excepciones sin un ADR que reemplace al vigente. Este documento no redefine el dominio (T-02) ni diseña eventos (T-05); fija el marco técnico dentro del cual se diseñarán.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cada decisión vigente queda registrada como ADR con alternativas justificadas (Priority: P1)

Un integrante o agente que empieza cualquier servicio necesita saber qué stack, broker, persistencia, despliegue y estructura interna debe usar, y por qué, sin reabrir el debate ni depender de la memoria de quien estuvo en la reunión. Hoy las decisiones están dispersas entre `ARCHITECTURE.md`, la constitución y el ticket; ninguna registra formalmente las alternativas descartadas.

**Why this priority**: es lo que desbloquea T-04, T-05, T-06, T-07 y la implementación. El criterio 1.3 de la rúbrica (§8.2, p. 23) vale 10 puntos y exige "decisiones bien argumentadas con trade-offs técnicos", frente a "sin justificación o basada en opiniones"; §8.1 exige además "Justificación técnica" de tecnologías como requisito (pp. 20-21), y §4.4 la lista como entregable (p. 14). Una alternativa descartada sin razón técnica lee como preferencia personal y pierde el punto.

**Independent Test**: se entrega solo. Se toma la lista de decisiones vigentes del ticket (backend, frontend, broker, persistencia, contenedores, cluster local, arquitectura interna, diagramas, comunicación, saga, autenticación) y cada una tiene un ADR con contexto, decisión, alternativas consideradas con razón técnica de descarte, y consecuencias.

**Acceptance Scenarios**:

1. **Given** la lista de decisiones vigentes, **When** se audita el registro, **Then** cada decisión que cambia la forma de implementar o desplegar tiene al menos un ADR, y ninguna decisión vigente carece de ADR.
2. **Given** cualquier ADR, **When** se revisan sus alternativas, **Then** cada alternativa descartada tiene una razón técnica (costo operativo, soporte de patrones, restricción del enunciado, riesgo) y no solo una preferencia personal.
3. **Given** el ADR de stack, **When** se compara con el enunciado revisado, **Then** cita explícitamente las tres opciones de lenguaje (Java, TypeScript, Go) y las dos de framework (Spring Boot 4, NestJS) tal como aparecen en §4.2 Flexibilidad de diseño (p. 13) y en la tabla de §4.3 (p. 14), y explica por qué TypeScript + NestJS sigue siendo válido.
4. **Given** el ADR de mensajería, **When** se compara con el enunciado revisado, **Then** cita explícitamente las cuatro opciones de broker (Kafka, RabbitMQ, NATS, gRPC async) tal como aparecen en §4.2 Alcance (p. 8) y en la tabla de §4.3 (p. 14), y justifica RabbitMQ frente a las otras tres, no solo frente a Kafka.

---

### User Story 2 - El mecanismo de autenticación JWT queda decidido y registrado (Priority: P1)

El enunciado revisado exige JWT para autenticar y validar al usuario (§4.1, Customer Service, p. 5), pero no dice quién emite el token, con qué algoritmo se firma, cuánto vive, ni dónde se valida. El equipo necesita esas respuestas fijadas antes de implementar Customer Service y el Gateway, porque condicionan el flujo de login, la configuración de seguridad del Gateway y la propagación de identidad en los mensajes.

**Why this priority**: es la única decisión vigente que aún no existe en ningún documento. Sin ella, T-05 (contratos de eventos) no puede definir cómo viaja la identidad en el sobre de mensaje, y el Gateway no puede implementar la responsabilidad de "autenticar" que la constitución (principio V) le permite.

**Independent Test**: se entrega solo. El ADR de autenticación responde en una lectura: librería, algoritmo de firma, tiempo de expiración, punto de emisión y puntos de validación, con las alternativas descartadas y la razón de cada descarte.

**Decisiones aprobadas por el equipo (2026-08-14)**, que el ADR debe registrar con su justificación y alternativas descartadas:

- **Emisión**: el **Gateway** firma el JWT. Customer Service valida las credenciales y responde `customer.authenticate` con *claims*, no con un token — exactamente como T-02 ya lo dejó escrito. Descartado: que Customer Service emita el token, porque contradice `docs/domain/message-catalog.md` y obligaría a enmendar T-02 sin ganancia técnica.
- **Algoritmo**: **HS256** con secreto compartido. Es defendible precisamente porque el Gateway es a la vez el único firmante y el único validador: el secreto no sale del Gateway y ningún otro componente necesita capacidad de firma. Descartado: RS256, cuyo valor —que quien valida no pueda firmar— no se materializa cuando firma y validación viven en el mismo componente, a cambio de generar, distribuir y rotar un par de claves en el despliegue local.
- **Validación**: **solo el Gateway** verifica firma y expiración. La identidad ya verificada (`customerId`, `role`) viaja hacia los servicios dentro del sobre de mensaje, junto a `correlationId`, `causationId` e `idempotencyKey`. Descartado: validación por servicio, que replicaría la configuración de verificación y el secreto en cinco servicios y acoplaría cada dominio a la decisión de autenticación.

**Acceptance Scenarios**:

1. **Given** el ADR de autenticación, **When** se consulta el punto de emisión, **Then** consta que el Gateway firma el JWT a partir de los claims que Customer Service devuelve por `customer.authenticate`, y que Customer Service no emite tokens de sesión.
2. **Given** el ADR de autenticación, **When** se consulta el algoritmo, **Then** consta HS256 con secreto compartido, junto con la razón (firma y validación concentradas en el Gateway) y el descarte razonado de RS256.
3. **Given** el ADR de autenticación, **When** se consulta la validación, **Then** consta que solo el Gateway valida el token y que la identidad verificada viaja en el sobre del mensaje, con el supuesto de confianza que eso implica declarado explícitamente.
4. **Given** el ADR de autenticación, **When** se revisa contra la constitución, **Then** el mecanismo elegido no le asigna al Gateway lógica de negocio ni base de datos (principio V), y no introduce comunicación síncrona entre servicios (principio IV).
5. **Given** el trade-off de revocación, **When** se lee el ADR, **Then** consta explícitamente que invalidar tokens antes de su expiración queda fuera de alcance de esta fase.
6. **Given** la decisión de propagar identidad en el sobre, **When** se revisa el impacto sobre T-05, **Then** el ADR registra como consecuencia que el sobre de mensaje debe incorporar el campo de identidad verificada, y que T-05 lo define.
7. **Given** el supuesto de confianza del broker, **When** se lee el ADR, **Then** consta que la validez del modelo depende de que ningún productor publique al broker sin haber pasado por el Gateway, y que el secreto de firma se gestiona como Secret de Kubernetes y nunca se versiona.

---

### User Story 3 - La definición inicial de SLI, SLO y SLA queda aprobada antes de implementar (Priority: P2)

El equipo necesita las métricas SRE aprobadas ahora —la metodología las exige en el paso 7, antes de la implementación del paso 8 (§6, p. 17)— para que cada servicio implemente desde el inicio la instrumentación que los SLI requieren (timestamps, logs con `correlationId`, conteo de retries), en vez de descubrir en T-24 que no hay datos para medir.

**Why this priority**: §4.2 (p. 8), §4.4 (p. 14) y §8.1 (pp. 20-21) exigen la definición de SLI, SLO y SLA como documentación obligatoria, y el criterio 2.9 de la rúbrica (p. 26) da 5 puntos por definiciones "claras y medibles" y 0 por "vagas o incorrectas" — sin rango intermedio. Es P2 porque las fuentes de los SLI nombran componentes que los ADRs de US1 fijan.

**Independent Test**: se entrega solo. Se toma cada SLI y se verifica que tiene indicador, fórmula y fuente de datos concreta; cada SLO tiene umbral numérico; el SLA declara su alcance académico (observable solo durante la demostración).

**Acceptance Scenarios**:

1. **Given** la lista de SLI, **When** se audita cada uno, **Then** tiene indicador, fórmula y fuente, y entre todos cubren: disponibilidad del Gateway, tasa de finalización de transferencias, duración de Saga (P50/P95), latencia de eventos, tasa de retry y mensajes en DLQ por cola, y consistencia funcional entre estado final, balances y auditoría.
2. **Given** los SLO iniciales, **When** se revisan, **Then** cada uno tiene umbral numérico medible: ≥99 % de mensajes válidos sin terminar en DLQ en la prueba final; ≥95 % de transferencias exitosas < 5 s en local estable; 100 % de comandos duplicados con un único efecto financiero; 100 % de fallos post-débito con compensación o estado pendiente explícito; 100 % de eventos del flujo principal con `correlationId` visible.
3. **Given** el SLA, **When** se lee su alcance, **Then** declara que el compromiso es observable solo durante la demostración (levantar el cluster, ejecutar el flujo principal, mostrar la Saga y evidencias) y que no representa disponibilidad productiva.
4. **Given** cualquier spec de servicio posterior, **When** se escribe su sección de observabilidad, **Then** puede citar los SLI/SLO aprobados sin redefinirlos.

---

### User Story 4 - La matriz de decisiones y ARCHITECTURE.md quedan consistentes con el registro (Priority: P2)

Quien revisa el proyecto (equipo o catedrático) necesita una vista única de decisiones → alternativas → trade-offs → consecuencias, y que `ARCHITECTURE.md` enlace los ADRs, para verificar en minutos que no hay contradicciones entre decisiones, diagramas, dominio (T-02) y contratos (T-05).

**Why this priority**: la rúbrica penaliza la inconsistencia entre diagramas y código con el 25 % (§8.3, p. 27) y el ticket exige revisión de consistencia con T-02 y T-05. La matriz es también donde deben quedar citadas como reglas separadas la base compartida (100 % de la nota, §8.3, p. 27) y el microservicio conectado a múltiples bases (50 %, §4.2, p. 13).

**Independent Test**: se entrega solo. Se abre la matriz y `ARCHITECTURE.md`: cada ADR aparece en ambos, cada trade-off del ticket (RabbitMQ frente a Kafka, PostgreSQL separado, kind, Lucid/Mermaid/PlantUML, Clean Architecture repetida, JWT sin estado) está documentado, y ninguna afirmación contradice la constitución ni `docs/domain/`.

**Acceptance Scenarios**:

1. **Given** la matriz de decisiones, **When** se recorre, **Then** cada decisión tiene alternativas, trade-off aceptado y consecuencias, incluida la cita explícita de las dos penalizaciones como reglas separadas.
2. **Given** `ARCHITECTURE.md`, **When** se buscan los ADRs, **Then** hay enlaces a cada ADR vigente desde la sección correspondiente.
3. **Given** el conjunto completo de entregables, **When** se hace la revisión cruzada con T-02 (dominio), la constitución y los contratos, **Then** no existe ninguna decisión contradictoria.
4. **Given** el registro de aprobación, **When** se audita, **Then** consta la aprobación del equipo para los ADRs y para la definición de SLI/SLO/SLA.

---

### Edge Cases

- **Una decisión cambia después de aprobada**: el cambio exige un ADR nuevo que marca al anterior como reemplazado (superseded), nunca una edición silenciosa; cambiar de stack tras iniciar los servicios sin ADR y aprobación del equipo está fuera de alcance.
- **El enunciado vuelve a cambiar la lista de opciones permitidas**: los ADRs citan la revisión del enunciado contra la que se decidieron; una revisión nueva obliga a revalidar el ADR afectado, no a reescribir la historia.
- **Dos ADRs entran en conflicto** (p. ej., uno de seguridad contra uno de mensajería): la constitución gana; el ADR que la contradice queda bloqueado hasta corregirse.
- **Un SLO resulta inalcanzable en la prueba local**: se ajusta mediante enmienda aprobada por el equipo con la razón registrada; no se relaja en silencio antes de T-24.
- **Una alternativa descartada se vuelve obligatoria en una revisión futura del enunciado**: el ADR vigente queda superseded por uno nuevo que cita la revisión; no se edita el original.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El registro MUST contener al menos un ADR por cada decisión que cambie la forma de implementar o desplegar: stack backend (TypeScript + NestJS), frontend (Vue + Nuxt), broker (RabbitMQ), persistencia (PostgreSQL, una base por servicio, fuera del cluster), contenedores (Docker), cluster local (kind), arquitectura interna (Clean Architecture por servicio), herramientas de diagramación (Lucid principal; Mermaid como fuente versionable — **PlantUML se evalúa y se descarta**, ver R9), comunicación (eventos y request/reply asíncrono; nunca HTTP entre servicios), saga (coreografía para la transferencia) y autenticación (JWT).
- **FR-002**: Cada ADR MUST registrar contexto, decisión, alternativas consideradas con razón técnica de descarte, y consecuencias; MUST citar la sección y página del enunciado revisado (2026-08-13) que la restringe, cuando exista.
- **FR-003**: El ADR de stack MUST citar explícitamente las tres opciones de lenguaje (Java, TypeScript, Go) y las dos de framework (Spring Boot 4, NestJS) permitidas por §4.2 Flexibilidad de diseño (p. 13) y por la tabla de §4.3 (p. 14), y justificar la vigencia de TypeScript + NestJS frente a ellas.
- **FR-004**: El ADR de mensajería MUST citar explícitamente las cuatro opciones de broker (Kafka, RabbitMQ, NATS, gRPC async) según §4.2 (p. 8) y §4.3 (p. 14), y justificar RabbitMQ frente a las tres alternativas; el trade-off aceptado (menor capacidad de streaming histórico) MUST quedar registrado.
- **FR-005**: El ADR de autenticación MUST fijar las cinco respuestas que el ticket exige, con estos valores aprobados: librería del ecosistema NestJS para firmar y verificar; **algoritmo HS256** con secreto compartido; **tiempo de expiración** con un valor numérico concreto y sin refresh token; **emisión en el Gateway** a partir de los claims que Customer Service devuelve por `customer.authenticate`; **validación únicamente en el Gateway**, con la identidad verificada propagada en el sobre de mensaje. MUST registrar que la revocación antes de expiración queda fuera de alcance de esta fase.
- **FR-005a**: El ADR de autenticación MUST declarar como consecuencias: (a) que el sobre de mensaje incorpora un campo de identidad verificada cuyo formato define T-05; (b) que el modelo de confianza asume que ningún productor publica al broker sin pasar por el Gateway; y (c) que el secreto de firma se gestiona como Secret de Kubernetes y nunca se versiona en el repositorio.
- **FR-005b**: El ADR de autenticación MUST distinguir explícitamente el **JWT de sesión** que aquí se decide del **token de activación por correo** ya decidido en T-02 (24 h, un solo uso, generado y validado por Customer Service), y MUST NOT redefinir este último.
- **FR-006**: La matriz de decisiones MUST listar cada decisión con sus alternativas, trade-off aceptado y consecuencias, y MUST citar como reglas separadas la penalización del 100 % por base compartida (§8.3, p. 27) y la del 50 % por microservicio conectado a múltiples bases (§4.2, p. 13).
- **FR-007**: La definición SRE MUST contener los seis SLI con indicador, fórmula y fuente (disponibilidad del Gateway; tasa de finalización de transferencias; duración de Saga P50/P95; latencia de eventos; tasa de retry y DLQ por cola; consistencia funcional), los cinco SLO con umbral numérico, y el SLA con alcance académico limitado a la demostración.
- **FR-008**: `ARCHITECTURE.md` MUST enlazar cada ADR vigente desde la sección correspondiente, y los comandos definitivos de desarrollo, pruebas y despliegue MUST quedar registrados en el monorepo.
- **FR-008a**: La sección "Current State" de `ARCHITECTURE.md` MUST dejar de afirmar que el Gateway y los servicios backend son trabajo futuro y que `apps/web/` es el starter de Nuxt: el workspace ya contiene `apps/gateway`, los cinco servicios bajo `apps/services/` y los tres paquetes compartidos bajo `apps/packages/` como scaffolding (health checks, validación de entorno, sobre de mensaje compartido; las capas `domain` y `application` están vacías a propósito). Una afirmación desactualizada aquí es exactamente la "inconsistencia entre diagramas y código" que §8.3 (p. 27) penaliza con el 25 %.
- **FR-009**: La aprobación del equipo MUST quedar registrada tanto para los ADRs como para la definición de SLI/SLO/SLA.
- **FR-010**: Ningún entregable MUST contradecir la constitución, el modelo de dominio de T-02 (`docs/domain/`), ni los contratos de T-05 cuando existan; la revisión de consistencia con T-02 y T-05 MUST quedar como evidencia.
- **FR-011**: El registro MUST declarar que las decisiones son restricciones de diseño para las specs siguientes, y que cambiar una decisión aprobada exige un ADR nuevo que marque al anterior como superseded.

### Key Entities *(include if feature involves data)*

- **ADR (Architecture Decision Record)**: unidad del registro. Atributos: identificador, título, estado (propuesto, aprobado, superseded), contexto, decisión, alternativas con razón de descarte, consecuencias, referencias al enunciado, aprobación del equipo.
- **Matriz de decisiones**: vista consolidada decisión → alternativas → trade-off → consecuencias, incluidas las penalizaciones del enunciado que la decisión evita.
- **SLI**: indicador con fórmula y fuente de datos. **SLO**: objetivo con umbral numérico sobre uno o más SLI. **SLA**: compromiso observable con alcance declarado (académico, solo demostración).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las decisiones vigentes listadas en el ticket (11 decisiones, incluida autenticación) tienen al menos un ADR aprobado; ninguna decisión que cambie implementación o despliegue carece de ADR.
- **SC-002**: El 100 % de los ADRs tienen al menos una alternativa descartada con razón técnica; los ADRs de stack y mensajería citan textualmente las listas cerradas del enunciado (3 lenguajes, 2 frameworks, 4 brokers).
- **SC-003**: El ADR de autenticación responde las cinco preguntas del ticket (librería, algoritmo, expiración, emisión, validación) sin dejar ninguna en "a definir", y registra además las tres consecuencias de FR-005a y la distinción de FR-005b frente al token de activación de T-02.
- **SC-004**: Los 6 SLI tienen indicador, fórmula y fuente; los 5 SLO tienen umbral numérico; el SLA declara su alcance académico. La revisión contra el criterio 2.9 de la rúbrica no encuentra definiciones vagas.
- **SC-005**: La revisión cruzada de entregables contra la constitución, `docs/domain/` (T-02) y los contratos (T-05) encuentra 0 contradicciones.
- **SC-006**: `ARCHITECTURE.md` enlaza el 100 % de los ADRs vigentes, y la aprobación del equipo queda registrada para ADRs y SLI/SLO/SLA.

## Assumptions

- Los ADRs viven en **`docs/architecture/adr/`** como archivos Markdown numerados (`ADR-001-...`), con índice propio en `docs/architecture/adr/README.md`, una fila en `docs/design-docs/index.md` y enlaces desde `ARCHITECTURE.md`. Se escriben **en inglés**. *(Corregido durante `/speckit-plan`: este supuesto decía `docs/adr/` y "en español". Ambas premisas eran falsas — `docs/architecture/README.md` ya se declara el hogar de los ADRs y carga el marcador `Blocked … Arrives with: T-03 and T-07`, y FR-020 de T-01 obliga a inglés en todo `docs/`, como ya cumplen `docs/domain/`, `ARCHITECTURE.md` y `RELIABILITY.md`. Ver R1 y R2 en [research.md](research.md).)*
- La aprobación del equipo se evidencia mediante revisión del pull request de la rama `feature/T-03`; no se requiere un acta adicional.
- La librería concreta de JWT (p. ej. `@nestjs/jwt` + `passport-jwt`) se fija en el ADR como parte de la decisión; la spec solo exige que quede registrada. Como la validación ocurre únicamente en el Gateway, `passport-jwt` solo se requiere ahí.
- **La expiración se asume en 1 hora, sin refresh token**, como default razonable para una demostración académica en la que la revocación queda fuera de alcance: suficiente para completar el flujo de transferencia en la demo y corto frente a la imposibilidad de invalidar. El ADR puede fijar otro valor, pero MUST registrar uno numérico y su razón.
- El punto de emisión, el algoritmo y el punto de validación **ya no son supuestos**: son decisiones del equipo tomadas el 2026-08-14 y registradas en la User Story 2.
- Los comandos definitivos de desarrollo, pruebas y despliegue son los del workspace pnpm ya documentados en `AGENTS.md`/`README.md`, más los de infraestructura local que T-06 concrete; T-03 los consolida, no los inventa.
- **T-24 solo medirá y reportará los SLI/SLO/SLA**; su definición se aprueba aquí y no se redefine después salvo enmienda registrada. El cuerpo del issue #10 dice "T-18" porque fue migrado de Notion antes de la renumeración de tickets (commit `b6103cf`, que dividió T-07 en un ticket por diagrama y corrió el resto); la numeración vigente en el repo es **T-24**, como la usan `docs/RELIABILITY.md`, `docs/METHODOLOGY.md` (hito H6), `docs/QUALITY_SCORE.md` y `docs/TECH_DEBT.md` (TD-006). Al cerrar T-03 debe actualizarse la marca de bloqueo de `docs/RELIABILITY.md`, que hoy declara "Blocked … Arrives with: T-03".
- El modelo de dominio de T-02 ya delegó explícitamente en T-03 la emisión, firma y expiración del JWT (`docs/domain/README.md`, fila "JWT issuance, signing, expiry | T-03") y dejó el flujo de login terminando en *claims*, no en un token: `customer.authenticate` "replies with claims, not a token" (`docs/domain/message-catalog.md`) y "el Gateway convierte los claims en una sesión" (`docs/domain/use-cases.md`). El ADR de autenticación se decide **dentro de ese marco**; si la decisión elegida lo contradijera, T-02 debe enmendarse en el mismo cambio.
- El token de activación por correo (24 h, un solo uso, generado y validado por Customer Service) es una decisión **ya tomada en T-02** y es independiente del JWT de sesión que decide este ADR; el ADR no lo redefine.
