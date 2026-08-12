# Phase 1 — Data Model: Base documental de Bank USAC (T-01)

Este feature no introduce persistencia. Las "entidades" son las estructuras que los documentos entregados deben materializar como tablas, y sus reglas de validación son lo que hace verificable cada criterio de éxito.

---

## Documento

Una ruta `.md` del repositorio. Materializado en `docs/DOC_INVENTORY.md`.

| Atributo | Tipo | Reglas |
|---|---|---|
| `path` | ruta relativa a la raíz | Única. Debe existir |
| `class` | enum | Una de: `project`, `template`, `generated`, `harness`, `vendored` |
| `owner` | persona o `—` | Obligatorio si `class = project`. `—` para el resto |
| `state` | enum | `current`, `blocked`, `stale`, `not-applicable` |
| `last_reviewed` | fecha | Obligatorio si `class = project` |
| `blocked_on` | texto | Obligatorio si `state = blocked`: qué falta, quién lo entrega y en qué ticket |

**Clases.**

- `project`: documentación viva de Bank USAC. Es autoridad. La escribe y mantiene una persona nombrada.
- `template`: plantilla reutilizable, `docs/templates/`. Se copia, no se lee como verdad.
- `generated`: producido a partir de otra fuente, `docs/generated/`. Se regenera, no se edita.
- `harness`: normativo del entorno de agentes — roles, skills, plantillas de Spec Kit, comandos por herramienta. Rige cómo se trabaja, no qué se construye.
- `vendored`: instalado por una herramienta externa y no editado aquí.

**Transiciones de estado.**

```
current ──(llega información que lo contradice)──> stale ──(se corrige)──> current
current ──(se detecta un vacío que nadie puede llenar hoy)──> blocked
blocked ──(el responsable entrega la información)──> current
```

**Invariante de cobertura.** Todo `.md` del repositorio queda cubierto por una fila del inventario o por una regla de directorio. El comando de `quickstart.md` no debe devolver ninguna línea.

**Regla de directorio.** Atributos: `glob`, `class`, `owner`, `note`. Cubre un conjunto de archivos con una sola entrada. Solo puede usarse para clases distintas de `project`.

---

## Componente

Una pieza del sistema con dueño. Materializado en `docs/OWNERSHIP.md`.

| Atributo | Tipo | Reglas |
|---|---|---|
| `name` | texto | Único |
| `type` | enum | `service`, `gateway`, `frontend`, `infrastructure`, `documentation` |
| `primary_owner` | persona | **Exactamente uno**. Nunca vacío, nunca dos |
| `scope_note` | texto | Qué incluye y qué no, cuando el nombre no basta |

**Población obligatoria — nueve componentes.** Los cinco servicios del enunciado (Customer, Account, Transaction, Payment, Notification & Audit), el API Gateway, el frontend, la infraestructura/SRE y la documentación.

**Invariante.** La unión de los componentes cubre el sistema completo, y ningún componente tiene dos responsables primarios. El trabajo compartido —contratos de eventos, integración, pruebas, revisión final— se registra aparte y no diluye la propiedad primaria.

---

## Restricción no negociable

Una regla que el diseño no puede violar. Materializada dos veces con el mismo contenido: como descripción en `ARCHITECTURE.md` y como principio en `.specify/memory/constitution.md`.

| Atributo | Tipo | Reglas |
|---|---|---|
| `id` | `NN-nombre` | Estable. Los planes futuros lo citan |
| `statement` | texto | Redactado de forma que una propuesta pueda ser conforme o no conforme |
| `source` | sección y página del enunciado | Obligatorio y verificado contra el PDF, no copiado del ticket |
| `conformance_check` | texto | Cómo se decide el veredicto sin interpretación |
| `penalty` | texto | Qué penaliza el enunciado si se viola, cuando lo dice explícitamente |

**Población obligatoria.** Las ocho de [research.md](research.md#r4--cuáles-son-de-verdad-las-restricciones-no-negociables).

**Invariante.** Las dos materializaciones no pueden divergir: si una cambia, la otra cambia en el mismo commit.

---

## Hito

Un punto de control del cronograma. Materializado en `docs/METHODOLOGY.md`.

| Atributo | Tipo | Reglas |
|---|---|---|
| `id` | `H1`–`H6` | Único |
| `date` | fecha absoluta | Dentro del rango del enunciado: 2026-08-06 a 2026-09-03 |
| `tickets` | lista | No vacía |
| `objective` | texto | Qué debe ser cierto al cerrar el hito |

**Invariante.** Todo ticket de T-01 a T-19 pertenece a exactamente un hito, salvo los explícitamente absorbidos. La fecha de un hito no puede ser posterior a la fecha de entrega del ticket más tardío que contiene.

---

## Dependencia declarada

Una entrada del manifiesto de la aplicación web. No se materializa como tabla propia: gobierna la poda de FR-021 y alimenta las filas de `docs/TECH_DEBT.md`.

| Atributo | Tipo | Reglas |
|---|---|---|
| `package` | texto | Del manifiesto |
| `justification` | enum | `decision` (hay decisión registrada), `tooling` (lo exige la herramienta), `pending` (plausible, sin decisión), `none` |
| `resolves_in` | ticket | Obligatorio si `justification = pending` |

**Regla de transición.** `justification = none` obliga a retirar el paquete. `pending` obliga a una fila en `docs/TECH_DEBT.md` con su ticket. Ninguna dependencia puede quedar sin clasificar: eso es lo que verifica SC-010.
