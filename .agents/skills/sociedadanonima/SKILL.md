---
name: sociedadanonima
description: Funda un proyecto de software de punta a punta — de la idea, el enunciado o el repositorio sin papeles hasta la documentación de análisis, diseño e implementación y su cronograma. Produce caso de negocio, stakeholders, requisitos funcionales y no funcionales, escenarios de calidad, restricciones, actores y matriz de permisos, glosario, entidades con estados e invariantes, casos de uso, ADR con alternativas descartadas, esquema de datos, contratos de interfaz, SLI, SLO, SLA, backlog de tickets y cronograma con ruta crítica, todo unido por matrices de trazabilidad. Úsala cuando pidan iniciar, definir, aterrizar, encuadrar, planificar o documentar un proyecto, cuando haya que decidir arquitectura antes de escribir código, o cuando un sistema ya construido no tenga estas bases escritas. Use when starting, scoping, defining, planning or documenting a software project — business case, requirements, domain model, use cases, ADRs, database schema, SLI/SLO/SLA, backlog and timeline.
---

# Sociedad Anónima

Convierte una idea, un enunciado o un repositorio sin papeles en el conjunto de
documentos que sostienen un proyecto: **qué** se va a construir, **para quién**,
**con qué decisiones**, **qué garantiza** y **en cuánto tiempo**.

Esto no es un generador de plantillas. Cada documento es el **acta de una
decisión que alguien tomó**. Si nadie la tomó, esta skill la fuerza preguntando,
o la marca como pendiente — jamás la inventa en silencio. Un documento que
rellena huecos con lo plausible es peor que no tener el documento: se ve
igual de terminado y no lo respalda nadie.

## Cuándo usarla

- Arranca un proyecto nuevo y solo existe una idea, un enunciado o un correo.
- Hay que decidir arquitectura, límites de módulos o modelo de datos **antes** de
  escribir código.
- Un sistema ya construido no tiene escritas sus bases y hay que reconstruirlas
  contra el código real (**modo retrofit**, ver más abajo).
- Piden «planifícame el proyecto», «hazme el cronograma», «documenta la
  arquitectura», «define el dominio», «qué SLA ofrecemos».

**Cuándo NO usarla:** una funcionalidad pequeña dentro de un proyecto que ya
tiene estas bases (usa el flujo de especificación del repositorio), un bug, un
refactor local, o una pregunta que se contesta leyendo un archivo.

## Portabilidad

La skill es agnóstica de proveedor y de stack. No nombra herramientas de ningún
agente concreto ni asume lenguaje, framework, nube ni metodología. Las
instrucciones son acciones —leer, preguntar, escribir un archivo, ejecutar un
comando— que cualquier agente ejecuta con lo que tenga. El directorio completo
(`SKILL.md`, `references/`, `templates/`) se copia tal cual a otro repositorio.

## Qué produce

Nueve fases, cada una con un artefacto y un cierre. Los prefijos de ID son la
columna vertebral: sin identificadores estables las matrices de trazabilidad no
existen y los documentos dejan de poder citarse entre sí.

| Fase | Artefacto por defecto | IDs que crea |
| --- | --- | --- |
| **F0** Encuadre | acuerdo de trabajo (en pantalla, no archivo) | — |
| **F1** Caso de negocio | `docs/dda.md` §1–3 | `STK-`, `CAR-` |
| **F2** Requisitos | `docs/dda.md` §4–6 | `RF-`, `HU-`, `RNF-`, `EAC-`, `RES-` |
| **F3** Dominio | `docs/domain/{glossary,actors,entities,use-cases}.md` | `A-`, `E-`, `INV-`, `CDU-` |
| **F4** Arquitectura | `docs/adr.md`, `docs/architecture.md` + diagramas | `ADR-`, `D-` |
| **F5** Datos y contratos | `docs/generated/db-schema.md`, `docs/api/` o `docs/events/` | `TBL-`, `MSG-` |
| **F6** Fiabilidad | `docs/sre/{sli,slo,sla}.md` | `SLI-`, `SLO-` |
| **F7** Plan | `docs/plan/backlog.md` | `T-` |
| **F8** Cronograma | `docs/plan/roadmap.md` | `H-` (hitos) |
| **F9** Trazabilidad | `docs/dda.md` §7 (matrices) | — |

Las rutas son el **defecto**, no un dogma: si el repositorio ya tiene otra
convención documental, gana la del repositorio y se acuerda en F0.

## Reglas de operación

1. **Decidir antes de escribir.** Ningún párrafo se escribe sin que exista la
   decisión que describe. El orden es: preguntar → acordar → escribir.
