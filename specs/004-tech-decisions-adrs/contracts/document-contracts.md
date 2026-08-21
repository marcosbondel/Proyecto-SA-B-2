# Contract: qué debe contener cada documento entregado

Por archivo: qué secciones son obligatorias, qué no puede afirmar, y cuál es su fuente
autorizada. Es lo que convierte "está documentado" en algo falsable.

**13 archivos nuevos, 8 editados, 0 bajo `apps/`.**

---

## Nuevos

### `docs/architecture/adr/README.md` — índice del registro

**Obligatorio**: tabla de los once ADRs con `id`, título, estado, fecha y enlace. Nota de
gobernanza que declara: las decisiones aquí registradas son **restricciones de diseño para
todas las specs siguientes**, y cambiar una aprobada exige un ADR nuevo que marque al anterior
como `Superseded` (FR-011). Registro de la aprobación del equipo (FR-009).

**No puede**: repetir el razonamiento de los ADRs; contener decisiones que no tengan archivo.

**Fuente**: los once ADRs.

### `docs/architecture/adr/ADR-001…ADR-011` — los once ADRs

**Obligatorio**: [`adr-template.md`](adr-template.md), incluidos los requisitos específicos por
ADR.

**Fuente**: enunciado (rev. 2026-08-13), constitución, `docs/domain/`, y las decisiones de la
User Story 2 del spec para ADR-010.

### `docs/architecture/decision-matrix.md` — la matriz

**Obligatorio**: una fila por decisión con las siete columnas de
[`data-model.md`](../data-model.md) §2; los **seis trade-offs** del ticket redactados; las
**dos penalizaciones como reglas separadas** con su porcentaje y su sección.

**No puede**: repetir el argumento de un ADR (R6); existir sin enlazar a los once.

**Fuente**: los once ADRs. La matriz nunca decide nada por su cuenta.

---

## Editados

### `ARCHITECTURE.md`

**Obligatorio**: (1) enlaces a cada ADR vigente desde la sección correspondiente — la sección
"Stack" cita ADR-001, ADR-002, ADR-004, ADR-005, ADR-006, ADR-007, ADR-008, ADR-009;
"Dependency Rules" cita ADR-003 y ADR-010; "Related Docs" añade el índice y la matriz (FR-008).
(2) La sección "Current State" **deja de afirmar** que el Gateway y los servicios backend son
trabajo futuro y que `apps/web/` es el starter de Nuxt (FR-008a). (3) Los comandos definitivos
de desarrollo, pruebas y despliegue quedan registrados o enlazados (FR-008).

**No puede**: contradecir la constitución; describir como existente lo que no está construido
—infraestructura local (T-06), chart de Helm y el despliegue en kind (T-21, T-22), lógica de dominio—; ni seguir describiendo
como ausente lo que sí existe.

**Fuente**: el estado real del workspace, verificado; los ADRs.

> El scaffolding verificado a 2026-08-15: `apps/gateway`, los cinco servicios de
> `apps/services/`, `apps/web`, y `apps/packages/{contracts,messaging,tooling}`. Cada servicio
> tiene `main.ts`, `app.module.ts`, health controller y validación de entorno; las capas
> `domain/` y `application/` contienen solo `README.md`, vacías **a propósito**.

### `docs/RELIABILITY.md`

**Obligatorio**: la sección "SLI, SLO, And SLA" sustituye el bloque `Blocked` por los **6 SLI
con fórmula y fuente**, los **5 SLO con umbral numérico** y el **SLA con alcance académico**,
según [`data-model.md`](../data-model.md) §3 (FR-007). Más la obligación de instrumentación que
esto impone a cada servicio (§3.4).

**No puede**: dejar el marcador `Blocked` que nombra a T-03; presentar valores medidos —eso es
**T-24**—; ni declarar disponibilidad productiva.

**Fuente**: [`data-model.md`](../data-model.md) §3.

### `docs/architecture/README.md`

**Obligatorio**: enlazar `adr/`. **Acotar** el marcador `Blocked` final: los ADRs dejan de
estar bloqueados; los ocho diagramas siguen esperando a T-07 … T-14. Alinear el texto de
herramientas con ADR-011.

**No puede**: seguir afirmando que "las decisiones tecnológicas viven en el ticket de Notion y
no están formalizadas".

### `docs/SECURITY.md`

**Obligatorio**: la sección "Access Model" registra que el modelo de autenticación **ya está
decidido** y enlaza ADR-010. El marcador `Blocked` se acota a lo que sigue abierto: reglas de
autorización por endpoint (**T-15**, el contrato del Gateway) y política de acceso entre servicios / carga de secretos
(**T-06**).

**No puede**: contener secretos ni valores reales; declarar resuelto lo que ADR-010 dejó fuera
de alcance (revocación de tokens).

### `docs/DOC_INVENTORY.md`

**Obligatorio**: una fila `project` por cada documento nuevo (13), con owner Marcos Bonifasi y
fecha de revisión. El estado de `docs/RELIABILITY.md` pasa de `blocked` a `current`; el de
`docs/SECURITY.md` se mantiene `blocked` (sigue esperando a T-06 y T-15) con la razón
actualizada.

### `docs/design-docs/index.md`

**Obligatorio**: una fila que apunta al índice de ADRs, con estado `Active`. Los once ADRs
**no** se listan uno por uno: su índice es `docs/architecture/adr/README.md` y duplicar la
tabla la haría divergir.

### `AGENTS.md`

**Obligatorio**: una entrada en el índice de documentación hacia
`docs/architecture/adr/README.md`, redactada como las vecinas: cuándo leerlo — antes de
introducir o cambiar una tecnología, o de escribir una spec que dependa del stack.

### `docs/QUALITY_SCORE.md`

**Obligatorio**: la fila Reliability deja de esperar a T-03. Sigue esperando a **T-24** para
las mediciones reales, que es una cosa distinta de la definición.

---

## Verificación transversal

| # | Regla | Criterio |
| --- | --- | --- |
| D-1 | `git diff -- apps/` está vacío | Cero código |
| D-2 | `pnpm lint` y `pnpm test` pasan sin cambios respecto a `main` | Prueba de que no se tocó código |
| D-3 | Los 13 documentos nuevos están en inglés | R1, FR-020 de T-01 |
| D-4 | Ningún documento entregado contradice la constitución ni `docs/domain/` | SC-005, FR-010 |
| D-5 | Ningún marcador `Blocked` sigue nombrando a T-03 como pendiente | R10 |
| D-6 | Cada uno de los 11 ADRs aparece en el índice, en la matriz y en `ARCHITECTURE.md` | SC-006, A-5 |
