# BrokerConsumerLagHigh

**SLO-14** — reintentos del broker dentro de la escalera. La alerta vigila el
**consumer lag**: más de **500** mensajes pendientes en una cola durante 10
minutos.

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
   kubectl exec -n prod deploy/bank-usac-rabbitmq -- rabbitmqctl list_queues name consumers messages
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

- **Consumidor ausente** → `kubectl rollout restart deployment/bank-usac-<servicio> -n prod`.
  Al reconectar, el broker reentrega lo no confirmado: nada se pierde.
- **Consumidor lento por carga** → el HPA escala al 80 % de CPU; si está al
  máximo, subir `maxReplicas`. **`account-service` se queda en una réplica**: su
  barrido de cuentas inactivas no tiene elección de líder.
- **Una cola concreta atascada por un mensaje** → suele acabar en la DLQ sola;
  ver [dead-letter.md](dead-letter.md).
- **El broker, caído o reiniciado** → recordar **TD-082**: el RabbitMQ del
  clúster **no tiene volumen**, así que un reemplazo de pod pierde lo que
  estuviera encolado sin consumir. Si el pod se reinició, hay que comprobar el
  dinero de las Sagas en vuelo, no sólo el lag.

## Lo que NO hay que hacer

- Leer el lag de `/metrics` del broker. Ahí `rabbitmq_queue_messages_ready` es
  **un único número para todo el broker, sin etiqueta `queue`**: no sirve para
  saber qué cola está atascada. El desglose por cola viene del job
  `rabbitmq-detailed` y la serie se llama `rabbitmq_detailed_queue_messages_ready`.
- Purgar la cola. Eso no resuelve el atasco: lo borra.
