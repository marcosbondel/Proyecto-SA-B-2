# T-61 / #168 — Plan, alcance y auditoría documental

## Revisión visual solicitada el 22 de octubre

Plan en ejecución tras la revisión del solicitante:

1. Editar las figuras, tamaños y conectores nativos del documento Lucid `SA`,
   partiendo de sus páginas originales de casos de uso y despliegue. No importar
   archivos ni reemplazar esas páginas por diagramas generados.
2. Recuperar el detalle de Transaction del DSL adjunto, con nombres cotejados
   contra el código. Conservar las demás vistas L3 como complementarias y
   mejorar el espaciado de las imágenes derivadas del DSL por CLI.
3. Retirar los SVG documentales y los cinco PNG ER; conservar DBML para que el
   solicitante prepare sus propias imágenes. Ajustar referencias y manuales.
4. Exportar los PNG editados desde Lucid, registrar procedencia y verificar
   enlaces, activos y alcance del diff. No presentar esta revisión como
   terminada antes de verificar las páginas y los archivos finales.

Rama **`feature/T-61`**, creada desde `origin/develop` en `40660d5`.
Revisión documental iniciada el 21/oct/2026 GT y verificación final el
22/oct/2026, con lecturas cloud y ejecuciones dev fechadas en sus evidencias. No se cambió código, pruebas, contratos ejecutables,
workflows, configuración Helm/Terraform ni infraestructura persistente.

## Plan ejecutado y puntos de revisión

1. Inventariar documentación, enunciado y criterios #168; cotejar con #167,
   contratos, migraciones, rutas, métricas, chart y Terraform.
2. Revisar dominio/datos/eventos; regenerar los cinco ER y DDL acumulado sin
   inventar relaciones entre bases; inventario de los 134 contratos.
3. Actualizar arquitectura general, C4 L1/L2 y seis L3, despliegue local/cloud,
   Saga y secuencias Fase III; conservar colores/estilo, añadir Helm/Terraform,
   tecnologías/protocolos, fuentes y renders PNG/SVG.
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
| A — Arquitectura | [Índice](../architecture/README.md), 13 vistas principales, C4 por contenedor y cinco ER | Actualizado; fuentes y renders canónicos. Los 31 CDU conservan su paleta, corrigen reglas actuales y se complementan con la vista 13. |
| B — SRE | [SLI/SLO](../sre/sli-slo-sla.md), [catálogo](../sre/telemetry-catalog.md), [16 alertas/runbooks](../operations/runbooks/README.md) | Fórmulas/configuración contrastadas; presupuesto negativo y falta de cobertura completa documentados. |
| C — ADR | [020–023](../architecture/adr/README.md) | SLO, v1, diagramación y evolución observabilidad; 013 superseded, 018 conserva historia. |
| D — Postmortems | [Índice](../sre/postmortems/README.md) | Tres experimentos cloud nuevos, Rabbit real reconstruido parcial y cuatro históricos kind. Falta caída de banco externo dev. |
| E — Evidencia cloud/carga | [Informe T-60](backend/T-60-cloud-evidence.md), nueve dashboards y raw k6 | Dos umbrales k6 fallan, uno pasa; HPA hasta 5, saldo total conservado. Tempo→Loki y compensación observados; detalle de anotación deploy y apertura log→Tempo independiente parciales. |
| F — Manuales | [Guías por rol](../manual/README.md), [recorrido Fase III](../manual/recorrido-fase3.md), [24 casos](guia-validacion-manual-fase3.md) | Navegación/capturas reales; casos mutantes pendientes se conservan como tales. |
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
| PlantUML 1.2026.9 / Graphviz 2.44.1 / Java 25 | 41 PUML válidos, incluidos los 31 CDU; PNG/SVG regenerados conservando estilo. |
| DBML / activos | Cinco modelos válidos: 34 tablas, 11 FK; 91 imágenes y 51 SVG verificados; 25 capturas originales. [Verificación](verification/T-61-verification.md). |
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

Los cambios permanecen sin commit en `feature/T-61`, sin push ni PR. El diff
se limita a documentación y activos/evidencia relacionados. El
[manifiesto final](verification/T-61-artifacts.json) enumera cada archivo
cambiado con su tamaño y SHA-256 para revisar el alcance concreto. Las diez
[alternativas del editor](../architecture/diagrams/alternativas-editor/README.md)
se conservan separadas de los renders técnicos.
