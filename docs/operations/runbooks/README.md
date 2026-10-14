# Runbooks

Uno por alerta, porque §4.1 lo pide así: *"Documentar un runbook por alerta: qué
significa, cómo diagnosticarla y cómo mitigarla"*. Cada alerta de
`infra/k8s/helm/bank-observability/values.yaml` lleva su enlace en la anotación
`runbook_url`, así que **una alerta sin runbook es un enlace roto** y se nota.

| Runbook | Alertas que lo usan | SLO |
| --- | --- | --- |
| [gateway-availability-burn.md](gateway-availability-burn.md) | `GatewayAvailabilityFastBurn`, `GatewayAvailabilitySlowBurn` | SLO-27 |
| [transfer-latency.md](transfer-latency.md) | `TransferLatencyBreach` | SLO-2 |
| [dead-letter.md](dead-letter.md) | `DeadLetterGrowing` | SLO-1 |
| [consumer-lag.md](consumer-lag.md) | `BrokerConsumerLagHigh` | SLO-14 |
| [partner-bank.md](partner-bank.md) | `PartnerBankDegraded`, `PartnerBankConfirmationSlow` | SLO-28 |

## Cómo se usa uno

Las alertas llegan **a dos sitios a la vez**: la consola de Grafana y
`/auditoria/notificaciones` del propio banco, porque el contact point apunta al
webhook `POST /api/alerts/slo` del Gateway (T-45) y de ahí la alerta entra al
broker como un evento más. El runbook se abre desde el enlace de la alerta.

Tres cosas que valen para todos:

1. **El `correlationId` y el `traceId` son el camino corto.** Casi todo lo que
   hay que mirar se encuentra con uno de los dos: en Grafana, *Explore → Loki*,
   `{service_name="<servicio>"} | correlationId="<id>"`, y cada línea tiene el
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
