# Documentación de Bank USAC

Índice de navegación de `docs/`. Cada fila dice **cuándo** leer el documento, no
solo cómo se llama. La clasificación formal —clase, responsable y fecha de
revisión de cada archivo— vive en [DOC_INVENTORY.md](DOC_INVENTORY.md); este
índice es para encontrar las cosas.

Los documentos de la raíz del repositorio son la puerta de entrada:
[README.md](../README.md) (identidad y comandos), [AGENTS.md](../AGENTS.md) (guía
operativa para agentes) y [ARCHITECTURE.md](../ARCHITECTURE.md) (fronteras, stack
y reglas de dependencia).

**Esta carpeta documenta el sistema bancario.** Lo que documenta *cómo se
construye con agentes de IA* —roles, skills y prompts— vive en
[`../context/`](../context/README.md), separado a propósito para que quien evalúa
el proyecto y quien opera el harness no tengan que filtrarse mutuamente.

## Los entregables

| Documento | Qué responde |
| --- | --- |
| [TECHNICAL_DOCUMENT.md](TECHNICAL_DOCUMENT.md) | El documento técnico consolidado: dónde vive cada entregable del enunciado, con los diagramas embebidos y leídos uno por uno. **Empieza por aquí.** |
| [dda.md](dda.md) | Caso de negocio, stakeholders, requisitos funcionales y no funcionales, escenarios de calidad y las matrices de trazabilidad. |
| [architecture.md](architecture.md) | La arquitectura en español: principios rectores, matriz de puertos y variables, estrategia de resiliencia. |
| [adr.md](adr.md) | La narrativa unificada de las decisiones. Los registros canónicos son [architecture/adr/](architecture/adr/README.md); si discrepan, manda el ADR. |

## Arquitectura y decisiones

| Documento | Qué responde |
| --- | --- |
| [architecture/README.md](architecture/README.md) | Índice de los diagramas y de los ADR: qué diagrama es cuál y en qué formato se entrega. |
| [architecture/adr/](architecture/adr/README.md) | Los veinticuatro registros de decisión, cada uno con las alternativas descartadas. Los tres de la Fase II son [ADR-014](architecture/adr/ADR-014-cloud-provider.md) (proveedor cloud), [ADR-015](architecture/adr/ADR-015-ci-cd-platform.md) (CI/CD) y [ADR-016](architecture/adr/ADR-016-cloud-infrastructure.md) (infraestructura); los de la Fase III son [ADR-017](architecture/adr/ADR-017-account-anomaly-reports-not-blocks.md) (una anomalía se reporta, no se bloquea), [ADR-018](architecture/adr/ADR-018-observability-stack.md) (el stack inicial de observabilidad, evolucionado por ADR-023) y [ADR-019](architecture/adr/ADR-019-payment-http-egress.md) (**ningún servicio llama a otro por HTTP**, y las dos salidas que existen van a terceros). ADR-020 fija los SLO y presupuestos, ADR-021 el protocolo interbancario v1, ADR-022 la primera política gráfica T-61 y ADR-023 la evolución de observabilidad. [ADR-024](architecture/adr/ADR-024-native-lucid-and-png-delivery.md) sustituye la política gráfica: UML de casos de uso/despliegue nativo en Lucid, diagramas sólo PNG y ER como DBML para exportación del solicitante. Léelos antes de introducir o cambiar una tecnología. |
| [architecture/decision-matrix.md](architecture/decision-matrix.md) | Los veintitrés ADR en una sola tabla: decisión, alternativa descartada, trade-off aceptado, y las penalizaciones del enunciado que cada uno evita. |
| [architecture/diagrams/](architecture/diagrams/) | Fuentes semánticas versionadas (`.puml`, `.dsl`, `.dbml`) y diagramas sólo `.png`; casos de uso/despliegue en edición nativa Lucid, C4 por DSL/CLI y secuencias por PUML. Las [alternativas históricas del editor](architecture/diagrams/alternativas-editor/README.md) permiten comparar estilo. |
| [architecture/c4-context.md](architecture/c4-context.md) · [c4-container.md](architecture/c4-container.md) · [c4-component.md](architecture/c4-component.md) | La lectura de cada nivel C4: qué muestra el diagrama y qué significa cada elemento. |
| [architecture/deployment.md](architecture/deployment.md) | La forma del despliegue: nodos, contenedores, puertos y protocolos. Para *ejecutarlo*, [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md). |
| [architecture/sequence-create-account.md](architecture/sequence-create-account.md) · [sequence-transfer.md](architecture/sequence-transfer.md) | Apertura de cuenta y transferencia con Saga; el índice incluye envío/recepción interbancaria y reintentos de pago. |
| [architecture/use-cases-uml.md](architecture/use-cases-uml.md) | La jerarquía UML de casos de uso, con enlace a cada fuente. Los diagramas están en [diagrams/cdu/](architecture/diagrams/cdu/README.md). |

