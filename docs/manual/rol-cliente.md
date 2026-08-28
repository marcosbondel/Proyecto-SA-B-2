# Manual del Cliente

Esta guía es para el **cuentahabiente**: la persona que usa Bank USAC para
manejar su propio dinero. Cubre todo lo que puedes hacer, en el orden en que
normalmente lo harías.

Los conceptos que se repiten en todas las pantallas —qué significa «solicitud
recibida», el identificador de correlación, los montos— están explicados en el
[manual general](README.md#3-cómo-leer-lo-que-el-sistema-te-responde). Si es tu
primera vez, léelo antes que esta guía.

## Lo que puedes hacer

| Módulo | Qué puedes hacer |
| --- | --- |
| **Clientes** | Registrarte, actualizar tus datos personales. |
| **Cuentas** | Abrir cuentas a tu nombre, consultar tu saldo, ver tus movimientos. |
| **Transferencias** | Enviar dinero y seguir el estado de cada envío. |

**Lo que no puedes hacer:** abrir cuentas a nombre de otra persona, activar o
desactivar cuentas, ver el módulo de Pagos, ni consultar la auditoría. Todo eso
es trabajo del personal del banco.

Tu menú lateral tiene tres módulos: **Clientes**, **Cuentas** y
**Transferencias**.

---

## 1. Crear tu cuenta de acceso

1. Abre <http://localhost:3010/registro>.
2. **Paso 1 — Datos personales.** Nombre completo (nombre y apellido), fecha de
   nacimiento (debes tener 18 años o más), dirección y correo electrónico. Usa
   un correo al que tengas acceso: ahí llega el enlace de activación.
3. **Paso 2 — Documento.** Tu número de DPI (13 dígitos) y una foto del
   documento, en JPG o PNG, de menos de 5 MB.
4. **Paso 3 — Confirmación.** Revisa los datos, crea una contraseña de al menos
   8 caracteres, confírmala y acepta los términos.
5. Pulsa **Crear cuenta**.

La pantalla te confirmará que el registro fue **enviado** y te mostrará tu
**customerId**. Cópialo: es tu identificador dentro del banco y lo vas a
necesitar.

> El registro público siempre crea un **Cliente**. No se puede elegir otro rol,
> y es a propósito.

## 2. Activar tu cuenta

Tu cuenta nace **inactiva** y no puedes iniciar sesión hasta activarla.

Abre el enlace que llegó a tu correo. Si dice *«Tu cuenta está activa»*, ya
puedes entrar. Si dice que el enlace no es válido o ya fue utilizado, tendrás
que registrarte de nuevo.

Fíjate en la segunda frase del mensaje de éxito: *«Para abrir cuentas bancarias,
un cajero debe validar la foto de tu documento.»*

> En una instalación local no sale ningún correo real. Si estás en una
> demostración y no recibes nada, pide el enlace a quien instaló el sistema.

## 3. Iniciar sesión

En <http://localhost:3010/login>, tu **correo** y tu **contraseña**, y
**Entrar**.

Si ves *«No pudimos iniciar sesión con esos datos»*, revisa la contraseña y
asegúrate de haber activado la cuenta. El sistema da el mismo mensaje para todos
los casos, a propósito.

Al entrar llegas al inicio, que te saluda por tu nombre de usuario y te muestra
una tarjeta por cada módulo al que tienes acceso.

> Si recargas la página, el sistema te pide iniciar sesión otra vez. La sesión
> vive solo en la memoria del navegador.

## 4. Abrir tu primera cuenta

1. Menú **Cuentas** → botón **Abrir cuenta**.
2. Elige el tipo:
   - **Monetaria** — uso diario, transferencias y pagos.
   - **Ahorro** — para guardar dinero. Hoy funciona igual que la monetaria y
     **no genera intereses**.
3. La cuenta se abrirá a tu nombre; como Cliente no puedes abrirla para otra
   persona.
4. **Continuar** → revisa la confirmación → **Crear la cuenta**.

La cuenta se abre con **Q 0.00** y en estado **activa**. Al terminar, la
pantalla te da el **número de cuenta**, con un botón para copiarlo.

> **Guarda ese número.** Es con lo que consultas el saldo y con lo que recibes
> transferencias. No hay forma de buscar una cuenta por nombre.

El sistema te dirá *«solicitud aceptada»*, no *«cuenta creada»*. Abre la cuenta
desde el enlace que te ofrece para ver si ya existe; si todavía no aparece,
espera unos segundos y actualiza.

## 5. Consultar tu saldo

Menú **Cuentas**. Ahí están todas tus cuentas con su saldo, y arriba a la
derecha el **Total consolidado**.

Para ver una en detalle, pulsa **Ver detalle**. Verás el saldo disponible en
grande, el estado de la cuenta, la fecha del último movimiento y, más abajo, el
estado de cuenta con una línea por movimiento: fecha, descripción, si fue débito
o crédito, y cómo quedó el saldo.

El botón **Actualizar** vuelve a pedir el saldo al banco.

### Si tu cuenta aparece «Inactiva»

Significa que no se puede sacar dinero de ella. Ocurre cuando una cuenta pasa
**seis meses sin movimientos con un saldo menor a Q 50.00**: un proceso
automático la desactiva.

Para reactivarla basta con **recibir una transferencia**. También puede
reactivarla un administrador.

Si tu cuenta está activa pero con menos de Q 50.00, la pantalla te avisa con
antelación y te dice cuántos días faltan.

## 6. Enviar una transferencia

1. Menú **Transferencias** → **Nueva transferencia**.
2. Escribe:
   - **Cuenta de origen** — el número de tu cuenta, de la que sale el dinero.
   - **Cuenta de destino** — el número de la cuenta que lo recibe. Tiene que ser
     distinta.
   - **Monto** — mínimo Q 0.01, con dos decimales como máximo.
3. Deja **Escenario de pago** en *«Sin escenario (comportamiento real)»*. Las
   otras opciones son solo para demostraciones.
4. **Enviar la transferencia**.

La pantalla no revisa tu saldo antes de enviar: eso lo decide el banco al
momento del cobro. Si no tienes fondos, la transferencia terminará en *Fallida*
y tu dinero no se habrá movido.

### Seguir el envío

Al enviar, el sistema te lleva a la pantalla de la transferencia, que **se
actualiza sola** hasta que termina. Los estados que verás:

| Estado | Qué significa para ti |
| --- | --- |
| **Aceptada** | El banco recibió la solicitud. Nada se ha movido. |
| **Debitando** | Se pidió el cobro a tu cuenta. Aún sin confirmar. |
| **Procesando pago** | El dinero ya salió de tu cuenta. Si el pago falla, se devuelve solo. |
| **Completada** | El dinero llegó a la cuenta de destino. |
| **Fallida** | No se hizo nada. **Tu dinero nunca salió.** |
| **Compensada** | Salió y **fue devuelto**. Verás dos movimientos en tu estado de cuenta y el mismo saldo de antes. |

Si termina mal, la pantalla te dice por qué en lenguaje claro: saldo
insuficiente, cuenta inactiva, cuenta no encontrada, pago rechazado, y así.

Si la pantalla deja de actualizarse a los dos minutos, no quiere decir que
falló: quiere decir que dejó de preguntar. Vuelve a consultar más tarde.

> **Guarda el identificador de la transferencia.** Es la única forma de volver a
> ella: no existe un listado de transferencias. Se pega en *Transferencias →
> Consultar una transferencia*.

## 7. Actualizar tus datos personales

Menú **Clientes** → **Abrir mi ficha**.

Puedes cambiar tu **nombre completo**, tu **dirección** y tu **fecha de
nacimiento**. Escribe solo lo que quieras cambiar; lo que dejes vacío se queda
como está. Hay que cambiar al menos un dato para poder guardar.

**El correo, el username y la contraseña no se pueden cambiar** desde la
aplicación todavía.

Al guardar verás *«solicitud aceptada»*. Tu sesión de cliente no puede consultar
el rastro de auditoría, así que la pantalla no podrá confirmarte el resultado:
guarda el identificador de correlación por si necesitas preguntar.

## 8. Cerrar sesión

Botón **Cerrar sesión**, al final del menú lateral.

---

## Problemas comunes

**«No pudimos iniciar sesión con esos datos».**
Casi siempre falta activar la cuenta desde el correo.

**Abrí una cuenta y no aparece en la lista.**
La apertura es asíncrona. Espera unos segundos y pulsa **Actualizar**.

**Mi transferencia dice «Compensada».**
No perdiste el dinero: salió y volvió. Revisa el estado de cuenta y verás los
dos movimientos.

**No encuentro el módulo de Pagos.**
Tu rol no lo tiene. Puedes ver el resultado del pago dentro de la transferencia
que lo originó.

**Perdí el número de mi cuenta.**
Está en *Cuentas*, en la columna «Número de cuenta», y en el detalle de la
cuenta con un botón para copiarlo.

**Perdí el identificador de una transferencia.**
No hay forma de recuperarlo desde la aplicación: no existe un listado. Un
administrador puede encontrarlo en la auditoría si tienes el identificador de
correlación.

---

Volver al [manual general](README.md).
