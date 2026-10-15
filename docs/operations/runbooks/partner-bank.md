# PartnerBankDegraded / PartnerBankConfirmationSlow
# PartnerBankSendDegraded / PartnerBankSendConfirmationSlow

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

0. **Qué alerta sonó, porque son dos direcciones y no la misma.** El nombre lo
   dice: `PartnerBankSend*` es el depósito que **le mandamos** —el dinero de un
   cliente nuestro está retenido mientras no se decida— y `PartnerBank*` sin
   `Send` es el que **él nos manda**, donde no hay nada retenido de nuestro
   lado. Si suena la primera, el reloj corre: a los 30 s vence y compensa.

1. **Cuánto y en qué dirección.**
   ```promql
   # lo que recibimos (T-46)
   slo:interbank_accepted:ratio_rate5m
   slo:interbank_confirmation:seconds_p95
   sum by (result) (rate(bank_interbank_deposits_total[5m]))
   sum by (result) (rate(bank_interbank_callbacks_total[5m]))

   # lo que enviamos (T-47)
   slo:interbank_sent_accepted:ratio_rate5m
   slo:interbank_sent_confirmation:seconds_p95
   sum by (result) (rate(bank_interbank_sent_total[5m]))
   sli:interbank_sent_timeouts:rate5m
   ```
   `bank_interbank_callbacks_total` es lo que **nosotros** entregamos: si falla,
   el problema es nuestro lado o la red, no su decisión.

   Y una distinción que el panel resuelve de un vistazo
   (`08-banco-pareja.json`, la mitad de abajo): si la **tasa** cae, él rechaza o
   no contesta; si sólo sube el **p95**, tarda. Son dos problemas distintos y
   sólo el segundo se arregla esperando.
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
  **mock**, que es un cambio de valores y un `helm upgrade`, sin reconstruir
  imágenes. El enunciado contempla justamente eso para el día de la
  calificación. Son dos claves, una por dirección:

  ```yaml
  interbank:
    callbackUrl: http://bank-usac-partner-bank-mock:3021/callbacks/interbank  # al contestarle
    sendUrl: http://bank-usac-partner-bank-mock:3021/deposits                 # al mandarle
  ```

  **`sendUrl` vacío apaga el envío por completo**, y lo hace en silencio: la
  ruta sigue contestando `202`, la transferencia termina `COMPLETED` y el dinero
  se queda en la cuenta de liquidación sin que nadie lo haya mandado a ninguna
  parte. El único rastro es una línea al arrancar, `envio interbancario
  desactivado: falta INTERBANK_SEND_URL`. Si las transferencias interbancarias
  salen todas perfectas y `bank_interbank_sent_total` está vacío, es esto.

- **Para inyectar el fallo a propósito** (T-51), la perilla es el modo del mock
  y no un cambio de código: `ACCEPT`, `REJECT`, `TIMEOUT` o `SLOW`.

  ```bash
  pnpm load:scenario rechazo        # el pareja dice no a todo
  pnpm load:scenario sin-respuesta  # el pareja no contesta
  pnpm load:scenario lento          # el pareja tarda 12 s
  ```

  El script devuelve el modo a `ACCEPT` al terminar, incluso si se interrumpe.
- **Nunca** se inyecta un fallo apagando o alterando el sistema del otro grupo.
  Los escenarios de prueba se hacen con el mock propio.

## Lo que NO hay que hacer

- Reintentar un depósito a mano con una `idempotencyKey` nueva. La clave es lo
  único que impide acreditar dos veces; una clave nueva para la misma
  transferencia es exactamente el depósito duplicado que §8.3 penaliza con un
  50 %.
- Acreditar "a mano" porque el callback no llegó. Si el callback no llegó, el
  resultado es desconocido, y lo que corresponde es compensar.

## Cuando se siguió este runbook

- **2026-10-15**, durante la carga de T-51: `PartnerBankSendDegraded` con el
  mock en `REJECT`. La conclusión está en
  [el postmortem](../../sre/postmortems/2026-10-15-banco-pareja.md), y el paso 4
  —«¿el dinero volvió?»— es el que decidió que el escenario había salido bien.
