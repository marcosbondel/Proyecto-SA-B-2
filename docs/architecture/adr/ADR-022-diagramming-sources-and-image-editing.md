# ADR-022: Fuentes reproducibles y alternativas del editor de imágenes

- **Status**: Partly superseded — la política gráfica y de exportación fue sustituida por [ADR-024](ADR-024-native-lucid-and-png-delivery.md), el 2026-10-22. El texto de la decisión original se conserva.
- **Date**: 2026-10-21
- **Deciders**: Responsable de T-61; revisión de la rama por el equipo.
- **Supersedes**: [ADR-013](ADR-013-diagramming-toolchain-revision.md).

## Contexto

El repositorio retiró Mermaid en `9acf394` y adoptó Structurizr DSL y DBML sin
registrar el sucesor de ADR-013. Tres PNG mantenidos a mano divergían de sus
fuentes. T-61 exige actualizar los diagramas, conservar su estilo y usar el
editor de imágenes. Las iteraciones del editor conservan la paleta, pero pueden
duplicar componentes o mover flechas. El solicitante decidió crear **ambas versiones**.

## Decisión

1. UML y arquitectura general: `.puml`; C4: `.dsl` con modelo base `c4.dsl`;
   esquema físico: `.dbml`, derivado de todas las migraciones acumuladas.
2. El PNG canónico se genera desde la fuente; UML/C4 incluyen SVG para ampliar
   texto sin pérdida. Los manuales y entregables técnicos enlazan esa versión.
3. Las alternativas del editor están en `diagrams/alternativas-editor/`,
   identificadas como **no canónicas**. Su índice registra referencia, diferencias
   y defectos visibles. No demuestran topología ni cambian el modelo.
4. Se conservan colores: arquitectura general pastel por servicio; C4 blanco
   con bordes azules, actores verdes y externos naranjas; UML gris, secuencias
   azules con broker rojo y notas amarillas; ER cabeceras azules y filas grises.
5. Toda modificación técnica requiere validar la fuente, regenerar y comprobar
   visualmente etiquetas, cardinalidades, límites y destinos de flechas.

## Alternativas y consecuencias

| Alternativa | Decisión |
| --- | --- |
| Sólo PNG del editor | Rechazada como autoridad: no garantiza texto ni conexiones. |
| Sólo fuente/render | Exacta y reproducible; se conserva también la alternativa visual solicitada. |
| Mantener Mermaid, DSL y PUML para cada vista | Rechazada: copias redundantes sin consumidor actual. |

Se cierra la divergencia documental TD-064. Se conserva el contenido histórico
de ADR-013, cambiando únicamente su estado y el vínculo al sucesor. Las fuentes
y comandos de render se documentan en [el índice](../README.md).