2. **Una fase a la vez, con puerta.** Al cerrar cada fase presenta *qué se
   decidió*, *qué quedó abierto* y *qué archivo se escribió*, y espera
   confirmación. No encadenes nueve fases en un solo turno aunque puedas.
3. **Máximo cinco preguntas por fase**, y de una en una si la respuesta cambia
   la siguiente pregunta. Prioriza las que alteran materialmente el resultado.
4. **Nunca inventes en silencio.** Lo no decidido se escribe con marca visible:
   `[SUPUESTO: …]` cuando decidiste tú por falta de respuesta, y
   `[PENDIENTE: …]` cuando hace falta un humano. Ambas marcas se listan en el
   cierre de fase. Un documento sin marcas es un documento que afirma tener
   todas las respuestas.
5. **Si el usuario dice «decide tú», decide** — no repreguntes. Elige la opción
   más simple que cumpla los drivers conocidos, márcala `[SUPUESTO: …]` y sigue.
6. **Cita la fuente.** Cuando un requisito venga de un enunciado, un correo o un
   ticket, cítalo con su ubicación (`§4.2, p. 7`). Cuando venga del equipo,
   dilo. Distinguir «lo exige el cliente» de «lo decidimos nosotros» es la
   diferencia entre poder renegociarlo y no poder.
7. **Un ID nunca se reutiliza ni se renumera.** Se corrige el contenido; si algo
   muere se marca `OBSOLETO` y se conserva la fila. Renumerar rompe cada
   referencia cruzada del repositorio a la vez.
8. **Idioma:** los documentos se escriben en el idioma en que habla el usuario.
   Los identificadores técnicos —IDs, nombres de estado, códigos de error,
   nombres de tabla y columna— van en el idioma del código y no se traducen.
9. **Sin números sin fuente.** «99.9 %», «< 200 ms», «3 semanas» solo se
   escriben si puedes decir de dónde salen y cómo se miden. Si no, es
   `[PENDIENTE]`.
10. **El repositorio manda.** Si el proyecto ya tiene convenciones, plantillas o
    documentos, se extienden — no se sustituyen por las de esta skill.

## Las nueve fases

Cada fase declara **entrada**, **qué preguntar**, **salida** y **criterio de
cierre**. El banco de preguntas completo está en
[references/FASES.md](references/FASES.md); las plantillas de cada documento en
[templates/](templates/).

### F0 — Encuadre

**Entrada:** todo lo que ya existe. Lee el enunciado o brief, el `README`, el
archivo de instrucciones para agentes si lo hay, la estructura de directorios y
los manifiestos de dependencias. En modo retrofit, además el código.

**Pregunta (las cinco que cambian todo):**
1. ¿Proyecto nuevo o sistema existente que hay que documentar?
2. ¿Cuál es la restricción dura: fecha, presupuesto, alcance o tecnología?
3. ¿Quién decide cuando hay desacuerdo, y quién recibe el resultado?
4. ¿Cuántas personas trabajan y con qué dedicación real?
5. ¿Dónde viven los documentos y en qué idioma?

**Salida:** acuerdo de trabajo en pantalla — modo, alcance de fases (se pueden
saltar fases si el proyecto no las necesita), rutas, idioma, equipo y fecha.

**Cierre:** el usuario confirma el acuerdo. **Sin esto no se escribe nada.**

### F1 — Caso de negocio

**Entrada:** el acuerdo de F0.

**Pregunta:** qué problema resuelve y para quién; qué pasa si no se construye;
quiénes son los interesados y qué le preocupa a cada uno; qué está fuera de
alcance de forma explícita; cómo se sabrá que funcionó.

**Salida:** visión, tabla de **stakeholders** con la preocupación arquitectónica
de cada uno (`STK-`), y **características priorizadas** en tres niveles
—críticas, altas, medias— con el criterio de corte escrito (`CAR-`).

**Cierre:** cada stakeholder tiene al menos una preocupación concreta, y existe
una lista de *no objetivos*. Una preocupación como «que funcione bien» no cierra
la fase; se convierte en pregunta.

### F2 — Requisitos

**Entrada:** F1.

**Pregunta:** qué debe hacer el sistema (`RF-`), quién lo pide y con qué
prioridad; qué historias de usuario lo expresan con criterios de aceptación
verificables (`HU-`); qué atributos de calidad importan y con qué umbral
(`RNF-`); qué restricciones son innegociables y de dónde vienen —técnicas,
normativas, de negocio, del enunciado— (`RES-`).

**Salida:** catálogo de RF, historias con criterios en formato
dado/cuando/entonces, tabla de RNF con **métrica y mecanismo de soporte**, y
tabla de restricciones con su justificación.

