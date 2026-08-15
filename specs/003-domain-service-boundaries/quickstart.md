# Quickstart — Verificación de T-02

**Feature**: [spec.md](spec.md) | **Fecha**: 2026-08-14

Una comprobación por cada criterio de éxito del spec. Todo se ejecuta desde la **raíz del
repositorio**. Las comprobaciones mecánicas son necesarias pero no suficientes: SC-001,
SC-011 y SC-012 exigen juicio humano y están marcadas como tales (R13).

Este ticket **no toca código**: no hay build que verificar. `pnpm lint` y `pnpm test` deben
seguir pasando exactamente igual que antes del cambio, y esa es la única verificación de
código relevante — que nada cambió.

## Prerrequisitos

```bash
cd "$(git rev-parse --show-toplevel)"
```

---

## Estructura del entregable

```bash
ls docs/domain/
# Esperado, exactamente 6 archivos:
# README.md  actors.md  bounded-contexts.md  entities.md  message-catalog.md  use-cases.md
```

---

## SC-001 — Comprensión en menos de diez minutos *(humano)*

Se le da a una persona que no participó en el diseño una lista de seis atributos —`balance`,
`documento`, `status` de una transferencia, `emailVerifiedAt`, `accountType`,
`failureReason`— y se le pide nombrar el servicio que puede modificarlos, usando solo
`docs/domain/`. **Pasa** si acierta los seis en menos de diez minutos y sin preguntar.

## SC-002 — Un solo propietario por atributo

```bash
grep -c '^|' docs/domain/bounded-contexts.md   # la matriz existe y tiene filas
```

Revisión: en la matriz de ownership, la columna de propietario tiene **un solo servicio por
fila**. Cero celdas con dos nombres, cero celdas vacías. Contraste contra
[data-model.md §1](data-model.md).

## SC-003 — Entidades completas

```bash
for e in Customer Account Transaction Payment AuditEvent Notification; do
  printf '%-14s ' "$e"; grep -c "^## .*$e" docs/domain/entities.md
done
# Esperado: 1 para cada una
```

Cada sección debe contener identificador, atributos, estados, transiciones legales e
invariantes. Seis de seis.

## SC-004 — Invariantes con fallo definido

```bash
grep -cE '^\| [CATPEXN]-[0-9]+ ' docs/domain/entities.md
```

Revisión: cada invariante tiene servicio protector y fallo esperado. **Cero invariantes con la
columna de fallo vacía o con texto tipo "error"**; el fallo tiene que estar nombrado
(`INSUFFICIENT_FUNDS`, `IDEMPOTENCY_KEY_CONFLICT`, …).

## SC-005 — Los seis flujos completos

```bash
grep -nE '^## ' docs/domain/use-cases.md
# Esperado: crear cliente, crear cuenta, consultar saldo, transferir,
#           activación por correo, login, más las dos secciones transversales
```

Cada flujo con actor, entrada, resultado y al menos un fallo esperado. Seis de seis.

## SC-006 — Cero comandos ambiguos y cero eventos huérfanos

Contra [contracts/message-catalog.md](contracts/message-catalog.md), comprobaciones M-1 y M-2:

- Cada comando tiene exactamente un servicio en la columna "Atiende". **13 de 13.**
- Cada evento tiene al menos un consumidor. **22 de 22.**
- La sección de eventos de Notification & Audit está vacía por diseño (M-3).

## SC-007 — Cero flujos distribuidos sin compensación

Comprobación M-4: los dos caminos que pueden fallar después del débito —`payment.failed` y
`account.credit.rejected`— llevan ambos a `account.debit.compensation.requested` y cierran en
`COMPENSATED`. El único cierre en `FAILED` es el del débito rechazado, donde no hay nada que
deshacer.

## SC-008 — Datos prohibidos enumerados

```bash
grep -in "does not cross\|never crosses\|stays in" docs/domain/bounded-contexts.md | head -20
```