## Dominio y mensajería

| Documento | Qué responde |
| --- | --- |
| [domain/](domain/README.md) | El modelo de dominio como contrato funcional: quién posee qué dato, qué invariante protege, qué comandos acepta. Léelo antes de implementar cualquier servicio. |
| [events/](events/README.md) | Cómo el sistema se habla a sí mismo: el sobre, el catálogo de los 134 contratos, la topología del broker y la Saga de transferencia. |
| [generated/db-schema.md](generated/db-schema.md) | El catálogo de las cinco bases de datos: tabla, columna, tipo, restricción e índice. |
| [architecture/diagrams/er/](architecture/diagrams/er/README.md) | Los cinco modelos entidad-relación físicos en DBML, validados contra migraciones acumuladas; exportación PNG pendiente del solicitante. |

## Operación y fiabilidad

| Documento | Qué responde |
| --- | --- |
| [operations/](operations/README.md) | Los runbooks: despliegue, contenedores, CI y el canal de correo real. |
| [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md) | De una máquina limpia a un clúster **local** corriendo, en cuatro comandos, y qué hacer cuando algo falla. |
| [operations/CLOUD.md](operations/CLOUD.md) | **Despliegue cloud Fase III y estado observado**: GKE, Cloud Run, Terraform, Helm, identidad del pipeline y las tareas condicionales de bootstrap/importación; separa fuente deseada de recursos aplicados. |
| [operations/MONOREPO.md](operations/MONOREPO.md) | La estrategia de monorepo: un directorio por componente, y cómo un cambio redespliega sólo ese componente. |
| [operations/CONTAINERS.md](operations/CONTAINERS.md) | El inventario de las siete imágenes: Dockerfile, puerto, health checks y variables requeridas. |
| [operations/CI.md](operations/CI.md) | Los cuatro workflows de GitHub Actions: qué los dispara, qué verifica cada etapa, cómo se publica una versión y qué no demuestra un run verde. |
| [operations/EMAIL_RESEND.md](operations/EMAIL_RESEND.md) | Resend para activación, restablecimiento, rechazo de identidad y cambio de contraseña; elegibilidad, redacción y diagnóstico de fallos. |
| [operations/INTERBANK.md](operations/INTERBANK.md) | Contrato v1 vigente, envío/recepción, callbacks, reserva, TIMEOUT, cancelación, reverso y reconciliación; distingue mock de banco participante real. |
| [operations/INTERBANK-AGREEMENT.md](operations/INTERBANK-AGREEMENT.md) | **Dónde vive el acuerdo con el banco pareja, que no es aquí**: es [`bank-interbank-contract`](https://github.com/marcosbondel/bank-interbank-contract), el repositorio público que consultan los dos grupos y donde cada cambio necesita la aprobación de ambos. Esta página es el puntero y las tres cosas que sí conviene repetir del lado del despliegue. |
| [RELIABILITY.md](RELIABILITY.md) | Las preocupaciones de confiabilidad que el enunciado exige resolver: idempotencia, reintentos, consistencia eventual, trazabilidad. |
| [sre/sli-slo-sla.md](sre/sli-slo-sla.md) | Qué se mide ([SLI](sre/sli-slo-sla.md#4-indicadores-de-nivel-de-servicio-sli)), qué meta se persigue ([SLO](sre/sli-slo-sla.md#5-objetivos-de-nivel-de-servicio-slo)) y qué se promete ([SLA](sre/sli-slo-sla.md#7-acuerdo-de-nivel-de-servicio-sla)). Encadenados: ninguna promesa sin un número que la verifique. |
| [sre/telemetry-catalog.md](sre/telemetry-catalog.md) | El catálogo de telemetría: cada métrica con su tipo, unidad, etiquetas permitidas y justificación de cardinalidad, más los nombres de span y los campos de log. La fuente única de la que salen los dashboards y las alertas, y lo que el enunciado pide definir **antes** de implementar. |
| [sre/postmortems/](sre/postmortems/README.md) | Un postmortem por incidente: cronología, qué SLO se rompió y con qué número, la evidencia, la causa raíz y las acciones. Los *runbooks* dicen qué hacer; estos dicen qué pasó. Se conserva la evidencia histórica kind de T-51 y se añaden los experimentos cloud dev y la reconstrucción parcial del incidente RabbitMQ. |
| [operations/runbooks/](operations/runbooks/README.md) | Un runbook por alerta: qué significa, cómo diagnosticarla y cómo mitigarla, con las consultas de este sistema. La anotación `runbook_url` de cada alerta apunta aquí, así que un runbook que falta es un enlace roto. |

## Producto, diseño y calidad

| Documento | Qué responde |
| --- | --- |
| [DESIGN.md](DESIGN.md) | **Obligatorio antes de tocar cualquier interfaz**: tokens, componentes, estados y textos. |
| [FRONTEND.md](FRONTEND.md) | El stack del frontend verificado y sus convenciones, con el inventario de las 34 pantallas. |
| [PRODUCT_SENSE.md](PRODUCT_SENSE.md) | Quiénes son los usuarios y cuáles son los flujos bancarios centrales. |
| [SECURITY.md](SECURITY.md) | Clases de datos y fronteras de seguridad antes de manejar datos sensibles. |
| [QUALITY_SCORE.md](QUALITY_SCORE.md) | La evaluación de calidad vigente por área. |
| [TECH_DEBT.md](TECH_DEBT.md) | La deuda abierta y la cerrada, con su origen y su remedio. |

## Manuales y evidencia

| Documento | Qué responde |
| --- | --- |
| [manual/](manual/README.md) | El manual de usuario: la guía general, una por rol y el recorrido visual histórico de 78 pasos y el [recorrido Fase III con capturas reales](manual/recorrido-fase3.md). |
| [qa/](qa/README.md) | La evidencia de pruebas: guía de happy path y casos de error, informe de validación y las capturas que producen las suites. |
| [qa/backend/](qa/backend/) | Un documento de evidencia por ticket, con **salida real de comandos** y no descripciones. Los de la integración interbancaria son [T-46](qa/backend/T-46-interbank-receipt-evidence.md) (la recepción) y [T-47](qa/backend/T-47-interbank-send-evidence.md) (el envío); el del stack de observabilidad es [T-49](qa/backend/T-49-observability-stack-evidence.md); el de la reconciliación del mensaje con el enunciado es [T-56](qa/backend/T-56-interbank-reconciliation-evidence.md); el de la carga y los escenarios de fallo es [T-51](qa/backend/T-51-load-and-failures-evidence.md). |
| [process/implementations.md](process/implementations.md) | Guía de pruebas de Fase 2 para quien no implementó los tickets: qué pedía cada uno, cómo se cubrió, y los pasos concretos en la web — con lo que no tiene superficie visible dicho de frente. |
| [images/kubernetes/](images/kubernetes/README.md) | Las capturas del despliegue en el clúster, con la lectura de qué prueba cada una. |
| [qa/T-61-documentation-audit.md](qa/T-61-documentation-audit.md) | Plan, matriz de revisión documental #168 y cambios verificables. |
| [qa/backend/T-60-cloud-evidence.md](qa/backend/T-60-cloud-evidence.md) | Carga/fallos en dev, aislamiento verificado, saldos, métricas y nueve dashboards reales. |
| [qa/verification/T-61-verification.md](qa/verification/T-61-verification.md) | Comprobaciones documentales y resultados de tests, incluidos fallos y límites locales. |
| [images/fase3/](images/fase3/README.md) | Capturas originales de navegador por rol y Grafana, con origen, dimensiones y SHA-256. |

## Gobierno del repositorio

| Documento | Qué responde |
| --- | --- |
| [DOC_INVENTORY.md](DOC_INVENTORY.md) | La clase, el responsable y la fecha de revisión de cada Markdown del repositorio. |
| [OWNERSHIP.md](OWNERSHIP.md) | Quién es el responsable primario de cada componente. |
| [METHODOLOGY.md](METHODOLOGY.md) | Hitos, transiciones de estado, evidencia y bloqueos. |
| [../context/](../context/README.md) | Cómo trabajan los agentes de IA en este repositorio: los roles, las skills y los prompts. Está fuera de `docs/` a propósito — aquí se documenta **el sistema**, allá **cómo se construye**. |
| [references/](references/README.md) | Los enunciados del proyecto y el prompt que originó el prototipo. |
