# Phase 1 — Quickstart: cómo se verifica que T-01 está hecho

Una comprobación por criterio de éxito. Las que son comandos se ejecutan desde la raíz del repositorio y su salida real se adjunta al ticket como evidencia; las que son revisión humana dicen quién la hace.

**Prerrequisitos**: `pnpm` disponible, y el repositorio en el estado posterior al cambio.

---

## SC-008 y FR-023 — La aplicación sigue construyendo tras la poda

```sh
cd apps/web && pnpm install && pnpm build
```

**Esperado**: ambos comandos terminan con éxito. Es la única verificación ejecutable de código que existe en el repositorio: no hay script de test ni de lint (TD-004). La salida completa se pega en el ticket.

**Si falla**: se restituye la dependencia que rompió y se reporta el hallazgo. No se fuerza el cambio.

---

## SC-010 — Las dependencias retiradas ya no aparecen

```sh
grep -nE '@tiptap|pdf-frame|nuxt-anime|@jasy/nuxt' apps/web/package.json apps/web/nuxt.config.ts
```

**Esperado**: sin salida, código de salida 1.

Y la contraparte, que el exportador de métricas sí siga presente **y** registrado como pendiente:

```sh
grep -n 'nuxt-prometheus' apps/web/package.json apps/web/nuxt.config.ts
grep -n 'prometheus' docs/TECH_DEBT.md
```

**Esperado**: las tres apariciones. Si la dependencia está pero no la fila de deuda, SC-010 falla.

---

## SC-005 y FR-017 — Sin placeholders sueltos

```sh
grep -rni --include='*.md' -E 'TBD|TODO|to be defined|not been selected|still a placeholder' \
  README.md ARCHITECTURE.md AGENTS.md CLAUDE.md docs/ \
  | grep -v '^docs/templates/'
```

**Esperado**: solo líneas que sean marcas de bloqueo con responsable y ticket, con la forma `> **Blocked**: … Owner: … Arrives with: …`. Cualquier otra coincidencia es un placeholder muerto y falla el criterio.

`docs/templates/` queda excluido a propósito: es plantilla, y sus marcadores son su contenido legítimo.

---

## SC-006 — Sin contradicciones entre los documentos de estado

```sh
grep -rni --include='*.md' -E 'not initialized|no spec workflow|placeholder|has not been (selected|decided)' \
  README.md ARCHITECTURE.md AGENTS.md CLAUDE.md docs/TECH_DEBT.md
```

**Esperado**: sin salida. Verificado después de T-01: no document states that Spec Kit is uninitialized or that the architecture remains a placeholder.

---

## SC-004 — Cobertura del 100% del inventario

Lista total de archivos Markdown del repositorio:

```sh
find . -name '*.md' -not -path './.git/*' -not -path '*/node_modules/*' | sort
```

**Esperado**: 114 archivos el 2026-08-11 (17 de proyecto, 84 del andamiaje, 8 de este spec, 3 plantillas, 2 generados), y 117 tras crear los tres documentos nuevos. Cada uno debe quedar cubierto por una fila de `docs/DOC_INVENTORY.md` o por una de sus reglas de directorio. `docs/DOC_INVENTORY.md` publica el comando exacto que resta lo cubierto de lo listado; su salida esperada es vacía.

**Nota para quien escriba el inventario**: 21 de los archivos bajo `.claude/` y `.opencode/` son symlinks a cuerpos que ya viven en `.agents/`. El inventario los cubre por regla de directorio y declara la relación, en lugar de contarlos dos veces como documentos distintos.

**Revisión adicional**: se toman tres rutas al azar de la lista y se comprueba que el inventario dice su clase. Para las de clase `project` debe decir además su responsable nominal; el andamiaje se cubre por regla de directorio y no lleva responsable individual. Lo hace quien revisa el diff, no quien lo escribió.

---

## SC-002 — Nueve componentes, un responsable cada uno

**Esta verificación es humana, no un comando.** Un `grep` de filas de tabla cuenta también los separadores y la tabla de trabajo compartido, así que nunca da nueve y da una falsa sensación de comprobación.

