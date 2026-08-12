# Phase 0 — Research: Base documental de Bank USAC (T-01)

**Fecha**: 2026-08-11. Todo lo verificado contra el repositorio y contra `docs/references/780_Proyecto_1_2S2026.pdf` en esa fecha.

---

## R1 — Dónde vive cada entregable

**Decisión.** Tres archivos nuevos en `docs/`, y la raíz se queda como índice.

| Entregable | Archivo | Por qué ahí |
|---|---|---|
| Ownership | `docs/OWNERSHIP.md` | Cambia cuando cambia el equipo, no cuando cambia el sistema. Merece su propio ciclo de vida |
| Metodología | `docs/METHODOLOGY.md` | Es la evidencia del criterio 1.1 de la rúbrica; quien califica debe poder llegar por un enlace directo |
| Inventario documental | `docs/DOC_INVENTORY.md` | Es un índice del repositorio, no del producto |
| Identidad y navegación | `README.md` | Primera pantalla: qué es, quiénes somos, dónde está todo |
| Sistema y restricciones | `ARCHITECTURE.md` | Ya es el mapa de alto nivel declarado por el scaffold |

**Rationale.** El ticket permite "README o `docs/`". Meter ownership, metodología e inventario dentro del README lo convierte en un muro de varios cientos de líneas donde el evaluador tiene que buscar. Separarlos da a cada uno un responsable y una fecha de revisión propios, que es lo que `docs/DOC_INVENTORY.md` necesita registrar.

**Alternativas consideradas.** (a) Todo en el README: rechazada por legibilidad y porque un README largo se desactualiza en bloque. (b) Ownership dentro de `ARCHITECTURE.md`: rechazada porque mezcla dos ejes de cambio —el sistema y las personas— en un archivo cuyo público principal son los agentes.

---

## R2 — Cómo se inventaría el 100% de los `.md` sin que se pudra

**Decisión.** Inventario híbrido en tres partes:

1. **Tabla por archivo** para los ~15 documentos de proyecto (raíz + `docs/*.md` + `docs/design-docs/`), con clase, responsable, estado y última revisión.
2. **Reglas por directorio** para los ~95 del andamiaje instalado: `.agents/skills/**`, `.agents/roles/**`, `.claude/**`, `.opencode/**`, `.specify/templates/**`, `specs/**`, `apps/web/README.md`. Cada regla declara clase y responsable para todo lo que cae bajo ella.
3. **Comando de cobertura** publicado en el propio inventario: lista los `.md` del repositorio y resta los cubiertos por una fila o una regla. Salida vacía = cobertura completa.

**Rationale.** 110 filas escritas a mano quedan obsoletas con el primer `npx skills add`. Las reglas por directorio absorben el crecimiento del andamiaje sin editar nada, y el comando convierte SC-004 en algo que se comprueba en lugar de creerse.

**Alternativas consideradas.** (a) Tabla exhaustiva de 110 filas: rechazada, se pudre sola. (b) Archivo generado por script en `docs/generated/`: rechazada por dos motivos — exige escribir un script (fuera de alcance) y FR-016 mantiene `docs/generated/` fuera de este trabajo.

---

## R3 — Idioma

**Decisión.** Inglés para la documentación duradera: `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**`, y la constitución. Español para el tablero de Notion y la comunicación del equipo. Los artefactos bajo `specs/` se redactan en el idioma en que se trabaja la tarea.

**Rationale.** Decisión del responsable (2026-08-11). Homogeneidad con el andamiaje ya instalado, que es todo inglés; una mezcla dentro de `docs/` obligaría a cada lector —humano o agente— a cambiar de idioma entre archivos vecinos.

**Consecuencia que hay que vigilar.** El enunciado exige documentación en Markdown (§4.4) pero no fija idioma. Quien califica lee español. El README debe abrir con una línea que identifique el proyecto, el curso y el grupo de forma inequívoca aunque el resto esté en inglés.

---

## R4 — Cuáles son de verdad las restricciones no negociables

**Decisión.** Se registran **ocho** principios, tomados literalmente del enunciado, no de la paráfrasis del ticket.

