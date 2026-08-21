# Research: Registro de decisiones tecnológicas y arquitectónicas (T-03)

Fase 0 del plan. Doce decisiones de enfoque sobre **cómo** se escribe el registro. Ninguna
queda pendiente.

Tres son **correctivas** (R1, R2, R9): arreglan algo que la spec asumió mal o que el
repositorio arrastra inconsistente. Se marcan así porque cambian lo que el spec decía, y esa
divergencia debe ser visible, no silenciosa.

Ninguna decisión de *tecnología* se toma aquí. Las once ya están tomadas; este documento
decide cómo registrarlas.

---

## R1 — Los ADRs se escriben en inglés *(correctiva)*

**Decisión**: los once ADRs, el índice y la matriz se redactan en **inglés**.

**Rationale**: la spec asumió español "como el resto de la documentación funcional del
proyecto". La premisa es falsa. FR-020 de T-01 dice que `README.md`, `ARCHITECTURE.md`,
`AGENTS.md` y **todo `docs/`** se redactan en inglés, y que *ningún documento puede quedar a
medio traducir*. El repositorio lo cumple: `docs/domain/` (los seis documentos de T-02),
`ARCHITECTURE.md`, `RELIABILITY.md`, `SECURITY.md` y `DOC_INVENTORY.md` están en inglés.

Los artefactos bajo `specs/` —incluida esta investigación— siguen en español, porque FR-020
los excluye explícitamente como documentos de trabajo del equipo. La regla no es "el proyecto
es bilingüe al azar": es "lo duradero en inglés, lo de trabajo en el idioma en que se trabaja".
Los ADRs son duraderos por definición.

**Alternativas consideradas**:

- *Español, como decía la spec*: dejaría trece documentos nuevos en `docs/` contradiciendo la
  regla que gobierna el directorio, y a `ARCHITECTURE.md` enlazando en inglés hacia documentos
  en español. Es exactamente el "a medio traducir" que FR-020 prohíbe.
- *Bilingüe, con resumen en español*: duplica el texto donde más caro es mantenerlo. Dos
  versiones de un razonamiento divergen en cuanto una se edita.

---

## R2 — Los ADRs viven en `docs/architecture/adr/` *(correctiva)*

**Decisión**: `docs/architecture/adr/`, con `README.md` de índice. No `docs/adr/`.

**Rationale**: `docs/architecture/README.md` **ya se declaró** el hogar de los ADRs, antes de
que existiera esta spec: *"this directory holds the decisions behind it and the diagrams that
show it"*, y bajo "What belongs here": *"One ADR per decision, numbered and dated, with the
alternatives that were rejected and why"*. Además ya carga el marcador
`Blocked … Owner: Marcos Bonifasi. Arrives with: T-03 and T-07`.

Crear `docs/adr/` habría producido dos directorios compitiendo por el mismo rol y un bloqueo
declarado que nunca se levanta — el repositorio afirmaría que los ADRs faltan mientras existen
en otro sitio. El subdirectorio `adr/` queda hermano del `diagrams/` que llenarán T-07 a T-14,
que es la división natural del contenido que ese README ya anuncia.

**Alternativas consideradas**:

- *`docs/adr/` (lo que decía la spec)*: contradice un documento existente y deja el marcador
  `Blocked` huérfano.
- *Los ADRs sueltos en `docs/architecture/`*: se mezclarían con los ocho diagramas y el índice.
  Con once ADRs más ocho diagramas, el directorio se vuelve ilegible.

---

## R3 — Un ADR por decisión: once, sin fusionar

**Decisión**: once ADRs, uno por cada decisión que FR-001 enumera. Docker (ADR-006) y kind
(ADR-007) quedan separados aunque ambos describan el runtime local.

**Rationale**: SC-001 mide "el 100 % de las 11 decisiones tienen al menos un ADR". Fusionar
dos haría el conteo ambiguo justo en el criterio que lo verifica. Más de fondo, **el ADR es la
unidad de reemplazo**: cambiar de kind a k3d no debería obligar a reabrir la decisión de
contenerización, y un ADR fusionado convierte dos reemplazos independientes en uno solo.

