# Manual de usuario — Bank USAC

Guía de la aplicación implementada, revisada contra las rutas y permisos de
Fase III el **21 de octubre de 2026** (T-61). La verificación de código y la
verificación en navegador se registran por separado en la
[guía de validación de Fase III](qa/guia-validacion-manual-fase3.md), el
[recorrido visual paso a paso de Fase III](manual/recorrido-fase3.md) con capturas reales de pantalla y el
[recorrido visual de 78 pasos](manual/recorrido-visual.md).
Una captura histórica no prueba el estado actual de producción.

## 1. Antes de empezar

### 1.1 Acceso

| Entorno | Aplicación |
| --- | --- |
| Producción, dirección comunicada por el equipo | [Bank USAC](https://bank-usac-web-mn2e6zhkwq-uc.a.run.app) |
| Local, con el stack iniciado | <http://localhost:3010> |

La aplicación necesita JavaScript y almacenamiento de sesión habilitados. Usa
un navegador actualizado. No se ha certificado una matriz de versiones mínimas
de navegadores ni requisitos de CPU, RAM, ancho de banda o latencia.

Las cuentas de demostración corresponden a Cliente, Cajero receptor y
Administrador. Solicita al equipo las credenciales del entorno que vas a usar;
las identidades de una captura local no implican que existan en producción.
Nunca incluyas contraseñas, tokens de activación o JWT en una captura o reporte.

### 1.2 Los tres roles

| Rol | Alcance |
| --- | --- |
| **Cliente** (`CLIENTE`) | Sus datos, cuentas, movimientos, transferencias, pagos de servicios y bandeja personal. |
| **Cajero receptor** (`CAJERO_RECEPTOR`) | Atención de clientes, validación de identidad, cuentas, depósitos y monitoreo operativo de transferencias y pagos. |
| **Administrador** (`ADMINISTRADOR`) | Operación del personal, alta de los tres roles, auditoría y consola global de notificaciones. |

Los tres ven Inicio, Clientes, Cuentas, Transferencias y Pagos; Auditoría solo
aparece al Administrador. El administrador ve **Usuarios** como etiqueta del
módulo de Clientes. Mi perfil y Notificaciones están en el encabezado. Cada
módulo ofrece las acciones autorizadas para el rol; ocultar un botón no
reemplaza los controles del Gateway y del servicio dueño del dato.

El Cliente administra el estado de sus propias cuentas desde el detalle. El
personal dispone además de Gestión de cuentas. La auditoría global sigue siendo
exclusiva del Administrador.

## 2. Acceso, activación y perfil

### 2.1 Registro público

En `/registro`, completa los tres pasos del asistente:

1. Datos personales: nombre, nacimiento, dirección y correo accesible. La
   interfaz admite edades entre 18 y 120 años.
2. Documento: DPI de 13 dígitos y fotografía JPG o PNG de hasta 5 MiB.
3. Revisión: contraseña de al menos ocho caracteres, confirmación y términos.

El registro público siempre crea un Cliente. Guarda el `customerId`, el usuario
y el código de seguimiento que muestra la respuesta. **Solicitud recibida** no
equivale a alta confirmada: el procesamiento continúa en el banco.

El alta pública solicita el correo de activación inmediatamente. Una vez
activado el correo, puedes iniciar sesión, pero las transferencias y pagos
dependen de la verificación de identidad y KYC. Activación de correo y KYC son
estados distintos.

### 2.2 Activación

Abre el enlace que llega al correo. `/activar` informa si la cuenta quedó
activa, el token es inválido o expiró, o no pudo confirmarse el resultado. El
token de activación tiene 24 horas de vigencia y es de un solo uso.

Con `NOTIFICATION_CHANNEL=resend`, la activación puede enviarse de forma real.
Con el canal simulado, el equipo técnico obtiene el enlace según la
configuración local. El modo de correo depende del despliegue, no de que sea
local o cloud. Consulta spam y pide revisión del estado de entrega si no llega.

El registro realizado por Cajero o Administrador valida presencialmente la
identidad y crea el acceso activo; ese camino no exige abrir un correo de
activación antes de entrar.

### 2.3 Iniciar y cerrar sesión

En `/login`, escribe correo y contraseña. Una respuesta de credenciales
inválidas no identifica si el correo existe. Si el alta pública sigue pendiente
de activación y la contraseña es correcta, el backend puede volver a emitir el
enlace; guarda el código del intento si necesitas asistencia.

**Cerrar sesión** elimina la sesión de esta pestaña. El token vive en
`sessionStorage`: una recarga conserva la sesión mientras el JWT siga vigente;
cerrar la pestaña o ventana la termina. La caducidad también obliga a entrar de
nuevo. En equipos compartidos, usa Cerrar sesión antes de dejar el equipo.

### 2.4 Recuperación y cambio de contraseña

`/recuperar` acepta una dirección y muestra una respuesta que no revela si
existe. El enlace lleva a `/restablecer`, dura una hora y se consume una vez.
La recuperación puede usar Resend cuando está configurado y el evento incluye
una dirección real. La confirmación del formulario no demuestra entrega del
correo; consulta spam o solicita revisión del estado de entrega.

En **Mi perfil** (`/perfil`) puedes cambiar nombre, dirección y nacimiento, y
cambiar la contraseña indicando la actual. El correo y el username son de solo
lectura. Un campo de actualización vacío conserva su valor anterior.

## 3. Cómo leer lo que el sistema te responde

### 3.1 Solicitud aceptada y resultado confirmado

Un `202` significa que el banco aceptó procesar la solicitud. Confirma después
el estado consultando la operación, la cuenta o su rastro autorizado.

| Mensaje | Acción |
| --- | --- |
| Solicitud aceptada, aún no completada | Guarda los identificadores y consulta después. |
| Operación completada | El servicio confirmó el resultado mostrado. |
| Operación rechazada / revisa los datos | Corrige el motivo indicado. |
| No pudimos confirmar el resultado | No asumas fallo ni repitas una operación nueva: consulta el estado. |
| Sistema no disponible / error inesperado | Conserva el código y reporta el contexto. |

### 3.2 Código de seguimiento y traza

El **código de seguimiento** (`correlationId`, UUID) identifica el flujo de la
operación. El botón adyacente permite copiarlo. Debajo puede aparecer la
**traza** (`traceId`, 32 caracteres hexadecimales), útil para soporte técnico.

Si el despliegue configura Grafana, la traza se abre en Explore/Tempo en otra
pestaña. Grafana requiere su propia sesión y permisos; tener una sesión del
banco no los concede. Sin Grafana configurado, el identificador queda como
texto. Una respuesta sin traza válida no muestra una traza inventada.

### 3.3 Reintentos y montos

La clave de idempotencia mantiene la identidad de una misma solicitud cuando un
formulario la reintenta. Empezar otra operación o abandonar y volver al
formulario puede producir otra clave. Ante un resultado incierto, conserva la
solicitud original y consulta antes de crear otra.

El envío interbancario genera sus identificadores en el Gateway: no presupongas
que dos envíos nuevos desde el navegador representan la misma solicitud.

Los montos se muestran en GTQ con dos decimales (`Q 1,250.00`). No se admiten
más de dos decimales ni se redondea silenciosamente el importe. En transferencias
el mínimo es Q 0.01.

## 4. Clientes y validación

El Cliente puede abrir su ficha. El personal puede registrar clientes y abrir
otras fichas por identificador; el Administrador también elige el rol para dar
de alta personal. El primer Administrador lo prepara el equipo técnico.

En **Validaciones** (`/clientes/validaciones`), Cajero y Administrador abren un
expediente pendiente y comparan los datos declarados con la **fotografía real**
cargada en el detalle. La interfaz distingue foto en carga, ausente y error de
lectura; una foto ausente no es lo mismo que un servicio inaccesible.

**Aprobar identidad** y **Rechazar** envían el veredicto. Rechazar exige
confirmación. El alta pública puede estar activa para iniciar sesión y seguir
pendiente de KYC; no equipares esos estados. Sigue el estado de la ficha tras
la respuesta; no deduzcas un correo real de un texto de confirmación del panel.

## 5. Cuentas

### 5.1 Abrir y consultar

En `/cuentas`, el Cliente ve las suyas. Abre el detalle para consultar número,
identificador, saldo disponible, última actividad e historial de movimientos.

| Tipo | Apertura y débitos |
| --- | --- |
| Monetaria | Saldo inicial Q 0.00. |
| Ahorro | Importe inicial mínimo Q 100.00; comisión Q 3.00 por débito de transferencia. |

El asistente de Ahorro pide monto y comprobante y ofrece una comprobación
**simulada** del depósito. No acredita un depósito real de otro sistema. El
personal puede seleccionar al titular; el Cliente abre a su propio nombre.
Respeta los avisos de identidad/KYC del formulario y consulta la cuenta después
de aceptar la solicitud.

### 5.2 Depósitos y movimientos

Cajero y Administrador registran efectivo desde `/cuentas/deposito`. Guarda el
`operationId` del recibo. Un depósito es una operación de cuenta y no tiene por
qué tener `transactionId`.

Los movimientos muestran débito, crédito y compensación con el saldo resultante.
Comprueba tanto el estado como el dinero antes de dar una incidencia por
resuelta. Una compensación de Ahorro devuelve también la comisión del débito.

### 5.3 Activar o desactivar

El Cliente puede cambiar el estado de sus cuentas desde el detalle; Cajero y
Administrador disponen de `/cuentas/administracion` para gestión general. Se
solicita un motivo. El cambio viaja por mensajería y debe comprobarse con la
consulta posterior.

Una cuenta inactiva no permite débitos. Recibir un crédito o depósito puede
reactivarla. El proceso automático desactiva cuentas con menos de Q 50.00 y seis
meses sin actividad.

La gestión permite filtros de estado y tipo; el texto de búsqueda filtra las
filas cargadas. El Gateway compone los nombres de titulares con una consulta
por lote a Customer Service; si no obtiene nombres, puede mostrar los
identificadores.

## 6. Transferencias internas

Desde `/transferencias/nueva`, elige origen, destino diferente e importe.
El saldo y la autorización se deciden en el servicio dueño del dinero.

La lista `/transferencias` permite consultar operaciones anteriores y aplicar
los filtros de fecha y estado. Abre la fila o consulta por `transactionId`.
El alcance de Cliente se aplica en el backend.

| Estado Saga | Lectura |
| --- | --- |
| `PENDING` — Aceptada | Solicitud registrada, antes del débito confirmado. |
| `DEBITING` — Debitando | Débito solicitado. |
| `PAYMENT_PENDING` — Procesando pago | Débito confirmado y pago en curso. |
| `COMPLETED` — Completada | Transferencia completada. |
| `FAILED` — Fallida | Rechazo antes de un débito exitoso. |
| `COMPENSATED` — Compensada | Débito revertido; verifica los movimientos y saldo. |

La vista también puede resumirlos como En proceso, Aprobada y Fallida
(`phaseStatus`). Ese resumen no reemplaza los seis estados.

El seguimiento consulta cada dos segundos y detiene el sondeo a los dos minutos.
Ese límite es de la pantalla; la operación continúa. Desde el monitor, el
personal consulta la Saga; el Administrador puede saltar a Auditoría.

## 7. Depósitos a otro banco

### 7.1 Enviar

Abre `/transferencias/interbancaria`. Elige origen, código del banco de destino
con forma `BANK99`, cuenta externa e importe. La cuenta externa admite de 1 a
34 letras, números o guiones. El techo del contrato es **Q 10,000.00**; la
configuración del banco puede imponer uno inferior.

La confirmación inicial significa **Depósito en curso**, no dinero acreditado.
El banco destino aún debe resolverlo. El historial propio está en
`/transferencias/interbancarias`, con filtro por seis estados; cada fila abre
`/transferencias/interbancarias/[id]`.

### 7.2 Leer el resultado

| Estado | Lo que significa |
| --- | --- |
| `PENDING` — Por enviar | Solicitud pendiente de entrega al banco externo. |
| `SENT` — Esperando al otro banco | Solicitud enviada, pendiente de decisión. |
| `ACCEPTED` — Acreditado | El banco destino confirmó el depósito. |
| `REJECTED` — Rechazado | El banco destino lo rechazó; la devolución se tramita. |
| `TIMEOUT` — Sin respuesta | Se agotó el plazo de confirmación; se reconcilia y el dinero sigue reservado. **No repitas el depósito.** |
| `REVERSED` — Devuelto | La devolución quedó registrada. |

El detalle muestra motivo traducido, importe, destino enmascarado, historial,
intentos, código de seguimiento, traza y, cuando corresponde, estado del reverso.

Un **reverso pendiente** no es una devolución confirmada. Si aparece una
liberación sin verificación del otro banco, conserva los identificadores y
contacta al operador: es una condición que requiere reconciliación. El
`TIMEOUT` interbancario tiene un protocolo distinto del timeout del proveedor
simulado de pagos internos.

## 8. Pagos y notificaciones

### 8.1 Pago de servicios

`/pagos/nuevo` permite pagar a los facturadores del catálogo (EEGSA, EMPAGUA y
CLARO), indicando cuenta de origen, referencia e importe. Es una transferencia
a la cuenta recaudadora del facturador. `/pagos` muestra ese historial.

### 8.2 Escenarios y monitoreo de pagos

El selector **Solo para demostración** de transferencias internas y nuevos pagos
ofrece Sin escenario, Aprobar, Rechazar, Fallo transitorio y Timeout. Los dos
últimos pueden subir la escalera de hasta **cuatro intentos**, con esperas de
**1, 5 y 30 segundos**. Un escenario explícito prevalece sobre la simulación
configurada para el banco. Déjalo sin escenario para el funcionamiento habitual.

Cajero y Administrador acceden a `/pagos/monitor`, con filtros por estado y tipo
de fallo, búsqueda en filas cargadas y chips de escenario. La ficha de pago
muestra intentos, respuesta del proveedor y fallo transitorio o permanente.
Aprobado indica el resultado del pago; para el resultado monetario final,
consulta también la transferencia y los movimientos.

La configuración global de simulación se administra por API, descrita en el
[manual técnico](manual-tecnico.md#simulación-administrativa-de-pagos). No existe
un editor de esos parámetros en esta pantalla.

### 8.3 Bandeja personal y consola

Todos los roles tienen bandeja personal en `/notificaciones`: el punto indica
no leído, **Ver** abre el recurso relacionado y lo marca leído; también puede
marcarse un aviso o todos. La campana muestra el conteo de no leídas. La bandeja
carga hasta 50 avisos y distingue carga, error y lista vacía; no ofrece un filtro
visual de leídas/no leídas.

Las insignias INFO, WARNING y ERROR expresan severidad, no estado de lectura.
La consola global `/auditoria/notificaciones`, solo para Administrador, filtra
por estado de entrega y correlación. Pendiente, Enviada y No enviada expresan
resultado del canal y no que una persona leyó un mensaje. Con Resend y una
dirección real, pueden enviarse activación, recuperación, rechazo de identidad
y aviso de cambio de contraseña. Las demás notificaciones siguen simuladas.

## 9. Auditoría

Solo el Administrador accede a `/auditoria`. La lista global pagina diez
eventos y ofrece cuatro filtros combinados con AND:

| Filtro | Uso |
| --- | --- |
| Código de seguimiento | UUID versión 4 completo. |
| Traza | 32 caracteres hexadecimales; se normaliza a minúsculas. |
| Servicio | Productor del evento. |
| Nivel | INFO, WARNING o ERROR. |

Los menús consultan al cambiar; los identificadores esperan **Buscar**.
**Limpiar filtros** vuelve a la lista sin condiciones. Los valores inválidos
muestran el problema junto al campo. Los eventos anteriores a la clasificación
pueden no tener nivel, y los no trazados muestran `—`.

**Ver rastro** o una consulta por correlación carga el flujo y permite filtrar
localmente por servicio y tipo. **Detalle** abre metadatos, causalidad, payload
ya redactado y traza, con enlace a Grafana cuando está configurado. La tabla
abrevia la traza; el detalle conserva su valor completo.

Lista vacía y error de consulta son estados diferentes. Una lista vacía no
demuestra que la operación no existió; puede seguir en proceso o su evento
todavía no haberse registrado. La auditoría no sustituye el libro de cuentas.

## 10. Límites y asistencia

No hay retiro de efectivo, cambio de correo desde la aplicación ni alta de
nuevos facturadores por pantalla. El acceso bancario no concede acceso a Grafana.
Los avisos generales sin dirección real siguen simulados.

Ante un problema conserva fecha, entorno, rol, ruta, estado observado,
`transactionId` o `interbankTransferId`, `correlationId` y `traceId`, sin
incluir credenciales ni fotos del DPI. No repitas una transferencia con resultado
incierto.

Continúa con la guía de [Cliente](manual/rol-cliente.md),
[Cajero](manual/rol-cajero-receptor.md) o
[Administrador](manual/rol-administrador.md). El
[recorrido visual histórico](manual/recorrido-visual.md) conserva las capturas
anteriores y separa la evidencia de Fase III.

## Capturas actuales de Fase III

El [recorrido del despliegue real](manual/recorrido-fase3.md) complementa los pasos anteriores
con interbancario, auditoría/trazas, pagos, notificaciones y ventanilla.
