# Verificación documental T-61

Revisión iniciada el 21/oct/2026 y cierre de archivos del **23/oct/2026,
Guatemala**. Rama `feature/T-61`. La auditoría original partió de `40660d5`;
esta revisión adicional partió de `4458d2f`, que ya incorporaba los commits del
solicitante. Para el PR se adelantó la rama a `develop` en `bdeb606`; el
manifiesto final usa esa base para excluir cambios ajenos ya integrados.
[Informe de alcance](../T-61-documentation-audit.md).

## Comprobación actual del 23/oct

- **49 PUML y cuatro DSL válidos**, comprobados de nuevo con PlantUML 1.2026.9
  y Structurizr CLI 2025.11.09. [Salida estructurada](T-61-source-review.json).
- **158 filas explícitas** en DOC_INVENTORY, tras la consolidación del manual
  y la incorporación de la guía de validación en producción llegada de develop.
  Se conservan el manual unificado, su índice y el recorrido Fase III.
- **69 PNG, cero SVG, cinco DBML** bajo diagramas. Los cinco ER fueron aportados
  por el solicitante y se revisaron visualmente. Su tabla/relación visible no
  sustituye los CHECK, índices o claves compuestas del DBML/DDL. El parseo previo
  de 34 tablas y 11 FK se conserva como evidencia fechada, sin presentarlo como
  una nueva ejecución del parser el 23/oct.
- Seis actividades Fase III corregidas y regeneradas; vistas nativas cloud, Payment y Fase III revisadas/exportadas desde Lucid. Las dos rutas PNG
  de Fase III contienen la misma exportación. [Procedencia](T-61-diagram-provenance.json).
- L2 y Transaction conservan sus ajustes PUML de presentación, con 45 relaciones
  dirigidas cada uno cotejadas contra exportaciones DSL nuevas. El código
  incrustado en los PNG coincide con esos PUML (el footer añade la versión del
  renderizador). Los otros seis C4 conservan el procedimiento desde DSL.
- El [manifiesto final](T-61-artifacts.json) registra rutas/anclas locales,
  integridad de todas las imágenes y JSON de docs, hashes, inventario, alcance
  Git y las cinco referencias inmutables de `40660d5`. Las 25 capturas originales
  del [manifiesto de navegador](../../images/fase3/manifest.json) conservan sus hashes.

No se volvió a ejecutar la aplicación, carga, fallos cloud o pruebas bancarias
para esta revisión de archivos. Las lecturas de operación corresponden a las
fechas originales. El siguiente bloque conserva sus resultados históricos.

## Comandos ejecutados en la auditoría del 21–22/oct

| Comprobación | Resultado y evidencia |
| --- | --- |
| PlantUML 1.2026.9, Java 25, Graphviz 2.44.1 | Las 41 fuentes PUML se validaron explícitamente y se renderizaron a PNG/SVG; [salida](T-61-plantuml.txt). El comando exitoso no imprime diagnósticos. |
| Structurizr CLI 2025.11.09 | **4/4 DSL válidos**; modelo compartido, L1/L2 y seis vistas L3. [Resultado](T-61-structurizr.json). |
| DBML | **5/5 válidos** con `@dbml/core` 10.3.1, parser dbmlv2: 34 tablas y 11 FK. El CLI Windows falló por conversión de ruta antes del parseo; la API oficial en memoria validó y exportó SQL temporal. [Resultado](T-61-dbml.json). |
| Web ESLint | **Exit 0** con Node 24.19 desde `apps/web`, equivalente al script del paquete; [salida](T-61-web-lint.txt). |
| Web Node test runner | **397 pruebas, 396 aprobadas/1 fallo, 0 omitidas**; [salida](T-61-web-unit.txt). Falla el parser del test que espera LF al buscar ReasonCode en YAML con CRLF; no se modificó contrato ni test. |
| Cardinalidad de métricas | **1 suite, 4 pruebas aprobadas**, con el directorio hoisted de pnpm en NODE_PATH; [salida](T-61-cardinality.txt). |
| Lint workspace | No llegó a ejecutar ESLint: runtime bundled pnpm 11.25 intentó registrar un symlink fuera del workspace y recibió EPERM; [intento](T-61-workspace-lint-attempt.txt). El proyecto pide pnpm 11.21. |
| Suites amplias de observabilidad | La instalación local carece de enlaces SDK OpenTelemetry necesarios; no se informa aprobación ni se instalaron dependencias para ocultar el límite. |
| Contratos/esquemas | Compilación del paquete y emisión de 134 contratos; ejemplos de tres flujos regenerados y validados. El generador de catálogo clasifica 48/134 y falla; el README incorpora el adaptador documental completo. |
| Cloud dev | Baseline/proveedor exit 99 por umbral de seguimiento, pod exit 0. No se alteraron umbrales. [Evidencia](../backend/T-60-cloud-evidence.md). |
| Estado final | [22/oct UTC](../load/2026-10-22-final-readiness.json): ambos Gateways HTTP 200 en health/ready; simulación dev 0/0/0. Sólo lectura, sin transferencias nuevas. |

