# Interbancario: degradación, confirmación y liberación sin verificar

**SLO-28**, por dirección: aceptados **≥ 95 %** y confirmación **p95 < 5 s**.
Este procedimiento cubre las cinco reglas del
[chart de observabilidad](../../../infra/k8s/helm/bank-observability/values.yaml).

| Alerta | Qué evalúa | Persistencia | Severidad |
| --- | --- | --- | --- |
| `PartnerBankDegraded` | aceptados entrantes < 95 % en tasa de 5 min | 15 min | warning |
| `PartnerBankConfirmationSlow` | p95 de decisión entrante > 5 s | 15 min | warning |
| `PartnerBankSendDegraded` | aceptados salientes < 95 % en tasa de 5 min | 5 min | warning |
| `PartnerBankSendConfirmationSlow` | p95 de confirmación saliente > 5 s | 5 min | warning |
| `InterbankReserveReleasedUnverified` | log de liberación no verificada en los últimos 15 min | sin espera adicional | critical |

## Qué significa y cómo distinguir las direcciones

`PartnerBankSend*` mira el dinero que enviamos. `PartnerBank*` sin `Send` mira
el depósito entrante que resuelve nuestro banco: un rechazo entrante puede ser
una cuenta local inválida o una regla de negocio, no una caída del otro banco.
El contador de callbacks mide nuestros intentos de entregarles el resultado;
no mezclar esa entrega con la decisión local del depósito.

El TTL oficial es **180 s** desde la creación, no 30 s. `TIMEOUT` significa
que venció sin confirmación: se retiene y se consulta/cancela antes de devolver.
El margen de liberación no verificada es **300 s adicionales** al vencimiento.
La variable heredada `INTERBANK_CONFIRMATION_TIMEOUT_MS` sigue siendo aceptada
al arrancar, pero **ya no decide esos plazos**.

## Diagnóstico de las cuatro alertas de degradación

1. Registrar entorno, `partnerBankCode`, URL base efectiva, versión, ventana y
   alerta. El inventario del 2026-10-21 encontró mock `BANK99` en `prod` y
   **ninguno en `dev`**. El código del banco no prueba por sí solo qué endpoint
   se está llamando. No inyectar fallos en producción para comprobarlo.
2. Consultar cada dirección por separado (elegir el filtro de entorno):

   ```promql
   slo:interbank_accepted:ratio_rate5m{environment="dev"}
   slo:interbank_confirmation:seconds_p95{environment="dev"}
   sum by (result) (rate(bank_interbank_callbacks_total{environment="dev"}[5m]))
   slo:interbank_sent_accepted:ratio_rate5m{environment="dev"}
   slo:interbank_sent_confirmation:seconds_p95{environment="dev"}
   sli:interbank_sent_timeouts:increase1h{environment="dev"}
   ```

   El saliente cuenta `timeout` al entrar en ese estado. Una resolución tardía
   no lo vuelve a contar como aceptado/rechazado; el ratio puede seguir bajo
   después de recuperar la operación. **Los timeouts no se incluyen en el
   histograma de confirmación**: p95 normal junto a timeouts altos no prueba
   dependencia sana. Ausencia de datos requiere comprobar tráfico y scrape.
3. Buscar razón y operación en logs, conservando correlación y entorno:

   ```logql
   {service_name="payment-service", deployment_environment="dev"}
     |= "interbank"
   {service_name="payment-service", deployment_environment="dev"}
     | correlationId="<correlationId>"
   ```

   En Tempo abrir la traza desde el log; spans `payment.interbank send`,
   `payment.interbank.resolve`, `payment.interbank.expire` y llamadas HTTP
   muestran dónde se detuvo. `traceparent` se envía al pareja; sólo se verá su
   mitad si también exporta esa traza a un almacén consultable y el muestreo la
   conserva. No prometer visibilidad del banco remoto sólo porque se envió un
   header.
4. Verificar las filas y el historial: `confirmationDueAt`,
   `releaseNotBefore`, resultado de consulta/cancelación y próxima ejecución
   persistida. Comparar saldo origen, liquidación, estado de Saga y auditoría.
   Un `202` no prueba aceptación financiera; `TIMEOUT` no prueba rechazo.

## Mitigación de la degradación

- **Rechazo conocido:** comprobar su motivo, que no se duplicó el envío y que
  la compensación devolvió lo debitado cuando corresponde. Una cuenta inválida
  no se arregla reiniciando pods.
