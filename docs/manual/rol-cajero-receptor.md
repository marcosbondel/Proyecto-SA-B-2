# Manual del Cajero receptor

Guía de ventanilla revisada para Fase III el 21 de octubre de 2026. Consulta el
[manual general](../manual-usuario.md) para estados y reglas compartidas.

## 1. Inicio y alcance

El tablero del Cajero reúne tareas y cifras operativas. **Sin dato** significa
que la sección no respondió; no debe leerse como cero. El menú ofrece Inicio,
Clientes, Cuentas, Transferencias y Pagos. Tu bandeja personal está en la campana.

Puedes registrar clientes, validar identidad, abrir cuentas para titulares,
recibir depósitos, gestionar cuentas y monitorear transferencias y pagos.
Auditoría global y alta de personal están reservadas al Administrador.

## 2. Registro presencial

1. Abre **Clientes → Nuevo cliente**.
2. Comprueba físicamente los datos y el documento de la persona.
3. Completa el asistente de datos, documento y confirmación.
4. Guarda y entrega el `customerId` y el usuario; conserva el código de
   seguimiento para comprobar el alta.
5. Consulta la ficha después del procesamiento.

El registro hecho por personal crea al cliente **activo y con identidad
validada**; no exige abrir el correo de activación antes de entrar. El registro
público tiene otro recorrido: correo activo y KYC pendiente pueden coexistir.
El Cajero crea Clientes; solo el Administrador crea Cajeros o Administradores.

## 3. Revisión de identidad

En `/clientes/validaciones`, abre un expediente pendiente. El detalle muestra
datos declarados y la fotografía del documento obtenida mediante una ruta
protegida. Diferencia **sin foto adjunta** de **no pudimos mostrar la foto**.

Compara los datos antes de **Aprobar identidad**. **Rechazar** abre una
confirmación y registra el rechazo. No confirmes basándote en una imagen que
no se pudo cargar. La aprobación de identidad y el KYC se reflejan en la ficha;
la aceptación de un comando no reemplaza la consulta de su resultado.

## 4. Apertura y depósitos

En **Cuentas → Abrir cuenta**, selecciona al titular correcto. Elige Monetaria
o Ahorro y cumple los avisos de verificación. Ahorro requiere al menos Q 100.00
iniciales; la comprobación del recibo en este proyecto es simulada.

Para efectivo usa `/cuentas/deposito`, verifica cuenta e importe y guarda el
`operationId` del recibo. Un depósito puede reactivar una cuenta inactiva.
No hay operación de retiro de efectivo.

La **Gestión de cuentas** permite buscar entre las filas cargadas y filtrar
estado y tipo. Para activar o desactivar una cuenta, registra un motivo y
comprueba después el estado. El Cajero sí dispone de esta gestión; no es una
facultad exclusiva del Administrador.

## 5. Transferencias y pagos asistidos

Verifica titular, cuenta e importe antes de enviar. Una respuesta aceptada
requiere seguimiento. Conserva la misma solicitud al reintentar; iniciar un
formulario nuevo puede producir otra operación.

En transferencias internas distingue Fallida (sin débito exitoso) y Compensada
(débito devuelto). En Ahorro comprueba también la devolución de Q 3.00 de comisión
cuando corresponda.

Los depósitos a otro banco tienen historial y detalle propios. **TIMEOUT
conserva la reserva mientras se reconcilia**; no es una devolución. Sigue el
reverso y no indiques al cliente que envíe de nuevo antes de resolver el estado.
La guía del [Cliente](rol-cliente.md#4-depósito-a-otro-banco) explica los seis
estados.

En `/pagos/monitor` filtra por estado y fallo. La ficha muestra hasta cuatro
intentos, esperas de 1/5/30 segundos y resultado del proveedor. El chip de
escenario identifica la demostración. La configuración global de simulación
se cambia por API administrativa, no desde este monitor.

## 6. Reportar una incidencia

Guarda entorno, hora, ruta, estado, identificador de transferencia o depósito,
`correlationId` y `traceId`. El Administrador puede consultar el rastro; el
operador SRE puede buscar la traza en Grafana con sus propios permisos.

Si no llega un correo, consulta al equipo el canal y el estado de entrega;
Resend puede estar configurado tanto localmente como en cloud. No garantices
entrega por el texto de una confirmación ni publiques el enlace privado.

Volver al [índice de manuales](README.md).

## Capturas actuales de Fase III

El [recorrido del despliegue real](recorrido-fase3.md) complementa los pasos anteriores
con interbancario, auditoría/trazas, pagos, notificaciones y ventanilla.
