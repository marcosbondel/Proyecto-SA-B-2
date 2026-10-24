# Confiabilidad y SRE — Bank USAC

La definición canónica de indicadores, objetivos y fórmulas está en
[`sre/sli-slo-sla.md`](sre/sli-slo-sla.md). Este mapa resume las preocupaciones
de diseño y cómo se verifican. Revisión: **2026-10-21**, Fase III, T-61.

## Preocupaciones de diseño obligatorias

- **Idempotencia:** constraints y deduplicación antes de mover dinero; un
  reintento conserva la identidad de la operación.
- **Reintentos:** escalera persistida y acotada, sin temporizadores que se
  olviden al reemplazar el pod. El proveedor de pagos tiene cuatro intentos con
  esperas de 1 s, 5 s y 30 s entre ellos.
- **Errores:** separar rechazo de negocio, indisponibilidad técnica y resultado
  aún desconocido; una aceptación HTTP no prueba liquidación financiera.
- **Consistencia eventual:** una Saga coordinada por Transaction a partir de eventos RabbitMQ, compensaciones
  explícitas y outbox transaccional. La devolución entre servicios es eventual,
  no un commit atómico entre bases independientes.
- **Trazabilidad:** `correlationId` del negocio y W3C `traceparent` por HTTP y
  AMQP; logs y spans contienen identificadores, las métricas usan conjuntos
  acotados. El [catálogo](sre/telemetry-catalog.md) fija sus nombres y unidades.

Las pruebas de código, los manifiestos y la evidencia de ejecución responden
preguntas diferentes. Un despliegue Ready no demuestra ausencia de dinero
inconsistente; una prueba unitaria no comprueba un row lock real.

## SLI, SLO y SLA

Se conservan los identificadores de la línea base T-03. En Fase III se miden
cinco grupos: disponibilidad HTTP (**SLO-27, 99 %**), duración terminal de Saga
(**SLO-2, 95 % hasta 5 s**), entregas sin DLQ (**SLO-1, 99 %**), latencia
GET/POST (**SLO-6/7, 95 %**) e interbancario por dirección (**SLO-28, 95 % y
p95 < 5 s**). Ventana operativa cloud: **siete días móviles**.

[§5.3](sre/sli-slo-sla.md#53-los-slo-que-la-fase-3-mide-con-datos-reales-t-58)
detalla las poblaciones y diferencias del proxy desplegado: SLO-2 incluye todos
los cierres, POST usa un bucket conservador de 2.5 s y el timeout interbancario
se cuenta antes de la resolución final. **TD-094 sigue abierta**: alcanzar el
segundo reintento del proveedor suma 6 s de espera, incompatible con 5 s, aunque
la recuperación financiera sea correcta.

El presupuesto se calcula desde incrementos de contadores sobre toda la
ventana; no se promedian ratios. Ausencia de tráfico significa **sin datos**,
no disponibilidad perfecta. Los objetivos de 100 % (dinero, idempotencia,
redacción y permisos) se verifican por invariantes y pruebas, sin presupuesto
que permita violarlos. [ADR-020](architecture/adr/ADR-020-slo-error-budgets.md)
registra esta política y los límites de cobertura.

El SLA es **académico**: demostración del sistema y evidencia de consistencia.
No existe un contrato comercial de 99.99 %, garantía de RPO cero o créditos
monetarios respaldados por este repositorio.

## Observabilidad y bitácora distribuida

`Notification & Audit` tiene **seis colas**: `audit.customer`, `audit.account`,
`audit.transaction`, `audit.payment`, `audit.alert` y `audit.query`. Deduplica por
`(event_id, consumer)` y redacta payload antes del insert. Los mensajes inválidos
se registran `INVALID`; los logs de aplicación van por stdout al agente, no por
el broker a auditoría.

El chart **`bank-observability`** instala Collector OTLP, agente de logs,
Prometheus, Tempo, Loki, Grafana y kube-state-metrics. Comparte `dev` y `prod`,
con entorno explícito y nueve dashboards versionados. Grafana evalúa
**16 alertas**, mapeadas a [siete runbooks](operations/runbooks/README.md), y
las entrega al webhook del Gateway para auditoría. Hay que comprobar tanto
`firing/resolved` en Grafana como el evento recibido por Audit.

Cloud configura retención **7 d** y PVC para los almacenes; kind reduce
Prometheus a 2 h y Tempo a 24 h. Grafana es público por LoadBalancer HTTP.
Dataplane V2 está declarado en Terraform y activo en GKE, pero las NetworkPolicies están
apagadas por defecto y no se encontraron políticas en los namespaces del
clúster durante la inspección del 2026-10-21. Ver
[inventario de observabilidad](qa/load/2026-10-21-gke-observability-inventory.txt),
[ADR-023](architecture/adr/ADR-023-observability-evolution.md) y
[seguridad](SECURITY.md).

## Continuidad y recuperación

RabbitMQ in-cluster usa PVC, identidad estable `rabbit@localhost` y permisos
de dueño en `.erlang.cookie`. Sigue siendo una réplica; borrar un claim puede
perder mensajes y no existe recuperación automática de todos los mensajes
perdidos antes de habilitarlo. El runbook de
[consumer lag](operations/runbooks/consumer-lag.md) trata ese fallo y la
rotación de credenciales persistidas. MinIO sigue siendo un Deployment sin PVC
en su manifiesto actual.

Account puede escalar a 1–5 réplicas: el barrido de inactividad se coordina con
`pg_try_advisory_lock`. Las cinco bases `_dev` son distintas de las de
producción, pero comparten VMs y recursos. Una prueba de carga en desarrollo
puede presionar infraestructura compartida.

El contrato interbancario fija TTL **180 s**. Al vencer, se consulta/cancela
antes de liberar; sin respuesta, el margen para liberación no verificada es
**300 s adicionales**. Una alerta `InterbankReserveReleasedUnverified` requiere
conciliación, porque devolver al cliente no prueba que el banco pareja no
acreditó. El [runbook](operations/runbooks/partner-bank.md#interbankreservereleasedunverified)
explica el cierre con evidencia.

## Verificación y evidencia

| Comprobación | Qué demuestra y límite |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Reglas de dependencias, tipos y compilación; no disponibilidad cloud |
| `pnpm test:contract` | Esquemas de eventos; no entrega real del broker |
| `turbo run test --filter=<servicio>` con infraestructura de pruebas | Constraints, concurrencia e idempotencia reales; usar una base aparte, las suites hacen `TRUNCATE` |
| `pnpm --filter @bank/observability test` | Redacción, contexto y claves métricas; una suite de integración puede requerir su entorno |
| `pnpm images:smoke`, `pnpm images:flow` | Contenedores y flujo Saga con asertos sobre dinero |
| Capturas de Grafana y resultados de carga | Cumplimiento sólo de la versión, entorno y ventana identificados |

Los [postmortems](sre/postmortems/README.md) conservan las corridas históricas de
kind y sus límites. No se trasladan números de T-51 a producción. Todo resultado
nuevo debe incluir entorno, versión, consulta, ventana, volumen, saldos y estado
de recuperación; una evidencia faltante se registra como pendiente.
