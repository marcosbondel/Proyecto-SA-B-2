# BrokerConsumerLagHigh

**Sin SLO propio.** Es la alerta que §4.1 exige para la dependencia del broker
(`docs/sre/sli-slo-sla.md` §5.3). Hasta T-60 llevaba la etiqueta SLO-14, que es
«reintentos dentro de la escalera» y no tiene que ver con una cola llena. La
alerta vigila el **consumer lag**: más de **500** mensajes pendientes en una
cola durante 10 minutos.

## Qué significa

Una cola acumula mensajes porque su consumidor no sigue el ritmo. El sistema no
está caído —nada se perdió— pero todo lo que pasa por esa cola llega tarde, y en
una Saga eso significa transferencias lentas y dinero reservado durante más
tiempo del necesario.

## Cómo diagnosticarla

1. **Qué cola.**
   ```promql
   sli:broker_consumer_lag:messages
   sli:broker_unacked:messages
   ```
   `ready` son mensajes que nadie ha tomado; `unacked`, tomados y sin confirmar.
   Mucho `unacked` con poco `ready` es un consumidor **lento**; mucho `ready`
   con poco `unacked` es un consumidor **ausente**.
2. **¿Hay consumidor?**
   ```bash
   kubectl get pods -n prod
   kubectl exec -n prod deploy/rabbitmq -- rabbitmqctl list_queues name consumers messages
   ```
   Cero consumidores en una cola con mensajes es un pod caído o un pod que
   perdió su canal.
3. **Cuánto tarda cada mensaje.**
   ```promql
   sli:message_process:seconds_p95
   sli:throughput_by_queue:rate5m
   ```
   Si el throughput cayó y el p95 subió, el consumidor se volvió lento (base de
   datos, bloqueos, un servicio externo). Si el throughput cayó y el p95 sigue
   bien, el consumidor no está recibiendo.
4. **Los logs del consumidor.**
   ```logql
   {service_name="<servicio>"} | level="error"
   ```
   Atención a `channel closed` y a `IllegalOperationError`: es el patrón de
   **TD-076**, en el que un fallo del canal durante el reintento mata el
   proceso. El síntoma visto desde fuera es un muro de `504 REPLY_TIMEOUT`.

## Cómo mitigarla

- **Consumidor ausente** → conservar estado, eventos y `--previous` antes de
  decidir reiniciarlo. Confirmar la dependencia; un pod nuevo no repara una base
  inaccesible. La reconexión reentrega los mensajes no confirmados que el broker
  aún conserva: comprobar idempotencia y conciliación en vez de prometer que
  ningún reinicio puede perder mensajes.
- **Consumidor lento por carga** → el HPA escala al 80 % de CPU; si está al
  máximo, subir `maxReplicas`. Account también puede escalar: el barrido toma un arriendo PostgreSQL
  con `pg_try_advisory_lock` y quien no lo adquiere omite el turno.
- **Una cola concreta atascada por un mensaje** → suele acabar en la DLQ sola;
  ver [dead-letter.md](dead-letter.md).
- **El broker caído o reiniciado** → el chart actual **sí tiene PVC** cuando
  `rabbitmq.inCluster=true` y persistencia habilitada. Verificar el claim y el
  nombre estable del nodo: un volumen montado bajo una identidad de nodo nueva
  puede aparentar una base vacía. Los mensajes perdidos antes de instalar el
  volumen no reaparecen al habilitarlo. Comprobar las Sagas en vuelo y el dinero.

## Lo que NO hay que hacer

- Leer el lag de `/metrics` del broker. Ahí `rabbitmq_queue_messages_ready` es
  **un único número para todo el broker, sin etiqueta `queue`**: no sirve para
  saber qué cola está atascada. El desglose por cola viene del job
  `rabbitmq-detailed` y la serie se llama `rabbitmq_detailed_queue_messages_ready`.
- Purgar la cola. Eso no resuelve el atasco: lo borra.

## RabbitMQ: PVC y permisos de `.erlang.cookie`

