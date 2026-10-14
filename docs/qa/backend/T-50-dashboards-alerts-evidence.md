# T-50 — Reglas, alertas y dashboards como código: evidencia

Fecha: **2026-10-14**. Rama `feature/T-50`, sobre `feature/T-58`.

Todo lo que sigue se verificó contra un stack real en kind (`pnpm obs:kind`),
sin encender la nube.

## 1. Lo que entra

| Artefacto | Dónde | Cuántos |
| --- | --- | --- |
| Reglas de grabación | `values.yaml` → `prometheus.serverFiles.recording_rules.yml` | **30** |
| Alertas de Grafana | `values.yaml` → `grafana.alerting.rules.yaml` | **7**, dos por burn rate |
| Contact points y política | `values.yaml` → `grafana.alerting` | 2 webhooks + 1 política con ruta por entorno |
| Dashboards | `dashboards/*.json` | **9**, 68 paneles |
| Runbooks | `docs/operations/runbooks/` | **5**, uno por alerta |
| Anotaciones de despliegue | consulta en los 9 dashboards + paso en `cd.yml` | 2 fuentes que no se pisan |

## 2. Verificación en kind

```
$ docker run --rm --entrypoint promtool prom/prometheus:v3.1.0 check rules /rules.yml
  SUCCESS: 30 rules found

$ curl -s http://prometheus-server/api/v1/rules | grep -c '"name":"slo:\|"name":"sli:'
  30

$ curl -s -u admin:*** http://grafana/api/v1/provisioning/alert-rules
  BrokerConsumerLagHigh · DeadLetterGrowing · GatewayAvailabilityFastBurn
  GatewayAvailabilitySlowBurn · PartnerBankConfirmationSlow · PartnerBankDegraded
  TransferLatencyBreach

$ curl -s -u admin:*** http://grafana/api/v1/provisioning/contact-points
  bank-audit-prod (webhook) · bank-audit-dev (webhook)

$ curl -s -u admin:*** http://grafana/api/v1/provisioning/policies
  {"receiver":"bank-audit-prod","group_by":["alertname","environment"],
   "routes":[{"receiver":"bank-audit-dev","object_matchers":[["environment","=","dev"]]}],
   "repeat_interval":"4h","provenance":"file"}

$ curl -s -u admin:*** 'http://grafana/api/search?type=dash-db'
  los nueve, en la carpeta «Bank USAC»

$ ./infra/scripts/cloud/obs-kind.sh --verify
  RESULTADO: 10 de 10. El stack mide lo que dice medir.
```

Y la entrega de la alerta, probada con el endpoint de test de Grafana:

```
$ curl -X POST .../api/alertmanager/grafana/config/api/v1/receivers/test
  {"alert":{"annotations":{"summary":"Notification test"},
            "labels":{"alertname":"TestAlert", …}},
   "receivers":[{"name":"bank-audit-prod", "status":"failed",
                 "error":"dial tcp: lookup bank-usac-gateway.prod.svc.cluster.local …"}]}
```

Ese fallo es el resultado correcto en este clúster y prueba las tres cosas que
se pueden probar sin la nube: Grafana **construye el payload** con
`labels.alertname` y `annotations.summary` —los campos que lee el contrato
`alert.slo.received.v1` de T-45—, **intenta entregarlo** a la URL configurada, y
lo único que falta es el Gateway, que en este clúster no existe. El último salto
se verifica contra el entorno de T-54.

Ningún dashboard, alerta ni datasource se creó a mano: todo sale de
`helm upgrade`. Un cambio hecho en la interfaz se pierde en el siguiente
despliegue, que es la mitad del criterio 2.6.

## 3. Tres defectos que sólo aparecieron midiendo

### 3.1 El consumer lag por cola no existe en `/metrics`

Medido contra `rabbitmq:3.13-management`, la imagen del chart de la aplicación:

```
/metrics          → rabbitmq_queue_messages_ready 3            ← SIN etiqueta queue
/metrics/detailed → rabbitmq_detailed_queue_messages_ready{queue="audit.customer"} 3
```

El chart raspaba sólo `/metrics`. El "consumer lag por consumidor" que pide
§4.1 **no se puede desglosar ahí**: es un número para todo el broker. Se añadió
el job `rabbitmq-detailed` con `family=queue_coarse_metrics`, y la regla usa el
nombre con prefijo `rabbitmq_detailed_`. Sin esto, el panel de consumer lag
habría sido una línea plana: un dashboard decorativo, que §8.3 penaliza con un
25 %.

### 3.2 Prometheus guarda `le="5.0"`, no `le="5"`

El Collector expone `le="5"` en su texto; la serie almacenada lleva `5.0`. La
regla de SLO-2 escrita con `le="5"` devolvía **vacío** — ni error, ni cero — y el
panel habría estado en blanco para siempre. La regla usa ahora
`le=~"5(\.0+)?"`, y la comprobación 10 de `obs:kind` falla si el selector deja
de resolver:

```
   numerador de SLO-2 (le ~ 5) -> "value":[…,"0"]
   OK  el selector del bucket resuelve
```

### 3.3 El Collector renombra `job` y añade `otel_scope_*`

La serie llega con `exported_job` (porque Prometheus ya tiene su `job="otel-gateway"`)
y con tres etiquetas `otel_scope_*`. Documentado en el catálogo: el servicio se
filtra por `service_name`, nunca por `job`.

## 4. El guardia nuevo

`pnpm obs:check:dashboards` comprueba, sin necesitar clúster, que cada JSON está
completo, que **cada `slo:`/`sli:` que cita un panel está grabado por una regla**
y que cada `runbook_url` apunta a un archivo que existe. Probado en los dos
sentidos:

```
$ sed -i 's/burn_rate1h/burn_rate1hh/' dashboards/02-slo-error-budget.json
$ pnpm obs:check:dashboards
   FALLO: paneles que citan una regla que nadie graba:
      02-slo-error-budget.json: slo:gateway_availability:burn_rate1hh
   RESULTADO: 1 comprobacion(es) fallaron.
```

Es el error que no da error: un nombre mal escrito deja el panel vacío y parece
que el sistema no tiene datos.

## 5. Validación

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 14 de 14 |
| `pnpm obs:lint` | 1 chart, 0 fallos |
| `pnpm obs:template` | renderiza las 30 reglas, las 7 alertas y los 9 ConfigMaps |
| `pnpm obs:check:dashboards` | pasa, y falla ante un nombre inventado |
| `promtool check rules` | 30 reglas |
| `pnpm obs:kind` | 10 de 10 |
| `actionlint .github/workflows/cd.yml` | sin hallazgos nuevos (el único es previo, línea 136) |

## 6. Lo que queda abierto

- **Ninguna alerta se ha disparado todavía.** El criterio 2.5 pide alertas «que
  se disparan durante las pruebas», y eso es T-51: hace falta carga y un
  escenario de fallo. Los umbrales están puestos para que `DeadLetterGrowing` y
  `TransferLatencyBreach` se disparen con el escenario de Payment de T-44.
- **Los paneles de plataforma no se han visto con datos reales de HPA**: en kind
  no hay `metrics-server`, así que las series de `kube_horizontalpodautoscaler_*`
  existen pero no se mueven. La evidencia de autoescalado es de T-51 contra el
  entorno de T-54.
- **El error budget necesita siete días de datos** para ser otra cosa que una
  extrapolación. Con el stack recién desplegado, la ventana estará incompleta el
  día de la calificación y conviene decirlo en la demo en lugar de maquillarlo.
