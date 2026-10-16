# Referencias

El material externo que el proyecto cita como fuente. No es documentación del
sistema: es aquello contra lo que se contrasta lo que construimos.

## Los enunciados

| Documento | Qué es | Fechas |
| --- | --- | --- |
| [780_Proyecto_1_2S2026.pdf](780_Proyecto_1_2S2026.pdf) | Enunciado de la **fase 1**, revisión del 2026-08-13. La fuente de los requisitos del sistema bancario distribuido: los cinco microservicios, la Saga, las restricciones de aislamiento y la rúbrica §8. | Calificado el 2026-09-05 |
| [780_Proyecto_2_2S2026.pdf](780_Proyecto_2_2S2026.pdf) | Enunciado de la **fase 2**. Extiende los cinco servicios (KYC, tipos de cuenta, historial, pagos externos, clasificación de eventos) y añade CI/CD, Terraform, despliegue en nube, bases de datos en máquinas virtuales y autoescalado. Exige "arquitectura actualizada" y "actualización completa de documentación". | Asignado 2026-09-03 · entrega 2026-09-24 · calificación 2026-09-26 |
| [780_Proyecto_3_2S2026.pdf](780_Proyecto_3_2S2026.pdf) | Enunciado de la **fase 3**: observabilidad con OpenTelemetry, Collector, Prometheus, Tempo, Loki y Grafana; SLO con error budget y alertas; logging estructurado centralizado; pruebas de carga con postmortems; extensión funcional de los cinco servicios; e **integración interbancaria** con el banco de otro grupo. El documento se contradice en la fecha: §2.1 dice "1 al 30 de octubre" y §7 dice elaboración hasta el **23** y calificación el **24**; se planifica contra §7 (T-53, punto C6). El contrato OpenAPI base que §4.1 promete **ya está**: [interbank-contract-v1.openapi.yaml](interbank-contract-v1.openapi.yaml). | Asignado 2026-10-01 · entrega 2026-10-23 · calificación 2026-10-24 |

## El contrato interbancario

| Documento | Qué es | Obtenido |
| --- | --- | --- |
| [interbank-contract-v1.openapi.yaml](interbank-contract-v1.openapi.yaml) | El **contrato base OpenAPI 3.0.3** de la integración interbancaria que promete §4.1, entregado por el auxiliar. `Contrato Interbancario Bank USAC`, versión `1.0.0`. Siete operaciones, dos roles por banco (emisor y receptor), el protocolo de *timeout* con reserva, los reversos y la conciliación diaria. | 2026-10-16 · SHA-256 `4888b951aa48f95d8d30…` |

**No se modifica.** El enunciado es explícito: *"Los grupos no deben modificarlo;
solo acuerdan entre sí URLs, credenciales y horarios de prueba"*. El archivo está
aquí **byte por byte** como llegó, y lo que acordamos con la pareja vive aparte,
en
[`../operations/INTERBANK-AGREEMENT.md`](../operations/INTERBANK-AGREEMENT.md).
Si alguna vez hay que tocar este archivo, no se toca: se anota la divergencia en
el acuerdo y se escala al auxiliar.

El análisis campo por campo de este contrato contra lo que el repositorio
implementaba antes de recibirlo está en
[`../qa/backend/T-56-interbank-reconciliation-evidence.md`](../qa/backend/T-56-interbank-reconciliation-evidence.md).

Se citan por sección y página (`§4.2, p. 8`) desde
[`../architecture/adr/README.md`](../architecture/adr/README.md),
[`../architecture/decision-matrix.md`](../architecture/decision-matrix.md), las
specs 003 y 008, y los issues T-41 a T-53. Distinguir "lo exige el enunciado" de "lo decidimos nosotros" es
la diferencia entre poder renegociar una decisión y no poder.

## Insumos históricos

| Documento | Qué es |
| --- | --- |
| [prompt-mockup.md](../../context/prompt-mockup.md) | El prompt maestro con el que se generó el primer prototipo de interfaz: roles, navegación e inventario de pantallas por módulo. **Superado**: el prototipo que se implementó vino de Claude Design y está registrado en [`../DESIGN.md`](../DESIGN.md), con el mapa pantalla por pantalla en [`../FRONTEND.md`](../FRONTEND.md). Se conserva porque el índice de casos de uso lo cita como origen de las superficies funcionales del frontend. |

## Qué añadir aquí

Fuentes externas en formato legible por agentes: instantáneas de texto estables o
resúmenes con su enlace y la fecha en que se consultaron. No pegues material con
derechos de autor completo; resume y enlaza.

Lo que **no** va aquí: documentación del sistema (va en su carpeta temática) ni
volcados de trabajo. Este directorio guardó durante un mes tres archivos
`*-llms.txt` que eran plantillas vacías de un scaffold, para herramientas que el
proyecto nunca usó; se borraron el 2026-09-09 (TD-008).
