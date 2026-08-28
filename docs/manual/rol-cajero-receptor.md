# Manual del Cajero Receptor

Esta guía es para el **personal de ventanilla**: quien atiende al cliente que
tiene enfrente, lo registra, le abre cuentas y transfiere por él.

Los conceptos que se repiten en todas las pantallas —qué significa «solicitud
recibida», el identificador de correlación, la clave de idempotencia— están en
el [manual general](README.md#3-cómo-leer-lo-que-el-sistema-te-responde).

## Lo que puedes hacer

| Módulo | Qué puedes hacer |
| --- | --- |
| **Clientes** | Registrar clientes con cualquier rol, actualizar tus datos, abrir la ficha de un cliente, entrar a la cola de validación de identidad. |
| **Cuentas** | Abrir cuentas **a nombre de otro cliente**, consultar cuentas y sus movimientos. |
| **Transferencias** | Enviar transferencias entre cuentas y seguir su estado. |
| **Pagos** | Vigilar el paso de pago de las transferencias y sus reintentos. |

**Lo que no puedes hacer:** activar o desactivar cuentas (es del Administrador),
ni consultar el rastro de auditoría ni la consola de notificaciones.

Tu menú lateral tiene cuatro módulos: **Clientes**, **Cuentas**,
**Transferencias** y **Pagos**.

---

## 1. Registrar a un cliente en ventanilla

Menú **Clientes** → botón **Nuevo cliente**.

Es un asistente de tres pasos. Lo llenas tú con los datos y el documento que
trae la persona.

**Paso 1 — Datos personales**

| Campo | Qué pedirle a la persona |
| --- | --- |
| Nombre completo | Como aparece en el documento. Al menos un nombre y un apellido. |
| Fecha de nacimiento | Debe tener **18 años o más**. El campo muestra la edad calculada. |
| Dirección | Su dirección de residencia. |
| Correo electrónico | **Un correo al que tenga acceso.** Ahí llega el enlace de activación, y sin abrirlo no podrá entrar. |
| **Rol** | Cliente, Cajero receptor o Administrador. En ventanilla es casi siempre **Cliente**. |

El campo **Rol** es lo único que distingue este formulario del registro público.
Úsalo con cuidado: es el que decide qué podrá hacer esa persona en el sistema.

**Paso 2 — Documento de identidad**

El número de DPI (13 dígitos) y una **foto del documento**, JPG o PNG de menos
de 5 MB. Si la imagen no sirve, el sistema lo dice antes de enviar nada.

**Paso 3 — Confirmación**

Revisa los datos con la persona presente, escribe la contraseña inicial (mínimo
8 caracteres) y acepta los términos. El **username** lo propone el sistema a
partir del nombre; si ya existe, le añadirá un sufijo.

Pulsa **Crear cuenta**.

### Qué decirle a la persona

La pantalla confirma que el registro fue **enviado**, no completado. Antes de
que se vaya de la ventanilla:

1. **Dale su customerId.** Está en pantalla con un botón para copiarlo. Sin él
   no hay forma de encontrar su ficha después: el sistema no tiene búsqueda de
   clientes.
2. **Explícale la activación.** Le llegará un correo con un enlace. Hasta que lo
   abra, **no podrá iniciar sesión**.
3. **Explícale la validación del documento.** Su acceso queda activo con el
   correo, pero la foto del documento la revisa un cajero después.

Para atender a la siguiente persona, usa el botón **Registrar otro**: además de
limpiar el formulario, empieza una intención nueva, lo que evita que el sistema
confunda dos registros distintos.

## 2. Abrir una cuenta para un cliente

Menú **Cuentas** → **Abrir cuenta**.

1. Elige el tipo: **Monetaria** (uso diario) o **Ahorro** (para guardar; hoy
   funciona igual y **no genera intereses**).
2. Marca la casilla **«La cuenta es para otro cliente»** y pega el **customerId
   del titular**. Es el identificador que devolvió su registro; no hay búsqueda
   por nombre ni por DPI.
3. **Continuar** → revisa la confirmación → **Crear la cuenta**.

La cuenta se abre con **Q 0.00** y activa. **Dale al cliente el número de cuenta**
que aparece al final: es con lo que consulta su saldo y con lo que recibe
transferencias.

> **No hay campo de depósito inicial**, y el sistema no tiene ninguna operación
> que ingrese efectivo. Una cuenta nueva empieza en cero y solo crece recibiendo
> transferencias.

Si dejas la casilla sin marcar, la cuenta se abre **a tu nombre**, no al del
cliente. Revísalo antes de confirmar.

## 3. Transferir por el cliente presente

Menú **Transferencias** → **Nueva transferencia**.

Necesitas el **número de la cuenta de origen**, el de la **cuenta de destino** y
el **monto**. Deja *Escenario de pago* en *«Sin escenario (comportamiento
real)»*: las otras opciones son para demostraciones y fuerzan artificialmente el
resultado del pago.

La pantalla **no comprueba el saldo antes de enviar**. Si no hay fondos, la
transferencia terminará en *Fallida* y el dinero no se habrá movido.

Al enviar llegas a la pantalla de seguimiento, que se actualiza sola. Lo que le
puedes decir al cliente según el estado:

| Estado | Qué decirle |
| --- | --- |
| **Aceptada** / **Debitando** | «El banco ya la recibió, todavía no se ha movido el dinero.» |
| **Procesando pago** | «El dinero ya salió de la cuenta. Si el pago falla, vuelve solo.» |
| **Completada** | «Llegó a la cuenta de destino.» |
| **Fallida** | «No se hizo. Su dinero nunca salió de la cuenta.» |
| **Compensada** | «No se completó y el dinero ya fue devuelto. En el estado de cuenta verá dos movimientos y el mismo saldo.» |

Si termina mal, la pantalla explica el motivo —saldo insuficiente, cuenta
inactiva, cuenta no encontrada, pago rechazado— en lenguaje claro.

**Dale al cliente el identificador de la transferencia.** No existe un listado:
sin ese identificador nadie puede volver a consultarla.

Si la pantalla dice *«Dejamos de consultar tras dos minutos»*, la transferencia
sigue viva. No es un fallo; es que la pantalla dejó de preguntar.

## 4. Vigilar los pagos

Menú **Pagos**.

Un pago es el paso intermedio de una transferencia: ocurre después de cobrar la
cuenta de origen y antes de acreditar la de destino. **No se crea desde aquí** —
nace de una transferencia. Esta pantalla sirve para vigilar los que están en
curso y los que terminaron mal.

La tabla se puede filtrar por estado (*En proceso*, *Aprobado*, *No completado*)
y por tipo de fallo (*Transitorio*, *Permanente*). El aviso rojo de arriba
resume cuántos no se completaron y por qué.

Pulsa **Ver estado** para ver el detalle de uno. Los cuatro resultados posibles:

| Resultado | Qué significa |
| --- | --- |
| **En proceso** | Todavía no responde. El dinero ya salió del origen; si no se completa, vuelve solo. |
| **Aprobado** | Se ordenó el crédito al destino. |
| **Rechazado** | Rechazo firme. **No se reintenta**, porque daría el mismo resultado. El dinero ya se devolvió. |
| **Fallido** | Se agotaron los intentos. Nadie lo rechazó: el sistema dejó de intentarlo. El dinero se devolvió y la transferencia se puede volver a hacer. |

La sección **Intentos** muestra en qué intento va (hasta 4) y cuánto falta para
el siguiente. Las esperas son de 1, 5 y 30 segundos, así que un pago con
problemas puede tardar. Un **fallo transitorio** se reintenta; un **rechazo
permanente**, no.

Desde el detalle del pago puedes saltar a la transferencia que lo originó, y
desde la transferencia al pago.

## 5. Validación de identidad

Menú **Clientes** → tarjeta **Validación de identidad** → **Ver la cola**.

> **Esta función todavía no está disponible.** La pantalla existe y la propia
> aplicación lo advierte: la cola no puede llenarse, la foto del documento no
> puede mostrarse, y los botones *Aprobar identidad* y *Rechazar* están
> deshabilitados. No es una avería; es una funcionalidad pendiente.

Mientras tanto, cuando registres a alguien explícale que la revisión del
documento queda pendiente y que no bloquea su acceso al sistema.

## 6. Tus propios datos

Menú **Clientes** → **Abrir mi ficha**. Puedes cambiar tu nombre, tu dirección y
tu fecha de nacimiento. El correo, el username y la contraseña no se pueden
cambiar desde la aplicación.

---

## Problemas comunes

**El cliente dice que no le llega el correo de activación.**
En una instalación local no sale ningún correo: el canal está simulado. En una
demostración, pide el enlace al equipo técnico.

**Registré a alguien y no encuentro su ficha.**
Necesitas su customerId. No hay búsqueda de clientes por nombre ni por DPI. Si
lo perdiste, no hay forma de recuperarlo desde la aplicación.

**Abrí la cuenta y quedó a mi nombre.**
Faltó marcar *«La cuenta es para otro cliente»*. La cuenta no se puede
reasignar; ábrele una nueva al cliente.

**Envié la transferencia dos veces por error.**
No se duplicó: la clave de idempotencia hace que el sistema reconozca que es el
mismo intento. Si de verdad quieres hacer una segunda transferencia, empieza una
nueva desde el formulario.

**Un pago lleva mucho en «En proceso».**
Está subiendo la escalera de reintentos. Puede tardar más de medio minuto. La
sección *Intentos* dice en cuál va.

**No veo el módulo de Auditoría.**
Tu rol no lo tiene. Si necesitas rastrear una operación, pásale el identificador
de correlación a un Administrador.

---

Volver al [manual general](README.md).
