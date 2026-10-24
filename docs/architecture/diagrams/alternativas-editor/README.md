# Comparación: render técnico y alternativa del editor

Esta carpeta conserva las alternativas del editor de imágenes solicitadas en
la primera revisión de T-61. Son PNG históricos para comparar colores,
figuras y composición; no son capturas de ejecución ni documentos Lucid
nativos. La petición del 2026-10-22 adopta edición nativa en Lucid para casos
de uso y despliegue y entrega de diagramas sólo en PNG, según
[ADR-024](../../adr/ADR-024-native-lucid-and-png-delivery.md).

El editor puede modificar letras, números, puntas de flecha o conexiones aun
cuando se pide una edición mínima. Por ello estas variantes sirven para
comparar el estilo y no se usan como autoridad en los manuales. La topología,
los permisos y el protocolo se cotejan con las fuentes semánticas y la vista
técnica vigente. [ADR-022](../../adr/ADR-022-diagramming-sources-and-image-editing.md)
conserva la decisión histórica que originó estas variantes. La tabla no
certifica la nueva edición o exportación desde Lucid.

| Vista | Render técnico | Alternativa editada | Cotejo y límite |
| --- | --- | --- | --- |
| General | [PNG](../01-arquitectura-general.png) | [Editor](01-arquitectura-general-editor.png) | Paleta pastel por servicio y límites GCP/GKE/datos. Se iteró al detectar broker duplicado; sólo se conserva aquí la última variante. |
| Crear cuenta | [PNG](../06-uml-secuencia-crear-cuenta.png) | [Editor](06-uml-secuencia-crear-cuenta-editor.png) | Conserva azul/rojo/verde y notas amarillas; la numeración y notación de retorno del editor no certifican equivalencia UML. |
| Saga | [PNG](../07-uml-secuencia-transferencia.png) | [Editor](07-uml-secuencia-transferencia-editor.png) | El render técnico distingue `X-Trace-Id` como cabecera. La variante anterior a esa precisión conserva una etiqueta abreviada en la respuesta. |
| Despliegue GCP | [PNG](../08-despliegue-cloud-gcp.png) | [Editor](08-despliegue-cloud-gcp-editor.png) | **No equivalente en todas las conexiones:** conserva Terraform/Helm, namespaces y cinco VMs, pero la edición altera flechas/etiquetas alrededor de MinIO, AMQP y telemetría. Usar el render técnico para protocolos y destinos. |
| Envío v1 | [PNG](../09-secuencia-envio-interbancario.png) | [Editor](09-secuencia-envio-interbancario-editor.png) | Conserva secuencia azul y notas; TTL, margen, IDs y reverso se verifican en PUML. |
| Recepción v1 | [PNG](../10-secuencia-recepcion-interbancaria.png) | [Editor](10-secuencia-recepcion-interbancaria-editor.png) | La admisión 202 precede al trabajo de crédito. Cotejar flechas de ida y respuesta. |
| Reintentos | [PNG](../11-secuencia-reintentos-pago.png) | [Editor](11-secuencia-reintentos-pago-editor.png) | Escalera 1/5/30s, cuatro intentos y salida terminal; la fuente define condiciones del loop. |
| Observabilidad | [PNG](../12-observabilidad-y-alertas.png) | [Editor](12-observabilidad-y-alertas-editor.png) | **No equivalente en conexiones:** la variante altera relaciones alrededor de Prometheus/aplicaciones/broker. Se conserva sólo para comparación visual; no usarla en el entregable técnico. |
| Casos Fase III | [PNG](../13-casos-uso-fase3.png) | [Editor](13-casos-uso-fase3-editor.png) | El envío es sólo CLIENTE; personal consulta globalmente, y auditoría/simulación son administrativas. Comprobar siempre permisos en la fuente. |

Las primeras iteraciones descartadas permanecen fuera del repositorio. C4
conserva Structurizr DSL; los cinco ER se entregan como DBML y su exportación
PNG fue incorporada por el solicitante y revisada. Los PUML de CDU y despliegue conservan
su contenido para cotejar la edición nativa de Lucid, cuya revisión y
exportación se registran por separado. El [índice general](../../README.md)
explica el procedimiento vigente. Las capturas de navegador se conservan sin
editar en [su manifiesto](../../../images/fase3/manifest.json).
