# Phase 1 — Contracts: qué debe contener cada documento entregado

La "interfaz pública" de este feature son los documentos. Este contrato fija, para cada uno, sus secciones obligatorias, su fuente autorizada y lo que tiene prohibido afirmar. Es lo que convierte la Regla de No Invención (FR-013, FR-014) en algo revisable en un diff en lugar de una buena intención.

**Fuentes autorizadas**, y ninguna otra:

- **E** — el enunciado, `docs/references/780_Proyecto_1_2S2026.pdf`, citando sección y página verificadas.
- **D** — decisiones registradas por el equipo en la página Bank USAC del tablero.
- **C** — el código y los archivos existentes en el repositorio, verificados al escribir.
- **R** — información entregada explícitamente por el responsable del documento.

---

## `ARCHITECTURE.md` — reescritura completa

**Fuentes**: E, D, C. **Responsable**: Marcos Bonifasi.

| Sección | Contenido obligatorio |
|---|---|
| System | Qué es Bank USAC en tres o cuatro líneas: sistema bancario distribuido, cinco microservicios, un punto de entrada |
| Services | Los cinco servicios por nombre, con la responsabilidad que el enunciado les asigna y la propiedad de sus datos |
| Non-Negotiable Constraints | Las ocho restricciones, más las conductas penalizadas, cada una con su cita verificada. Enlaza a la constitución como fuente ejecutable |
| Stack | Backend NestJS/TypeScript, frontend Nuxt, RabbitMQ, PostgreSQL por servicio, Docker, kind, Clean Architecture por servicio, Saga por coreografía |
| Layering | Las capas de Clean Architecture y qué va en cada una |
| Dependency Rules | Dirección permitida entre capas y entre servicios. Debe incluir la prohibición de acceso cruzado a bases de datos y de llamadas HTTP entre servicios |
| Current State | Qué existe hoy de verdad y qué todavía no |
| Related Docs | Enlaces a los documentos vigentes |

**Prohibido**: describir la estructura de directorios del monorepo backend (decisión de T-04); nombrar tecnologías fuera de lo permitido por §4.3; conservar cualquier frase de la plantilla del scaffold; declarar como existente algo que no existe.

---

## `README.md` — reescritura completa

**Fuentes**: E, D, C. **Responsable**: Marcos Bonifasi.

| Sección | Contenido obligatorio |
|---|---|
| Identidad | Nombre del proyecto, curso, sección y grupo. Debe ser inequívoco para quien califica, aunque el resto esté en inglés |
| Team | Los tres integrantes con carnet y rol |
| What This Is | Qué construye el sistema, en lenguaje de producto |
| Repository Layout | Organización del monorepo y qué vive en cada directorio |
| Documentation | Índice enlazado de los documentos vigentes |
| Development | Los comandos reales, y la ausencia declarada de test y lint |

**Prohibido**: seguir presentándose como el scaffold genérico; afirmar que Spec Kit no está inicializado; describir directorios que no existen.

---

## `docs/OWNERSHIP.md` — nuevo

**Fuentes**: D. **Responsable**: Marcos Bonifasi.

| Sección | Contenido obligatorio |
|---|---|
| Primary Owners | Tabla de nueve filas, una por componente, con exactamente un responsable primario |
| Shared Work | Lo que es de todo el equipo: contratos de eventos, integración, pruebas, revisión final |
| How To Use This | Qué significa ser responsable primario: quién decide, quién revisa, a quién se escala |

**Prohibido**: dos responsables para un componente; dejar un componente sin responsable; asignar personas fuera del equipo registrado.

---

## `docs/METHODOLOGY.md` — nuevo

**Fuentes**: D, E. **Responsable**: Marcos Bonifasi.

| Sección | Contenido obligatorio |
|---|---|
| Cadence | Sprints semanales, alineados a los hitos |
| Milestones | Los seis hitos con fecha y tickets, contra el cronograma del enunciado |
| Source Of Truth | El tablero de Notion mantiene el estado; transiciones Not started → In progress → Done |
| Definition Of Done | Criterios de aceptación verificados **y** evidencia enlazada en el ticket |
| Evidence Of Distribution | Cada integrante commitea en su propio servicio; los commits son la evidencia del criterio 1.1 |
| Blockers | Se reportan en el ticket el mismo día |

**Prohibido**: describir ceremonias que el equipo no hace; inventar métricas de velocidad; contradecir las fechas de los hitos registrados.

---

## `docs/DOC_INVENTORY.md` — nuevo

**Fuentes**: C. **Responsable**: Marcos Bonifasi.

