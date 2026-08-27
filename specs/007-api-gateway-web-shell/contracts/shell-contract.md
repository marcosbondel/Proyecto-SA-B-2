# Contrato del shell: lo que T-16 a T-20 heredan

**Fase 1** · 2026-08-24 · [plan.md](../plan.md)

Cinco tickets construyen su módulo sobre esto. El propósito de fijarlo aquí es
que ninguno de los cinco tenga que leer el código del Gateway ni inventar su
propia integración (SC-011).

---

## Convención de módulos

Cada microservicio pone sus cosas en dos lugares y en ningún otro:

```
apps/web/app/pages/<modulo>/          # Las pantallas
apps/web/app/components/<servicio>/   # Los componentes propios
```

| Módulo | Carpeta de páginas | Carpeta de componentes | Ticket |
| --- | --- | --- | --- |
| Clientes | `pages/clientes/` | `components/customer/` | T-16 |
| Cuentas | `pages/cuentas/` | `components/account/` | T-17 |
| Transferencias | `pages/transferencias/` | `components/transaction/` | T-19 |
| Auditoría | `pages/auditoria/` | `components/audit/` | T-20 |

Lo compartido vive en `components/shared/` y **lo posee T-15**. Un módulo que
necesite algo compartido nuevo lo pide, no lo añade por su cuenta: es la única
forma de que la interfaz siga siendo una sola.

---

## `useGatewayApi`

El **único** punto por el que el navegador habla con el Gateway. Ninguna pantalla
llama `$fetch` directamente.

Qué resuelve, para que nadie lo vuelva a resolver:

- `baseURL` desde la configuración de entorno (`NUXT_PUBLIC_API_BASE_URL`), sin
  incrustar la dirección en el código (FR-040).
- El token adjunto a toda ruta protegida (FR-041c).
- Los **siete códigos de error** normalizados (FR-041, ver
  [`error-contract.md`](error-contract.md)); uno desconocido cae en
  `INTERNAL_ERROR`.
- `UNAUTHENTICATED` descarta la sesión y lleva a `/login` **antes** de que la
  pantalla vea nada (FR-041d).
- `correlationId` extraído de la respuesta y expuesto junto al resultado,
  también cuando la respuesta es un error.

Lo que **no** hace: decidir qué significa un rechazo de negocio. Eso es de cada
módulo.

---

## Los cuatro componentes compartidos

### `SharedCorrelationIdBadge`

Muestra el `correlationId` y lo copia con una acción. Es la herramienta de
diagnóstico de todo el sistema: es lo que se pega en `GET /api/audit` para
averiguar cómo terminó cualquier cosa.

El prototipo lo dibuja en varias pantallas —etiqueta en versalitas `#75767F`,
valor en cifras tabulares, acción de copiar al lado.

### `SharedAsyncStateAlert`

Los cinco estados, sobre `UAlert`:

| Estado | Origen | Tratamiento en el prototipo |
| --- | --- | --- |
| Pendiente | `202` sin confirmar | ámbar `rgba(180,116,10,.16)` / `#7A4F06` |
| Éxito | Confirmado por consulta o auditoría | verde `rgba(30,122,60,.12)` / `#186A32` |
| Rechazo de negocio | `BUSINESS_REJECTION` | rojo `#F7DCD7` / `#8A1010` |
| Vencimiento del plazo | `REPLY_TIMEOUT` | ámbar, con la copia de "no fue cancelada" |
| Broker no disponible | `BROKER_UNAVAILABLE` | **no existe en el prototipo** — se compone en la familia ámbar |

La copia de los cuatro primeros se porta literal del prototipo. La del quinto se
escribe siguiendo el mismo criterio y se registra como adición intencional.

### `SharedMoneyInput`

`UInputNumber`. Mínimo `0.01`, exactamente dos decimales, quetzales.

**Al enviar convierte a `amountMinor`**, que es como el contrato `money` escribe
el dinero: entero en unidades menores. Un módulo que mande decimales rompe la
validación del Gateway, y esta conversión existe para que ninguno tenga que
acordarse.

### `SharedIdempotencyKeyField`

Genera un UUID y **lo mantiene estable mientras la persona reintenta**. Cambia
solo cuando cambia la intención, no cuando cambia el intento — que es lo que
hace que un reintento sea inocuo.

---

## Formato del dinero y de las fechas

No negociable, viene de `docs/DESIGN.md`:

- `font-variant-numeric: tabular-nums lining-nums` en **todo** valor monetario.
- Prefijo `Q `, separador de miles, siempre dos decimales: `Q 1,250.00`.
- Locale `es-GT` para números y fechas.
- Columnas de moneda alineadas a la derecha.

Vive en `app/lib/money.ts` como función pura, con pruebas (R9).

---

## Sesión

| | |
| --- | --- |
| Dónde vive el token | Estado de la aplicación, **no** `localStorage` (R10) |
| Duración | Una hora, sin renovación (ADR-010) |
| Al caducar | Sesión descartada, redirección a `/login`, distinguible de un rechazo de negocio |
| Sobrevive a recargar | **No**, y es deliberado |

**Ningún módulo implementa sesión.** Ni pantalla de inicio, ni guardado del
token, ni adjuntarlo, ni manejar la caducidad. Es FR-041g y es lo que SC-015
mide: cero código de sesión fuera del shell.

---

## Navegación

`app/lib/navigation.ts` exporta los cuatro módulos con los roles que los ven,
derivado de [`authorization-matrix.md`](authorization-matrix.md). Un módulo
nuevo se añade ahí, no en el `.vue`.

---

## Tema

`app/app.config.ts` lleva los tokens de la revisión **`bonking. Core`** del
sistema de diseño: paleta monocroma obsidiana, Inter, rejilla de 8 px, radios de
8 px en controles y 16–24 px en superficies.

Por decisión del responsable del 2026-08-24, `docs/DESIGN.md` se actualiza a esa
revisión en esta misma feature. **La paleta azul anterior (`#002db5`,
`#2A53FD`) no se implementa en ninguna parte.**

---

## La regla que hace que esto sirva de algo

**Un `202` no es un éxito.** El frontend muestra estado pendiente y no declara
nada hasta confirmarlo por consulta de estado o por auditoría (FR-043).

Es la regla que más fácil se rompe, porque romperla hace que la interfaz se
sienta más rápida. También es la que convierte una demostración en una mentira:
un `202` significa que el sistema aceptó la solicitud, no que la operación
ocurrió.
