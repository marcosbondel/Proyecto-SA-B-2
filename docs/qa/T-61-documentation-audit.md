# T-61 / #168 — Plan, alcance y auditoría documental

## Revisión visual solicitada el 22 de octubre

Plan de revisión visual ejecutado y comprobado el **23/oct/2026**:

1. Editar las figuras, tamaños y conectores nativos del documento Lucid `SA`,
   partiendo de sus páginas originales de casos de uso y despliegue. No importar
   archivos ni reemplazar esas páginas por diagramas generados.
2. Recuperar el detalle de Transaction del DSL adjunto, con nombres cotejados
   contra el código. Conservar las demás vistas L3 como complementarias y
   mejorar el espaciado de las imágenes derivadas del DSL por CLI.
3. Retirar los SVG documentales y los cinco PNG ER; conservar DBML para que el
   solicitante prepare sus propias imágenes. Ajustar referencias y manuales.
   El 23/oct se verificaron los cinco PNG ER que incorporó posteriormente.
4. Exportar los PNG editados desde Lucid, registrar procedencia y verificar
   enlaces, activos y alcance del diff. No presentar esta revisión como
   terminada antes de verificar las páginas y los archivos finales.

Rama **`feature/T-61`**, creada desde `origin/develop` en `40660d5`.
Revisión documental iniciada el 21/oct/2026 GT y cierre gráfico/documental el
23/oct/2026, después de los commits del solicitante hasta `4458d2f`, con lecturas cloud y ejecuciones dev fechadas en sus evidencias. No se cambió código, pruebas, contratos ejecutables,
workflows, configuración Helm/Terraform ni infraestructura persistente.

## Cierre de la revisión del repositorio, 23/oct/2026

Se conservaron la consolidación del manual y las mejoras de distribución C4
aportadas por el solicitante. Se corrigieron los seis flujos nuevos de Fase III
contra controladores, contratos y casos de uso: rutas v1, eventos reales,
propiedad de la Saga, reserva durante TIMEOUT, contingencia/cancelación,
anomalía estrictamente mayor que N y configuración administrativa por API.

Las etiquetas HMAC añadidas por la edición anterior eran incorrectas: se
sustituyeron por `X-Api-Key` en Lucid. Sólo CLIENTE origina envíos; ADMIN y
CAJERO consultan por su alcance. El scheduler resuelve TIMEOUT: no existe un
endpoint administrativo que fuerce ese barrido. Se sincronizaron las dos
referencias PUML de Fase III y la de Payment con las vistas nativas.

Se exportaron las vistas nativas cloud, Payment y Fase III. La nota técnica cloud distingue
Web en GKE de Cloud Run y BANK99 sólo prod, además de Terraform/Helm y el estado observado
de HTTP, NetworkPolicies y RabbitMQ. Se reemplazó el PNG cloud de 1024×768 por
la exportación final 6000×4478. El canal OTLP conserva la línea sin puntas de
flecha elegida por el solicitante. Se mantiene la página original `despliegue`;
el borrador alternativo UML no forma parte del entregable.
[Procedencia](verification/T-61-diagram-provenance.json).
Los otros PNG nativos aportados por el solicitante se conservaron.

El cotejo C4 conserva las **45 relaciones dirigidas** de L2 y las **45 de
Transaction**, con las mismas etiquetas que sus DSL, y comprueba el código
incrustado en los PNG contra los PUML de presentación. No se perdió el detalle
de Transaction al mantener cinco L3 complementarias. Los ER se revisaron sin
regenerarlos; las restricciones detalladas permanecen en DBML/DDL.

El cierre corresponde a **documentación y archivos gráficos**. La matriz de
abajo conserva las pruebas operativas incompletas o fallidas de #167; esta
revisión no las convierte en aprobadas ni cierra automáticamente #168 en GitHub.

## Alcance final de despliegue

Por petición del solicitante, el entregable conserva únicamente el diagrama
GCP. Se retiraron la página nativa de despliegue local, su PNG, su fuente PUML
y la variante histórica del editor, junto con las referencias de los manuales.
Además, se reconstruyó el canal OTLP que tenía un extremo suelto y se aplicó
una jerarquía tipográfica común: títulos en negrita y detalles en peso normal.
La etiqueta del canal incluye 4317/4318 y el bloque identifica su Collector.

