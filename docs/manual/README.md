# Manual de usuario — Bank USAC

Este manual explica cómo usar Bank USAC desde el navegador. Está escrito para
las personas que operan el sistema —clientes, cajeros y administradores—, no
para quien lo programa o lo instala. No hace falta saber nada de tecnología para
seguirlo.

Si lo que buscas es cómo levantar el sistema, compilarlo o modificarlo, ese no
es este documento: eso vive en el [README del
repositorio](../../README.md) y en
[docs/operations/CONTAINERS.md](../operations/CONTAINERS.md).

## Índice

1. [Antes de empezar](#1-antes-de-empezar)
2. [Cómo entrar al sistema](#2-cómo-entrar-al-sistema)
3. [Cómo leer lo que el sistema te responde](#3-cómo-leer-lo-que-el-sistema-te-responde)
4. [Clientes](#4-clientes)
5. [Cuentas](#5-cuentas)
6. [Transferencias](#6-transferencias)
7. [Pagos](#7-pagos)
8. [Auditoría y notificaciones](#8-auditoría-y-notificaciones)
9. [Lo que el sistema todavía no puede hacer](#9-lo-que-el-sistema-todavía-no-puede-hacer)
10. [Preguntas frecuentes](#10-preguntas-frecuentes)

**Guías por rol** — el recorrido completo de cada puesto, paso a paso:

- [Manual del Cliente](rol-cliente.md)
- [Manual del Cajero Receptor](rol-cajero-receptor.md)
- [Manual del Administrador](rol-administrador.md)

**[Recorrido visual](recorrido-visual.md)** — los mismos flujos, pero con una
captura de pantalla por paso: 78 pasos que atraviesan los tres roles sobre un
único ejemplo con datos concretos, desde el registro del cliente hasta el pago
de un servicio. Úsalo cuando quieras *ver* la pantalla en lugar de leer su
descripción.

---

## 1. Antes de empezar

### 1.1 Qué necesitas

Un navegador web y la dirección del sistema. En una instalación local —la que se
usa para las demostraciones y la evaluación— la dirección es:

| Para | Dirección |
| --- | --- |
| La aplicación (lo que usan las personas) | <http://localhost:3010> |
| La API del banco (no la usa una persona) | <http://localhost:3000> |

No necesitas instalar nada más. El sistema no tiene aplicación móvil ni de
escritorio.

### 1.2 Los tres roles

Cada persona entra al sistema con **un rol**, y el rol decide qué pantallas ve.
El rol se asigna cuando se registra la persona y no se cambia desde la
aplicación.

| Rol | Quién es | Qué módulos ve en el menú |
| --- | --- | --- |
| **Cliente** (`CLIENTE`) | El cuentahabiente. Opera sobre sus propias cuentas. | Inicio, Clientes, Cuentas, Transferencias, Pagos |
| **Cajero receptor** (`CAJERO_RECEPTOR`) | Personal de ventanilla. Registra clientes, abre cuentas, recibe depósitos y transfiere por el cliente que tiene enfrente. | Inicio, Clientes, Cuentas, Transferencias, Pagos |
| **Administrador** (`ADMINISTRADOR`) | Supervisa la operación: administra cuentas y consulta el rastro de auditoría. | Inicio, Clientes, Cuentas, Transferencias, Pagos, Auditoría |

Todos los roles tienen además dos pantallas fuera del menú lateral, en el menú
de tu nombre arriba a la derecha: **Mi perfil** (tus datos y tu contraseña) y
**Notificaciones**, a la que también lleva la campana de la barra superior.

El menú lateral izquierdo muestra solo los módulos de tu rol, y debajo de tu
nombre aparece siempre el rol con el que estás operando. Si escribes en la barra
de direcciones la ruta de un módulo que tu rol no tiene, el sistema te devuelve
al inicio en lugar de mostrarlo.

**Auditoría es el único módulo que se oculta por rol.** Los demás los ven los
tres, y lo que cambia es lo que ofrecen adentro: en *Clientes*, un Cliente
encuentra solo su propia ficha, mientras que el personal ve además el registro
de nuevos clientes, la cola de validación de identidad y la búsqueda por número
de cliente.

Las dos diferencias entre los tres menús son **Clientes**, que es trabajo del
personal del banco, y **Auditoría**, que es solo del Administrador. Todo lo
demás lo ven los tres; lo que cambia es el alcance: un Cliente ve sus cuentas y
sus transferencias, no las de los demás, y esa restricción la aplica el servicio
que guarda el dato, no la pantalla.

Un **Cliente** ve sólo sus propias cuentas y sus propios movimientos: esa
restricción no depende de la pantalla, la aplica el servicio que guarda el
dinero.

### 1.3 Usuarios de prueba

> **Usuarios de demostración precargados.** Para facilitar pruebas y evaluaciones locales,
> el script de inicialización (`pnpm seed:demo` o inicialización de base de datos)
> precarga las credenciales de prueba para los tres roles del sistema con la contraseña `BankUsac#2026`:
>
> * **Administrador**: `admin@bankusac.gt` / `BankUsac#2026`
> * **Cajero Receptor**: `cajero@bankusac.gt` / `BankUsac#2026`
> * **Cliente Principal**: `marco.lopez@bankusac.gt` / `BankUsac#2026` (Marco Tulio López)
> * **Cliente Secundario**: `cliente@bankusac.gt` / `BankUsac#2026` (Clara Cliente)

Reglas de registro en nuevas instalaciones:

- El **registro público** (`/registro`) siempre crea un **Cliente**. Nunca un
  cajero ni un administrador; el sistema lo fuerza, para que nadie pueda
  nombrarse administrador a sí mismo.
- Para crear un **Cajero receptor** o un **Administrador** adicional hace falta que un
  **Administrador ya existente** los registre desde *Clientes → Nuevo cliente*,
  eligiendo el rol en el primer paso.
- El **primer administrador** no puede crearse desde la aplicación. Lo prepara
  el equipo técnico al instalar el sistema. Si vas a operar como administrador y
  todavía no tienes usuario, pídeselo a quien instaló el sistema.

---

## 2. Cómo entrar al sistema

Entrar tiene tres pasos y hay que hacerlos en orden: **registrarse**,
**activar la cuenta desde el correo** y **iniciar sesión**. Sin activación no se
puede iniciar sesión.

### 2.1 Crear tu cuenta

Abre <http://localhost:3010/registro> y sigue el asistente de **tres pasos**.

**Paso 1 — Datos personales**

| Campo | Qué escribir |
| --- | --- |
| Nombre completo | Al menos un nombre y un apellido. Máximo 200 caracteres. |
| Fecha de nacimiento | Debes tener **18 años o más**. El campo te muestra la edad mientras escribes. |
| Dirección | Máximo 300 caracteres. |
| Correo electrónico | A este correo llega el enlace de activación, así que tiene que ser uno al que tengas acceso. |

**Paso 2 — Documento de identidad**

| Campo | Qué escribir |
| --- | --- |
| Número de DPI | Exactamente **13 dígitos**. Puedes escribirlos con espacios. |
| Foto del documento | Arrastra la foto o selecciónala. **JPG o PNG, máximo 5 MB.** |

Si la imagen no cumple —formato equivocado o demasiado pesada— el sistema te lo
dice de inmediato y no envía nada. Cambia el archivo y continúa.

**Paso 3 — Confirmación**

Aquí revisas todo lo que escribiste y creas la contraseña.

| Campo | Qué escribir |
| --- | --- |
| Username generado | No se escribe: el sistema lo propone a partir de tu nombre (por ejemplo, `mlopez`). Es una previsualización; si ese usuario ya existe, el sistema le añade un sufijo. |
| Contraseña | Mínimo **8 caracteres**. |
| Confirmar contraseña | Debe coincidir con la anterior. |
| Términos y condiciones | Hay que aceptarlos para continuar. |

Pulsa **Crear cuenta**. Si algo quedó mal, el asistente te devuelve al paso
donde está el error.

**Qué pasa después.** El sistema responde *«Registro enviado»* y te dice a qué
correo envió el enlace. Fíjate en lo que dice y en lo que **no** dice: la
solicitud fue **recibida**, no completada. Tu cuenta todavía no existe como
cuenta activa. En esa pantalla aparecen dos datos que conviene copiar:

- el **customerId**, que es tu identificador como cliente, y
- el **identificador de correlación**, que sirve para rastrear esta operación si
  algo sale mal.

### 2.2 Activar la cuenta desde el correo

La cuenta nace **inactiva**. Para activarla hay que abrir el enlace que el
sistema envía por correo.

Al abrirlo llegas a la pantalla de **Activación de cuenta**, que te da uno de
estos tres resultados:

| Lo que ves | Qué significa | Qué hacer |
| --- | --- | --- |
| «Tu cuenta está activa. Ya puedes iniciar sesión.» | Todo salió bien. | Pulsa **Ir a iniciar sesión**. |
| «El enlace de activación no es válido o ya fue utilizado.» | El enlace ya se usó, venció, o no es el correcto. | Regístrate de nuevo o pide ayuda. |
| «No pudimos confirmar el resultado» | El sistema tardó demasiado en responder. **No significa que falló.** | Espera unos segundos y vuelve a abrir el enlace. |

El mensaje de éxito añade algo importante: tu cuenta de acceso ya está activa,
pero **para abrir cuentas bancarias un cajero debe validar la foto de tu
documento**.

> **En una instalación local no sale ningún correo de verdad.** El canal de
> correo está simulado. El enlace de activación queda escrito en el registro
> técnico del sistema, y quien instaló el sistema sabe cómo leerlo. Si estás
> haciendo una demostración local y no te llega ningún correo, no es un error:
> pide el enlace al equipo técnico.

### 2.3 Iniciar sesión

Abre <http://localhost:3010/login>, escribe el **correo** con el que te
registraste y tu **contraseña**, y pulsa **Entrar**.

Si algo no cuadra verás siempre el mismo mensaje: *«No pudimos iniciar sesión
con esos datos.»* El sistema no te dice si falló el correo, la contraseña, o si
la cuenta aún no está activa — y lo hace a propósito, para que nadie pueda
averiguar desde esta pantalla qué correos están registrados en el banco. Si
acabas de registrarte y no puedes entrar, lo más probable es que falte activar
la cuenta.

### 2.4 Cerrar sesión

El botón **Cerrar sesión** está al final del menú lateral, siempre visible.

> **La sesión no sobrevive a recargar la página.** Si actualizas el navegador o
> cierras la pestaña, el sistema te pide iniciar sesión otra vez. Es
> intencional: la sesión vive solo en la memoria del navegador y nunca se
> guarda en el disco. La sesión también caduca sola después de una hora.

---

## 3. Cómo leer lo que el sistema te responde

Esta sección es corta pero es la más útil del manual. Bank USAC no funciona como
una aplicación que hace las cosas mientras esperas: **acepta** tu solicitud, te
responde de inmediato, y la ejecuta después. Entender eso evita casi todas las
confusiones.

### 3.1 «Solicitud recibida» no quiere decir «hecho»

Cuando envías un registro, abres una cuenta o haces una transferencia, la
primera respuesta casi siempre es:

> **Solicitud aceptada, aún no completada**
> El sistema recibió tu solicitud y la está procesando de forma asíncrona.

Eso significa que el banco **anotó** lo que pediste y lo está ejecutando. No
significa que ya ocurrió, y tampoco significa que falló. El resultado real se
consulta después.

### 3.2 Los mensajes que vas a ver

Todas las pantallas usan los mismos siete avisos. Vale la pena reconocerlos:

| Aviso | Qué pasó | Qué hacer |
| --- | --- | --- |
| **Solicitud aceptada, aún no completada** | El banco recibió la solicitud y la está procesando. | Esperar o consultar el resultado después. |
| **Operación completada** | El sistema confirmó el resultado. | Nada. |
| **La operación fue rechazada** | Un servicio del banco no pudo completarla con los datos enviados. | Revisar los datos y volver a intentar. |
| **No pudimos confirmar el resultado** | Nadie respondió a tiempo. **La operación sigue en el sistema: no asumas que falló.** | Guardar el identificador de correlación y volver a consultar. Reintentar es seguro. |
| **El sistema no pudo aceptar la solicitud** | La solicitud nunca llegó a procesarse. **No se cambió nada.** | Intentar de nuevo en unos momentos. |
| **Revisa los datos enviados** | El formulario tiene un error y no se envió nada. | Corregir lo marcado. |
| **Ocurrió un error inesperado** | Falla no prevista. | Guardar el identificador de correlación y reportarlo. |

La diferencia entre los dos avisos rojos importa: *«El sistema no pudo aceptar
la solicitud»* garantiza que **no se movió nada**; *«No pudimos confirmar el
resultado»* **no** lo garantiza — solo dice que nadie contestó a tiempo.

### 3.3 El identificador de correlación

Cada operación lleva un identificador que la acompaña por todo el banco. Aparece
al pie de las pantallas, con un botón para copiarlo. Es el dato que hay que dar
cuando algo sale mal: con él, un administrador puede reconstruir exactamente qué
pasó.

**Cópialo siempre que una operación no termine con una confirmación clara.**

### 3.4 La clave de idempotencia: reintentar es seguro

Debajo de los formularios que mueven dinero o crean cosas verás un bloque
llamado **Clave de idempotencia**. Es la forma que tiene el sistema de reconocer
que dos envíos son *el mismo intento* y no dos operaciones distintas.

En la práctica esto te da una garantía: **si pulsas enviar dos veces, o si
reintentas después de un error, no se duplica nada**. La clave solo cambia
cuando tú empiezas una operación genuinamente nueva (por ejemplo, con los
botones *Registrar otro* o *Abrir otra cuenta*).

### 3.5 Los montos

Todos los montos están en quetzales y se muestran con dos decimales: `Q
1,250.00`. El monto mínimo de una transferencia es **Q 0.01**, y no se aceptan
más de dos decimales — el campo los rechaza en vez de redondearlos.

---

## 4. Clientes

**Quién lo ve:** Cajero receptor y Administrador. **Ruta:** `/clientes`.

Este módulo no es una lista de clientes: es un conjunto de accesos. El sistema
todavía no ofrece una búsqueda de clientes, así que para abrir la ficha de
alguien hay que tener su **customerId**.

Un **Cliente** no ve este módulo, y no le hace falta: sus propios datos y su
contraseña están en *Mi perfil*.

### 4.1 Registrar un cliente

Botón **Nuevo cliente**. Es el mismo asistente de tres pasos de la sección 2.1,
con una diferencia: en el primer paso aparece un campo **Rol**, donde eliges si
la persona será Cliente, Cajero receptor o Administrador.

**La lista ofrece los tres roles, pero solo un Administrador puede crear
personal del banco.** Si un Cajero receptor elige Cajero receptor o
Administrador, el banco rechaza el registro. Desde ventanilla, el rol que
funciona es **Cliente**.

El registro dispara el correo de activación igual que el registro público: la
persona no podrá iniciar sesión hasta abrir ese enlace.

### 4.2 Mis datos

Botón **Abrir mi ficha**, o **Mi perfil** en el menú de tu nombre — que es por
donde llega un Cliente. En cualquiera de las dos verás tus datos actuales y
podrás cambiar tu **nombre completo**, tu **dirección** y tu **fecha de
nacimiento**.

Escribe solo lo que quieras cambiar: un campo vacío se deja como está. Tienes
que cambiar al menos un dato para poder guardar.

**Mi perfil** añade el cambio de **contraseña**, que pide la actual antes de
aceptar la nueva. Nadie puede cambiar la contraseña de otra persona,
administradores incluidos: para eso está la recuperación por correo, que llega a
la bandeja de su dueño. Quien no recuerda la actual usa ese camino.

**El correo y el username no se pueden modificar** desde la aplicación.

### 4.3 Abrir la ficha de otra persona

En la tarjeta **Abrir una ficha**, pega el customerId (el identificador largo
que devolvió el registro) y pulsa **Abrir**. El botón se habilita cuando el
identificador tiene la forma correcta.

### 4.4 Validación de identidad

**Quién lo ve:** Cajero receptor y Administrador.

La cola de identidades pendientes de revisar, con el nombre y el correo de cada
cliente que espera. **Revisar** abre uno: arriba, sus datos declarados; abajo,
los botones **Aprobar identidad** y **Rechazar**. El veredicto se envía al
banco y no se puede deshacer; un rechazo avisa al cliente y le permite volver a
subir su documento.

El cliente sale de la cola cuando el banco termina de procesar el veredicto, no
en el instante del clic.

> **Lo único que falta aquí es la foto.** La imagen del documento se guarda al
> registrarse, pero todavía no hay una pantalla que la muestre: en su lugar
> aparece un recuadro gris que lo explica. La revisión se hace comparando el
> documento físico que la persona presenta con los datos declarados en pantalla.

---

## 5. Cuentas

**Quién lo ve:** los tres roles. **Ruta:** `/cuentas`.

### 5.1 Consultar tus cuentas y su saldo

La pantalla **Mis cuentas** lista tus cuentas con su tipo, su número, su estado
y su saldo, y arriba a la derecha el **Total consolidado** de todas ellas.

Un Cliente ve únicamente sus cuentas. Si todavía no tienes ninguna, la pantalla
te ofrece abrir la primera.

### 5.2 Abrir una cuenta

Botón **Abrir cuenta**. Se hace en tres pasos:

1. **Elige el tipo de cuenta.** Hay dos:

   | Tipo | Para qué |
   | --- | --- |
   | **Monetaria** | Uso diario: transferencias y pagos sin límite de movimientos. |
   | **Ahorro** | Para guardar dinero. Hoy no tiene reglas distintas a la monetaria. |

   Las dos se comportan igual: **la cuenta de ahorro no genera intereses** y no
   tiene reglas propias todavía.

2. **Confirma.** Verás el titular, el tipo y el saldo inicial.
3. **Recibe el identificador.** La cuenta se abre con **Q 0.00** y en estado
   **activa**.

Si eres **Cajero receptor** o **Administrador** puedes marcar *«La cuenta es
para otro cliente»* y escribir el customerId del titular. Un **Cliente** solo
puede abrir cuentas a su propio nombre.

> **Guarda el número de cuenta** que aparece al final. Es con lo que se consulta
> el saldo y con lo que se envían transferencias, y no hay forma de buscarlo por
> nombre.

**No existe un campo de depósito inicial.** Una cuenta nueva empieza en Q 0.00.
Para ingresarle dinero hay dos caminos: **recibir una transferencia**, o que un
Cajero receptor o un Administrador registre un **depósito en ventanilla** desde
*Cuentas → Depósito*. Ese depósito responde en el momento —no hay nada que
esperar— y **reactiva la cuenta si estaba inactiva**.

Lo que el sistema no tiene es un **retiro** de efectivo: no hay ninguna
operación que saque dinero de una cuenta salvo una transferencia.

### 5.3 Ver una cuenta y sus movimientos

Pulsa **Ver detalle** en cualquier cuenta de la lista. Arriba verás el **saldo
disponible**, el estado de la cuenta y la fecha del último movimiento; abajo, el
estado de cuenta con una fila por movimiento:

| Columna | Qué muestra |
| --- | --- |
| Fecha | Cuándo ocurrió. |
| Descripción | Débito, Crédito o Compensación, con la transferencia que lo originó. |
| Estado | *Aplicada* o *Compensada*. |
| Débito / Crédito | El monto, con signo: `−` en rojo si salió, `+` en verde si entró. |
| Saldo resultante | Cómo quedó la cuenta después de ese movimiento. |

### 5.4 Cuentas activas e inactivas

| Estado | Qué significa |
| --- | --- |
| **Activa** | La cuenta opera con normalidad. |
| **Inactiva** | No se puede sacar dinero de ella. Un depósito la reactiva automáticamente, o un administrador puede reactivarla a mano. |

El banco **desactiva cuentas solo**: si una cuenta pasa **seis meses sin
movimientos con un saldo menor a Q 50.00**, un proceso automático la desactiva.
Cuando una cuenta se acerca a esa condición, su pantalla muestra un aviso
ámbar que dice cuántos días faltan. Para conservarla activa basta con
registrar un movimiento — recibir una transferencia es suficiente.

### 5.5 Gestión de cuentas

**Quién lo ve:** solo el Administrador. Botón **Gestión de cuentas** en
`/cuentas`.

Muestra **todas** las cuentas del sistema, con filtros por estado y por tipo, y
una búsqueda por número de cuenta o titular. Arriba aparece un aviso cuando hay
cuentas activas con saldo menor a Q 50.00, que son las candidatas a
desactivación automática.

Cada fila tiene un botón **Desactivar** o **Reactivar** según su estado. Al
pulsarlo se abre un panel que pide un **motivo** — obligatorio, porque es el
único registro de por qué se hizo el cambio — y luego **Confirmar**.

El cambio no es inmediato: la pantalla te dirá que la solicitud fue aceptada y
recargará la lista. Si el estado todavía no cambió, vuelve a actualizar en unos
segundos.

> En esta tabla, la columna **Titular** muestra el **nombre** del cliente, con su
> identificador debajo. El nombre no lo guarda el servicio de cuentas —son dos
> servicios distintos y así está diseñado—, sino que la pantalla lo pide al de
> clientes en una segunda consulta. Si esa consulta no llega, la columna muestra
> solo el identificador: no es un dato faltante, es esa pregunta sin responder.

---

## 6. Transferencias

**Quién lo ve:** los tres roles. **Ruta:** `/transferencias`.

### 6.1 Enviar dinero

Botón **Nueva transferencia**. Necesitas tres datos:

| Campo | Qué escribir |
| --- | --- |
| Cuenta de origen | El número de la cuenta de la que sale el dinero. |
| Cuenta de destino | El número de la cuenta que lo recibe. **Debe ser distinta de la de origen.** |
| Monto | En quetzales, mínimo Q 0.01, máximo dos decimales. |

Hay además un campo **Escenario de pago**, marcado como *«Solo para
demostración»*. Sirve para forzar cómo termina el pago y **no existe en un banco
real**; en uso normal se deja en *«Sin escenario (comportamiento real)»*. Las
otras opciones —aprobar el pago, rechazarlo, provocar un fallo transitorio que
se reintenta, o provocar que el proveedor no responda (timeout, que sube la
misma escalera de reintentos que el fallo transitorio pero se distingue de él
en la ficha de cada intento)— están ahí para poder demostrar los cuatro finales
posibles de una transferencia sin esperar a que ocurran solos.

**La pantalla no comprueba tu saldo antes de enviar.** Esa decisión la toma el
servicio de cuentas en el momento del cobro, que es el único que puede tomarla
sin equivocarse. Si no hay fondos, la transferencia terminará en *Fallida* y el
dinero nunca habrá salido.

Al enviar, el sistema te lleva directamente a la pantalla de seguimiento.

### 6.2 Seguir una transferencia

La pantalla de la transferencia **se actualiza sola** cada dos segundos hasta
que la operación termina. Muestra el monto, la línea de tiempo con cuatro pasos
—Solicitada, Débito, Pago y el final— y el estado actual.

Una transferencia pasa por estos estados:

| Estado | Qué significa |
| --- | --- |
| **Aceptada** | El sistema recibió la solicitud y todavía no ha movido nada. |
| **Debitando** | Se pidió el cobro a la cuenta de origen. Aún no se confirma. |
| **Procesando pago** | El dinero ya salió de la cuenta de origen y el pago está en proceso. Si el pago falla, se devuelve automáticamente. |
| **Completada** | El dinero llegó a la cuenta de destino. |
| **Fallida** | La transferencia no se realizó y **el dinero nunca salió** de tu cuenta. |
| **Compensada** | La transferencia no se completó. El dinero **había salido y fue devuelto**, así que verás dos movimientos en el estado de cuenta. |

Si la transferencia no termina, la pantalla deja de consultar a los dos minutos
y te lo dice: *«Dejamos de consultar tras dos minutos. La transferencia sigue en
el sistema: no asumas que falló.»* Puedes volver a consultar cuando quieras.

**La diferencia entre Fallida y Compensada importa.** *Fallida* quiere decir que
nunca se tocó tu dinero. *Compensada* quiere decir que salió y volvió: verás dos
apuntes en el estado de cuenta y el saldo final será el mismo que antes.

### 6.3 Por qué no se completó

Cuando una transferencia termina mal, la pantalla explica el motivo en lenguaje
claro:

| Motivo | Qué pasó |
| --- | --- |
| Saldo insuficiente | La cuenta de origen no tenía suficiente dinero. |
| Cuenta inactiva | La cuenta de origen está inactiva y no se puede cobrar de ella. |
| Cuenta no encontrada | Una de las dos cuentas no existe. |
| Monto inválido | El monto debe ser mayor que cero, o tiene más de dos decimales. |
| Misma cuenta | Origen y destino son la misma cuenta. |
| Clave de idempotencia en conflicto | Esa clave ya se usó para otra transferencia distinta. Empieza una nueva en lugar de reintentar esta. |
| Pago rechazado | El pago fue rechazado. El dinero se devolvió a la cuenta de origen. |
| Pago sin respuesta tras varios intentos | El pago no se pudo procesar. El dinero se devolvió a la cuenta de origen. |

### 6.4 Consultar una transferencia anterior

En `/transferencias`, la tarjeta **Consultar una transferencia** te deja pegar el
identificador que devolvió un envío y ver su estado.

**El historial vive en `/transferencias`** y muestra tus transferencias más
recientes; si acabas de enviar una y todavía no aparece, o si solo tienes el
identificador de un comprobante, la búsqueda por `transactionId` sigue estando
en la misma pantalla. Cada quien ve las suyas: la lista la acota el servicio que
guarda las transferencias, no la pantalla.

---

## 7. Pagos

**Quién lo ve:** los tres roles. **Ruta:** `/pagos`.

Este módulo tiene dos caras, y conviene no confundirlas.

**La puerta de entrada, `/pagos`, es el pago de servicios**, y la ven los tres
roles. Ahí un Cliente paga la luz, el agua o el teléfono desde **Nuevo pago**, y
ve el historial de los servicios que ya pagó. Un pago de servicio **es una
transferencia** a la cuenta recaudadora del prestador, así que se comporta
exactamente igual que cualquier otra: los mismos estados, la misma devolución
automática si algo falla — e incluye el mismo campo **Escenario de pago**
(§6.1) para poder demostrar un rechazo, un fallo transitorio o un timeout del
proveedor pagando un servicio real, y no solo transfiriendo entre cuentas.

**El monitoreo, `/pagos/monitor`, es otra cosa** y es solo para Cajero receptor
y Administrador. Ahí «pago» no significa pagar un servicio, sino el paso
intermedio por el que pasa **toda** transferencia: después de cobrar la cuenta
de origen y antes de acreditar la de destino. Eso **no se crea desde ninguna
pantalla** — nace de una transferencia—, y el monitoreo sirve para vigilar los
que están en curso y los que terminaron mal, de todo el banco.

Un **Cliente** no entra al monitoreo, pero sí ve cómo terminó el pago de su
propia transferencia dentro de la transferencia que lo originó.

### 7.1 Monitoreo

**Quién lo ve:** Cajero receptor y Administrador. **Ruta:** `/pagos/monitor`.

La tabla lista los pagos con su identificador, la fecha, el **número de
intento**, el estado y el monto. Se puede filtrar por estado (*En proceso*,
*Aprobado*, *No completado*) y por tipo de fallo (*Transitorio*, *Permanente*),
y buscar por identificador.

Cuando hay pagos que no se completaron, un aviso rojo arriba dice cuántos fueron
por rechazo permanente y cuántos por agotar los reintentos, y recuerda que en
ambos casos **el dinero ya fue devuelto**.

### 7.2 El estado de un pago

Se llega por dos caminos: **Ver estado** en cualquier fila del monitoreo, o el
enlace al pago desde la transferencia que lo originó — que es como llega un
Cliente al pago de su propia transferencia. Un pago termina en uno de cuatro
resultados:

| Resultado | Qué significa |
| --- | --- |
| **En proceso** | Se solicitó y todavía no responde. El dinero ya salió de la cuenta de origen; si el pago no se completa, se devuelve automáticamente. |
| **Aprobado** | Se ordenó el crédito a la cuenta de destino. |
| **Rechazado** | Se rechazó y **no se vuelve a intentar**: reintentarlo daría el mismo resultado. El dinero se devolvió. |
| **Fallido** | No se completó después de agotar todos los intentos. Nadie lo rechazó; el sistema dejó de intentarlo. El dinero se devolvió y la transferencia se puede volver a hacer. |

Esta pantalla también se actualiza sola mientras el pago sigue en proceso, y
deja de consultar a los dos minutos.

### 7.3 Los intentos

La sección **Intentos** muestra la escalera de reintentos mientras se está
subiendo: en qué intento va (hasta **4**), si el último fallo fue transitorio o
permanente, y cuánto falta para el siguiente intento. Las esperas entre intentos
son de **1 segundo, 5 segundos y 30 segundos**, así que un pago con problemas
puede tardar más de medio minuto en cerrar.

La distinción entre los dos tipos de fallo es la clave para leer esta pantalla:
un **fallo transitorio** es pasajero y el sistema lo reintenta; un **rechazo
permanente** no se reintenta, porque el resultado sería el mismo.

---

## 8. Auditoría y notificaciones

**Quién lo ve:** solo el Administrador. **Ruta:** `/auditoria`.

### 8.1 Explorador general de eventos y rastro por operación

El módulo de auditoría ofrece dos vistas fundamentales para el Administrador:

1. **Bitácora general de eventos**: Permite paginar e inspeccionar los eventos registrados en el bus de mensajería (RabbitMQ) con sus metadatos (`eventId`, tipo de mensaje, productor, consumidor y estado de procesamiento) con cuerpo de payload redactado.
2. **Rastro de una operación**: Permite ingresar el **identificador de correlación** (`correlationId`) de una transacción o flujo específico para armar la historia secuencial completa: qué se publicó, qué servicio lo procesó, en qué orden y qué notificaciones derivaron.

Pega el identificador y pulsa **Consultar**. Arriba aparece el resumen —cuántos
eventos, cuántos servicios participaron y cuánto duró la operación— y debajo la
tabla de eventos, que se puede filtrar por servicio y por tipo.

Cada fila muestra el momento, el tipo de evento, el servicio que lo produjo y si
el evento quedó **Registrado**, **Inválido** (llegó pero no coincidía con su
contrato; se registró igual) o con **Error**. El botón **Detalle** abre el
contenido completo del evento.

> **Los datos sensibles no están aquí.** El contenido de los eventos se guarda ya
> oculto: los montos, los documentos y los correos aparecen como `[redactado]`.
> Esos datos viven en la base del servicio que los posee, no en la de auditoría.

Si no aparece nada, la pantalla lo explica sin adivinar: puede ser que la
operación nunca existió, que todavía está en curso, o que el servicio de
auditoría estaba caído. Si acabas de enviar la operación, espera unos segundos y
vuelve a consultar.

### 8.2 Notificaciones

Botón **Consola de notificaciones**, o la sección de notificaciones al pie del
rastro de una operación.

Lista los avisos que el sistema generó, con su estado real de entrega:
**Pendiente**, **Enviada** o **No enviada**. Se puede filtrar por estado, y
cuando alguna falló aparece un aviso rojo arriba.

El sistema avisa cuando una transferencia termina, se revierte o falla, y cuando
cambia algo de la cuenta o de la identidad de un cliente. No avisa por cada paso
interno, así que hay operaciones que no generan ninguna notificación.

> **Los envíos son simulados: de este sistema no sale ningún correo.** Una
> notificación *No enviada* no se reintenta, porque no hay un servidor de correo
> que pueda estar temporalmente caído. Que una notificación falle **no afecta la
> operación bancaria**.

---

## 9. Lo que el sistema todavía no puede hacer

Esta lista es deliberada. Son funciones que la interfaz muestra o que un usuario
esperaría, y que todavía no están disponibles. Ninguna es una avería.

Ocho de las funciones que esta lista describía ya existen: depositar en
ventanilla, ver los datos de un cliente, validar su identidad, cambiar la
contraseña, recuperarla por correo, listar transferencias, ver el historial de
pagos propio y marcar notificaciones como leídas. Lo que queda es esto.

| Lo que no se puede | Detalle |
| --- | --- |
| **Retirar efectivo** | Se puede depositar en ventanilla, pero no existe la operación inversa. El dinero sale de una cuenta únicamente mediante una transferencia o pago de servicios. |
| **Cambiar tu correo electrónico** | El correo es tu identificador de acceso principal (D-05): cambiarlo cambia con qué inicias sesión. La pantalla lo muestra de solo lectura. |
| **Confirmar el resultado de un registro o apertura en tiempo real por el cliente** | El cuentahabiente ve su estado en pantalla y en su buzón de notificaciones; el rastro forense detallado por correlación es exclusivo del Administrador. |
| **Agregar un nuevo prestador al catálogo de pagos** | Los facturadores institucionales (EEGSA, Empagua, Claro) están fijos en base de datos. Agregar nuevos convenios requiere configuración administrativa. |

El detalle técnico de cada una, con su decisión y su ticket, está en
[docs/TECH_DEBT.md](../TECH_DEBT.md).

---

## 10. Preguntas frecuentes

**Me registré y no puedo iniciar sesión.**
Falta activar la cuenta. Abre el enlace de activación que llegó a tu correo. Sin
eso no se puede entrar. En una instalación local no sale ningún correo: pide el
enlace al equipo técnico.

**No me llegó el correo de activación.**
En una instalación local es lo normal: el canal de correo está simulado y el
enlace queda en el registro técnico del sistema.

**Actualicé la página y me sacó del sistema.**
Es intencional. La sesión vive solo en la memoria del navegador. Vuelve a
iniciar sesión.

**Envié una transferencia y sigue en «Procesando pago».**
El dinero ya salió de la cuenta de origen y el pago está en curso. Si el pago
falla, el sistema devuelve el dinero solo. La pantalla se actualiza sola; si
deja de hacerlo a los dos minutos, vuelve a consultar más tarde.

**Mi transferencia dice «Compensada». ¿Perdí el dinero?**
No. *Compensada* significa que el dinero salió y fue devuelto automáticamente.
En el estado de cuenta verás dos movimientos y el saldo final igual al inicial.

**Pulsé enviar dos veces. ¿Se duplicó la operación?**
No. La clave de idempotencia hace que el sistema reconozca que es el mismo
intento.

**El sistema dice «No pudimos confirmar el resultado». ¿Falló?**
No lo sabes todavía, y el sistema tampoco. La operación sigue en curso; nadie
respondió a tiempo. Guarda el identificador de correlación y vuelve a consultar.

**No veo el módulo de Auditoría.**
Es el único que se oculta por rol: solo lo ve el Administrador. **Los demás
módulos los ven los tres roles**, y lo que cambia es lo que ofrecen adentro. Si
eres Cliente y no encuentras dónde pagar un servicio, está en *Pagos → Nuevo
pago*; lo que no verás es el *monitoreo* de pagos, que muestra los de todo el
banco. Y en *Clientes* verás solo tu propia ficha, no el registro de clientes ni
la cola de validación, que son tareas de ventanilla.

**¿Dónde consigo el número de mi cuenta?**
En *Cuentas → Ver detalle*, con el botón **Copiar**. También aparece al terminar
de abrir una cuenta.

**Mi cuenta aparece como «Inactiva».**
Pasó seis meses sin movimientos con menos de Q 50.00. Recibir una transferencia
la reactiva automáticamente, o un administrador puede reactivarla desde *Gestión
de cuentas*.

---

## Ver también

- [Manual del Cliente](rol-cliente.md) · [Manual del Cajero Receptor](rol-cajero-receptor.md) · [Manual del Administrador](rol-administrador.md)
- [Documento técnico](../TECHNICAL_DOCUMENT.md) — el índice de toda la documentación del proyecto
- [Casos de uso](../domain/use-cases.md) — los seis flujos del sistema, en detalle
