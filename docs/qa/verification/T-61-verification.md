# Verificación documental T-61

Revisión iniciada el 21 de octubre y cierre de comprobaciones el
**22 de octubre de 2026, Guatemala**. Rama `feature/T-61`, base `40660d5`.
El [informe](../T-61-documentation-audit.md) enlaza alcance, evidencia y
pendientes de #167/#168. Los resultados no certifican un cambio de aplicación.

**Revisión de formato del 22/oct, posterior a las comprobaciones de abajo:**
se retiraron los SVG documentales y los cinco PNG ER generados; se conservaron
los cinco DBML y sus hashes durante el retiro. [ADR-024](../../architecture/adr/ADR-024-native-lucid-and-png-delivery.md)
adopta UML de casos de uso/despliegue nativo en Lucid y diagramas sólo PNG.
Las exportaciones Lucid/C4 siguen su revisión propia y el solicitante
exportará los ER. Los manifiestos JSON y los conteos previos conservados a
continuación requieren regeneración al terminar esa revisión: no describen
el conjunto actual ni certifican exportaciones pendientes.

## Comandos ejecutados

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

## Comprobación anterior a la revisión de formato

El manifiesto de revisión enumera cada archivo, su SHA-256 y las validaciones
de enlaces, fuentes, tipos y render. Las incidencias de documentos históricos
se separan de enlaces introducidos por T-61; no se da por aprobada una ruta que
no existe. Las capturas originales tienen un
[manifiesto independiente](../../images/fase3/manifest.json).

Resultado previo en [T-61-artifacts.json](T-61-artifacts.json): 160 entradas
documentales; 159 Markdown de producto analizados y una plantilla de catálogo
clasificada aparte. La plantilla contiene rutas relativas al archivo que
genera, por lo que no se resuelven como si se ejecutara desde su directorio.
La comprobación de rutas/anclas locales dio cero incidencias; no certifica
disponibilidad futura de enlaces remotos.

Activos comprobados antes del retiro: **41 PUML, cuatro DSL, cinco DBML, 66 PNG y 51 SVG**, más **25 JPEG
originales** del navegador. Se comprobaron apertura/integridad de 91 imágenes,
XML de 51 SVG, JSON y correspondencia de los renders PUML con sus fuentes.
Los 66 PNG incluyen 56 renders técnicos y diez alternativas del editor.
El manifiesto registra dimensiones y SHA-256 de cada artefacto cambiado,
excepto su propio hash, para evitar una referencia circular.

Las cinco referencias versionadas conservaron el blob Git de la base
`40660d5`, incluidos PDF y contrato OpenAPI oficial. En Windows la comparación
usa el contenido normalizado por Git; las diferencias LF/CRLF del checkout no
se presentan como una modificación del contrato. Se registran además los
SHA-256 de los archivos del workspace.

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
No se creó commit ni PR.


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
   Comprobar que no queden SVG documentales ni enlaces a los ER retirados.
   Comparar cada
   SHA-256 del manifiesto de capturas con su original, sin transformar imágenes.
4. Comparar las referencias con `git rev-parse 40660d5:<ruta>` y
   `git hash-object <ruta>`; revisar `git diff --check` y enumerar el diff
   completo, incluidos nuevos archivos. El manifiesto conserva la lista de
   archivos y hashes usada en este cierre.

Las herramientas temporales se retiraron del workspace tras la validación;
no se añadieron dependencias ni scripts al producto. Las salidas de tests
conservan la ejecución real y no son una nueva certificación del código.
