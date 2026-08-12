# Feature Specification: Base documental de Bank USAC (T-01)

**Feature Branch**: `001-bank-usac-baseline`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "trabajemos el ticket T-01, analizalo completamente y el estado del repositorio actual, ademas realizame preguntas segun sea necesario"

**Ticket origen**: [T-01 Adaptar el scaffold al proyecto Bank USAC](https://app.notion.com/p/3b84e0fc97968160baceeda0e60d7019) — responsable Marcos Bonifasi, entrega 2026-08-13, bloquea T-02 a T-07.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entender qué se construye y quién responde por cada pieza (Priority: P1)

Un integrante del equipo —o un agente que abre el repositorio con contexto vacío— necesita saber, sin preguntar en el chat y sin leer el PDF completo, qué es Bank USAC, con qué stack se construye, qué restricciones no puede violar y quién es el responsable primario de cada componente.

**Why this priority**: Es lo que desbloquea T-02 a T-07. Mientras `ARCHITECTURE.md` diga "Application architecture has not been selected yet" y el README se presente como "The Crazy Template", cualquier decisión de diseño posterior se toma sobre un vacío y cada agente vuelve a inventar el contexto.

**Independent Test**: Se entrega solo. Una persona que nunca vio el proyecto lee `README.md` y `ARCHITECTURE.md` y responde correctamente: cuáles son los cinco microservicios, por qué no pueden hablarse de forma síncrona, dónde viven las bases de datos y a quién se le pregunta por el Payment Service.

**Acceptance Scenarios**:

1. **Given** un lector sin contexto previo, **When** lee `ARCHITECTURE.md`, **Then** identifica los cinco microservicios, el Gateway como único punto de entrada, la mensajería asíncrona, las cinco bases independientes fuera del cluster y la Saga por coreografía, sin encontrar texto de plantilla del scaffold.
2. **Given** un lector que busca un responsable, **When** consulta el registro de ownership, **Then** encuentra exactamente un responsable primario para cada componente (cinco servicios, Gateway, frontend, infraestructura/SRE, documentación).
3. **Given** una restricción del enunciado, **When** el lector la busca en la documentación, **Then** la encuentra enunciada y con referencia a la sección del PDF que la exige.
4. **Given** el repositorio después del cambio, **When** se ejecuta la construcción de la aplicación web existente, **Then** sigue pasando como antes del cambio.
5. **Given** la lista de dependencias de la aplicación web, **When** se contrasta contra las decisiones registradas, **Then** cada una corresponde a una decisión o está marcada como justificación pendiente con el ticket que la resolverá.

---

### User Story 2 - Saber cómo trabaja el equipo (Priority: P2)

Los tres integrantes y el evaluador necesitan que la forma de trabajo esté escrita: en qué sprint estamos, contra qué hito, dónde vive el estado de cada tarea, cuándo una tarea está terminada y cómo se reporta un bloqueo.

**Why this priority**: El criterio 1.1 de la rúbrica (§8.2, p. 21) exige evidenciar distribución de responsabilidades y metodología ágil. Sin esto escrito, el trabajo puede estar hecho y aun así no ser calificable. Es P2 porque no bloquea el diseño técnico, pero sí la nota.

**Independent Test**: Se entrega solo. Un evaluador lee la metodología y puede verificarla contra el tablero de Notion y contra el historial de commits sin que nadie se la explique.

**Acceptance Scenarios**:

1. **Given** la metodología escrita, **When** un integrante busca la fecha objetivo de su fase, **Then** encuentra los seis hitos con fecha y qué tickets cubre cada uno.
2. **Given** un ticket cualquiera del tablero, **When** se pregunta si está terminado, **Then** la definición de terminado escrita permite responder sí o no sin interpretación: criterios de aceptación verificados y evidencia enlazada en el ticket.
3. **Given** un integrante bloqueado, **When** consulta la metodología, **Then** sabe que debe reportarlo en el ticket el mismo día y no al cierre del sprint.
4. **Given** los tres integrantes, **When** se cierra el ticket, **Then** consta que los tres conocen la metodología.

---

### User Story 4 - Construir interfaz sin inventar el diseño (Priority: P2)

> El número es un identificador estable, no un orden. Las historias se presentan por prioridad: US1, US2, US4, US3. `tasks.md` las ejecuta en ese mismo orden.

Quien construya una pantalla —integrante o agente— necesita que el color, la tipografía, el espaciado, los componentes y los estados ya estén decididos, para no inventar una dirección visual distinta en cada pantalla.

**Why this priority**: cinco frontends los construyen tres personas distintas en paralelo (T-08 a T-13). Sin un style guide previo, el resultado son cinco interfaces que no parecen el mismo producto, y rehacerlo después cuesta más que decidirlo ahora. Comparte prioridad con la metodología porque ambas son condiciones de trabajo en paralelo. The owner-approved baseline is now recorded in `docs/DESIGN.md`.

**Independent Test**: se entrega solo. Se toma una pantalla cualquiera del sistema y se comprueba que cada decisión visual que la construye está en `docs/DESIGN.md`, y que ninguna se decidió durante la implementación.

**Acceptance Scenarios**:

1. **Given** un agente a punto de crear un componente, **When** consulta `AGENTS.md`, **Then** encuentra la instrucción de leer `docs/DESIGN.md` primero y el enlace para hacerlo.
2. **Given** una operación bancaria aceptada pero no confirmada, **When** se busca cómo representarla, **Then** el style guide define el estado pendiente como distinto del estado de éxito.
3. **Given** un monto y una fecha en pantalla, **When** se verifican contra el style guide, **Then** su formato está fijado y no depende de quien programó la pantalla.
4. **Given** an area of the style guide that is not approved in a future change, **When** the document is read, **Then** it appears as a named blocking question rather than generic filler.

---

### User Story 3 - Saber a qué documento ir y cuál está vigente (Priority: P3)

Un agente o un integrante que va a escribir o consultar documentación necesita saber qué archivo es autoridad, cuál es plantilla reutilizable, cuál es generado y cuál es normativo del harness, y quién responde por cada uno.

**Why this priority**: El repositorio tiene más de cien archivos Markdown, la mayoría del andamiaje instalado. Sin clasificación, un agente edita una plantilla creyendo que es documentación viva, o cita como vigente un documento que quedó obsoleto. Es P3 porque el daño es acumulativo, no inmediato.

**Independent Test**: Se entrega solo. Se toma cualquier ruta `.md` del repositorio y el inventario dice su clase y su responsable.

**Acceptance Scenarios**:

1. **Given** el inventario, **When** se elige al azar cualquier archivo `.md` del repositorio, **Then** aparece clasificado y con responsable.
2. **Given** `AGENTS.md`, **When** un agente busca dónde está la dirección de diseño o el modelo de seguridad, **Then** encuentra el enlace y una línea que dice cuándo consultarlo.
3. **Given** dos documentos que se contradicen, **When** se aplica el cambio, **Then** la contradicción está resuelta o marcada explícitamente con su responsable.

---

### Edge Cases

- **Falta información para completar una sección.** No se inventa: la sección se marca como bloqueada, se nombra qué falta y a quién se le pidió, y el ticket se cierra parcialmente. Esta es la Regla de No Invención del ticket y gobierna todo lo demás.
- **El style guide depende de decisiones que solo su responsable puede tomar.** `docs/DESIGN.md` is an always-delivered artifact. Marcos Bonifasi supplied and approved the baseline values used in T-01; future unapproved values must be named as blocking questions rather than invented.
- **Contradicciones ya presentes en el repositorio.** `README.md` afirma que Spec Kit "is not initialized in this repository yet" y `docs/TECH_DEBT.md` (TD-003) lo repite, pero `.specify/` existe y está en uso. Ambos son falsos hoy y deben corregirse en este cambio.
- **Documentos que no se tocan.** `docs/templates/` y `docs/generated/` no se sobrescriben, aunque estén vacíos o desactualizados. `docs/templates/base-ticket.md` está vacío (0 líneas): se registra como hallazgo, no se rellena aquí.
- **Dependencias instaladas sin decisión registrada.** `apps/web/` declara módulos que ninguna decisión conocida justifica. Documentarlas como vigentes sería inventar una decisión, así que se retiran. La única superviviente es el exportador de métricas, retenido por su vínculo con el trabajo de observabilidad ya planificado y marcado como justificación pendiente. Retirarlas es un cambio de código dentro de un ticket documental: obliga a reverificar la construcción y a que ese sea el único código tocado.
- **La aplicación web no usa ninguna de esas dependencias.** Su única vista muestra la pantalla de bienvenida del framework, por lo que la retirada no debería romper nada. Si aun así la construcción falla, el hallazgo se reporta y la dependencia se restituye antes que forzar el cambio.
- **El alcance se desborda hacia implementación.** Este trabajo no crea código de negocio ni la estructura del monorepo backend: eso es T-04. Si aparece la tentación, se registra como tarea de otro ticket.

## Requirements *(mandatory)*

### Functional Requirements

**Identidad y arquitectura**

- **FR-001**: `ARCHITECTURE.md` MUST describir el sistema Bank USAC —los cinco microservicios por nombre, el API Gateway, el frontend, la mensajería y la propiedad de datos— y MUST NOT conservar texto de plantilla del scaffold.
- **FR-002**: La documentación MUST registrar las **ocho** restricciones no negociables del enunciado, cada una con referencia verificada a la sección del PDF que la exige: (1) exactamente cinco microservicios; (2) una base de datos por servicio, sin acceso a la base de otro; (3) bases de datos externas al cluster; (4) comunicación entre servicios exclusivamente asíncrona, sin llamadas HTTP ni acoplamiento directo; (5) API Gateway como único punto de entrada y sin lógica de negocio; (6) Saga obligatorio para operaciones distribuidas; (7) despliegue en un cluster local de Kubernetes; (8) DevOps y SRE desde el diseño, con idempotencia, retries, manejo de errores, consistencia eventual y trazabilidad por identificador de correlación en cada servicio.
- **FR-002a**: La documentación MUST registrar también las conductas que el enunciado penaliza explícitamente: mezclar responsabilidades entre servicios, servicios "god object", comunicación directa entre servicios, falta de eventos claros y falta de modelo de dominio.
- **FR-003**: `README.md` MUST identificar el proyecto —nombre, curso, sección y grupo, integrantes con carnet— y explicar la organización del monorepo y dónde está cada documento vigente. MUST NOT seguir presentándose como el scaffold genérico.
- **FR-004**: Las decisiones tecnológicas registradas MUST coincidir con las ya acordadas por el equipo, sin agregar ni sustituir ninguna.

**Responsabilidad**

- **FR-005**: MUST existir un registro de ownership con exactamente un responsable primario por componente: Customer Service, Account Service, Transaction Service, Payment Service, Notification & Audit Service, API Gateway, frontend, infraestructura/SRE y documentación.
- **FR-006**: El registro MUST indicar también qué trabajo es de todo el equipo (contratos de eventos, integración, pruebas, revisión final).

**Metodología (evidencia rúbrica 1.1)**

- **FR-007**: La metodología de trabajo MUST quedar escrita en el repositorio e incluir: cadencia de sprints semanales, los seis hitos con su fecha y los tickets que cubren, el tablero de Notion como fuente de verdad del estado, la definición de terminado, el commit por integrante como evidencia de distribución del trabajo, y la regla de reportar bloqueos el mismo día.
- **FR-008**: La metodología documentada MUST ser verificable contra evidencia externa —el tablero y el historial de commits— sin requerir explicación adicional.

**Navegabilidad documental**

- **FR-009**: MUST existir un inventario de todos los archivos `.md` del repositorio, cada uno con su clase (vigente del proyecto, plantilla reutilizable, generado, normativo del harness, o instalado por una herramienta externa) y su responsable.
- **FR-010**: `AGENTS.md` MUST incluir una sección que enlace cada documento vigente del proyecto y explique en una línea cuándo consultarlo.
- **FR-011**: Las contradicciones documentales existentes MUST quedar resueltas en este cambio, incluidas las afirmaciones de que Spec Kit no está inicializado.
- **FR-012**: El registro de deuda técnica MUST reflejar la realidad al cierre: se cierran los ítems que dejaron de ser ciertos y se abren los hallazgos que este trabajo detecta y no resuelve.

**Reglas de proceso**

- **FR-013**: Todo contenido nuevo MUST ser rastreable a una de estas cuatro fuentes: el PDF del enunciado, una decisión ya registrada por el equipo, el código existente en el repositorio, o información entregada explícitamente por el responsable del documento.
- **FR-014**: Cuando falte información, el sistema de documentación MUST marcar la sección como bloqueada indicando qué falta y a quién se le solicitó, en lugar de completarla con supuestos.
- **FR-015**: `docs/DESIGN.md` MUST cambiar únicamente con contenido proporcionado o aprobado por su responsable, Marcos Bonifasi. Lo que el responsable no haya decidido MUST registrarse como pregunta bloqueante, no completarse con supuestos.

- **FR-016**: `docs/templates/` y `docs/generated/` MUST NOT ser sobrescritos por este trabajo.
- **FR-017**: Los documentos de proyecto MUST NOT contener marcadores de pendiente (`TBD`, `TODO`, `to be defined`) sin una justificación explícita y un responsable.

**Límites**

- **FR-018**: Este trabajo MUST NOT crear código de negocio, estructura de servicios backend, ni especificaciones de funcionalidades.
- **FR-019**: El único cambio de código permitido es la retirada de dependencias de FR-021. El trabajo MUST NOT modificar ningún otro archivo bajo `apps/web/`, con la única excepción del archivo de bloqueo de dependencias, que la instalación regenera sola.

**Idioma**

- **FR-020**: La documentación duradera del repositorio —`README.md`, `ARCHITECTURE.md`, `AGENTS.md` y `docs/`— MUST redactarse en inglés, de forma homogénea con el andamiaje existente. El tablero de tickets y la comunicación del equipo permanecen en español; ningún documento MUST quedar a medio traducir.

**Limpieza de dependencias**

- **FR-021**: La aplicación web MUST declarar únicamente las dependencias que una decisión registrada o el funcionamiento actual justifican. Las que existen sin justificación —editor de texto enriquecido, visor de PDF, librería de animación y `@jasy/nuxt`— MUST ser retiradas tanto de las dependencias como de la configuración de módulos.
- **FR-022**: El exportador de métricas MUST conservarse por su relación con el trabajo de observabilidad ya planificado, y su justificación MUST quedar registrada como pendiente a resolver en ese ticket, no como decisión aceptada.
- **FR-023**: Después de la limpieza, la instalación de dependencias y la construcción de la aplicación web MUST completarse con éxito, y su salida real MUST adjuntarse como evidencia.

**Restricciones como principios ejecutables**

- **FR-024**: Las restricciones no negociables MUST quedar registradas en dos lugares con el mismo contenido: en `ARCHITECTURE.md` como descripción del sistema, y como principios de la constitución del flujo de especificación, que hoy es una plantilla sin llenar.
- **FR-025**: La constitución MUST quedar redactada de modo que un spec o un plan posterior pueda evaluarse contra ella y resultar conforme o no conforme, sin interpretación.

**Style guide (fuente de verdad visual)**

- **FR-026**: `docs/DESIGN.md` MUST contener el style guide aprobado de Bank USAC, cubriendo ocho áreas: principios de diseño e interacción propios del dominio bancario; tokens de color primario, neutro y semánticos; tipografía con familia y escala, incluida la variante numérica para montos; espaciado, contenedor y breakpoints; convenciones de componentes de la librería de UI para formularios, tablas, estados, feedback, modales y carga de archivos; los estados de interfaz obligatorios; accesibilidad mínima; y los formatos de dominio.
- **FR-027**: Los estados de interfaz obligatorios MUST incluir el caso asíncrono propio de este sistema: una operación aceptada no es una operación completada, y la interfaz MUST distinguir inicial, vacío, validación local, enviando, pendiente, éxito, error de negocio, timeout y reintento.
- **FR-028**: Los formatos de dominio MUST fijar montos en quetzales con dos decimales y fechas en configuración regional de Guatemala.
- **FR-029**: Los tokens definidos MUST ser aplicables por el ticket que construye el shell de frontend, sin reinterpretación.
- **FR-030**: Cualquiera de las ocho áreas que el responsable no haya decidido MUST aparecer como pregunta bloqueante nombrada, y no como texto genérico de relleno.
- **FR-031**: `AGENTS.md` MUST enlazar `docs/DESIGN.md` de forma permanente, con la instrucción explícita de consultarlo antes de crear o modificar cualquier interfaz —páginas, componentes, estilos o textos. Si `CLAUDE.md` replica esa sección, el enlace MUST estar también ahí.
- **FR-032**: Ese enlace MUST NOT eliminarse en cambios documentales posteriores sin decisión explícita del equipo, y esa protección MUST quedar escrita junto al enlace, no solo en este spec.

**Adaptación de los documentos heredados del scaffold**

- **FR-033**: Los documentos que el scaffold dejó como guías genéricas —sentido de producto, frontend, seguridad, fiabilidad y calificación de calidad— MUST adaptarse a Bank USAC hasta donde llegue su fuente autorizada, y lo que exceda esa fuente MUST marcarse como bloqueado con su responsable y el ticket que lo resolverá.
- **FR-034**: Ningún documento adaptado MUST quedar declarado vigente mientras conserve texto genérico del scaffold que ya no describe a este proyecto.

### Key Entities

- **Documento**: una ruta `.md` del repositorio. Atributos: clase, responsable, estado (vigente, plantilla, generado, normativo, externo), última revisión.
- **Componente**: una pieza del sistema con dueño. Atributos: nombre, responsable primario, tipo (servicio, gateway, frontend, infraestructura, documentación).
- **Restricción no negociable**: una regla que el diseño no puede violar. Atributos: enunciado, origen (sección y página del PDF), consecuencia si se viola.
- **Hito**: un punto de control del cronograma. Atributos: identificador, fecha, tickets que cubre.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona que nunca vio el proyecto responde correctamente, en menos de diez minutos y usando solo el repositorio, qué es Bank USAC, cuáles son sus cinco servicios y por qué no pueden comunicarse de forma síncrona.
- **SC-002**: Los nueve componentes tienen exactamente un responsable primario identificable en menos de un minuto.
- **SC-003**: El 100% de las restricciones no negociables está enunciado en el repositorio y es rastreable a una sección del enunciado.
- **SC-004**: El 100% de los archivos `.md` del repositorio queda cubierto por el inventario, sea por una fila propia o por una regla de directorio, y ninguno queda sin clase. El responsable nominal es obligatorio solo para los documentos vivos del proyecto; el andamiaje instalado se cubre por regla.
- **SC-005**: Cero documentos de proyecto contienen marcadores de pendiente sin justificación y responsable.
- **SC-006**: Cero afirmaciones contradictorias entre `README.md`, `AGENTS.md`, `CLAUDE.md` y `ARCHITECTURE.md` sobre el estado del repositorio o del flujo de trabajo.
- **SC-007**: Los tres integrantes confirman por escrito, en el ticket, que conocen la metodología documentada.
- **SC-008**: La construcción de la aplicación web sigue pasando después de la limpieza de dependencias, con la salida del comando adjuntada como evidencia.
- **SC-009**: Los tickets T-02 a T-07 pueden iniciarse sin solicitar contexto adicional por chat.
- **SC-010**: Cada dependencia declarada por la aplicación web es rastreable a una decisión registrada, o está explícitamente marcada como justificación pendiente con el ticket que la resolverá. Cero excepciones sin marcar.
- **SC-011**: Un spec o un plan posterior puede evaluarse contra la constitución y recibir un veredicto de conformidad por cada restricción no negociable, sin interpretación.
- **SC-012**: Cero documentos duraderos del repositorio mezclan idiomas.
- **SC-013**: Las ocho áreas del style guide están cubiertas: cada una con contenido decidido, o con una pregunta bloqueante nombrada. Cero áreas con texto genérico.
- **SC-014**: Quien construya una pantalla toma cero decisiones visuales que no estén ya en `docs/DESIGN.md`: color, tipografía, espaciado, componente, estado y formato salen del documento.
- **SC-015**: Un agente que va a tocar interfaz llega a `docs/DESIGN.md` desde `AGENTS.md` en un salto, con la instrucción de consultarlo antes de escribir.

## Assumptions

- El responsable de `docs/DESIGN.md` es Marcos Bonifasi, confirmado por él mismo el 2026-08-11. El documento **se entrega siempre**: lo que puede quedar pendiente es un área concreta, no el archivo entero. Un área sin decidir se marca como pregunta bloqueante nombrada (FR-030) y el documento se registra como vigente con esas marcas. FR-015 sigue vigente aunque el responsable y quien ejecuta el ticket sean la misma persona.
- Las decisiones tecnológicas y el ownership provienen de lo ya acordado por el equipo; este trabajo las transcribe al repositorio, no las revisa ni las amplía.
- El nombre del directorio del repositorio ya cumple la convención exigida por el enunciado, por lo que no se requiere renombrarlo.
- El inventario clasifica los archivos del andamiaje instalado (roles, habilidades, plantillas de la herramienta de especificación) como externos: se listan y se les asigna clase, pero su contenido no se edita en este trabajo.
- `docs/design-docs/` es hoy ambiguo: la guía de diseño lo declara destino de decisiones de diseño y el rol de arquitectura lo declara destino de registros de decisión arquitectónica. Se asume que este trabajo solo documenta la ambigüedad; resolverla corresponde al ticket que registra las decisiones arquitectónicas.
- La regla de idioma de FR-020 cubre la documentación duradera del repositorio. Los artefactos de trabajo bajo `specs/` son documentos de trabajo del equipo y se redactan en el idioma en que se trabaja la tarea; este spec está en español por esa razón. Si el equipo prefiere homogeneidad total, la traducción es un cambio mecánico posterior.
- La aplicación web existente no se altera más allá de la retirada de dependencias de FR-021: no se agregan vistas, rutas ni configuración.
- El exportador de métricas se conserva por juicio, no por decisión registrada. Se marca como pendiente en lugar de asumirse aceptado, conforme a FR-014.
- El estado verificado del repositorio corresponde al 2026-08-11 y se reverifica al ejecutar el trabajo.

## Dependencies

- El enunciado del proyecto disponible en el repositorio como material de referencia.
- Las decisiones tecnológicas, el ownership, el cronograma y los hitos registrados por el equipo fuera del repositorio.
- La aprobación del responsable de diseño para cualquier future change to `docs/DESIGN.md`; the T-01 baseline is approved and recorded.
