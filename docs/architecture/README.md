# Arquitectura: fuentes, diagramas y decisiones

Revisión T-61 contra el código y el despliegue GKE del **21 de octubre de 2026**;
política gráfica actualizada el **22 de octubre**.
[ARCHITECTURE.md](../../ARCHITECTURE.md) fija límites y reglas; los
[ADR](adr/README.md) conservan decisiones y alternativas. La evidencia y los
pendientes están en [la auditoría](../qa/T-61-documentation-audit.md).

## Vistas y lectores

| Vista | Fuente semántica | PNG de consulta | Lectura técnica |
| --- | --- | --- | --- |
| Arquitectura general | [PUML](diagrams/01-arquitectura-general.puml) | [PNG](diagrams/01-arquitectura-general.png) | [Arquitectura](../architecture.md) |
| C4 L1, contexto | [DSL](diagrams/02-c4-contexto.dsl) | [PNG](diagrams/02-c4-contexto.png) | [Contexto](c4-context.md) |
| C4 L2, contenedores | [DSL](diagrams/03-c4-contenedores.dsl) / [PUML](diagrams/03-c4-contenedores.puml) | [PNG](diagrams/03-c4-contenedores.png) | [Contenedores](c4-container.md) |
| C4 L3, seis vistas | [DSL](diagrams/04-c4-componentes.dsl) / [PUML](diagrams/04-c4-componentes.puml) | [Transaction](diagrams/04-c4-componentes.png) | [Los seis contenedores](c4-component.md) |
| Despliegue local kind | [PUML](diagrams/05-uml-despliegue.puml) | [PNG](diagrams/05-uml-despliegue.png) | [Despliegue](deployment.md) |
| Crear cuenta | [PUML](diagrams/06-uml-secuencia-crear-cuenta.puml) | [PNG](diagrams/06-uml-secuencia-crear-cuenta.png) | [Secuencia](sequence-create-account.md) |
| Transferencia/Saga | [PUML](diagrams/07-uml-secuencia-transferencia.puml) | [PNG](diagrams/07-uml-secuencia-transferencia.png) | [Secuencia](sequence-transfer.md) |
| Despliegue GCP | [PUML](diagrams/08-despliegue-cloud-gcp.puml) | [PNG](diagrams/08-despliegue-cloud-gcp.png) | [Despliegue](deployment.md) |
| Envío interbancario | [PUML](diagrams/09-secuencia-envio-interbancario.puml) | [PNG](diagrams/09-secuencia-envio-interbancario.png) | [Protocolo](../operations/INTERBANK.md) |
| Recepción interbancaria | [PUML](diagrams/10-secuencia-recepcion-interbancaria.puml) | [PNG](diagrams/10-secuencia-recepcion-interbancaria.png) | [Protocolo](../operations/INTERBANK.md) |
| Reintentos de pago | [PUML](diagrams/11-secuencia-reintentos-pago.puml) | [PNG](diagrams/11-secuencia-reintentos-pago.png) | [Saga](../events/saga-transfer.md) |
| Observabilidad/alertas | [PUML](diagrams/12-observabilidad-y-alertas.puml) | [PNG](diagrams/12-observabilidad-y-alertas.png) | [Telemetría](../sre/telemetry-catalog.md) |
| Casos de uso Fase III | [PUML](diagrams/13-casos-uso-fase3.puml) | [PNG](diagrams/13-casos-uso-fase3.png) | [Casos de uso](use-cases-uml.md) |
| Jerarquía base CDU | [31 fuentes y PNG (2 globales +29 detallados)](diagrams/cdu/README.md) | Índice por servicio | [Casos de uso](use-cases-uml.md) |
| Esquema físico, cinco bases | [Cinco DBML](diagrams/er/README.md) | Exportación pendiente del solicitante | [DDL acumulado](../generated/db-schema.md) |

Los diagramas se entregan sólo en PNG. Los casos de uso y despliegue pasan a
edición nativa en [el documento SA de Lucid](https://lucid.app/lucidchart/c7a15874-cdcd-42fa-a48c-b6c4124a6fbc/edit),
con figuras y conectores editables; sus PUML se conservan para cotejo semántico.
La presencia de un PNG en esta tabla no certifica que ya se haya sustituido por
la nueva exportación de Lucid: el estado está en la
[auditoría T-61](../qa/T-61-documentation-audit.md). El modelo compartido de
L1/L2 sigue siendo [c4.dsl](diagrams/c4.dsl). Las alternativas históricas del
editor se comparan en [su índice](diagrams/alternativas-editor/README.md) y no
son la autoridad técnica. [ADR-024](adr/ADR-024-native-lucid-and-png-delivery.md)
sustituye la política gráfica de [ADR-022](adr/ADR-022-diagramming-sources-and-image-editing.md).

## Regenerar y verificar

Herramientas usadas: Java 25, PlantUML (versión exacta en el informe de
verificación), Graphviz incluido en PlantUML y Structurizr CLI 2025.11.09.
No son dependencias de ejecución del banco. Instalar las herramientas oficiales
fuera de `docs/`; desde la raíz, con sus rutas reales:

```bash
java -jar plantuml.jar -charset UTF-8 -checkonly 'docs/architecture/diagrams/*.puml'
java -DPLANTUML_LIMIT_SIZE=24000 -jar plantuml.jar -charset UTF-8 -tpng 'docs/architecture/diagrams/0[167]-*.puml' 'docs/architecture/diagrams/09-*.puml' 'docs/architecture/diagrams/1[012]-*.puml'
java -cp 'structurizr/lib/*' com.structurizr.cli.StructurizrCliApplication validate -workspace docs/architecture/diagrams/03-c4-contenedores.dsl
java -cp 'structurizr/lib/*' com.structurizr.cli.StructurizrCliApplication export -workspace docs/architecture/diagrams/03-c4-contenedores.dsl -format plantuml -output /tmp/c4
```

Repetir validación/export para `02-c4-contexto.dsl` y `04-c4-componentes.dsl`.
Renderizar la exportación con PlantUML; T-61 inserta `scale max 6000*5000` al
inicio del PUML exportado para limitar el lienzo, sin cambiar el modelo.
Copiar `Contexto_Fase_III`, `Contenedores_Fase_III`,
`Diagrama_Componentes_Transaction` y `Componentes_<servicio>` a los nombres de
la tabla. Para ER, el [README](diagrams/er/README.md) conserva la validación
DBML y la comprobación de claves, columnas, índices y referencias; su
exportación gráfica corresponde al solicitante.

Los 31 CDU conservan sus fuentes y la paleta original. Se valida su sintaxis
sin sobrescribir con un render automático los PNG de edición nativa en Lucid.
En PowerShell, la enumeración explícita alcanza los subdirectorios:

```powershell
$diagramFiles = @(Get-ChildItem docs/architecture/diagrams -Recurse -Filter *.puml | ForEach-Object FullName)
& java -jar plantuml.jar -charset UTF-8 -checkonly @diagramFiles
```

La enumeración incluye 41 fuentes PUML (diez principales y 31 CDU). Para casos
de uso y despliegue, cotejar participantes, tecnologías y relaciones con esas
fuentes, revisar el documento nativo de Lucid y exportar sólo PNG; comprobar
texto, direcciones y legibilidad antes de publicar. C4 se regenera desde DSL.
La validación DBML no genera aquí imágenes ER. Después de la revisión visual,
actualizar el inventario y regenerar los manifiestos finales; no tomar el
manifiesto anterior al retiro de SVG/PNG ER como estado actual.