| Sección | Contenido obligatorio |
|---|---|
| Classes | Definición de las cinco clases de [data-model.md](../data-model.md#documento) |
| Project Documents | Tabla por archivo: ruta, clase, responsable, estado, última revisión |
| Directory Rules | Reglas por glob para el andamiaje instalado |
| Coverage Check | El comando que demuestra que no queda ningún `.md` sin cubrir, con su salida esperada vacía |

**Prohibido**: filas para archivos que no existen; declarar `current` un documento con secciones bloqueadas sin decir cuáles.

---

## `AGENTS.md` — edición acotada

**Fuentes**: C. **Responsable**: Marcos Bonifasi.

Se agrega una sección **Project Documentation**: un enlace por documento vigente y una línea que diga cuándo consultarlo. Se corrige el bloque **Repo Status**, que hoy declara `ARCHITECTURE.md` como plantilla.

**Prohibido**: expandir el archivo con conocimiento duradero — eso va a `docs/`, y el propio archivo lo prohíbe; tocar las secciones de layout o de mantenimiento, que siguen siendo correctas.

---

## `CLAUDE.md` — edición acotada

**Fuentes**: C. **Responsable**: Marcos Bonifasi.

Solo el bloque **Repo Status**, que quedará obsoleto en cuanto `ARCHITECTURE.md` deje de ser plantilla. El resto del archivo sigue siendo cierto.

---

## `docs/PRODUCT_SENSE.md`, `FRONTEND.md`, `SECURITY.md`, `RELIABILITY.md` — adaptación parcial

**Fuentes**: E, C. **Responsable**: Marcos Bonifasi.

Cada uno se llena hasta donde llega su fuente, según el corte de [research.md](../research.md#r6--cuánto-se-puede-llenar-de-cada-documento-del-scaffold). Lo que no llega se marca:

```markdown
> **Blocked**: <qué falta>. Owner: <persona>. Arrives with: <ticket>.
```

**Prohibido**: dejar `To be defined` suelto; rellenar con prácticas genéricas de industria que nadie decidió; declarar objetivos de fiabilidad, modelo de acceso o convenciones de estado que todavía no existen.

---

## `docs/DESIGN.md` — style guide, entregable

**Fuente**: R, exclusivamente. **Responsable**: Marcos Bonifasi.

| Sección | Contenido obligatorio |
|---|---|
| Principles | Principios de diseño e interacción del dominio bancario: operaciones con dinero, estados asíncronos, confianza y claridad |
| Color | Primario, neutro y semánticos (success, warning, error, info), como tokens mapeables al tema de la librería de UI |
| Typography | Familia y escala: títulos, cuerpo, caption, y la variante numérica para montos |
| Spacing & Layout | Contenedor, unidad base de la escala, breakpoints de escritorio y móvil |
| Components | Qué componente se usa para formularios, tablas, estados, feedback, modales y carga de archivos |
| UI States | Inicial, vacío, validación local, enviando, **pendiente**, éxito, error de negocio, timeout y reintento |
| Accessibility | Etiquetas asociadas a campos, foco visible, contraste AA, error junto al campo |
| Domain Formats | Montos en quetzales con dos decimales; fechas en configuración regional de Guatemala |

**Regla que distingue este documento de todos los demás**: cada valor concreto es una decisión del responsable, o una pregunta bloqueante nombrada. No hay término medio, y el término medio es precisamente lo que se ve bien en un diff y no se puede defender después.

```markdown
> **Pending decision**: <qué hay que decidir>. Owner: Marcos Bonifasi. Blocks: <qué no se puede construir sin esto>.
```

**Prohibido**: inventar valores de color, familias tipográficas o escalas de espaciado por parecer razonables; describir un estado "cargando" genérico que borre la distinción entre *enviando* y *pendiente*, que es la que este sistema necesita por su Saga; definir tokens que el shell de frontend no pueda aplicar tal cual.

---

## `docs/QUALITY_SCORE.md` y `docs/TECH_DEBT.md` — actualización de estado

**Fuentes**: C. **Responsable**: Marcos Bonifasi.

`QUALITY_SCORE.md`: recalificar las cinco áreas contra el estado posterior al cambio, con la nota que justifica cada movimiento.

`TECH_DEBT.md`: cerrar TD-001 y TD-003; actualizar TD-002; dar de alta los hallazgos de este trabajo — justificación pendiente del exportador de métricas (resuelve T-18), `docs/templates/base-ticket.md` vacío, referencias ajenas al stack en `docs/references/`, y la ambigüedad de `docs/design-docs/`.

**Prohibido**: cerrar un ítem que sigue siendo cierto; abrir deuda sin ticket ni área.

---

## `apps/web/package.json` y `nuxt.config.ts` — poda

**Fuentes**: C, D. **Responsable**: Marcos Bonifasi.

Retirar lo listado en [research.md R5](../research.md#r5--qué-dependencias-se-retiran), de las dependencias **y** de los módulos. El lockfile se actualiza con la instalación.

**Prohibido**: tocar cualquier otro archivo de `apps/web/` (FR-019); agregar dependencias; retirar el exportador de métricas; declarar el trabajo terminado sin la salida real de la construcción.
