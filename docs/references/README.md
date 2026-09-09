# Referencias

El material externo que el proyecto cita como fuente. No es documentación del
sistema: es aquello contra lo que se contrasta lo que construimos.

## Los enunciados

| Documento | Qué es | Fechas |
| --- | --- | --- |
| [780_Proyecto_1_2S2026.pdf](780_Proyecto_1_2S2026.pdf) | Enunciado de la **fase 1**, revisión del 2026-08-13. La fuente de los requisitos del sistema bancario distribuido: los cinco microservicios, la Saga, las restricciones de aislamiento y la rúbrica §8. | Calificado el 2026-09-05 |
| [780_Proyecto_2_2S2026.pdf](780_Proyecto_2_2S2026.pdf) | Enunciado de la **fase 2**. Extiende los cinco servicios (KYC, tipos de cuenta, historial, pagos externos, clasificación de eventos) y añade CI/CD, Terraform, despliegue en nube, bases de datos en máquinas virtuales y autoescalado. Exige "arquitectura actualizada" y "actualización completa de documentación". | Asignado 2026-09-03 · entrega 2026-09-24 · calificación 2026-09-26 |

Se citan por sección y página (`§4.2, p. 8`) desde
[`../architecture/adr/README.md`](../architecture/adr/README.md),
[`../architecture/decision-matrix.md`](../architecture/decision-matrix.md) y las
specs 003 y 008. Distinguir "lo exige el enunciado" de "lo decidimos nosotros" es
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