- **Sin callback:** dejar ejecutar la resolución persistida. Una consulta o
  cancelación que confirma aceptación cierra favorablemente; rechazo/cancelación
  permiten liberar. Un `PROCESSING` o una consulta sin respuesta requiere seguir
  el protocolo, no devolver a ciegas antes del margen.
- **Banco real afectado:** registrar el incidente y usar el contacto del
  [acuerdo de integración](../INTERBANK-AGREEMENT.md). Una comunicación humana
  no autoriza a modificar un saldo ni a saltarse la idempotencia.
- **Mock para una demostración en desarrollo:** verificar primero que existe
  en ese namespace y que el endpoint apunta a él. La clave de configuración
  actual es `interbank.partnerBaseUrl`, con sufijo **`/interbank/v1`**; los
  valores antiguos `sendUrl` y `callbackUrl` no describen este chart. No vaciar
  la URL para silenciar la alerta: puede desactivar el envío y dejar dinero en
  liquidación mientras la transferencia parece interna.
- **Prueba de fallo autorizada en `dev`:** capturar modo inicial del mock y
  simulación; usar su API de administración autenticada y los modos admitidos
  `ACCEPT`, `REJECT`, `TIMEOUT`, `SLOW`. Restaurar exactamente el estado previo
  aun ante error. Los scripts históricos de carga usan supuestos de Docker
  local; comprobar comandos y destino antes de reutilizarlos en GKE.

## InterbankReserveReleasedUnverified

### Significado

La regla cuenta logs de `payment-service` con `RELEASED_NO_ANSWER` o
`RELEASED_UNKNOWN_AT_PARTNER` en **15 min**, y renombra
`deployment_environment` a `environment` para el enrutamiento. Se dispara con
cualquier cantidad mayor de cero, sin `for` adicional.

El protocolo llegó al margen de liberación sin verificar el resultado remoto.
Esto requiere **conciliación**, aunque el sistema haya devuelto al cliente: el
otro banco pudo acreditar y perder la respuesta. La línea se emite antes de
aplicar la transición local, por lo que hay que verificar que la liberación y
la compensación efectivamente se persistieron.

### Diagnóstico y mitigación

1. Abrir la alerta con su entorno; extraer `interbankTransferId`,
   `transactionId`, `correlationId` y hora del log:

   ```logql
   {service_name="payment-service", deployment_environment="dev"}
     |~ "RELEASED_NO_ANSWER|RELEASED_UNKNOWN_AT_PARTNER"
   ```

2. Conservar las respuestas de consulta/cancelación, vencimiento y margen de
   esa operación; consultar el estado e historial con las rutas autorizadas.
   Confirmar estado y saldo local. No concluir “dinero devuelto” sólo por el log.
3. Conciliar el identificador con el pareja mediante consulta y la
   reconciliación diaria del contrato, usando su credencial y alcance. Si no
   responde, mantener el incidente abierto con dueño y próxima revisión.
4. Si el pareja sí acreditó, comprobar la rama de **reverso**. Un callback
   tardío activa el proceso persistido con un `reversalId` estable; el sweeper
   pide o consulta el reverso. No crear otra transferencia con identidad nueva.
5. Seguir `payment.interbank.reversal` y los logs `REVERSAL_COMPLETED`,
   `REVERSAL_FAILED`, `REVERSAL_UNANSWERED` o rechazo del reverso. Un resultado
   `COMPLETED` referencia `refundTransferId`; verificar también el depósito de
   devolución recibido y conciliado. Si falla o se agotan intentos, el dueño de
   Payment y SRE coordinan resolución humana con el otro banco, conservando el
   registro de cualquier ajuste aprobado.

### Criterio de cierre

Documentar el veredicto remoto, compensación/reverso local, depósito de retorno
si aplica, y saldos conciliados. Grafana deja de ver el log al salir de su
ventana de 15 min: **eso no cierra la conciliación financiera**. Comprobar además
la resolución en Audit y adjuntar identificadores sin secretos al postmortem.

## Prácticas que preservan la evidencia

Conservar claves de idempotencia y el envelope en un reintento; no cambiar el
identificador para forzar una nueva acreditación. No modificar saldos, purgar
colas o borrar las filas para que la alerta deje de verse. Las pruebas de fallo
se hacen sobre el mock propio en desarrollo, sin alterar el banco de otro grupo.

## Antecedente histórico

El [postmortem de 2026-10-15](../../sre/postmortems/2026-10-15-banco-pareja.md)
registra rechazos y timeouts de **kind con el protocolo anterior**. Sus plazos
de 30 s y sus recuentos se preservan como evidencia histórica; no prueban el TTL
actual de 180 s, consulta/cancelación ni liberación después del margen en GKE.
