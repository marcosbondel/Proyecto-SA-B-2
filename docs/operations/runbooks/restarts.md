# PodRestarting / MassRestartDependencyLost

**No tienen SLO.** Son la señal más barata y más específica que existe, y la que
faltaba: no miden un objetivo, dicen *qué* se rompió cuando los demás paneles ya
están rojos.

## Qué significan

Son dos alertas porque son dos cosas distintas, y mezclarlas haría que la
segunda —la que importa— se pareciera a la primera.

- **`PodRestarting`** — un pod se reinició más de dos veces en diez minutos. Es
  un pod enfermo: una sonda mal calibrada, un `OOMKilled`, una migración que
  falla al arrancar.
- **`MassRestartDependencyLost`** — **más de la mitad de los componentes** se
  reiniciaron en la misma ventana. Eso no es un montón de pods enfermos a la vez:
  es **una dependencia compartida que se cayó**. El broker, una base de datos, el
  DNS.

El umbral de la segunda es una fracción y no un número de pods a propósito: con
un siete escrito dentro, dejaría de servir en cuanto el chart creciera o un HPA
subiera una réplica.

## Por qué existen

El 2026-10-15, durante la carga interbancaria de T-51, **los siete servicios se
reiniciaron dentro de seis segundos**. La única señal fue un `kubectl get pods`
hecho a mano.

Las alertas de latencia y de error rate sí dispararon — pero describiendo el
**síntoma**, así que el diagnóstico empezó por las sondas de readiness, que era
el camino equivocado. La causa real era el latido de AMQP: `amqp-connection-manager`
usa 5 s por defecto, RabbitMQ cierra tras dos latidos perdidos, y un bucle de
eventos ocupado 11 s mata la conexión de los siete a la vez. Está contado entero
en [el postmortem](../../sre/postmortems/2026-10-15-latido-amqp.md).

La lección que estas dos alertas codifican: **un reinicio simultáneo no es un
síntoma, es un diagnóstico.** Dice «dependencia compartida» antes de que nadie
mire un log.

## Cómo diagnosticarlas

1. **Qué alerta sonó.** Si es `MassRestartDependencyLost`, salta al paso 3 — no
   pierdas tiempo mirando un pod.

2. **`PodRestarting`: por qué murió ese pod.** El motivo está en el estado
   anterior, no en el log actual:

   ```bash
   kubectl describe pod -n <ns> <pod> | sed -n '/Last State/,/Ready/p'
   ```

   - `OOMKilled` → el límite de memoria. Es un cambio de `resources` en el chart,
     no un reinicio.
   - `Error` con un código de salida → el proceso decidió morir. Mira el log del
     contenedor anterior: `kubectl logs -n <ns> <pod> --previous`.
   - `Completed` o sondas fallando → la sonda. `/health` y `/ready` contestan
     preguntas distintas en los siete servicios; una liveness que falla por una
     base de datos brevemente ausente es un bucle de reinicios, y es exactamente
     el defecto que T-21 arregló abriendo el puerto **antes** de las migraciones.

3. **`MassRestartDependencyLost`: qué dependencia.** Las tres candidatas, en
   orden de probabilidad:

   ```bash
   # El broker. Si murió, los seis servicios de mensajería se van con él
   # (TD-092: terminan el proceso al perder la conexión).
   kubectl get pods -n <ns> -l app.kubernetes.io/name=rabbitmq
   kubectl logs -n <ns> deploy/<servicio> --previous | grep -i "heartbeat\|ECONNRESET\|channel closed"

   # Las bases. Están FUERA del clúster: cinco VMs sin IP pública.
   kubectl logs -n <ns> deploy/<servicio> --previous | grep -i "ECONNREFUSED\|ETIMEDOUT\|password"

   # El DNS, que es el que nadie mira.
   kubectl exec -n <ns> deploy/bank-usac-gateway -- getent hosts rabbitmq
   ```

4. **Y la pregunta que ahorra el resto:** ¿el reinicio fue *simultáneo* o
   *escalonado*? Simultáneo apunta a algo externo compartido. Escalonado en
   cascada apunta a un servicio que arrastró a los demás.

   ```bash
   kubectl get pods -n <ns> -o json \
     | jq -r '.items[] | "\(.metadata.name) \(.status.containerStatuses[0].lastState.terminated.finishedAt // "-")"' \
     | sort -k2
   ```

## Cómo mitigarlas

**Nada aquí justifica tocar un saldo a mano.** Un reinicio en medio de una Saga
lo recoge el barrido: `transaction-service` y `payment-service` escriben sus
eventos en un `outbox_messages` dentro de la transacción que los produce, y un
relay los publica después (TD-047, TD-093). Lo que un reinicio puede retrasar, no
lo pierde.

- **Si es el broker y la causa es el latido:** ya está arreglado
  (`heartbeatSeconds: 30` en `@bank/messaging`). Si vuelve a pasar, el bucle de
  eventos se está bloqueando más de 60 s, y eso es un defecto de un servicio, no
  de la configuración.
- **Si es una base de datos:** las cinco están fuera del clúster y comparten
  `dev` y `prod` (TD-070). Comprueba la VM antes de tocar el chart.
- **Si es un pod solo y es `OOMKilled`:** sube su límite en `values.yaml` y
  despliega por el pipeline. No con `kubectl set resources`, que se pierde en el
  siguiente `helm upgrade` y además deja el chart mintiendo.

## Lo que NO hay que hacer

- **No reiniciar «para ver si se arregla».** Si la dependencia sigue caída, el
  pod nuevo muere igual y se pierde el `--previous` del que traía el motivo.
- **No subir el `periodSeconds` de la liveness para silenciar la alerta.** Eso no
  quita el reinicio, lo retrasa — y convierte una alerta específica en un
  misterio.
- **No desactivar `MassRestartDependencyLost` por ruidosa.** Si suena seguido es
  que algo se cae seguido; el ruido es el mensaje.

## Cuando se siguió este runbook

Todavía no. La alerta se escribió **después** del incidente que la justifica
(TD-091), así que lo que hay es el postmortem y no una ocasión en que esta alerta
avisara a tiempo. La primera vez que suene, se anota aquí.