## Archivo de la primera comprobación

Antes de la revisión gráfica se verificaron 41 PUML, cuatro DSL, cinco DBML,
66 PNG, 51 SVG y 25 JPEG. Esos conteos describen la primera ejecución, no el
estado final. El manifiesto actual los sustituye; las salidas históricas de
tests y del parser DBML conservan su fecha y no se reetiquetan como nuevas.

Las referencias versionadas conservaron el blob Git de `40660d5`, incluido
el contrato OpenAPI oficial. La comparación usa normalización Git para no
tratar LF/CRLF de Windows como un cambio del contrato.

Ningún resultado `skipped`, `No data`, `NaN` o umbral cruzado se convirtió en
un pase. La traza de compensación y Tempo→Loki se observaron; la apertura
independiente log→Tempo y el detalle de commit/versión de una anotación de
deploy conservan su límite en T-60.

## Límite de alcance

El diff se limita a Markdown, fuentes/renders de diagramas, ejemplos de
documentación y evidencia JSON/txt/JPEG. Las especificaciones y referencias
originales, código, manifests, tests y workflows no se reescriben. No se
ejecutaron pruebas SQL destructivas sobre bases vivas ni Terraform apply;
no se cambió infraestructura ni configuración Helm/Terraform. La simulación
runtime dev se modificó temporalmente y sus valores volvieron a 0/0/0.
La fila de override permanece con `source=RUNTIME` y su `updatedAt`, frente a
`DEFAULTS`/null del preflight; no se afirma haber restaurado esa procedencia.
El solicitante ya integró los commits anteriores. Esta revisión del 23/oct se
entrega en un PR documental desde `feature/T-61` hacia `develop`; la autoría del
commit fue confirmada por el solicitante como Enner Mendizabal. La copia UML
alternativa de Lucid queda fuera de esta entrega por decisión del solicitante.


## Reproducir la comprobación documental

1. Usar las versiones y comandos del [índice de arquitectura](../../architecture/README.md)
   para validar PUML/DSL y generar sólo los PNG correspondientes a C4 y
   vistas PUML que conservan render. Revisar y exportar los casos de uso y
   despliegue desde su documento nativo Lucid. Usar la validación DBML del
   [índice ER](../../architecture/diagrams/er/README.md); su exportación PNG
   corresponde al solicitante y no se regenera con Pillow.
2. Recorrer las filas explícitas de DOC_INVENTORY, omitiendo reglas glob del
   harness y tratando el preámbulo de catálogo como plantilla. Resolver cada
   enlace Markdown relativo desde el directorio del documento y verificar
   su existencia; para anclas, normalizar los headings con los slugs de
   GitHub y sus sufijos para duplicados, además de IDs HTML explícitos.
3. Abrir PNG/JPEG con Pillow `Image.verify()` y JSON con `json.loads()`.
   Comprobar que no queden SVG documentales y que estén los cinco PNG ER
   aportados por el solicitante, junto a sus DBML.
   Comparar cada
   SHA-256 del manifiesto de capturas con su original, sin transformar imágenes.
4. Comparar las referencias con `git rev-parse 40660d5:<ruta>` y
   `git hash-object <ruta>`; revisar `git diff --check` y enumerar el diff
   completo, incluidos nuevos archivos. El manifiesto conserva la lista de
   archivos y hashes usada en este cierre.

Las herramientas de comprobación permanecen en `tmp/`, ignorado por Git;
no se añadieron dependencias ni scripts al producto. Las salidas de tests
conservan la ejecución real y no son una nueva certificación del código.