Este procedimiento atiende también un broker `CrashLoopBackOff` sin lag visible:
el scrape puede faltar precisamente porque el broker no arrancó. Los cambios
versionados de **2026-10-19** añadieron el PVC (`6402d9b`) y corrigieron los
permisos tras reinicio (`4f9593c`). Esas horas son de commits, no una cronología
medida de la caída; ver [el registro del incidente](../../sre/postmortems/2026-10-19-rabbitmq-persistence-cookie.md).

### Diagnóstico sin revelar la cookie

Con el contexto ya comprobado y `NS` elegido:

```bash
kubectl config current-context
kubectl get deploy,pod,svc,pvc -n "$NS" -l app.kubernetes.io/component=rabbitmq
kubectl describe deployment rabbitmq -n "$NS"
kubectl logs -n "$NS" deploy/rabbitmq -c rabbitmq --previous --tail=100
kubectl logs -n "$NS" deploy/rabbitmq -c permisos-de-la-cookie --tail=100
kubectl get events -n "$NS" --sort-by=.lastTimestamp
```

1. `Pending` / `Multi-Attach` indica un problema de montaje `ReadWriteOnce`;
   verificar que el pod anterior terminó y que hay un único escritor.
2. `Cookie file ... must be accessible by owner only` apunta a permisos de
   `.erlang.cookie`. No leer ni copiar su contenido. Si el proceso está vivo,
   consultar únicamente metadatos:
   ```bash
   kubectl exec -n "$NS" deploy/rabbitmq -c rabbitmq -- \
     stat -c '%a %u:%g' /var/lib/rabbitmq/.erlang.cookie
   ```
3. Revisar el manifiesto efectivo: PVC `rabbitmq-data` en `/var/lib/rabbitmq`,
   `RABBITMQ_NODENAME=rabbit@localhost`, `fsGroup: 999`,
   `fsGroupChangePolicy: OnRootMismatch`, init container como UID/GID 999 que
   aplica `chmod 400` si existe la cookie. Un `fsGroup` aplicado recursivamente
   puede volver a conceder permiso de grupo en el siguiente montaje.
4. Si el broker arranca pero las colas parecen nuevas, verificar el nodo y el
   claim **antes** de redeclarar/purgar. No cambiar `RABBITMQ_NODENAME` en un
   volumen existente sin procedimiento de migración y copia.

### Mitigación y comprobación

- Aplicar mediante el pipeline la versión corregida del chart, conservar el
  claim y confirmar que el init container termina. El rollout usa
  `maxSurge: 0`, `maxUnavailable: 1`: habrá una interrupción del broker y no
  deben solaparse dos pods escribiendo el volumen.
- No borrar cookie, directorio `mnesia`, PVC o namespace para salir del
  CrashLoop. `helm uninstall` también puede eliminar el claim; registrar y
  respaldar datos antes de una reinstalación.
- Si la contraseña se rotó, recordar que `RABBITMQ_DEFAULT_USER/PASS` sólo se
  usa en el primer arranque con datos vacíos. Coordinar la actualización del
  usuario persistido con los Secret y clientes; no poner la clave en comandos
  versionados, logs ni capturas.
- Comprobar `rabbitmq-diagnostics ping`, reconexión de consumidores, colas,
  mensajes listos/no confirmados, targets de métricas y sondas `/ready` del banco.
  Conciliar las operaciones que estuvieron en vuelo: outbox garantiza reintento
  de publicación, no reconstruye cualquier mensaje ya perdido del broker.
- La imagen que fija hoy el manifiesto es **`rabbitmq:3.13-management`**; no
  declarar que el broker GKE ejecuta la versión 4.3.4 de CI/Docker local.

## Cierre

El lag debe volver a su línea base con consumidores activos, sin nuevos
reinicios, y la alerta debe pasar a `resolved` tanto en Grafana como en Audit.
Conservar el inventario de pendientes, estados y conciliación financiera. Que
la cola vuelva a cero no demuestra que el trabajo fue procesado si se perdió
el volumen o se purgó.