> **Corrección (2026-08-11, tras `/speckit-analyze`)**: esta tabla listaba siete y omitía el despliegue en Kubernetes local, que el enunciado marca como obligatorio en §4.2 y §4.3. El spec, por su lado, listaba otras siete: incluía Kubernetes y omitía SRE desde el diseño. La unión es ocho y ninguna lista las tenía todas. Corregido en spec, plan, contratos y tareas.

Verificado en el PDF (índice de página tal como lo entrega el archivo):

| # | Restricción | Fuente |
|---|---|---|
| 1 | Implementación de **5 microservicios** con responsabilidades claramente definidas | §4.2, p. 8 |
| 2 | Cada microservicio **tiene su propia base de datos** y **no accede a la base de otro servicio** | "Reglas de diseño obligatorias", p. 7 |
| 3 | Bases de datos **externas al cluster** (contenedores Docker o servicios locales) | §4.2, p. 8; §4.3, p. 14 |
| 4 | Comunicación **completamente asíncrona**; **no existen** llamadas HTTP entre servicios ni acoplamiento directo | §4.2, p. 8; "Reglas de diseño obligatorias", p. 7 |
| 5 | **API Gateway** como punto de entrada al sistema | §4.2, p. 8 |
| 6 | **Saga (obligatorio)**; coreografía recomendada | "Patrones esperados", p. 7 |
| 7 | **Despliegue en un cluster local de Kubernetes** | §4.2, p. 8; §4.3, p. 14 |
| 8 | **DevOps y SRE desde el diseño**: idempotencia, retries, manejo de errores, consistencia eventual y trazabilidad por `correlationId` en cada servicio | §4.2, p. 8; "Consideraciones SRE (obligatorias)", p. 7 |

**Tres hallazgos que el ticket no recoge:**

- **"DevOps y SRE desde el diseño" es obligatorio**, y las cinco consideraciones SRE por servicio también. El ticket no las lista entre las restricciones no negociables. Sin ellas registradas, T-08 a T-12 pueden implementarse sin idempotencia ni `correlationId` y descubrirlo en T-17.
- **El enunciado penaliza explícitamente** mezclar responsabilidades entre servicios, servicios "god object", comunicación directa, falta de eventos claros y falta de modelo de dominio ("Observaciones críticas", p. 7). Son criterios de calificación, no sugerencias; van al mismo registro.
- **Las citas de página del ticket están corridas.** El ticket cita §4.2 en "pp. 6-7"; en el PDF el encabezado §4.2 está en la p. 7 y sus requisitos en la p. 8. La cita de §4.4 (p. 14) sí es correcta. Cada referencia debe reverificarse al escribirla.

**Verificación adicional.** §4.3 fija el stack permitido: lenguaje Java/TypeScript/Go, framework Spring Boot 4 o **NestJS**, Kubernetes local, Docker, mensajería Kafka/**RabbitMQ**/NATS/gRPC async, base de datos externa al cluster. Las decisiones del equipo (NestJS + RabbitMQ) caen dentro de lo permitido; queda comprobado, no supuesto.

**Rationale.** La constitución solo sirve si un plan futuro puede resultar *no conforme* frente a ella. Transcribir la paráfrasis del ticket, que omite tres exigencias calificables, produciría un gate que deja pasar exactamente los errores que el enunciado penaliza.

---

## R5 — Qué dependencias se retiran

**Decisión.**

**Se retiran** de `apps/web/package.json` y de los `modules` de `nuxt.config.ts`:

| Paquete | Qué es | Por qué se va |
|---|---|---|
| `@tiptap/*` (16 paquetes) | Editor de texto enriquecido | Ninguna funcionalidad bancaria del enunciado necesita edición de texto enriquecido |
| `@i2d/nuxt-pdf-frame` | Visor de PDF embebido | Sin decisión que lo respalde |
| `@hypernym/nuxt-anime` | Librería de animación | Sin decisión que lo respalde |
| `@jasy/nuxt` | Módulo Nuxt de terceros, versión `1.0.0-alpha.7` | Sin decisión que lo respalde, y una versión alpha en la base de un proyecto calificado es riesgo sin contrapartida |