La lista debe cubrir, como mínimo: credencial de acceso, foto del documento y su referencia,
documento completo hacia auditoría, fecha de nacimiento, dirección, `balance` en eventos de
la Saga, `lastActivityAt`, `idempotencyKey` y el token de activación. Cada uno con su motivo.
La única excepción documentada es el correo en `customer.activation.requested`.

## SC-009 — Los tres actores con permisos y frontera

```bash
grep -c "ADMINISTRADOR\|CAJERO_RECEPTOR\|CLIENTE" docs/domain/actors.md
```

Revisión: existe la matriz caso de uso × rol, existe la frontera explícita de lo no permitido,
y existe la marca de que los permisos son propuesta del equipo (FR-045).

## SC-010 — Trazabilidad total

```bash
grep -rniE 'TBD|TODO|to be defined|por definir' docs/domain/
# Esperado: sin resultados
```

Revisión: toda afirmación del modelo remite al enunciado (con sección y página), a una
decisión registrada, o a una decisión del equipo marcada como tal. **Cero afirmaciones sin
origen.** Las decisiones del equipo aparecen en `docs/domain/README.md` como D-01 a D-06.

## SC-011 — Veredicto por principio de la constitución *(humano)*

Un revisor lee solo `docs/domain/` y emite conforme / no conforme para cada uno de los ocho
principios de `.specify/memory/constitution.md`. **Pasa** si puede emitir los ocho veredictos
sin abrir otro documento. Los principios III (bases fuera del cluster) y VII (Kubernetes
local) no aplican a un modelo de dominio: el veredicto correcto es "no aplica", y debe poder
justificarse.

## SC-012 — Aprobación de los tres integrantes *(humano)*

En el issue [#9](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/9) constan tres
comentarios de aprobación —Marcos Bonifasi, Enner Mendizabal, David Barrios— con fecha y
referencia al commit o versión del modelo aprobada. El registro se replica en
`docs/domain/README.md`.

**Esta comprobación es la que cierra el ticket.** Ninguna de las anteriores la sustituye.

## SC-013 — T-03, T-05 y T-06 desbloqueados

Prueba concreta: se toma el enunciado de cada uno de esos tres tickets y se comprueba que
todo lo que necesitan del dominio está en `docs/domain/`. T-05 necesita el catálogo de
mensajes y los consumidores; T-03 necesita saber qué claims produce el login; T-06 necesita
saber cuántas bases hay y de quién es cada una.

## SC-014 — Cero consultas cruzadas en el modelo

```bash
grep -rniE 'query .*(other|another) service|joins? .*(across|between) service|read.*database of' docs/domain/
# Esperado: sin resultados, salvo dentro de una prohibición explícita
```

Revisión: ningún flujo, ninguna entidad y ninguna fila de la matriz describe un servicio
leyendo datos de otro por otra vía que no sea evento o request/reply asíncrono.

---

## Verificación de que no se tocó código

```bash
git diff --name-only main -- apps/ | head
# Esperado: sin resultados

pnpm lint && pnpm test
# Esperado: pasan igual que antes del cambio
```

---

## Coherencia de los documentos editados

```bash
grep -n "docs/domain" ARCHITECTURE.md AGENTS.md docs/DOC_INVENTORY.md \
                      docs/events/README.md docs/architecture/README.md
# Esperado: al menos una referencia en cada uno de los cinco
```

Y que `docs/events/README.md` ya no bloquee el catálogo entero, solo payload, versionado y
convención de topics (R3).

---

## Resumen

| Criterio | Tipo | Cierra con |
| --- | --- | --- |
| SC-002 a SC-010, SC-014 | Mecánico + revisión de tabla | Salida de comando adjuntada al issue |
| SC-001, SC-011, SC-013 | Juicio humano | Nota en el issue con quién lo verificó |
| SC-012 | Aprobación formal | Tres comentarios en el issue #9 |
