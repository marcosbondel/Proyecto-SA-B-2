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
| [architecture/adr/](architecture/adr/README.md) | Los trece registros de decisión, cada uno con las alternativas descartadas. Léelos antes de introducir o cambiar una tecnología. |
| [architecture/decision-matrix.md](architecture/decision-matrix.md) | Los trece ADR en una sola tabla: decisión, alternativa descartada, trade-off aceptado. |
| [architecture/diagrams/](architecture/diagrams/) | Las fuentes versionadas (`.puml`, `.dsl`, `.dbml`) y sus renders `.png`. |
| [architecture/c4-context.md](architecture/c4-context.md) · [c4-container.md](architecture/c4-container.md) · [c4-component.md](architecture/c4-component.md) | La lectura de cada nivel C4: qué muestra el diagrama y qué significa cada elemento. |
| [architecture/deployment.md](architecture/deployment.md) | La forma del despliegue: nodos, contenedores, puertos y protocolos. Para *ejecutarlo*, [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md). |
| [architecture/sequence-create-account.md](architecture/sequence-create-account.md) · [sequence-transfer.md](architecture/sequence-transfer.md) | Los dos diagramas de secuencia: apertura de cuenta y transferencia con Saga. |
| [architecture/use-cases-uml.md](architecture/use-cases-uml.md) | La jerarquía UML de casos de uso, con enlace a cada fuente. Los diagramas están en [diagrams/cdu/](architecture/diagrams/cdu/README.md). |

## Dominio y mensajería

| Documento | Qué responde |
| --- | --- |
| [domain/](domain/README.md) | El modelo de dominio como contrato funcional: quién posee qué dato, qué invariante protege, qué comandos acepta. Léelo antes de implementar cualquier servicio. |
| [events/](events/README.md) | Cómo el sistema se habla a sí mismo: el sobre, el catálogo de los 97 contratos, la topología del broker y la Saga de transferencia. |
| [generated/db-schema.md](generated/db-schema.md) | El catálogo de las cinco bases de datos: tabla, columna, tipo, restricción e índice. |
| [architecture/diagrams/er/](architecture/diagrams/er/README.md) | Los diagramas entidad-relación por microservicio, en DBML y PNG. |

## Operación y fiabilidad

| Documento | Qué responde |
| --- | --- |
| [operations/](operations/README.md) | Los runbooks: despliegue, contenedores y el canal de correo real. |
| [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md) | De una máquina limpia a un clúster corriendo, en cuatro comandos, y qué hacer cuando algo falla. |
| [operations/CONTAINERS.md](operations/CONTAINERS.md) | El inventario de las siete imágenes: Dockerfile, puerto, health checks y variables requeridas. |
| [operations/EMAIL_RESEND.md](operations/EMAIL_RESEND.md) | Cómo enviar correo de activación real en lugar del canal simulado. |
| [RELIABILITY.md](RELIABILITY.md) | Las preocupaciones de confiabilidad que el enunciado exige resolver: idempotencia, reintentos, consistencia eventual, trazabilidad. |
| [sre/sli.md](sre/sli.md) · [slo.md](sre/slo.md) · [sla.md](sre/sla.md) | Qué se mide, qué meta se persigue y qué se promete. Encadenados: ninguna promesa sin un número que la verifique. |

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
| [manual/](manual/README.md) | El manual de usuario: la guía general, una por rol y el recorrido visual de 78 pasos. |
| [qa/](qa/README.md) | La evidencia de pruebas: guía de happy path y casos de error, informe de validación y las capturas que producen las suites. |
| [images/kubernetes/](images/kubernetes/README.md) | Las capturas del despliegue en el clúster, con la lectura de qué prueba cada una. |

## Gobierno del repositorio

| Documento | Qué responde |
| --- | --- |
| [DOC_INVENTORY.md](DOC_INVENTORY.md) | La clase, el responsable y la fecha de revisión de cada Markdown del repositorio. |
| [OWNERSHIP.md](OWNERSHIP.md) | Quién es el responsable primario de cada componente. |
| [METHODOLOGY.md](METHODOLOGY.md) | Hitos, transiciones de estado, evidencia y bloqueos. |
| [../context/](../context/README.md) | Cómo trabajan los agentes de IA en este repositorio: los roles, las skills y los prompts. Está fuera de `docs/` a propósito — aquí se documenta **el sistema**, allá **cómo se construye**. |
| [references/](references/README.md) | Los enunciados del proyecto y el prompt que originó el prototipo. |