Los RNF se convierten además en **escenarios de calidad** (`EAC-`) con seis
campos: fuente del estímulo, estímulo, artefacto, entorno, respuesta y **medida
de respuesta**. Un RNF sin escenario es un adjetivo; el escenario es lo que lo
vuelve comprobable.

**Cierre:** todo RNF tiene número y unidad. «Rápido», «seguro» y «escalable» no
pasan la puerta.

### F3 — Dominio

**Entrada:** F1 y F2.

**Pregunta:** qué términos usa el negocio y cuáles significan lo mismo con
nombres distintos; quién actúa sobre el sistema y qué puede y **qué no puede**
hacer cada rol; qué cosas persisten, quién las posee, qué estados admiten y qué
transiciones son ilegales; qué reglas no pueden violarse nunca y **cómo se llama
el fallo** cuando alguien lo intenta.

**Salida:**
- **Glosario** — un término, una definición, un dueño. Sin implementación.
- **Actores** (`A-`) y **matriz de permisos**, con una sección explícita de
  *fronteras*: lo que cada rol **no** puede hacer, con el nombre del rechazo.
- **Entidades** (`E-`): identidad, atributos, conjunto **cerrado** de estados,
  transiciones legales dibujadas, e **invariantes numerados** (`INV-`) cada uno
  con su fallo esperado.
- **Casos de uso** (`CDU-`): actor, precondiciones, entrada, resultado
  observable, secuencia, y **fallos esperados en tabla** — los que el diseño
  contempla, no los accidentes.

**Cierre:** toda transición no dibujada es ilegal por definición y así está
escrito; todo invariante tiene un nombre de fallo; ningún caso de uso termina
sin resultado observable.

### F4 — Arquitectura y decisiones

**Entrada:** F2 (drivers) y F3 (dominio).

**Pregunta:** qué estilo arquitectónico exigen los drivers —no la moda—; qué
piezas hay y cómo se comunican; dónde están las fronteras y qué las cruza; qué
se decidió en cada punto donde había alternativas reales.

**Salida:** vista de arquitectura (contexto, contenedores, componentes, con
diagramas **en texto versionable**) y el registro **ADR**. Cada ADR lleva:
título, contexto, decisión, **alternativas descartadas con el motivo del
descarte**, justificación **atada a un driver por ID**, y consecuencias
separadas en positivas y negativas.

Las decisiones que son de **dominio o de negocio** —no de tecnología— se numeran
aparte (`D-`): a qué llamamos usuario, si el personal interno es otra entidad,
qué identifica el acceso. Se confunden con los ADR y no son lo mismo: una se
revisa cuando cambia la tecnología, la otra cuando cambia el negocio.

**Cierre:** ningún ADR sin alternativa descartada — si no hubo alternativa no
hubo decisión, y eso es una nota, no un ADR. Ninguna justificación sin ID de
driver. Ninguna consecuencia negativa vacía.

### F5 — Datos y contratos

**Entrada:** F3 y F4.

**Pregunta:** qué persiste cada componente y quién es su dueño; qué tipos exigen
las invariantes —dinero, tiempo, identidad—; qué garantiza el motor con
restricciones y qué queda en manos del código; qué cruza las fronteras y con qué
forma exacta.

**Salida:** esquema por almacén con **tabla, columna, tipo, nulabilidad,
default, restricción** e índices, más las reglas de frontera: qué referencias
son opacas y por qué no hay clave foránea. Y los **contratos de interfaz**
(`MSG-`) —endpoints, eventos o comandos— con su versión y su forma.

**Cierre:** cada invariante de F3 apunta a dónde se hace cumplir —restricción de
base de datos, bloqueo, código— o se declara explícitamente que no se hace
cumplir. Cada tipo de dato sensible —dinero sobre todo— tiene decisión escrita.

### F6 — Fiabilidad

**Entrada:** F2 (RNF/EAC), F4 y F5.

**Pregunta:** qué se mide, con qué fórmula y **de qué fuente que ya exista**;
qué meta interna se persigue, en qué ventana y con cuánto presupuesto de error;
qué se promete hacia afuera y qué queda excluido.

**Salida:** tres documentos encadenados —**SLI** mide, **SLO** persigue, **SLA**
promete— donde el SLA **no introduce umbrales propios**: cada promesa apunta al
SLO que la respalda, y cada SLO al SLI que lo prueba.

Distingue dos clases de objetivo: los que admiten **presupuesto de error** y los
**invariantes sin presupuesto** (corrección, dinero, seguridad, privacidad). Un
presupuesto de error es un permiso para fallar una fracción del tiempo; hay
cosas donde ninguna fracción es aceptable, y decirlo es el trabajo.

