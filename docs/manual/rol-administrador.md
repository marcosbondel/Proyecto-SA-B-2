# Manual del Administrador

Esta guía es para quien **supervisa la operación** de Bank USAC: da de alta al
personal, administra el estado de las cuentas y es la única persona que puede
reconstruir qué pasó con una operación.

Los conceptos que se repiten en todas las pantallas están en el
[manual general](README.md#3-cómo-leer-lo-que-el-sistema-te-responde).

## Lo que puedes hacer

| Módulo | Qué puedes hacer |
| --- | --- |
| **Inicio** | El tablero del sistema: clientes, cuentas activas, transferencias y pagos del día, estados de las operaciones y **alertas operativas**. |
| **Clientes** | Registrar personas con **cualquier rol**, incluidos cajeros y administradores. |
| **Cuentas** | Todo lo del cajero, más **Gestión de cuentas**: ver todas las cuentas del sistema con el nombre de su titular, y activarlas o desactivarlas. |
| **Transferencias** | Enviar, consultar, ver el **monitoreo de la Saga** y saltar desde una transferencia a su rastro de auditoría. |
| **Pagos** | Pagar servicios y vigilar los pagos y sus reintentos. |
| **Auditoría** | Reconstruir el rastro completo de una operación y revisar la consola de notificaciones. |

### Cómo leer el tablero

Cada número lo cuenta el servicio dueño de sus propias filas; el sistema
pregunta a los cinco a la vez y dibuja lo que cada uno respondió.

Un recuadro que dice **«Sin dato»** no es un cero: significa que ese servicio no
alcanzó a responder. Un cero ahí sería un número equivocado en la pantalla que
más se mira justo cuando algo va mal.

Dos cifras **no son de hoy**, a propósito:

- **En proceso** cuenta todas las transferencias en vuelo, empezaran cuando
  empezaran. Una atascada desde ayer preocupa más que una de esta mañana: el
  dinero ya salió de una cuenta y todavía no llegó a la otra.
- **Pagos reintentando** son los que fallaron al menos una vez y tienen otro
  intento pendiente. No requieren reproceso manual — la escalera de reintentos
  corre sola.

Las **alertas operativas** salen de esos mismos números, ordenadas por lo que
cuesta ignorarlas: primero el dinero en vuelo, después las compensaciones del
día (el cliente ya vio dos movimientos en su estado de cuenta), y al final los
mensajes que la auditoría no pudo interpretar — no se perdió nada, falta
explicarlos.

Eres el único rol que ve **Auditoría**, y el único que puede **cambiar el estado
de una cuenta**. También eres el único que puede confirmar en pantalla cómo
terminó un registro o una apertura de cuenta: las demás sesiones se quedan en
«solicitud aceptada».

Tu menú lateral tiene seis entradas: **Inicio**, **Clientes**, **Cuentas**,
**Transferencias**, **Pagos** y **Auditoría**.

---

## 1. Dar de alta al personal del banco

Menú **Clientes** → **Nuevo cliente**.

Es el mismo asistente de tres pasos que usa el cajero, y en el primer paso está
el campo **Rol**. Ahí eliges si la persona será **Cliente**, **Cajero receptor**
o **Administrador**.

**Solo un administrador puede crear cajeros y administradores.** El registro
público siempre crea un Cliente, y el sistema lo impone: si no fuera así,
cualquiera podría nombrarse administrador a sí mismo.

El alta funciona igual que cualquier otra: la persona recibe un enlace de
activación y no podrá iniciar sesión hasta abrirlo. Dale su **customerId** antes
de que termine el trámite.

> **El primer administrador no se crea desde aquí.** Como hace falta una sesión
> de administrador para crear otro, el primero lo prepara el equipo técnico al
> instalar el sistema.

## 2. Gestión de cuentas

Menú **Cuentas** → botón **Gestión de cuentas**.

Es la vista de todas las cuentas del sistema, no solo las tuyas.

### Lo que muestra

| Columna | Qué contiene |
| --- | --- |
| Número | El identificador de la cuenta. |
| Titular | El **nombre del titular**, con su identificador debajo en letra pequeña. |
| Tipo | Monetaria o Ahorro. |
| Estado | Activa o Inactiva. |
| Última actividad | Cuándo se movió por última vez, o `—` si nunca. |
| Saldo | El saldo actual. |

> La columna **Titular** muestra el nombre porque esta pantalla pregunta a dos
> servicios: el de cuentas da las cuentas y el de clientes da los nombres. Son
> dos servicios separados a propósito y ninguno lee la base del otro, así que si
> el de clientes no alcanza a responder, la columna cae al identificador. Un
> identificador donde esperabas un nombre no es un error de datos: es esa
> segunda consulta que no llegó.

### Filtros

- **Búsqueda libre** por número de cuenta o titular — filtra lo que ya está en
  pantalla.
- **Estado** (Todos / Activa / Inactiva) y **Tipo** (Todos / Monetaria /
  Ahorro) — vuelven a preguntar al banco.

### El aviso de desactivación automática

Cuando hay cuentas activas con saldo menor a **Q 50.00**, aparece un aviso
arriba con cuántas son. Un proceso automático desactiva las cuentas que llevan
**seis meses sin movimientos con saldo menor a Q 50.00**. Las que aparecen en el
aviso ya cumplen la condición de saldo; se desactivarán cuando cumplan también
la de tiempo.

### Desactivar o reactivar una cuenta

1. Pulsa **Desactivar** o **Reactivar** en la fila de la cuenta.
2. Se abre un panel debajo de la tabla con el identificador de la cuenta y un
   campo **Motivo**.
3. **El motivo es obligatorio.** Es el único registro de por qué se hizo el
   cambio: no hay un proceso automático detrás del cual deducirlo. Escribe algo
   que le sirva a quien lea esto en seis meses.
4. **Confirmar**.

El cambio **no es inmediato**. La pantalla dirá que la solicitud fue aceptada y
recargará la lista. Si el estado todavía no cambió, actualiza en unos segundos:
la lista dice la verdad cuando el cambio aterriza.

Recuerda que una cuenta inactiva **se reactiva sola** si recibe una
transferencia; no siempre hace falta intervenir.

## 3. Auditoría: reconstruir qué pasó

Menú **Auditoría**.

Esta es la herramienta que nadie más tiene. Se consulta por **identificador de
correlación**: el código que acompaña a cada operación por todos los servicios
del banco, y que aparece al pie de las pantallas y en cada aviso de error.

### Cómo consultar

1. Pega el identificador de correlación en el campo.
2. Pulsa **Consultar**.

El identificador queda en la dirección de la página, así que puedes **compartir
el enlace** con el resultado ya cargado. Desde el detalle de una transferencia,
el botón **Ver auditoría** te trae aquí con el identificador ya puesto.

### Cómo leer el resultado

Arriba está el resumen: cuántos **eventos**, cuántos **servicios**
participaron y cuánto **duró** la operación de punta a punta. Si algún mensaje
no pudo leerse, aparece un contador rojo.

La tabla tiene una fila por evento, en orden:

| Columna | Qué muestra |
| --- | --- |
| Momento | Cuándo ocurrió. |
| Tipo de evento | Qué pasó. Se colorea: rojo para fallos y compensaciones, verde para lo que se completó. Debajo indica qué evento lo causó. |
| Servicio origen | Qué servicio lo publicó. |
| eventId | El identificador del evento. |
| Registro | Si quedó **Registrado**, **Inválido** o con **Error**. |

Los filtros por **servicio** y por **tipo de evento** trabajan sobre lo que ya
está en pantalla.

El botón **Detalle** abre un panel lateral con el contenido completo del evento
y qué lo causó.

> **Lo que la auditoría no guarda.** Los montos, los documentos y los correos
> aparecen como `[redactado]`. El servicio de auditoría guarda los contenidos ya
> ocultos: nunca almacena el original. Esos datos viven en la base del servicio
> que los posee. Es una decisión de privacidad, no una limitación técnica: es la
> única base de datos que escucha todos los eventos del banco, y por eso es la
> que menos debe guardar.

### Cuando no aparece nada

La pantalla lo dice sin adivinar: puede significar que la operación nunca
existió, que **todavía está en curso**, o que el servicio de auditoría estaba
caído cuando ocurrió. Si la operación es reciente, espera unos segundos y vuelve
a consultar.

### Cuando la consulta no responde

Si ves *«No pudimos confirmar el resultado»*, el banco publicó la pregunta y
nadie contestó en cinco segundos. Lo más probable es que el servicio de
auditoría no esté corriendo. No significa que la operación haya fallado.

## 4. Consola de notificaciones

Menú **Auditoría** → botón **Consola de notificaciones**.

Lista los avisos que el sistema generó, con su **estado real de entrega**:

| Estado | Qué significa |
| --- | --- |
| **Pendiente** | Se creó y todavía no se ha entregado. |
| **Enviada** | El canal la dio por entregada. |
| **No enviada** | El canal no pudo entregarla. **No se reintenta.** |

Se filtra por estado, y un aviso rojo aparece cuando alguna falló.

Si llegas aquí desde el rastro de una operación, la consola se abre acotada a
esa correlación y puedes volver al flujo completo o quitar el filtro con **Ver
todas**.

> **De este sistema no sale ningún correo: los envíos son simulados.** Por eso
> una notificación fallida no se reintenta — no hay un servidor de correo que
> pueda estar temporalmente caído. Y por eso una notificación fallida **no
> afecta la operación bancaria**: el dinero se movió igual.

Esta consola es una herramienta de supervisión, no una bandeja de entrada: no
hay estado de leído ni forma de marcar avisos.

## 5. Lo que sí puedes confirmar y los demás no

Cuando un cliente o un cajero registra a alguien, actualiza una ficha o abre una
cuenta, la pantalla se queda en *«solicitud aceptada»* y no puede decirles cómo
terminó. La tuya sí: tu sesión consulta el rastro de auditoría y confirma el
desenlace.

Por eso, cuando alguien te reporte un problema, **lo primero que hay que pedirle
es el identificador de correlación**. Con él, esta es la única pantalla del
sistema que puede decir exactamente qué ocurrió.

---

## Problemas comunes

**Desactivé una cuenta y sigue apareciendo activa.**
El cambio es asíncrono. Actualiza la lista en unos segundos.

**La auditoría no devuelve nada para una operación que acabo de ver.**
Espera unos segundos y vuelve a consultar: puede que el evento aún no se haya
registrado.

**La auditoría responde «No pudimos confirmar el resultado».**
El servicio de auditoría probablemente no está corriendo. Es el fallo esperado
en ese caso.

**Necesito filtrar la auditoría por fecha.**
No se puede. La auditoría se consulta por identificador de correlación; no hay
navegación general ni filtro de fechas.

**Necesito saber el nombre del titular de una cuenta.**
La gestión de cuentas lo muestra en la columna *Titular*. Si en esa fila aparece
un identificador en vez de un nombre, copia ese identificador y abre la ficha
desde *Clientes → Abrir una ficha*: ahí están los datos completos del cliente.

**Necesito crear otro administrador.**
Desde *Clientes → Nuevo cliente*, eligiendo el rol **Administrador** en el
primer paso.

---

Volver al [manual general](README.md).
