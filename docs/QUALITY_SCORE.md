# Evaluación de calidad — T-61, 2026-10-21

Escala: 5 verificado sin brecha material conocida; 4 sólido con pendientes
acotados; 3 utilizable con brechas relevantes; 2 riesgoso; 1 insuficiente.
La puntuación es una evaluación documental, no una aprobación de producción.

| Área | Puntuación | Evidencia y límite |
| --- | ---: | --- |
| Producto | 4 | Manuales por rol y funciones Fase III contrastados con rutas; capturas reales y guía de validación. No todos los casos mutantes se ejecutaron en prod. |
| Arquitectura | 4 | Siete aplicaciones, cuatro bibliotecas; límites AMQP/BD, C4 por contenedor, despliegue Terraform/Helm y cinco esquemas acumulados. |
| Confiabilidad | 3 | Stack operativo, nueve dashboards, 16 alertas/runbooks y pruebas cloud dev. Latencia baseline/proveedor incumple p95; presupuestos prod negativos; falta banco externo dev. |
| Seguridad | 3 | JWT/roles, redacción y secretos runtime verificados en fuentes. Gateway/Grafana públicos HTTP y ausencia de NetworkPolicies aplicadas siguen como brechas. |
| Documentación | 4 | Fuentes y renders técnicos, ADR sucesores, inventario y evidencia con procedencia. El catálogo automático de flujos sólo clasifica 48/134 contratos; no se encubre esa limitación. |

[Informe y validaciones](qa/T-61-documentation-audit.md),
[evidencia cloud](qa/backend/T-60-cloud-evidence.md),
[deuda](TECH_DEBT.md). Revisar al cerrar #167 y en cada hito; no subir un
puntaje por tener una prueba omitida o una captura sin datos.