**Alternativas consideradas**:

- *Un ADR "runtime local" que cubra Docker + kind + Helm*: menos archivos, pero acopla
  decisiones con ciclos de vida distintos.
- *Un único ADR "stack" con todo*: es el documento que el ticket existe para no tener. Once
  decisiones en un archivo no se pueden marcar *superseded* por separado.

---

## R4 — Qué cuenta como "razón técnica" de descarte

**Decisión**: toda alternativa descartada se argumenta con al menos uno de estos cuatro
criterios, nombrado explícitamente: **(a)** carga operativa en el entorno local de la
demostración; **(b)** soporte directo del patrón que el diseño necesita (colas, ack, retries,
DLQ, request/reply); **(c)** una restricción o penalización citada del enunciado; **(d)** un
riesgo concreto para la entrega.

**Rationale**: el criterio 1.3 de la rúbrica (§8.2 p. 23) contrapone "decisiones bien
argumentadas con trade-offs técnicos" contra "sin justificación o basada en opiniones", y son
10 puntos. "El equipo ya sabe TypeScript" es una opinión sobre el equipo, no un trade-off
técnico — puede aparecer como contexto, nunca como *la* razón. Fijar los cuatro criterios de
antemano hace que SC-002 sea auditable por alguien que no participó en la decisión.

**Alternativas consideradas**:

- *Dejar la razón a criterio de quien escribe*: produce once ADRs con profundidad desigual;
  el más débil marca la nota.
- *Exigir benchmarks*: desproporcionado para un proyecto académico local, y no medible en el
  plazo del ticket.

---

## R5 — Cada ADR cita sección y página del enunciado cuando exista restricción

**Decisión**: los ADRs restringidos por el PDF citan **sección y página** de la revisión del
2026-08-13. Los que no lo están (ADR-008 Clean Architecture, ADR-011 diagramación) lo declaran:
"no restringido por el enunciado; decisión del equipo".

**Rationale**: FR-002 lo exige, y la verificación de páginas hecha durante `/speckit-specify`
mostró por qué importa: **seis de las citas heredadas estaban desplazadas** (§4.2 p. 7→8, §4.3
p. 13→14, §6 p. 16→17, criterio 1.3 p. 21→23, criterio 2.9 p. 25→26, §8.3 p. 26→27). Una cita
incorrecta es peor que ninguna: invita a un revisor a abrir la página equivocada y concluir que
el equipo no leyó el enunciado. Declarar explícitamente "no restringido" evita que un ADR sin
cita se lea como un olvido.

**Alternativas consideradas**:

- *Citar solo la sección*: el PDF tiene 27 páginas sin numeración impresa en el pie; sin número
  de página, verificar exige releer la sección entera.
- *Citar solo en los ADRs "importantes"*: la importancia se decide después, no antes.

---

## R6 — La matriz indexa los ADRs, no los repite

**Decisión**: `decision-matrix.md` tiene una fila por decisión con: decisión, alternativa
principal descartada, trade-off aceptado, consecuencia operativa y **enlace al ADR**. El
argumento completo vive solo en el ADR.

**Rationale**: la matriz responde una pregunta distinta que un ADR. El ADR responde "¿por qué
esto?" en profundidad; la matriz responde "¿qué se decidió, en total?" de un vistazo, que es lo
que un revisor con quince minutos necesita. Si la matriz repitiera el razonamiento, tendríamos
dos copias del mismo texto en archivos distintos: el día que una se edite, se contradicen — y
la inconsistencia documental cuesta el 25 % (§8.3 p. 27).

**Alternativas consideradas**:

- *Matriz autocontenida con todo el razonamiento*: se lee sin saltar, pero duplica y diverge.
- *Sin matriz, solo el índice de ADRs*: FR-006 la exige como entregable, y un índice no
  muestra trade-offs lado a lado, que es donde se ven las decisiones incoherentes entre sí.

---

## R7 — La matriz cita las dos penalizaciones como reglas separadas

