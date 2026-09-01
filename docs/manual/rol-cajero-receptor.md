# Manual del Cajero Receptor

Esta guía es para el **personal de ventanilla**: quien atiende al cliente que
tiene enfrente, lo registra, le abre cuentas y transfiere por él.

Los conceptos que se repiten en todas las pantallas —qué significa «solicitud
recibida», el identificador de correlación, la clave de idempotencia— están en
el [manual general](README.md#3-cómo-leer-lo-que-el-sistema-te-responde).

## Lo que puedes hacer

| Módulo | Qué puedes hacer |
| --- | --- |
| **Inicio** | Tu turno en tres números: validaciones pendientes, cuentas creadas hoy y depósitos del día. |
| **Clientes** | Registrar clientes, actualizar tus datos, abrir la ficha de un cliente y **revisar la cola de validación de identidad**. |
| **Cuentas** | Abrir cuentas **a nombre de otro cliente**, consultar cuentas y sus movimientos, y **registrar depósitos en ventanilla**. |
| **Transferencias** | Enviar transferencias, seguir su estado y vigilar la Saga desde el monitoreo. |
| **Pagos** | Pagar servicios y vigilar el paso de pago de las transferencias y sus reintentos. |

**Lo que no puedes hacer:** activar o desactivar cuentas (es del Administrador),
ni consultar el rastro de auditoría ni la consola de notificaciones. Tampoco
puedes **registrar cajeros ni administradores**: solo un administrador puede
crear personal del banco, y el sistema rechaza el registro si lo intentas desde
tu sesión. Y tampoco puedes cambiar la contraseña de un cliente: si no puede
entrar, dile que use **¿Olvidaste tu contraseña?** — el enlace llega a su propio
correo, que es lo único que prueba que es él.

Tu menú lateral tiene cinco entradas: **Inicio**, **Clientes**, **Cuentas**,
**Transferencias** y **Pagos**.

---

## Registrar un depósito

**Cuentas → Depósito.** Es la única operación de dinero del sistema que responde
en el momento: no hay Saga que esperar, porque un depósito acredita una cuenta y
no tiene contraparte.

1. Escribe el **número de cuenta** completo (el identificador, no un alias) y el
   **monto**. La descripción es opcional y **queda registrada tal cual**: no
   anotes datos personales ahí.
2. Presiona **Continuar**. La pantalla te repite la cuenta y el monto antes de
   comprometerlos — es el único lugar donde un dígito mal tecleado mueve dinero
   real a la cuenta equivocada sin que nadie más lo note.
3. **Registrar depósito.** El comprobante muestra el monto, el saldo resultante
   y un `operationId`.

Si la cuenta estaba **inactiva**, el depósito la reactiva en lugar de ser
rechazado.

**Si la pantalla dice que no recibió confirmación a tiempo, no vuelvas a
cobrar.** El depósito pudo haberse registrado: consulta el saldo de la cuenta
antes de intentar de nuevo.

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
| **Rol** | Déjalo en **Cliente**. La lista ofrece también Cajero receptor y Administrador, pero desde tu sesión el banco no los acepta. |

El campo **Rol** es lo único que distingue este formulario del registro público.
La lista muestra los tres roles, pero **desde ventanilla solo funciona
Cliente**: si eliges Cajero receptor o Administrador, el registro se rechaza,
porque solo un administrador puede dar de alta al personal del banco. No es una
avería del formulario; es la regla que impide que alguien se nombre
administrador a sí mismo.

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

1. **Dale su customerId.** Está en pantalla con un botón para copiarlo. Es la
   forma de abrir su ficha después: el sistema no tiene búsqueda de clientes por
   nombre ni por DPI.
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

> **No hay campo de depósito inicial**: la cuenta se abre en cero. Si el cliente
> trae dinero, ábrele la cuenta y luego regístrale el depósito desde
> *Cuentas → Depósito*, con el número de cuenta que acaba de salir.

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

**Dale al cliente el identificador de la transferencia.** Con él puede abrirla
directamente desde *Transferencias → Consultar una transferencia*. Aunque lo
pierda, la pantalla de **Transferencias** lista las más recientes de quien está
en sesión, así que no es la única forma de volver a ella.

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

Esta es una de tus tareas de ventanilla. La cola lista a los clientes cuyo
documento espera revisión, con su nombre y su correo; el enlace **Revisar** abre
la ficha de uno.

En la pantalla de revisión verás los **datos declarados** —nombre, número de
documento, fecha de nacimiento, dirección, username y el estado actual de la
identidad— y dos botones:

| Botón | Qué hace |
| --- | --- |
| **Aprobar identidad** | Da la identidad por validada. |
| **Rechazar** | Pide confirmación y, al confirmar, la rechaza. El cliente recibe un aviso y podrá volver a subir su documento. |

El veredicto no se puede deshacer, así que confírmalo antes de pulsar. Al
enviarlo, la pantalla avisa que se registró; el cliente sale de la cola cuando
el banco termine de procesarlo, no en el instante del clic.

> **La foto del documento todavía no se muestra.** En su lugar aparece un
> recuadro gris que lo explica: la imagen se guarda cuando la persona se
> registra, pero el sistema aún no tiene una pantalla que la muestre. Es lo
> único que falta de esta función. Mientras tanto, revisa la identidad con el
> documento que la persona te presenta en ventanilla y con los datos declarados
> que sí ves en pantalla.

Cuando registres a alguien, explícale que la revisión de su documento queda
pendiente y que **no bloquea su acceso** al sistema: podrá entrar en cuanto
active su cuenta desde el correo.

## 6. Tus propios datos

Menú **Clientes** → **Abrir mi ficha**. Puedes cambiar tu nombre, tu dirección y
tu fecha de nacimiento.

Tu **contraseña** se cambia en **Mi perfil**, en el menú de tu nombre arriba a
la derecha: ahí se te pide la actual antes de poner la nueva. El correo y el
username no se pueden cambiar desde la aplicación.

---

## Problemas comunes

**El cliente dice que no le llega el correo de activación.**
En una instalación local no sale ningún correo: el canal está simulado. En una
demostración, pide el enlace al equipo técnico.

**Registré a alguien y no encuentro su ficha.**
Necesitas su customerId. No hay búsqueda de clientes por nombre ni por DPI. Si
lo perdiste y esa persona todavía tiene el documento sin revisar, búscala por su
nombre en la **cola de validación de identidad**: es el único lugar donde el
sistema lista clientes.

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