**Se conservan**: `nuxt`, `vue`, `vue-router`, `typescript`, `tailwindcss` (requerido por `@nuxt/ui` 4), `@nuxt/ui` (decisión registrada: frontend Vue/Nuxt), `@nuxt/eslint` y `eslint` (herramienta de lint pendiente de cablear, TD-004).

**Se conserva marcado como pendiente**: `@artmizu/nuxt-prometheus`. El enunciado exige SRE desde el diseño y definición de SLI/SLO/SLA (§4.2, §4.4), así que exponer métricas es plausible — pero ninguna decisión registrada lo dice. Se conserva y se registra en `docs/TECH_DEBT.md` como justificación pendiente a resolver en T-18, conforme a FR-014 y FR-022. No se documenta como decisión aceptada.

**Riesgo y su control.** `apps/web/app/app.vue` solo renderiza la pantalla de bienvenida del framework y no importa ninguna de estas librerías, así que la poda no debería romper nada. El control es la verificación de FR-023: `pnpm install` y `pnpm build` con salida real adjuntada. Si falla, se restituye la dependencia y se reporta el hallazgo en lugar de forzar el cambio.

**Alternativas consideradas.** (a) Registrarlas como deuda y podar en T-04: rechazada por el responsable — arrastra hasta T-04 un `ARCHITECTURE.md` que no describe el repositorio real. (b) Documentarlas como decisiones vigentes: rechazada, sería inventar una decisión que nadie tomó.

---

## R6 — Cuánto se puede llenar de cada documento del scaffold

**Decisión.** Cada documento se corta explícitamente entre lo afirmable y lo bloqueado. Ningún documento se deja a medias en silencio.

| Documento | Se puede afirmar hoy | Queda bloqueado |
|---|---|---|
| `docs/PRODUCT_SENSE.md` | Usuario y flujos principales derivados del enunciado: registro y validación de cliente, apertura y consulta de cuenta, transferencia entre cuentas, procesamiento de pago, notificación y auditoría | El north star del producto y el detalle de cada flujo: llegan con T-02 |
| `docs/FRONTEND.md` | Todo verificable contra el repo: Nuxt 4.5, `@nuxt/ui` 4.10, Tailwind 4, TypeScript, organización de componentes por microservicio, comandos reales | Convenciones de estado y de routing: llegan con T-13, que define el shell |
| `docs/SECURITY.md` | Clases de datos tomadas del enunciado: identificación del cliente, documento, correo, dirección, fecha de nacimiento, balances y transacciones | Modelo de acceso y manejo de secretos: llegan con T-03 y T-06 |
| `docs/RELIABILITY.md` | Las consideraciones SRE obligatorias del enunciado y la exigencia de definir SLI/SLO/SLA | Indicadores, fórmulas, fuentes y objetivos: los fija **T-03** en fase de diseño. **T-18** los mide y reporta con datos reales. La marca de bloqueo debe citar T-03, no T-18 |
| `docs/QUALITY_SCORE.md` | Recalificación de las cinco áreas con el estado posterior a este cambio | — |
| `docs/TECH_DEBT.md` | Cierre de TD-001 y TD-003, actualización de TD-002, y alta de los hallazgos nuevos | — |
| `docs/DESIGN.md` | Owner-approved style guide with eight required areas | Future values not approved by the owner |

**Rationale.** El criterio 6 del ticket prohíbe placeholders sin justificar, no prohíbe secciones bloqueadas. La diferencia importa: "To be defined" sin más es un placeholder muerto; "Bloqueado: los objetivos de disponibilidad los fija T-18, responsable Marcos Bonifasi" es información útil y verificable. FR-017 exige lo segundo.

**Deuda técnica que este trabajo abre** (no resuelve): `docs/templates/base-ticket.md` está vacío (0 líneas); `docs/references/` conserva `uv-llms.txt` y `nixpacks-llms.txt`, ajenos a este stack; `docs/design-docs/` es ambiguo entre decisiones de diseño y registros de decisión arquitectónica.

---

## R7 — Cómo se llena la constitución

