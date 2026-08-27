# Revisión visual contra la referencia de Claude Design

**T-15** · 2026-08-24 · exigida por [`docs/DESIGN.md`](../../../docs/DESIGN.md)

## Qué se importó e inspeccionó

Proyecto `4a48d652-297f-4351-9170-d8049427e897` — "bonking | AI-native banking
platform", vía el conector de Claude Design.

| Archivo | Tamaño | Qué aporta |
| --- | --- | --- |
| `bonking.dc.html` | 215 KB, 2 259 líneas | El prototipo. Cada pantalla y cada estado transversal, como entrada independiente |
| `support.js` | 70 KB | **Nada visual.** Es el runtime generado de Claude Design (`dc-runtime`), un artefacto de compilación. No se porta |
| `uploads/DESIGN.md` | — | La revisión `bonking. Core` del sistema de diseño. Ver discrepancia 1 |

## Entradas del prototipo que informan T-15

| Entrada | Dónde aterrizó |
| --- | --- |
| `show.login`, `v.loginError`, `v.loginInactive` | `app/pages/login.vue` |
| `show.activate`, `v.activateOk`, `v.activateExpired` | `app/pages/activar.vue` |
| `show.app` — riel fijo, marca laqueada, `roleLabel` | `app/layouts/default.vue` |
| `show.dash` / `show.cashierDash` / `show.adminDash` | `app/pages/index.vue`, y confirman el filtrado por rol |
| `show.public` | `app/layouts/public.vue` |
| `v.txPending`, `v.txDone`, `v.txFailed`, `v.txTimeout` | `SharedAsyncStateAlert.vue` |
| Bloque `correlationId` con acción de copiar | `SharedCorrelationIdBadge.vue` |
| `up.idle` / `up.loading` / `up.done` / `up.error` | Estados de carga de la foto; las pantallas son T-16 |

**La copia de los estados asíncronos se portó literal**, incluida la del
vencimiento del plazo, que es FR-026 escrito para una persona: *"La operación
sigue en el sistema pero no recibimos confirmación en el tiempo esperado. No
asumas que falló… Reintentar es seguro, la operación es idempotente y no se
duplica."*

---

## Las tres discrepancias

### 1. La paleta — el repositorio estaba desactualizado, y se corrigió

`docs/DESIGN.md` declaraba `Bank USAC Core` con primario `#002db5` y prosa sobre
"authoritative blues" y un primario `#2A53FD`. El proyecto de diseño contiene su
**propia copia de DESIGN.md**, ya en la revisión `bonking. Core`: monocroma,
primario `#0b0c10`, superficie `#f6f6f7`.

`#2A53FD` **no aparece ni una vez** en los 215 KB del prototipo. Las 14 tonalidades
más frecuentes son grises y obsidiana; el color solo aparece en estado operativo
(`#186A32` éxito, `#B01B1B` error, `#7A4F06` ámbar).

Todo lo demás de los dos documentos —tipografía, rejilla de 8 px, radios, cifras
tabulares, formato `es-GT`— era idéntico palabra por palabra. Solo diferían las
secciones de color.

**Resolución (decisión del responsable, 2026-08-24):** se implementa únicamente
la paleta de Claude Design y `docs/DESIGN.md` se actualiza a `bonking. Core`. Sin
esto, ninguna captura de T-15 a T-20 podría coincidir con la referencia que el
propio repositorio declara obligatoria. La cabecera del documento registra el
cambio.

### 2. El rechazo de inicio de sesión — gana la spec

El prototipo separa `v.loginInactive` ("Tu cuenta aún no está activa", con un
botón para reenviar el correo) de `v.loginError` ("Usuario o contraseña
incorrectos").

FR-013, SC-002 y el **criterio 9 del propio ticket** exigen que credenciales
inválidas, correo no registrado y cuenta sin activar produzcan el mismo rechazo
genérico. Se implementó el rechazo genérico.

Conviene decir por qué el prototipo es defendible y aun así no se adoptó: para
llegar a `activationPending` hay que haber acertado la contraseña, de modo que
decírselo a quien ya la sabe no es un oráculo de enumeración. Pero el ticket lo
pide explícitamente y la spec está aprobada. Revisitarlo es una decisión del
equipo, no de esta implementación.

Probado en `apps/gateway/test/auth-login.spec.ts`: los tres rechazos son
idénticos en cuerpo, código y cabeceras.

### 3. El quinto estado no existe en el prototipo — adición intencional

`bonking.dc.html` define **cuatro** estados asíncronos: pendiente, completada,
fallida y timeout. FR-027 exige **cinco**: falta *broker no disponible*.

Se compuso en el mismo idioma —la familia ámbar `#B4740A` / `#7A4F06` que usa el
vencimiento— con copia propia que dice lo que el timeout no puede decir: que
**no se realizó ningún cambio** y que reintentar es gratis.

La distinción entre los dos importa dinero. Un timeout significa que la
operación sigue corriendo y reintentar podría duplicar la intención; un broker
caído significa que no pasó nada. Un componente que los mezclara costaría una
transferencia duplicada.

Visible en `/demo`, con `data-state="BROKER_UNAVAILABLE"`.

---

## Una diferencia de alcance, no una discrepancia

La navegación del prototipo tiene más entradas por rol de las que T-15 entrega
(`Pagos`, `Notificaciones`, `Perfil`, `Validaciones`, `Depósitos`…). FR-036 fija
**cuatro módulos** para el shell: Clientes, Cuentas, Transferencias y Auditoría.
El resto son pantallas de T-16 a T-20 y se añadirán a `app/lib/navigation.ts`
cuando existan.

## Cómo reproducir las capturas

```bash
pnpm build
pnpm --filter web dev
```

| Captura | Ruta | Qué debe mostrar |
| --- | --- | --- |
| Inicio de sesión | `/login` | Marca laqueada, rechazo genérico |
| Activación correcta | `/activar?token=<válido>` | Estado `SUCCESS` |
| Activación rechazada | `/activar?token=<usado>` | `BUSINESS_REJECTION`, idéntico para los tres tokens |
| Navegación · `CLIENTE` | `/` | Clientes, Cuentas, Transferencias. **Sin Auditoría** |
| Navegación · `CAJERO_RECEPTOR` | `/` | Las mismas tres. **Sin Auditoría** |
| Navegación · `ADMINISTRADOR` | `/` | Las cuatro, Auditoría incluida |
| Piezas compartidas | `/demo` | Los cinco estados y los cuatro componentes |

Verificado sobre el build de producción: `/demo` renderiza
`data-state` para `PENDING`, `SUCCESS`, `BUSINESS_REJECTION`, `REPLY_TIMEOUT` y
`BROKER_UNAVAILABLE`, y sin sesión cada módulo redirige a
`/login?next=<ruta>`.

> **Pendiente de recoger: las imágenes.** Los siete estados están verificados por
> respuesta HTTP y por prueba automatizada; las capturas en sí requieren un
> navegador y las toma quien ejecute la demostración.
