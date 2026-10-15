# T-49 — El stack de observabilidad en el clúster: evidencia

Fecha de la medición: **2026-10-15**. Entregado en T-49 (#136); esta evidencia se
escribió en T-59 (#156). La decisión es
[ADR-018](../../architecture/adr/ADR-018-observability-stack.md).

## 1. Qué es este ticket

El destino de la telemetría que T-41 a T-45 y T-48 ya emitían y nadie recogía:
un OpenTelemetry Collector en el clúster, Prometheus, Tempo, Loki y Grafana,
desplegados **por chart** y no a mano — §4.2 lo exige y §8.3 cobra un 25 % por
un stack desplegado manualmente.

## 2. El chart, y los subcharts dentro del repositorio

```
$ pnpm obs:lint
1 chart(s) linted, 0 chart(s) failed

$ pnpm obs:template | (contar por kind)
objetos renderizados: 55
  ConfigMap 17 · Service 8 · ServiceAccount 7 · ClusterRole 6
  ClusterRoleBinding 6 · Deployment 4 · PersistentVolumeClaim 2
  StatefulSet 2 · Role 1 · RoleBinding 1 · DaemonSet 1
```

Cinco imágenes de subchart en seis dependencias declaradas —el Collector entra dos veces, con alias— **con la versión fijada y el `.tgz` dentro del repositorio**:

```
$ ls infra/k8s/helm/bank-observability/charts/
grafana-10.5.15.tgz
loki-7.3.0.tgz
opentelemetry-collector-0.176.0.tgz   (dos veces: otlpGateway y logAgent)
prometheus-29.36.2.tgz
tempo-1.24.4.tgz
```

Vendorizados y no descargados en el despliegue: un `helm dependency update` en
el pipeline convierte una caída del repositorio ajeno en un despliegue fallido, y
una versión flotante en un stack distinto cada vez. La razón completa está en
ADR-018.

Dos instancias del **mismo** chart del Collector con alias distintos
(`otlpGateway` y `logAgent`): una recibe OTLP de los siete componentes, la otra
es un DaemonSet que lee los logs de los pods. Son dos ciclos de vida y dos
tamaños, no un pod con dos trabajos.

## 3. La validación desechable: 10 de 10

`pnpm obs:kind` crea su **propio** clúster de kind (`bank-obs-test`), instala el
stack, le manda telemetría de verdad y comprueba diez afirmaciones. No usa el
clúster del camino local, para que una validación no dependa de un despliegue
que puede estar a medias.

```
$ pnpm obs:kind

 1. Tempo tiene la traza                                            OK
 2. Loki indexa SOLO las etiquetas de la lista cerrada              OK
 3. El JSON del banco se parseó: filtrar por traceId encuentra la línea  OK
 4. correlationId también es consultable                            OK
 5. La línea que NO es JSON se guardó igual                         OK
 6. Prometheus raspa al Collector                                   OK
 7. Grafana cargó los tres datasources y los derivedFields          OK
 8. Prometheus tiene las series con el nombre del catálogo          OK
      bank_transfer_finished_total
      bank_transfer_duration_seconds_bucket
 9. Las dos etiquetas del catálogo están, y ninguna más             OK
      service_name y environment
      k8s_pod_name NO es etiqueta
10. Las reglas de grabación de T-50 cargan y sus selectores RESUELVEN   OK
      cargadas · el selector del bucket resuelve · la regla produce serie

RESULTADO: 10 de 10. El stack mide lo que dice medir.
```

Las comprobaciones que no son obvias, y por qué están:

- **La 2 y la 9 son la misma preocupación por los dos lados.** §4.2 pide
  cardinalidad controlada, y el modo de fallar no es un error: es que alguien
  añade `k8s_pod_name` como etiqueta y seis meses después Prometheus no arranca.
  La 9 comprueba que **no** está.
- **La 5 — una línea que no es JSON se guarda igual.** El formato de log del
  banco es JSON (T-48), pero un volcado de pila de Node o una línea de arranque
  de un subchart ajeno no lo son. Un pipeline que descarta lo que no parsea
  pierde justo las líneas de una caída.
- **La 10 es la que distingue un stack que mide de uno que está instalado.** Una
  regla de grabación con un selector que no resuelve **carga sin error** y
  produce una serie vacía para siempre. Comprobar que carga no sirve; hay que
  comprobar que su selector encuentra algo. T-58 y T-51 encontraron dos defectos
  exactamente de esa forma — el `le="5"` que Prometheus guarda como `le="5.0"` y
  el numerador que desaparece en el peor caso.

## 4. Los tres datasources, en el despliegue real

Contra el stack instalado en el clúster local, no contra el render:

```
$ curl -u admin:*** http://localhost:3002/api/datasources
  loki         Loki         uid=bank-loki        default=False
  prometheus   Prometheus   uid=bank-prometheus  default=True
  tempo        Tempo        uid=bank-tempo       default=False
```

Los `uid` son **fijos y escritos a mano**, no generados: los paneles de T-50 los
citan por `uid`, así que un datasource recreado con otro identificador dejaría
nueve dashboards apuntando a la nada. Es el error que no da error.

## 5. El salto entre las tres señales

```
$ curl -u admin:*** .../api/datasources/name/Loki   (derivedFields)
  campo=TraceID        matcher=traceId        -> datasource bank-tempo
  campo=CorrelationID  matcher=correlationId  -> consulta de Loki con ese correlationId

$ curl -u admin:*** .../api/datasources/name/Tempo  (jsonData)
  tracesToLogs:    sí
  tracesToMetrics: sí
  nodeGraph:       {'enabled': True}
```

Las dos direcciones, que es lo que §4.1 pide: de un log a su traza por
`traceId`, y de una traza a sus logs. Y `CorrelationID` **no** salta a Tempo
sino a otra consulta de Loki, porque el `correlationId` es del negocio: agrupa
todo lo que pasó por una operación aunque la traza técnica se haya cortado.

Medido de punta a punta con el depósito interbancario de
[T-46](T-46-interbank-receipt-evidence.md): un `traceparent` que entró desde
otro banco produjo **80 spans en una sola traza**, repartidos en cuatro
servicios —`payment-service` 30, `gateway` 21, `account-service` 15,
`notification-audit-service` 14— y el mismo `traceId` encuentra sus líneas en
Loki. Cuatro servicios en una traza **sin una sola llamada HTTP entre ellos**:
el contexto W3C viaja en las propiedades AMQP.

## 6. La retención, y el número que de verdad corre en cada sitio

| Dónde | Prometheus | Loki | Por qué |
| --- | --- | --- | --- |
| el chart (`values.yaml`) | `retention: 7d` | `retention_period: 168h` | §4.2 — «configurar la retención de datos (por ejemplo, 7 días)», y es la ventana del error budget de §6.1 |
| el camino local (`infra/k8s/kind/observability.values.yaml`) | `retention: 2h` | — | un portátil no guarda siete días de series para una prueba de media hora |

```
$ kubectl get deploy prometheus-server -n observability -o jsonpath='…args'
  --storage.tsdb.retention.time=2h
  --storage.tsdb.path=/data
```

**Los 2h del despliegue local son una sobrescritura deliberada, no el valor del
chart.** Conviene decirlo porque tiene una consecuencia que afecta a lo que se
puede afirmar: el **error budget de siete días no se puede observar en local**.
Las reglas `*:budget_remaining7d` existen y cargan, pero `avg_over_time(…[7d])`
sobre dos horas de datos no es el presupuesto, es lo que hay. Eso se mide cuando
T-54 despliegue en GKE.

## 7. Qué falta, y de qué depende

- **La corrida en GKE.** Todo lo de arriba es el clúster local y el clúster
  desechable. El mismo chart sirve para la nube —es el punto de ADR-018— pero no
  se ha instalado allí. Cuando T-54 (#151) despliegue, se añade aquí la salida
  de `pnpm obs:forward` contra GKE, los siete HPA con métricas reales y el
  presupuesto de siete días con siete días de datos.
- **Grafana no tendrá IP pública** en la nube: queda una sola libre en la cuota
  y es el margen de la entrada del banco (ADR-018, §3). Se verá por
  `port-forward`, que es una limitación de cuota y no una decisión.

## 8. Validación

| Comando | Resultado |
| --- | --- |
| `pnpm obs:lint` | 1 chart, 0 fallos |
| `pnpm obs:template` | 55 objetos |
| `pnpm obs:check` | 6 dependencias declaradas (el Collector dos veces, con alias), versionadas y con el lock al día |
| `pnpm obs:check:dashboards` | 9 dashboards, 34 reglas citadas y existentes, 5 runbooks en disco |
| `pnpm obs:kind` | **10 de 10** |
| `promtool check rules` | 34 reglas |