**Decisión.** Se llena invocando `/speckit-constitution` en lugar de editar el archivo a mano, con los ocho principios de R4. Versión `1.0.0`, ratificada 2026-08-11. Cada principio se redacta con un criterio de conformidad accionable, según [contracts/constitution-principles.md](contracts/constitution-principles.md).

**Rationale.** El comando existe precisamente para esto y además sincroniza las plantillas dependientes de `.specify/templates/`. Editar el archivo a mano deja esas plantillas desalineadas y el desfase no se nota hasta el siguiente `/speckit-plan`.

**Alternativas consideradas.** Escribir el Markdown directamente: rechazada por la desincronización. Posponer la constitución a T-03: rechazada por el responsable — sin ella, T-02 a T-07 se planifican sin gate.

---

## R9 — El style guide: qué está decidido y qué falta

**Contexto.** El ticket se amplió el 2026-08-11, después de escribirse el spec: `docs/DESIGN.md` dejó de ser un documento bloqueado y pasó a ser un entregable con ocho áreas mínimas, más dos criterios de aceptación nuevos. Absorbido en FR-026 a FR-032.

**Decisión.** El documento se escribe hasta donde llega la dirección entregada por su responsable, y ni un valor más allá. During T-01, Marcos Bonifasi supplied and approved the primary palette, Inter typography scale, and 8px responsive layout system now recorded in `docs/DESIGN.md`.

**Ya decidido por el responsable en el propio ticket** (fuente R, citable):

- Las ocho áreas que el documento debe cubrir, y su alcance.
- Los estados de interfaz obligatorios, incluido el caso que hace especial a este sistema: una operación aceptada no es una operación completada. Con Saga por coreografía, "pendiente" es un estado de primera clase, no un intermedio que se oculta tras un spinner.
- Los formatos de dominio: montos en quetzales con dos decimales, fechas en configuración regional de Guatemala.
- La accesibilidad mínima: etiquetas asociadas a campos, foco visible, contraste AA, mensajes de error junto al campo.
- Que los tokens se mapean al tema de la librería de UI que T-13 aplica, de modo que el shell de frontend los consuma sin reinterpretarlos.
- Que el enlace desde `AGENTS.md` es permanente y obliga a consultarlo antes de tocar interfaz.

**Las tres decisiones que estaban pendientes quedaron resueltas durante la ejecución**:

| Área | Decisión registrada |
|---|---|
| Color | Primary `#8CE071`, dark contrast `#1A201D`, neutral surfaces, and semantic tokens documented in `docs/DESIGN.md`. |
| Tipografía | Inter with 400/500/600/700 weights, documented heading/body/caption/hero sizes, and tabular lining numerals for amounts. |
| Espaciado y layout | 8px base grid, 1200px maximum content width, 16px mobile padding, 24px desktop padding, and 768/1024/1280px breakpoints. |

**Rationale.** Que el responsable del documento y quien ejecuta el ticket sean la misma persona no relaja la Regla de No Invención. The values were supplied by the owner as an approved guide, then normalized into explicit tokens and component rules in `docs/DESIGN.md`.

**Resultado.** The owner-approved values are now recorded in `docs/DESIGN.md`; no pending style decision remains for T-01.

---

## R8 — Qué contradicciones hay que cerrar

**Decisión.** Tres correcciones obligatorias, verificadas en el repositorio:

1. **`README.md:21-24`** afirma que Spec Kit "is not initialized in this repository yet" y que "there is no spec workflow here". Falso: `.specify/` existe, tiene integraciones instaladas y este feature se creó con él.
2. **`docs/TECH_DEBT.md`, TD-003** repite lo mismo ("Spec Kit is not initialized"). Se cierra.
3. **TD-001** ("Product scope is not defined yet… write the first spec with Spec Kit, once it is initialized") queda resuelto por este mismo spec. Se cierra citándolo.

Además, `CLAUDE.md` y `AGENTS.md` declaran que `ARCHITECTURE.md` es una plantilla. Deja de serlo con este cambio: ambos se actualizan en el mismo commit, que es lo que `AGENTS.md` exige de sí mismo ("Update stale docs in the same change that makes them stale").

**Rationale.** SC-006 pide cero afirmaciones contradictorias entre los cuatro documentos de estado. Hoy hay cuatro.
