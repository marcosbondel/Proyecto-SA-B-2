# ADR-020: medir SLO con poblaciones explícitas y presupuestos móviles de siete días

- **Status**: Accepted — registro documental de la configuración existente; no cambia umbrales.
- **Date**: 2026-10-21
- **Deciders**: Bank USAC team; ejecución documental T-61 (#168).
- **Related**: [ADR-018](ADR-018-observability-stack.md), [ADR-023](ADR-023-observability-evolution.md).

## Contexto

La línea base T-03 define invariantes y objetivos de servicio; Fase III añade
series y alertas. Las fórmulas de `values.yaml` ya habían evolucionado, pero el
documento seguía promediando ratios de cinco minutos y describiendo nueve
alertas en lugar de dieciséis. Una ventana mensual tampoco es verificable con
siete días de retención. Este ADR registra el funcionamiento vigente y sus
límites; no atribuye una motivación histórica no documentada a los autores.

Fuentes: [reglas y alertas](../../../infra/k8s/helm/bank-observability/values.yaml),
[catálogo](../../sre/telemetry-catalog.md) y
[marco SRE](../../sre/sli-slo-sla.md#53-los-slo-que-la-fase-3-mide-con-datos-reales-t-58).

## Decisión documentada

1. Separar cinco grupos medidos: disponibilidad HTTP 99 %, duración de Saga
   95 % hasta 5 s, entregas sin DLQ 99 %, GET/POST rápidos 95 % e interbancario
   95 % y p95 < 5 s **por dirección**. Mantener los IDs anteriores.
2. Calcular la población de una ventana desde `increase(buenos[W]) /
   increase(total[W])`, por entorno. Para siete días, el presupuesto restante
   es `1 - (1 - P_7d) / (1 - objetivo)`; el burn usa la misma fracción de eventos
   malos en su ventana corta. No promediar proporciones con tráfico desigual.
3. Numerador ausente con tráfico significa cero eventos buenos/malos según la
   fórmula, completado con `or 0 * total`. Denominador cero significa **sin
   datos**, no cumplimiento. Los contadores sembrados a cero hacen observable
   el primer incremento sin crear eventos ficticios.
4. Conservar exactamente las alertas existentes: Gateway burn 1 h > 14.4×
   durante 5 min y 6 h > 6× durante 30 min; Saga combina 1 h/5 min > 14.4× con
   `for: 2m` y 6 h/30 min > 6× con `for: 15m`. Las demás reglas se mapean en
   [los runbooks](../../operations/runbooks/README.md). El nivel de persistencia
   evita avisar por una evaluación aislada; no prueba que esos umbrales sean
   óptimos para el volumen del banco.
5. Usar Grafana Alerting y el webhook autenticado del Gateway hacia Audit como
   canal visible. Verificar `firing` y `resolved` en ambas superficies. La
   severidad operativa es `critical`, `warning` o `info`.
6. Mantener invariantes financieros y de seguridad con presupuesto cero y
   evidencia de pruebas/conciliación. El SLA es académico; no derivar garantías
   comerciales o durabilidad de un manifiesto.

## Consecuencias y límites

- La retención permite una ventana de siete días sólo cuando existe historia
  suficiente. Kind usa retenciones menores; no sirve para declarar una semana
  completa. El budget negativo se conserva para mostrar el exceso.
- En 168 h, 14.4× agota presupuesto íntegro en **11 h 40 min** y consume
  **8.57 % en una hora**; 6×, en **28 h**, consume **21.43 % en seis horas**.
  Son cálculos bajo tráfico uniforme, no mediciones de un incidente.
- `noDataState: OK` evita alertar por inactividad, pero puede ocultar un corte
  total de instrumentación. Los targets y el throughput se revisan aparte.
- SLO-2 usa todos los resultados terminales, mientras su definición original
  habla de exitosas; no cuenta pendientes. SLO-7 usa el bucket 2.5 s por faltar
  3 s. SLO-1 no resta `invalid`/`dropped`. Esos límites se documentan sin
  cambiar el código ni declarar resuelta la discrepancia.
- **TD-094 sigue abierta**: segundo reintento de pago acumula 6 s de espera,
  incompatible con 5 s aun cuando recupera correctamente. Cambiar umbral,
  escalera o población requiere decisión de producto y evidencia posterior.
- El ratio de reinicios masivos divide pods reiniciados entre Deployments:
  puede amplificarse con HPA y requiere confirmar componentes afectados.
- La política de revisión por consumo de budget es humana; el pipeline no
  bloquea despliegues automáticamente por el valor de una serie.

## Alternativas contrastadas en esta revisión

| Alternativa | Resultado de contrastarla con el sistema actual |
| --- | --- |
| Promediar ratios rápidos | Pesa igual ventanas con tráfico desigual y puede propagar `NaN`; la implementación vigente ya usa incrementos. |
| Ventana mensual con retención de siete días | No se conserva la historia requerida; no se afirma cumplimiento mensual. |
| Convertir ausencia de tráfico en 100 % | Confunde inactividad o pérdida de telemetría con servicio sano. |
| Elevar SLO-2 para que pase el escenario | Sería una nueva decisión de producto y alteraría la línea base; T-61 no la toma. |
| Contar sólo HTTP 2xx como disponibilidad | Penalizaría rechazos de negocio correctos y no coincide con SLI-1. |

Estas alternativas explican la comparación documental actual, no una votación
histórica del equipo. La validación operativa requiere consultas y evidencia
fechadas del entorno desplegado.