Los procedimientos y evidencias históricas de desarrollo mantienen su contexto;
no se presentan como el despliegue cloud.

## Plan ejecutado y puntos de revisión

1. Inventariar documentación, enunciado y criterios #168; cotejar con #167,
   contratos, migraciones, rutas, métricas, chart y Terraform.
2. Revisar dominio/datos/eventos; regenerar los cinco ER y DDL acumulado sin
   inventar relaciones entre bases; inventario de los 134 contratos.
3. Actualizar arquitectura general, C4 L1/L2 y seis L3, despliegue cloud,
   Saga y secuencias Fase III; conservar colores/estilo, añadir Helm/Terraform,
   tecnologías/protocolos y fuentes; la política posterior ADR-024 conserva sólo PNG.
4. Entregar **dos versiones**, por decisión del solicitante: render técnico
   canónico y alternativas editadas identificadas; [ADR-022](../architecture/adr/ADR-022-diagramming-sources-and-image-editing.md).
5. Revisar SRE: catálogo, cinco SLO principales, ventanas/presupuestos,
   16 alertas y siete runbooks con procedimiento por regla; registrar ADR
   sucesores sin reescribir historia.
6. Navegar la aplicación real por roles, obtener capturas para manuales,
   distinguir funciones visibles de APIs administrativas y de prototipo.
7. Comprobar cloud; carga y fallos autorizados dev, prod en lectura. Conservar
   salidas fallidas, saldos, límites de medición y restauración.
8. Integrar índices, propiedad/inventario, metodología/Bonking, calidad y deuda;
   validar enlaces/anclas, fuentes, renders, ejemplos y alcance Git.

Cada punto se revisa con sus artefactos, no con una afirmación global de
“proyecto terminado”. La documentación no corrige los defectos de código que
descubre: se identifican con propietario y #167 para implementación separada.

## Matriz de entrega #168

| Grupo | Evidencia actual | Estado y límite |
| --- | --- | --- |
| A — Arquitectura | [Índice](../architecture/README.md), 12 vistas principales, C4 por contenedor y cinco ER | Actualizado; fuentes y renders canónicos. 31 fuentes CDU base, una vista Fase III y seis actividades; vistas nativas Lucid y ER aportados por el solicitante. Total: 49 PUML, cuatro DSL, cinco DBML, 69 PNG y cero SVG en diagramas. |
| B — SRE | [SLI/SLO](../sre/sli-slo-sla.md), [catálogo](../sre/telemetry-catalog.md), [16 alertas/runbooks](../operations/runbooks/README.md) | Fórmulas/configuración contrastadas; presupuesto negativo y falta de cobertura completa documentados. |
| C — ADR | [020–024](../architecture/adr/README.md) | SLO, v1, diagramación y evolución observabilidad; 013 superseded, 018 conserva historia. |
| D — Postmortems | [Índice](../sre/postmortems/README.md) | Tres experimentos cloud nuevos, Rabbit real reconstruido parcial y cuatro históricos kind. Falta caída de banco externo dev. |
| E — Evidencia cloud/carga | [Informe T-60](backend/T-60-cloud-evidence.md), nueve dashboards y raw k6 | Dos umbrales k6 fallan, uno pasa; HPA hasta 5, saldo total conservado. Tempo→Loki y compensación observados; detalle de anotación deploy y apertura log→Tempo independiente parciales. |
| F — Manuales | [Manual unificado](../manual-usuario.md), [índice](../manual/README.md), [24 casos](guia-validacion-manual-fase3.md) | Navegación/capturas reales; casos mutantes pendientes se conservan como tales. |
| G — Proyecto/operación | [README](../../README.md), [cloud](../operations/CLOUD.md), [interbank](../operations/INTERBANK.md), [metodología](../METHODOLOGY.md) | Estado observado separado del objetivo; Bonking es GitHub Projects. |
| H — Trazabilidad/deuda | [Inventario](../DOC_INVENTORY.md), [deudas](../TECH_DEBT.md), [dominio](../domain/README.md) | Dueños conservados; cierres sólo con fuente/evidencia, brechas nuevas vinculadas a #167. |
| I — Verificación | [Informe y manifiesto](verification/T-61-verification.md) | No se publica “todo verde” ante fallos de entorno, umbrales o herramientas. |

## Cambios por sección

