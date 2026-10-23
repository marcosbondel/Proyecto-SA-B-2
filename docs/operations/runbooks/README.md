# Runbooks

Siete procedimientos cubren **16 alertas**, cada una con diagnóstico y mitigación identificables. §4.1 pide: *"Documentar un runbook por alerta: qué
significa, cómo diagnosticarla y cómo mitigarla"*. Cada alerta de
`infra/k8s/helm/bank-observability/values.yaml` lleva su enlace en la anotación
`runbook_url`, así que **una alerta sin runbook es un enlace roto** y se nota.

| Runbook | Alertas que lo usan | SLO |
| --- | --- | --- |
| [gateway-availability-burn.md](gateway-availability-burn.md) | `GatewayAvailabilityFastBurn`, `GatewayAvailabilitySlowBurn` | SLO-27 |
| [transfer-latency.md](transfer-latency.md) | `TransferLatencyBreach`, `TransferLatencyFastBurn`, `TransferLatencySlowBurn` | SLO-2 |
| [gateway-latency.md](gateway-latency.md) | `GatewayReadLatencyBreach`, `GatewayCommandLatencyBreach` | SLO-6, SLO-7 |
| [dead-letter.md](dead-letter.md) | `DeadLetterGrowing` | SLO-1 |
| [consumer-lag.md](consumer-lag.md) | `BrokerConsumerLagHigh` | — (la alerta de la dependencia del broker que exige §4.1) |
| [partner-bank.md](partner-bank.md) | `PartnerBankDegraded`, `PartnerBankConfirmationSlow`, `PartnerBankSendDegraded`, `PartnerBankSendConfirmationSlow`, `InterbankReserveReleasedUnverified` | SLO-28 |
| [restarts.md](restarts.md) | `PodRestarting`, `MassRestartDependencyLost` | SLO-26 |

## Cómo se usa uno

Las alertas llegan **a dos sitios a la vez**: la consola de Grafana y
`/auditoria/notificaciones` del propio banco, porque el contact point apunta al
webhook `POST /api/alerts/slo` del Gateway (T-45) y de ahí la alerta entra al
broker como un evento más. El runbook se abre desde el enlace de la alerta.

## Antes de diagnosticar

Registrar **entorno, versión, hora y ventana**. Seleccionar el contexto GKE
correcto y el namespace (`dev` o `prod`); en kind es `bank-usac`. Los comandos
que usan `NS` asumen una shell Bash y `NS=dev` o `NS=prod` seleccionado de forma
consciente. Una prueba inyectada se limita a desarrollo y al mock propio.

La inspección del 2026-10-21 encontró mock **en producción** y ninguno en `dev`;
no asumir que `BANK99` sea el banco real ni inyectar fallos donde está el mock
sin verificar primero el entorno. Las cinco bases `_dev` separan datos, pero
las VMs y el stack de observabilidad se comparten.

Tres cosas que valen para todos:

1. **El `correlationId` y el `traceId` son el camino corto.** Casi todo lo que
   hay que mirar se encuentra con uno de los dos: en Grafana, *Explore → Loki*,
   `{service_name="<servicio>", deployment_environment="dev"} | correlationId="<id>"`, y cada línea tiene el
   botón que salta a su traza.
2. **Primero el dinero, después la causa.** Ninguna de estas alertas justifica
   tocar un saldo a mano. Si una transferencia quedó a medias, la compensación
   de la Saga es la que la cierra; lo que hay que comprobar es que corrió.
3. **Lo que se aprendió va al postmortem** (T-51), no a este archivo. Los
   runbooks dicen qué hacer; los postmortems, qué pasó.

## Nombres de serie

Todas las consultas de estos runbooks usan los nombres de
[`../../sre/telemetry-catalog.md`](../../sre/telemetry-catalog.md). Dos detalles
que se midieron y que conviene recordar al escribir una consulta nueva: el
bucket de 5 segundos es `le="5.0"` y no `le="5"`, y el nombre del servicio se
filtra por `service_name`, nunca por `job`.

## Límites de las señales y criterio de cierre

- Las proporciones sin tráfico no devuelven serie. `noDataState: OK` evita
  alertar por inactividad; no demuestra que el banco esté sano. Comprobar targets,
  throughput y recepción OTLP. Un error de consulta usa `execErrState: Error`.
- `for` es persistencia de la condición; no es la ventana de datos. Los burn
  rates del Gateway usan 1 h/6 h; los de Saga usan dos ventanas cada uno.
- Las NetworkPolicies existen como plantillas y tienen default desactivado;
  no se observaron políticas en los namespaces del clúster el 2026-10-21.
  `ClusterIP` no implica aislamiento entre pods.
- Cerrar el incidente requiere recuperación de la métrica, estado `resolved`,
  recepción de la resolución en Audit y conciliación de operaciones afectadas.
  Conservar consultas, logs, trazas y saldos; una alerta silenciada no está resuelta.
- Los [postmortems históricos](../../sre/postmortems/README.md) corresponden a
  kind. Sus resultados no constituyen una repetición actual sobre GKE.
