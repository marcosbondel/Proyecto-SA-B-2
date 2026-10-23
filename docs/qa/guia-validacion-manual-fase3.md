# Guía de validación manual — Fase III

T-61 / #168. Preparada el **21 de octubre y revisada el 22 de octubre de 2026** a partir de rutas,
composables, funciones de presentación, controladores y contratos actuales.

## Cómo interpretar la evidencia

**Inspeccionado en código** significa que existe la ruta o comportamiento en el
checkout revisado. **Pendiente de navegador** significa que este documento no
afirma haber ejecutado el caso. Una captura se registra solo después de
observarla; no se generan imágenes de pantallas como sustituto de evidencia.

Para cada ejecución registra fecha/hora de Guatemala, entorno, URL, rol,
versión/commit cuando esté disponible, navegador/viewport, pasos, resultado
esperado y observado, y `correlationId`/`traceId` si existen. Una revisión de
producción y una ejecución local de tests tienen alcances diferentes.

Las direcciones comunicadas por el equipo son
[web producción](https://bank-usac-web-mn2e6zhkwq-uc.a.run.app),
[Gateway producción](http://34.69.101.197:3000),
[Gateway dev](http://136.71.158.228:3000) y
[Grafana](http://35.255.103.13). El estado observado se añade abajo; la lista de
URLs no es una declaración de disponibilidad.

## Matriz de casos

Todos los casos de esta tabla se contrastaron con el código. La columna distingue casos observados, comprobaciones parciales y pendientes;
las capturas del recorrido respaldan sólo lo que muestran.

| ID | Rol / entorno | Acción y resultado esperado | Estado de ejecución |
| --- | --- | --- | --- |
| M3-01 | Invitado / prod, lectura | Abrir login; formulario legible sin error de contenido mixto. | Observado: captura01 (login); sin credenciales visibles |
| M3-02 | Tres roles / prod | Entrar con cuenta del rol, comprobar dashboard y menú; no publicar JWT. | Observado login/dashboard de tres roles; capturas02/06/10 y menú por rol |
| M3-03 | Cliente / prod, lectura | Recargar una página: sessionStorage conserva acceso si el JWT no caducó. | Observado parcialmente durante navegación; no se midió caducidad del JWT |
| M3-04 | Cliente / prod, lectura | Abrir cuentas propias y detalle, comparar saldo/estado entre vistas. | Observado dashboard/listado; comparación exhaustiva detalle pendiente |
| M3-05 | Cajero / prod, lectura | Abrir gestión y ventana de depósitos sin confirmar movimientos. | Observado formulario de ventanilla sin confirmar; captura10 |
| M3-06 | Personal / dev | Registrar Cliente presencial: alta activa y validada; consultar resultado. | Pendiente; modifica datos |
| M3-07 | Invitado / dev | Registrar usuario con correo controlado: activar y distinguir KYC pendiente. | Pendiente; modifica datos y puede enviar correo |
| M3-08 | Personal / dev | Revisar foto real de un expediente y decidir; distinguir ausencia y fallo. | Pendiente; veredicto modifica datos |
| M3-09 | Cliente / dev | Crear transferencia interna aprobada; comprobar estados y saldos. | Ejecutado API/carga dev:169 COMPLETED baseline; evidencia T-60; navegador no ejecutó movimiento |
| M3-10 | Cliente / dev | Rechazo de pago y compensación, incluida comisión Ahorro si corresponde. | Ejecutado parcialmente API/carga dev:2 COMPENSATED; saldo total conservado. Comisión Ahorro no ejercitada |
| M3-11 | Personal / dev | TRANSIENT_FAILURE y TIMEOUT: hasta 4 intentos con esperas 1/5/30 s. | Ejecutado proveedor dev 30/10% y restauración; se conservan límites del muestreo y p95 fallido |
| M3-12 | Cliente / prod, lectura | Abrir envío interbancario sin confirmar; comprobar campos y límite. | Observado: formulario y máximo Q10,000; captura03; sin confirmar |
| M3-13 | Cliente / prod, lectura | Abrir historial interbancario; filtro por seis estados, vacío y error diferenciados. | Observado listado con operaciones existentes y filtro visible; captura04; no se forzó vacío/error |
| M3-14 | Cliente / prod, lectura | Abrir depósito existente: motivo, historial, destino enmascarado y reverso. | Observado depósito ACCEPTED e historial; captura05; reverso no ejercitado por UI |
| M3-15 | Cliente / dev | TIMEOUT interbancario: conservar reserva y no ofrecer resultado de éxito prematuro. | Pendiente; usa mock controlado |
| M3-16 | Administrador / prod, lectura | Auditoría: combinar correlación, traza, servicio y nivel; probar ID inválido y limpiar. | Observado filtros y consulta por correlationId; captura07. Todas las combinaciones/ID inválido pendientes |
| M3-17 | Administrador / prod, lectura | Ver rastro, detalle, payload redactado y traza completa; conservar causalidad. | Observado rastro compensado diez eventos y cuatro servicios; captura08. Revisión exhaustiva redacción pendiente |
| M3-18 | Personal / prod, lectura | Monitor de pagos: filtros, chip de escenario e intentos de una fila existente. | Observado monitor con rechazos e intentos; captura09; no se ejercitaron todos los filtros |
| M3-19 | Tres roles / prod, lectura | Abrir bandeja personal y comparar con consola global solo Administrador. | Observada bandeja cliente sin marcar; captura11. Bandejas de otros roles pendientes |
| M3-20 | Tres roles / dev | Marcar un aviso y todos; estado de lectura persiste tras recarga. | Pendiente; modifica datos |
| M3-21 | Administrador + SRE / prod, lectura | Abrir traza en Grafana con sesión independiente; anotar encontrada/ausente y ventana. | Observada traza Tempo real, spans ordered/completed; captura12; acceso SRE separado |
| M3-22 | Administrador / dev | GET/PUT simulación: cuerpo completo, inválidos, reset y restauración del estado inicial. | Ejecutado GET/PUT dev 30/10/0 y valores 0/0/0 restaurados; override RUNTIME conservado; cuerpos inválidos no ejercitados |
| M3-23 | Cliente / dev | Recuperación con correo controlado, token de 1 hora y aviso de cambio; comprobar entrega real si Resend está configurado. | Pendiente; cambia credenciales/envía correo |
| M3-24 | Roles / dev | Acceso prohibido a auditoría/monitor por URL y respuesta API; sin filtración de datos. | Pendiente; prueba autorizada de permisos |

Los casos de carga y eliminación de pods pertenecen a la evidencia SRE T-60/T-51,
no se consideran ejecutados por abrir el frontend. En dev confirma contexto,
bases aisladas, mock y estado inicial antes de mutar. Restaura simulación y
verifica el estado final incluso si un escenario falla.

## Capturas de Fase III

Las doce capturas siguientes existen en `docs/images/fase3/manual/`;
[el recorrido](../manual/recorrido-fase3.md) las enlaza y explica. El
[manifiesto](../images/fase3/manifest.json) registra origen, hora UTC, tamaño y hash:

| Archivo capturado | Contenido observado |
| --- | --- |
| `01-login.jpg` | Acceso público. |
| `02-cliente-dashboard.jpg` | Inicio con rol Cliente. |
| `03-interbank-formulario.jpg` | Formulario sin confirmar envío. |
| `04-interbank-historial.jpg` | Lista y filtro, incluso si está vacía. |
| `05-interbank-detalle.jpg` | Depósito existente, estado y reverso. |
| `06-administrador-dashboard.jpg` | Inicio Administrador. |
| `07-auditoria-filtros.jpg` | Cuatro filtros y tabla real. |
| `08-auditoria-detalle-traza.jpg` | Drawer de evento con traza/payload redactado. |
| `09-pagos-monitor.jpg` | Filtros y filas disponibles. |
| `10-cajero-cuentas.jpg` | Gestión accesible al Cajero. |
| `11-notificaciones.jpg` | Bandeja personal sin alterar lectura. |
| `12-grafana-explore.jpg` | Traza real en Tempo; ausencia se registra como tal. |

Añade solo archivos capturados y revisados. Mantén etiquetas, controles e
identificadores técnicos legibles. Evita nombres de personas ajenas a la demo,
documentos, fotos, passwords, tokens, cookies y cabeceras Authorization. No
retoques el resultado de una operación ni sustituyas “Sin dato” por cifras.

## Registro de ejecución

| Fecha/hora (Guatemala) | Caso | Entorno / versión | Resultado observado | Evidencia |
| --- | --- | --- | --- | --- |
| 21–22/oct/2026, horas UTC de archivo en manifiesto | M3-01/02/05/12–14/16–19/21, alcance parcial según matriz | Producción v1.3.6 observada; navegador | Login y navegación por roles, rastro compensado, Tempo y Loki; sin confirmar movimientos. | [Capturas](../images/fase3/manifest.json) |
| 21/oct/2026 22:28–22:49 GT | M3-09/10/11/22, alcance según matriz | Dev, tres corridas k6 | Transferencias internas, fallos 30/10/0, dos compensaciones, eliminación de un pod y restauración. | [T-60](backend/T-60-cloud-evidence.md) |
| Pendiente | Restantes casos y subcasos de la matriz | Dev aislado | No se declaran ejecutados por tener procedimiento o captura de otra acción. | — |

## Hallazgos y límites

- El código de correo permite dirección real para cuatro eventos; varios
  comentarios antiguos todavía dicen «solo activación». Los manuales siguen el
  conjunto ejecutable `DELIVERABLE`, no esos comentarios.
- La integración web usa Nitro real y upstreams controlados. No prueba por sí
  sola los siete componentes desplegados ni todo el recorrido de navegador.
- Las capturas del [recorrido anterior](../manual/recorrido-visual.md) pertenecen
  a su ejecución histórica. No acreditan la configuración de producción actual.
- Si aparece un fallo, registra pasos, expectativa, resultado, IDs y evidencia y
  vincúlalo al ticket de implementación #167. La revisión T-61 cambia
  documentación; no corrige código ni modifica la operación para aparentar éxito.

Los estados se actualizan únicamente tras verificar la evidencia. No se cierra
un caso ni la historia completa por disponer de un procedimiento escrito.

## Evidencia de esta sesión

[Recorrido real](../manual/recorrido-fase3.md), [carga cloud](backend/T-60-cloud-evidence.md)
y [manifiesto de capturas](../images/fase3/manifest.json). No se sustituye un
caso pendiente por una captura de otra acción o entorno.