Se revisa la tabla de responsables primarios de `docs/OWNERSHIP.md` a mano contra el [data-model](data-model.md#componente): los nueve componentes están, ninguno tiene dos responsables, ninguno está vacío, y las personas nombradas pertenecen al equipo registrado.

---

## SC-003 y SC-011 — Restricciones registradas y ejecutables

```sh
grep -c '^### ' .specify/memory/constitution.md
grep -nE '\[PRINCIPLE_|\[SECTION_|\[GOVERNANCE_' .specify/memory/constitution.md
```

**Esperado**: **ocho** principios; ningún marcador de plantilla sin reemplazar.

**Prueba de ejecutabilidad**, que es la que de verdad importa: se toma una propuesta deliberadamente inválida —"el Transaction Service lee la tabla de balances del Account Service"— y se contrasta contra la constitución. Debe resultar **no conforme por el principio II** sin necesidad de interpretar. Si el veredicto admite discusión, el principio está mal redactado.

Y la coherencia entre las dos materializaciones:

```sh
grep -nE 'asynchronous|Gateway|Saga|correlationId|Kubernetes|SRE' ARCHITECTURE.md
```

**Esperado**: las **ocho** restricciones aparecen también en `ARCHITECTURE.md`, sin contradecir la redacción de la constitución. Las dos que se perdieron una vez cada una —Kubernetes local y SRE desde el diseño— están explícitamente en el patrón de búsqueda por eso mismo.

---

## SC-001 y SC-009 — El repositorio se explica solo

No hay comando. Lo verifica una persona del equipo que no escribió el cambio:

1. Lee únicamente `README.md` y `ARCHITECTURE.md`, sin abrir el PDF ni el tablero.
2. Responde por escrito: cuáles son los cinco servicios, por qué no pueden comunicarse de forma síncrona, dónde viven las bases de datos, y a quién se le pregunta por el Payment Service.
3. Dice si podría arrancar T-02 sin pedir contexto por chat.

**Esperado**: las cuatro respuestas correctas en menos de diez minutos. Si alguna falla, el documento tiene un vacío, no el lector.

---

## SC-013 y SC-015 — El style guide cubre sus ocho áreas y es alcanzable

```sh
grep -nE '^## (Principles|Color|Typography|Spacing|Components|UI States|Accessibility|Domain Formats)' docs/DESIGN.md
grep -n 'Pending decision' docs/DESIGN.md || true
grep -n 'DESIGN.md' AGENTS.md CLAUDE.md
```

**Esperado**: las ocho secciones por nombre —contarlas con `grep -c '^## '` no sirve, cualquier encabezado extra rompe el conteo—; no output from the pending-decision command because the T-01 baseline is approved; and the links from `AGENTS.md` and `CLAUDE.md` include the mandatory consultation instruction and the note that prevents removing them without an explicit team decision (FR-032). Future pending decisions must name an owner and blocker.

**Prueba real de SC-014**: se toma una pantalla imaginaria —el formulario de transferencia— y se enumeran las decisiones visuales que exige: color del botón primario, tipografía del monto, espaciado entre campos, componente de formulario, qué se muestra mientras la Saga está pendiente, y cómo se formatea `Q 1,250.00`. Todas deben salir del documento. Cada una que obligue a improvisar es un hueco.

---

## SC-007 — Los tres integrantes conocen la metodología

Confirmación escrita de los tres en el ticket T-01. No es un comando y no se sustituye por "se los envié".

---

## SC-012 — Sin documentos que mezclen idiomas

Revisión humana sobre el diff: cada documento duradero está íntegramente en inglés. La excepción declarada es la línea de identidad del README, que nombra curso, sección y grupo tal como los espera quien califica.

---

## Cierre

El ticket se cierra cuando las comprobaciones ejecutables pasan **y** las tres revisiones humanas —lectura sin contexto, tabla de responsables, prueba de la propuesta inválida— están hechas por alguien distinto de quien escribió el cambio. Un criterio verificado sin evidencia enlazada no cuenta como verificado: esa es la definición de terminado que el propio `docs/METHODOLOGY.md` va a declarar.
