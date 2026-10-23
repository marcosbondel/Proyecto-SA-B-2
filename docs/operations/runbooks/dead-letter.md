# DeadLetterGrowing

**SLO-1** — entregas válidas que **no** acaban en la cola muerta, objetivo
**≥ 99 %** sobre 7 días corridos.

## Qué significa

La proporción de entregas `dead_letter` supera 1 % en la tasa de 5 min durante **15 min**. Un mensaje en la cola muerta es
**trabajo detenido**: alguien pidió algo, el sistema lo aceptó y nadie lo está
procesando. Es la alerta con la que menos se puede esperar, porque el dinero
puede estar a medio camino.

## Cómo diagnosticarla

1. **Qué cola y qué tipo de mensaje.**
   ```promql
   sum by (messaging_destination_name, bank_delivery_outcome) (
     rate(messaging_client_consumed_messages_total{bank_delivery_outcome!="ack"}[5m])
   )
   ```
   `retry` señala otro intento; `dead_letter`, `invalid` y `dropped`
   requieren explicación. La regla de SLO-1 resta sólo `dead_letter`: no
   demuestra que no haya pérdida o mensajes inválidos.
2. **Por qué falló el handler.** En *Explore → Loki*:
   ```logql
   {service_name=~".+"} | level="error" |= "dead"
   ```
   y con el `correlationId` de una línea, el flujo completo de ese mensaje en
   todos los servicios. El botón de la traza muestra el salto exacto.
3. **¿Es uno o son todos?** Si es un único `messageType`, probablemente sea un
   mensaje concreto que el consumidor no sabe interpretar (un cambio de contrato
   sin versionar). Si son todos los de un servicio, es el servicio.
4. **La cola, en el broker.**
   ```bash
   kubectl exec -n prod deploy/rabbitmq -- rabbitmqctl list_queues name messages | grep -i dlq
   ```
5. **La auditoría oye todo.** Lo que la auditoría registró como `INVALID` dice
   qué mensajes llegaron ilegibles:
   ```promql
   sum by (family) (rate(bank_audit_events_total{processing="invalid"}[5m]))
   ```

## Cómo mitigarla

- **Un defecto del consumidor** → arreglar y desplegar; los mensajes de la DLQ
  se reprocesan después, no antes: reencolar contra el mismo defecto los devuelve
  a la DLQ y multiplica el ruido.
- **Reencolar**, cuando el consumidor ya está arreglado: mover los mensajes de
  la DLQ a su cola de origen con el *shovel* de RabbitMQ o publicándolos de
  nuevo. Conservar **envelope, `messageId`, `correlationId`, routing key y clave
  de idempotencia originales**. Validar con el dueño del consumidor el alcance
  de su deduplicación; cambiar identificadores puede convertir un reenvío en
  una operación nueva. Reprocesar una muestra, comprobar su estado/saldo y
  continuar sólo si el defecto ya está corregido.
- **Un contrato roto** → `pnpm test:contract` localmente contra el mensaje
  real. Si el productor cambió un campo sin versionar el contrato, el arreglo es
  en el productor.
- **Una Saga a medias** → comprobar el dinero, no el estado: el saldo de la
  cuenta origen debe estar íntegro si la transferencia no se completó.

## Lo que NO hay que hacer

- **Vaciar la DLQ para que la alerta se apague.** Eso borra la evidencia y el
  trabajo pendiente. La DLQ es el inventario de lo que falta hacer.
- Desactivar el reintento. La escalera existe para absorber un fallo
  transitorio; sin ella, un blip del broker se convierte en una DLQ llena.

## Cierre

Registrar la cola y su recuento antes/después, la causa del mensaje, el destino
de cada reenvío y la conciliación de Sagas afectadas. Verificar caída de la
proporción, cola procesable y resolución de la alerta. El contador de entregas
incluye reintentos y redeliveries: no equivale a un total de eventos de negocio
únicos.
