# ADR-024: Edición UML nativa en Lucid y entrega de diagramas sólo en PNG

- **Status**: Accepted — política de edición y entrega confirmada por el solicitante de T-61; no certifica que las exportaciones estén terminadas.
- **Date**: 2026-10-22
- **Deciders**: Solicitante de T-61; revisión de la rama por el equipo.
- **Partly supersedes**: [ADR-022](ADR-022-diagramming-sources-and-image-editing.md), en la edición gráfica y los formatos de entrega.

## Contexto

Después de revisar las primeras imágenes de T-61, el solicitante pidió editar
los diagramas UML de casos de uso y despliegue con figuras y conectores nativos
de Lucid, sin importar archivos ni subir imágenes como sustituto del documento
editable. También pidió retirar todos los SVG documentales y los cinco PNG ER
generados. El solicitante realizará la exportación gráfica de los ER desde
los DBML conservados. Esta petición cambia la política aceptada el día anterior;
se registra aquí para conservar la historia de ADR-022.

## Decisión

1. Los diagramas UML de casos de uso y despliegue se editan en un documento
   nativo de Lucid. Actores, nodos, límites, relaciones, conectores y etiquetas
   deben ser elementos editables. No se reemplaza ese trabajo por una imagen
   importada ni por un archivo convertido. El documento de trabajo es
   [SA en Lucid](https://lucid.app/lucidchart/c7a15874-cdcd-42fa-a48c-b6c4124a6fbc/edit).
2. PNG es el único formato de imagen de los diagramas documentales. Se retiran
   los SVG de `docs/`; las capturas originales JPEG del navegador conservan
   su formato y evidencia. Esta decisión no afecta a los recursos de la
   aplicación ni del harness fuera de `docs/`.
3. Las fuentes semánticas existentes siguen versionadas. Los PUML de casos de
   uso y despliegue permiten cotejar contenido; la geometría editable y su
   exportación se mantienen en Lucid. El diff de PUML por sí solo no demuestra
   que el documento Lucid ni su PNG hayan sido actualizados.
4. C4 conserva Structurizr DSL y su procedimiento de CLI; las secuencias y las
   demás vistas PUML conservan su render a PNG. No se introduce una segunda
   fuente C4 manual ni se elimina el historial de fuentes.
5. Los cinco DBML físicos se conservan y validan contra las migraciones
   acumuladas. Se retiran sus PNG generados y el procedimiento de dibujo con
   Pillow. La exportación ER queda pendiente del solicitante; los manuales
   enlazan las fuentes sin incrustar imágenes inexistentes.
6. Se conserva el estilo existente y se revisan nombres, tecnologías,
   protocolos, límites, extremos y dirección de las relaciones. Las
   alternativas históricas del editor de imágenes mantienen su etiqueta de
   no canónicas; no certifican el trabajo nativo en Lucid.

## Alternativas y consecuencias

| Alternativa | Decisión |
| --- | --- |
| Importar el render como imagen o convertir un archivo a Lucid | Descartada por la petición de edición nativa. |
| Mantener SVG y PNG en paralelo | Sustituida por la entrega de diagramas sólo en PNG. |
| Regenerar los ER con un dibujante local | Retirada; se entregan DBML y la exportación corresponde al solicitante. |
| Eliminar PUML, DSL o DBML al cambiar el formato visual | Descartada: las fuentes conservan contenido verificable e historial. |

Cada entrega debe comprobar el documento editable, exportar el PNG y revisarlo
completo y ampliado antes de darla por terminada. Los inventarios y manifiestos
finales se regeneran después de ese paso. La adopción de esta política no es
evidencia de que Lucid esté terminado, de que un PNG se haya exportado desde él
ni de que la exportación ER pendiente exista. El estado de ejecución se registra
en [la auditoría T-61](../../qa/T-61-documentation-audit.md).
