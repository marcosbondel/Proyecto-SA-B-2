# PartnerBankDegraded / PartnerBankConfirmationSlow

**SLO-28** — la dependencia con el banco pareja: depósitos interbancarios
confirmados **≥ 95 %** y confirmación **p95 < 5 s**.

## Qué significa

El banco del otro grupo está rechazando depósitos, tardando demasiado en
confirmarlos, o no contestando. Es la única alerta sobre un sistema que **no
controlamos**, y por eso la regla de evaluación del enunciado es explícita: los
fallos del banco pareja no restan puntos si el banco propio reacciona
correctamente — compensación, reintentos y alertas.

Así que la pregunta del runbook no es "¿cómo arreglo el banco pareja?" sino
**"¿reaccionó el nuestro como debía?"**.

## Cómo diagnosticarla

1. **Cuánto y en qué dirección.**
   ```promql
   slo:interbank_accepted:ratio_rate5m
   slo:interbank_confirmation:seconds_p95
   sum by (result) (rate(bank_interbank_deposits_total[5m]))
   sum by (result) (rate(bank_interbank_callbacks_total[5m]))
   ```
   `bank_interbank_callbacks_total` es lo que **nosotros** entregamos: si falla,
   el problema es nuestro lado o la red, no su decisión.
2. **El motivo del rechazo está en el log y en el span**, no en la métrica (es
   un conjunto que el contrato ajeno puede ampliar):
   ```logql
   {service_name="payment-service"} |= "interbank" | level=~"warn|error"
   ```
3. **La traza cruza los dos bancos.** El `traceparent` viaja en la petición, así
   que el depósito tiene **el mismo `traceId`** a los dos lados. En Tempo se ve
   dónde se detuvo: en nuestra salida, en su respuesta o en su callback.
4. **¿El dinero volvió?** Lo que de verdad importa. Un rechazo o un timeout debe
   terminar en `REVERSED` con el saldo íntegro:
   ```logql
   {service_name="payment-service"} |= "<interbankTransferId>"
   ```
   y el saldo de la cuenta origen antes y después.

## Cómo mitigarla

- **Nada que arreglar en su sistema.** Avisar al contacto del acuerdo de
  integración (`docs/operations/INTERBANK-AGREEMENT.md`) y registrar la hora.
- **Comprobar que compensamos.** Si un depósito quedó en `SENT` o `TIMEOUT` sin
  pasar a `REVERSED`, eso **sí** es nuestro: el vencimiento está guardado como
  columna, así que un barrido posterior debe recogerlo. Si no lo recoge, es un
  defecto y va al postmortem.
- **Si hay que seguir operando** sin el banco pareja: apuntar la configuración al
  **mock** (`interbank.partnerBaseUrl` en `values.yaml`), que es un cambio de
  valores y un `helm upgrade`, sin reconstruir imágenes. El enunciado contempla
  justamente eso para el día de la calificación.
- **Nunca** se inyecta un fallo apagando o alterando el sistema del otro grupo.
  Los escenarios de prueba se hacen con el mock propio.

## Lo que NO hay que hacer

- Reintentar un depósito a mano con una `idempotencyKey` nueva. La clave es lo
  único que impide acreditar dos veces; una clave nueva para la misma
  transferencia es exactamente el depósito duplicado que §8.3 penaliza con un
  50 %.
- Acreditar "a mano" porque el callback no llegó. Si el callback no llegó, el
  resultado es desconocido, y lo que corresponde es compensar.