**Cierre:** ningún SLI sin fórmula y fuente; ningún SLO sin ventana de medición;
ninguna promesa del SLA sin SLO detrás. Ver
[references/FIABILIDAD.md](references/FIABILIDAD.md).

### F7 — Plan de implementación

**Entrada:** todo lo anterior.

**Salida:** backlog de tickets (`T-`) donde cada ticket lleva: objetivo, **IDs
que satisface** (`RF-`, `CDU-`, `EAC-`…), criterios de aceptación verificables,
dependencias por ID, tamaño y evidencia esperada — el comando o la prueba que
demuestra que está hecho, no la afirmación de que lo está.

Los tickets se ordenan por **dependencia y riesgo**, no por comodidad: lo que
puede invalidar el diseño va primero, aunque no se vea en pantalla.

**Cierre:** todo RF y todo CDU está cubierto por al menos un ticket, o consta
como fuera de alcance. Ningún ticket con criterio de aceptación no verificable.

### F8 — Cronograma

**Entrada:** el backlog de F7 y la capacidad real de F0.

**Salida:** cronograma con fases, hitos (`H-`), asignación, **ruta crítica
señalada**, holgura y riesgos con plan de mitigación; tabla de tickets con
fechas y un diagrama de Gantt en texto versionable.

El método —unidades de estimación, capacidad real frente a nominal, rangos en
vez de puntos, cálculo de la ruta crítica y colchón— está en
[references/ESTIMACION.md](references/ESTIMACION.md). **Léelo antes de poner la
primera fecha.** Un cronograma sin ruta crítica es una lista de deseos ordenada.

**Cierre:** el hito final cae dentro de la restricción dura de F0, o está
escrito cuánto se pasa y qué habría que recortar para no pasarse.

### F9 — Trazabilidad y cierre

**Salida:** las matrices que cierran el círculo —RF×stakeholder, RF×RNF,
CDU×EAC, CDU×actor, HU×RF, T×RF— y un **informe de huecos**: qué ID no aparece
en ninguna matriz.

**Cierre:** todo requisito llega a un ticket; todo ticket viene de un requisito.
Lo que no cumpla una de las dos cosas se nombra: alcance sin construir, o
trabajo que nadie pidió.

## La cadena

Todo el valor de estos documentos está en que se citan entre sí. Esta es la
cadena que las matrices de F9 verifican:

```
STK (a quién le importa)
  └─ CAR (qué característica lo atiende)
      └─ RF / RNF (qué exige exactamente)
          ├─ EAC (con qué escenario se comprueba)
          ├─ ADR / D (qué decidimos por su causa)
          │   └─ TBL / MSG (qué forma toman los datos)
          ├─ CDU / HU (cómo se usa)
          │   └─ E + INV (qué no puede romperse)
          ├─ SLI → SLO → SLA (qué medimos, buscamos y prometemos)
          └─ T (qué ticket lo construye)
              └─ H (en qué hito entrega)
```

Regla: **todo nodo apunta hacia arriba y hacia abajo**. Un ADR que no cita un
driver es un gusto personal. Un ticket que no cita un requisito es alcance que
nadie pidió. Un SLO que no cita un SLI es una intención.

## Modo retrofit

Cuando el sistema ya existe, el orden se invierte y la regla cambia:
**el código es la fuente de la verdad, no la memoria de nadie.**

1. Lee el código antes de escribir cada documento, y cita archivo y línea.
2. Escribe lo que el sistema **hace**, no lo que debería hacer.
3. Cuando el código y la intención discrepen, no elijas: escribe ambas y marca
   `[DIVERGENCIA: el código hace X, el diseño dice Y]`. Esa lista es el
   hallazgo más valioso de todo el ejercicio.
4. Las decisiones se reconstruyen como ADR con la fecha real en que se tomaron
   si el historial la conserva, y con `[SUPUESTO]` cuando no.
5. Lo que falte se registra como deuda con su ID, no se completa a mano.

## Encaje con otras skills

Esta skill **funda** el proyecto; no lo implementa. Al cerrar F8, si el
repositorio tiene flujo de especificación, planificación o implementación,
entrégale el backlog y detente. Si no lo tiene, el backlog de F7 ya es
ejecutable ticket a ticket.

## Referencias

- [references/FASES.md](references/FASES.md) — banco de preguntas por fase.
- [references/ESTIMACION.md](references/ESTIMACION.md) — método del cronograma.
- [references/FIABILIDAD.md](references/FIABILIDAD.md) — SLI, SLO y SLA.
- [references/ANTIPATRONES.md](references/ANTIPATRONES.md) — cómo se ve un
  documento que no sirve, y qué hacer en su lugar.
- [templates/](templates/) — una plantilla por artefacto.