- Entrada del proyecto y guías de agentes: siete apps, cuatro bibliotecas,
  cloud v1.3.6 y funciones Fase III; se conserva el vínculo permanente DESIGN.
- Arquitectura: límites reales de Cloud Run/GKE/VM, observabilidad y banco
  externo; tecnologías, puertos, Terraform, Helm, WIF, almacenamiento y HPA.
- Dominio/eventos/datos: estados, invariantes, TTL/reserva, outbox/leases,
  reversos/refund, cuenta de liquidación, anomalía N/M y mensajes actuales.
- Manuales: interbancario, pagos/intentos, auditoría/trazas, notificaciones y
  recuperación; la simulación se configura por API, no por formulario inventado.
- Seguridad/SRE/operación: credenciales en comandos frente a redacción de
  eventos; Resend para cuatro eventos; fórmulas exactas, runbooks, persistencia
  y retenciones local/cloud; deudas que siguen abiertas.
- Evidencia: screenshots originales del navegador y JSON/txt de lecturas y
  experimentos. Se conserva el origen de la evidencia antigua sin recatalogarla
  como una ejecución nueva.

## Resultados de verificación

Esta sección registra comandos realmente ejecutados y sus límites. Los logs
de verificación y el manifiesto de artefactos acompañan el cierre de la rama.

| Comprobación | Resultado observado |
| --- | --- |
| Structurizr CLI 2025.11.09 | L1/L2/L3 válidos; exportados para render. |
| PlantUML 1.2026.9 / Graphviz 2.44.1 / Java 25 | 49 PUML válidos; seis actividades Fase III corregidas y renderizadas. UML nativo exportado desde Lucid sin renderizar sus referencias PUML sobre esos PNG. |
| DBML / activos | Cinco modelos: 34 tablas, 11 FK (validación DBML previa conservada). Cinco ER aportados, 69 PNG de diagramas, cero SVG y 25 capturas originales comprobadas; manifiesto final renovado. [Verificación](verification/T-61-verification.md). |
| Contratos | 134 emitidos; tres ejemplos de flujo regenerados y validados. `docs:catalog` falla porque sólo clasifica 48/134; adaptador documental reproducido en README. |
| Web Node 24.19 | 397 casos: 396 pasan/1 falla por regex que espera LF en YAML CRLF del contrato en Windows. No se editó contrato ni test para ocultarlo. |
| Observabilidad | Suite de cardinalidad 4/4; otras suites no arrancaron por módulos SDK faltantes en instalación local. |
| `pnpm lint` | Intento con runtime pnpm 11.25 (bundled) bloqueado antes de ESLint por EPERM al registrar symlink fuera del workspace. No se presenta como un resultado del código ni de lint. |
| Cloud dev | Baseline/provider exit 99 por umbral Saga; pod exit 0. Evidencia original y recuperación en informe T-60. |

No se ejecutaron suites con TRUNCATE contra bases de la aplicación desplegada.
No se certifica un build nuevo de las aplicaciones por modificar sólo docs.
Los documentos históricos de QA conservan su fecha y resultados originales.

## Pendientes externos a esta rama

La [evidencia cloud](backend/T-60-cloud-evidence.md) y
[deuda](../TECH_DEBT.md) precisan los faltantes de #167. Actualizar las guías
no aplica TLS/NetworkPolicy, no alinea imágenes, no cambia la semántica del
crédito ni instala el mock dev. La ausencia de una evidencia se declara como
tal. El cierre de #168 necesita revisión de su matriz, no sólo un diff grande.


## Estado de entrega para revisión

El solicitante integró la documentación anterior en `develop` hasta `4458d2f`.
La revisión adicional del 23/oct se prepara para entrega de `feature/T-61`
hacia `develop`, actualizado a `bdeb606`. El issue #168 ya figuraba cerrado al
preparar el PR; esta entrega registra la conclusión del alcance documental y
conserva los límites de evidencia de #167. Su diff se limita a documentación,
fuentes, PNG y evidencia relacionados. El
[manifiesto final](verification/T-61-artifacts.json) enumera cada archivo
cambiado con su tamaño y SHA-256 para revisar el alcance concreto. Las nueve
[alternativas del editor](../architecture/diagrams/alternativas-editor/README.md)
se conservan separadas de los renders técnicos.
