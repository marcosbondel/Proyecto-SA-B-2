# Manual del Cliente

Guía revisada para Fase III el 21 de octubre de 2026. Las reglas comunes,
estados y límites están en el [manual general](../manual-usuario.md).

## 1. Entrar y verificar tu identidad

El registro público crea un Cliente. Completa datos personales, DPI y fotografía
JPG/PNG de hasta 5 MiB, y contraseña. Guarda tu número de cliente y código de
seguimiento. Abre el enlace de activación del correo y entra en `/login`.

Activar el correo permite iniciar sesión; la aprobación del documento y el KYC
habilitan las operaciones que los requieren. Una identidad pendiente o rechazada
no debe interpretarse como permiso para transferir. Si necesitas revisión,
contacta a un Cajero o Administrador.

La recarga conserva la sesión de la pestaña mientras el JWT siga vigente.
**Cerrar sesión**, cerrar la pestaña o la caducidad terminan ese acceso.

## 2. Cuentas

En **Cuentas**, abre el detalle para ver saldo y movimientos. Para una cuenta
nueva elige Monetaria o Ahorro; Ahorro exige Q 100.00 iniciales y cobra Q 3.00 por
débito de transferencia. La verificación del comprobante de apertura es una
simulación de la demostración.

El detalle permite activar o desactivar tus propias cuentas con un motivo. Una
cuenta inactiva bloquea débitos y puede reactivarse al recibir un crédito.
Para depositar efectivo, acude al Cajero; no hay un formulario de retiro.

Después de un cambio aceptado, actualiza para confirmar. Una respuesta
asíncrona no equivale a estado ya aplicado.

## 3. Transferencia interna

1. En **Transferencias → Nueva transferencia**, elige cuenta origen, destino
   distinto e importe.
2. Deja **Sin escenario** para el funcionamiento habitual. El bloque de
   escenarios sirve para demostraciones.
3. Revisa y envía; guarda el identificador y el código de seguimiento.
4. Sigue el detalle. Completada indica éxito; Fallida indica rechazo antes del
   débito exitoso; Compensada indica devolución del débito.
5. Revisa saldo y movimientos si hubo compensación. En Ahorro la compensación
   devuelve también la comisión.

El historial permite filtros de fecha y estado y consulta por identificador.
Si el seguimiento deja de sondear a los dos minutos, vuelve a consultar: la
operación puede seguir ejecutándose.

## 4. Depósito a otro banco

En **Depósito a otro banco** (`/transferencias/interbancaria`), elige origen,
código `BANKnn`, cuenta destino e importe. La cuenta externa admite letras,
números y guiones, hasta 34 caracteres. El techo contractual es Q 10,000.00 y
el banco puede configurar uno menor.

**Ver depósitos enviados** abre `/transferencias/interbancarias`. Filtra y
abre una fila para ver motivo, historial y reverso:

| Resultado | Acción |
| --- | --- |
| Por enviar / Esperando al otro banco | Conserva el identificador y espera confirmación. |
| Acreditado | El banco destino confirmó. |
| Rechazado | Revisa el motivo y sigue la devolución. |
| Sin respuesta (`TIMEOUT`) | El dinero sigue reservado mientras se reconcilia. **No repitas el envío.** |
| Devuelto (`REVERSED`) | Comprueba la devolución en los movimientos. |

Si el detalle advierte liberación sin confirmación del banco externo, entrega
los identificadores a soporte. El estado del reverso puede ser pendiente, en
proceso, completado o fallido; solo el estado final y los movimientos confirman
el resultado.

## 5. Pago de servicios

Desde **Pagos → Nuevo pago**, selecciona facturador, cuenta, referencia e importe.
El catálogo se consulta al banco; el pago usa la misma Saga de transferencias.
El historial de Pagos muestra tus pagos a las cuentas recaudadoras.

Un rechazo del proveedor y el agotamiento de reintentos son resultados
diferentes. El selector de demostración explica cada uno. No confundas la
aprobación del paso de pago con la confirmación final de la transferencia.

El monitoreo global de pagos es del personal; puedes consultar el resultado de
tu pago a través de tu transferencia.

## 6. Notificaciones, perfil y asistencia

La campana abre `/notificaciones`. El punto indica no leído; **Ver** abre el
recurso y marca el aviso. También puedes marcar uno o todos como leídos.
INFO, WARNING y ERROR indican severidad, no lectura ni entrega.

**Mi perfil** permite cambiar tus datos y contraseña; correo y username son de
solo lectura. **Olvidé mi contraseña** solicita un enlace de una hora sin
revelar si la dirección existe. El envío real depende del canal de correo
configurado y del resultado de entrega.

Tu rol no accede a Auditoría ni a Grafana por el solo hecho de tener una cuenta
bancaria. Para asistencia conserva entorno, fecha, operación, código de
seguimiento y traza, sin enviar contraseña, token ni foto del documento.

Volver al [índice de manuales](README.md).

## Capturas actuales de Fase III

El [recorrido del despliegue real](recorrido-fase3.md) complementa los pasos anteriores
con interbancario, auditoría/trazas, pagos, notificaciones y ventanilla.
