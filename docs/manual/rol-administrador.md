# Manual del Administrador

Guía revisada para Fase III el 21 de octubre de 2026. El
[manual general](../manual-usuario.md) contiene la operación común a los roles.

## 1. Inicio y alta de personal

El tablero resume las respuestas de cinco servicios. Una sección **Sin dato**
no es cero ni prueba ausencia de actividad. Las transferencias en proceso pueden
ser de días anteriores; el contador de pagos reintentando es trabajo pendiente.

El módulo **Usuarios** usa las rutas de Clientes. En **Nuevo cliente**, puedes
elegir Cliente, Cajero receptor o Administrador. El registro público solo crea
Clientes; el primer Administrador requiere preparación técnica externa.

El alta presencial por personal verifica la identidad y activa al usuario.
Comprueba su ficha y conserva los identificadores del registro.

## 2. Cuentas y seguimiento

Tienes las operaciones de ventanilla y Gestión de cuentas: filtros por estado y
tipo, búsqueda en filas cargadas y cambios de estado con motivo. El Cajero
también tiene gestión; el Cliente puede cambiar sus propias cuentas desde el
detalle.

El nombre de titular procede de una composición del Gateway. Si aparece un
identificador, puede faltar la respuesta de nombres; confirma la ficha antes de
diagnosticar un dato perdido.

El monitoreo de Saga y el de pagos tienen alcances distintos: una aprobación del
proveedor no demuestra por sí sola el crédito final. Comprueba transferencia,
movimientos y, si es interbancaria, el detalle de depósito y reverso.

## 3. Auditoría general y por operación

Abre `/auditoria`. La tabla global pagina **diez eventos** y permite combinar:

| Campo | Regla |
| --- | --- |
| Código de seguimiento | UUID versión 4. |
| Traza | 32 caracteres hexadecimales; mayúsculas se normalizan. |
| Servicio | Productor del evento. |
| Nivel | INFO, WARNING o ERROR. |

Las condiciones se combinan con AND. Un campo vacío no filtra; los menús
consultan al cambiar y los identificadores con **Buscar**. **Limpiar filtros**
restaura la lista. Un identificador inválido se explica junto al campo.

La traza se abrevia en la tabla; el valor completo está en el tooltip y el
detalle. Un guion significa ausencia de traza registrada. Los eventos previos a
la clasificación pueden no tener severidad.

**Ver rastro** o la consulta superior por correlación abre el flujo de una
operación, con conteos y filtros locales de productor y tipo. Ese rastro puede
compartirse mediante la ruta con `?correlationId=…`, respetando los permisos.
**Detalle** abre causalidad, metadatos, payload ya redactado y traza.

El contenido se redacta antes de persistir. No es una ocultación del navegador.
La auditoría no es un libro contable y no reemplaza saldos y movimientos.

Distingue **ningún evento coincide** de **no se pudo consultar**. Un flujo
recién aceptado puede no haberse registrado todavía; una respuesta vacía no
demuestra que nunca existió.

## 4. Notificaciones

Tu bandeja personal `/notificaciones` tiene leído/no leído. La consola
`/auditoria/notificaciones` muestra entregas de todo el sistema y filtra por
correlación y estado: PENDING, SENT o FAILED. Son conceptos distintos.

Con Resend configurado, activación, recuperación, rechazo de identidad y cambio
de contraseña pueden entregarse a una dirección real. Los demás avisos usan
canal simulado. Una entrega fallida queda registrada; no hay un reintento
automático de correo en este adaptador y no revierte una transferencia.

## 5. Pasar de una operación a Grafana

Copia el código de seguimiento y la traza de una operación. Si
`NUXT_PUBLIC_GRAFANA_URL` está configurada, el badge o detalle abre la traza
en **Grafana → Explore → Tempo**. Grafana exige autenticación independiente;
el rol Administrador del banco no concede ese acceso.

El punto de acceso cloud comunicado por el equipo es
[Grafana](http://35.255.103.13). Obtén la contraseña mediante el canal del equipo;
nunca la incorpores al manual ni a capturas. Consulta los
[runbooks](../operations/runbooks/README.md) para métricas, logs y trazas.

Una traza ausente en Tempo puede deberse a la ventana, retención, muestreo o
problemas de exportación. Registra lo observado; no declares pérdida de una
operación solo porque no aparece una traza.

## 6. Simulación administrativa y escalamiento

Los parámetros globales del proveedor se consultan con
`GET /api/payments/simulation` y se sustituyen con `PUT`, solo con sesión de
Administrador. No hay editor de esos tres parámetros en el frontend.
El [manual técnico](../manual-tecnico.md#simulación-administrativa-de-pagos)
define cuerpo completo, validación, persistencia y reset.

Las pruebas de rechazo, timeout y carga deben usarse en `dev` con aislamiento
confirmado, conservando y restaurando la configuración inicial. No modifiques la
simulación de producción para obtener una captura.

Escala una liberación interbancaria sin verificación del banco externo aunque el
detalle ya indique Devuelto. Entrega IDs, estado e historial al responsable de
reconciliación. Para cualquier incidente registra hora, entorno, versión,
identificadores y evidencia, sin datos sensibles.

Volver al [índice de manuales](README.md).

## Capturas actuales de Fase III

El [recorrido del despliegue real](recorrido-fase3.md) complementa los pasos anteriores
con interbancario, auditoría/trazas, pagos, notificaciones y ventanilla.