**Decisión**: la fila de persistencia (ADR-005) cita **dos** reglas distintas: base de datos
compartida → **100 %** de la nota (§8.3 p. 27, "Uso de una sola base de datos compartida"), y
microservicio conectado a múltiples bases → **50 %** (§4.2 p. 13, "Restricciones
arquitectónicas").

**Rationale**: FR-006 lo exige y la revisión del enunciado del 2026-08-13 las separó. Son
fallos distintos: la primera es una base para todos; la segunda es un servicio que lee bases
ajenas. Una decisión —una base por servicio, con credenciales propias— evita ambas, pero un
revisor que solo vea una regla no puede comprobar que la otra también está cubierta.

**Alternativas consideradas**:

- *Citarlas juntas como "penalización por mal uso de bases"*: es como se documentaban antes de
  la revisión, y pierde que los porcentajes y las secciones son distintos.

---

## R8 — El ADR de mensajería compara contra las cuatro opciones, no contra Kafka

**Decisión**: ADR-004 evalúa RabbitMQ frente a **Kafka, NATS y gRPC asíncrono**, las cuatro que
el enunciado permite (§4.2 p. 8 y tabla de §4.3 p. 14). Cada descarte con su razón propia.

**Rationale**: el ticket lo pide y la razón es de fondo. El argumento heredado —"RabbitMQ sobre
Kafka por menor carga operativa"— no dice nada sobre NATS, que también es ligero, ni sobre gRPC
asíncrono, que es de otra naturaleza. Un ADR que solo descarta Kafka deja dos alternativas sin
responder y un revisor puede preguntar por cualquiera de ellas. Las razones no son
intercambiables: NATS Core no persiste mensajes por defecto (y el flujo bancario no puede
perder un `account.debit.requested`), mientras que gRPC async es transporte punto a punto sin
broker, sin colas ni DLQ, lo que dejaría la coreografía de la Saga sin sustrato.

**Alternativas consideradas**:

- *Comparar solo contra Kafka*: era el estado heredado; incompleto frente al enunciado revisado.

---

## R9 — PlantUML no se adopta *(correctiva)*

**Decisión**: ADR-011 registra **Lucid + Mermaid** como las dos herramientas, y **descarta
PlantUML explícitamente**.

**Rationale**: el ticket dice "Mermaid y PlantUML para fuentes versionables o automatizadas",
pero `docs/architecture/README.md` ya fijó la regla de entrega antes que esta spec: *"Every
diagram ships **both**, and they must agree"* — LucidChart (editable + export) y Mermaid
(`.mmd` versionado). Mermaid cubre siete de los ocho diagramas nativamente (`C4Context`,
`C4Container`, `C4Component`, `C4Deployment`, `sequenceDiagram`); solo el de casos de uso
carece de soporte y ahí el artefacto de Lucid es autoritativo.

Añadir PlantUML como tercer formato crea una **tercera copia de cada diagrama** que puede
contradecir a las otras dos, en un proyecto donde la inconsistencia entre diagramas cuesta el
25 % (§8.3 p. 27). El beneficio sería cubrir el único diagrama que a Mermaid le falta; el costo
es un formato más que mantener sincronizado en los ocho.

Dejar el ticket diciendo "PlantUML" y el repo diciendo "Lucid + Mermaid" es precisamente la
contradicción que FR-010 prohíbe. El ADR la resuelve **decidiendo**, y registra PlantUML como
alternativa evaluada y descartada — que es más honesto que borrarlo del ticket.

**Alternativas consideradas**:

- *Adoptar PlantUML para el diagrama de casos de uso*: resolvería la carencia real de Mermaid,
  pero introduce una cadena de herramientas (JVM o servidor de render) por un solo diagrama que
  Lucid ya cubre.
- *Sustituir Mermaid por PlantUML*: PlantUML no tiene soporte nativo de C4 sin la biblioteca
  `C4-PlantUML`, y Mermaid se renderiza directamente en GitHub — que es donde ocurre la
  revisión por pull request.

---

## R10 — Los SLI/SLO/SLA van a `docs/RELIABILITY.md`, no a un documento nuevo

**Decisión**: la definición SRE sustituye el bloque `Blocked` de la sección "SLI, SLO, And SLA"
de `docs/RELIABILITY.md`.

**Rationale**: ese archivo ya existe, ya está indexado en `AGENTS.md` ("SRE requirements before
service or infrastructure design"), ya está clasificado en `DOC_INVENTORY.md` como `blocked`, y
ya declara literalmente *"Arrives with: T-03"*. Es el documento que este ticket viene a
desbloquear. Crear `docs/SRE.md` dejaría a `RELIABILITY.md` bloqueado para siempre apuntando a
un ticket cerrado.

Al escribirlos, el estado de la fila en `DOC_INVENTORY.md` pasa de `blocked` a `current`, y la
fila Reliability de `QUALITY_SCORE.md` deja de esperar a T-03 (sigue esperando a T-24 para las
mediciones reales, que es otra cosa).

**Alternativas consideradas**:

- *`docs/SRE.md` nuevo*: un documento más que indexar y un bloqueo que no se levanta.
- *Dentro de un ADR*: un SLO no es una decisión entre alternativas; es un objetivo numérico.
  Meterlo en el formato ADR obligaría a inventar "alternativas descartadas" para cada umbral.

---

## R11 — La expiración del JWT: 1 hora, sin refresh token

**Decisión**: `expiresIn: 1h`. Sin refresh token. El ADR registra el número y la razón.

**Rationale**: FR-005 exige un valor numérico concreto, no un rango. Una hora es el equilibrio
defendible para este contexto: **suficiente** para que la demostración completa —levantar el
cluster, registrar, autenticar, transferir, mostrar la Saga— ocurra sin que el evaluador tenga
que volver a iniciar sesión a media prueba; y **corto** frente a la consecuencia de que la
revocación esté fuera de alcance, porque el peor caso de un token filtrado es una hora de
validez y no un día.

No hay refresh token porque su único propósito es permitir sesiones largas con tokens de vida
corta, y aquí no hay sesiones largas: hay una demostración. Añadirlo obligaría a almacenar y
revocar refresh tokens, que es justo el estado que ADR-010 evita al no darle base de datos al
Gateway.

**Alternativas consideradas**:

- *15 minutos*: obliga a re-autenticar durante la demostración; el riesgo que mitiga
  (revocación imposible) ya está aceptado explícitamente.
- *24 horas*: cómodo, pero con revocación fuera de alcance un token filtrado vive un día entero;
  y coincidiría con la vida del token de activación de T-02, invitando a confundirlos.

---

## R12 — El ADR de autenticación distingue los dos tokens

**Decisión**: ADR-010 abre declarando que hay **dos tokens distintos** en el sistema y que solo
decide uno: el **JWT de sesión** (Gateway, HS256, 1 h) frente al **token de activación por
correo** (Customer Service lo genera y valida, 24 h, un solo uso), que T-02 ya decidió en
`docs/domain/use-cases.md` y este ADR no redefine.

**Rationale**: FR-005b lo exige, y el riesgo de confusión es real: ambos son "tokens", ambos
tienen expiración, ambos aparecen en el flujo de Customer Service. Sin la distinción explícita,
alguien que implemente Customer Service puede creer que el JWT de sesión es el que valida el
correo, y romper el flujo de activación o duplicar la lógica de firma. La asimetría es
deliberada y vale la pena nombrarla: el token de activación **sí** lo firma y valida Customer
Service, porque activar es una decisión de identidad de su dominio; el JWT de sesión no, porque
autenticar peticiones entrantes es responsabilidad del Gateway.

**Alternativas consideradas**:

- *Mencionar el token de activación solo como nota al pie*: insuficiente para algo que ya está
  implementado como flujo en el modelo de dominio.
- *Unificar ambos en un mecanismo*: cambiaría una decisión de T-02 sin necesidad y le daría al
  Gateway un papel en la activación por correo, que no le corresponde.
