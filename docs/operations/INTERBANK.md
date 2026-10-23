# Interbancario Fase III — contrato v1, reserva y devolución

> Revisión documental T-61, 2026-10-21, contra contratos, handlers, migraciones y pruebas del repositorio. Describe la implementación actual; los resultados de ejecución viven en [QA](../qa/README.md). Esta revisión no constituye una nueva prueba cloud ni una prueba con el banco externo.

El [OpenAPI oficial v1.0.0](../references/interbank-contract-v1.openapi.yaml) se conserva sin modificar y gobierna la API entre bancos. El [acuerdo de integración](INTERBANK-AGREEMENT.md) apunta al repositorio compartido, donde se acuerdan pareja, cuentas y URLs. [ADR-021](../architecture/adr/ADR-021-interbank-protocol-v1.md) registra cómo se traduce a los límites de este sistema.

## Entradas y autenticación

Hay tres superficies distintas; cada una conserva su contrato:

| Superficie | Actor y autenticación | Uso |
| --- | --- | --- |
| `/interbank/v1/*` | Banco participante; `X-Api-Key` y `traceparent` W3C. Salud sin clave. | Contrato oficial entre bancos. |
| `/api/interbank/transfers` | JWT del cliente. Enviar: sólo `CLIENTE`, desde cuenta propia. Listar/consultar: cliente propio, cajero/administrador todos. | Producto del frontend, UUID y centavos internos. |
| `/api/interbank/deposits`, `/api/interbank/callbacks` | Bearer provisional `INTERBANK_PARTNER_TOKEN` cuando se configure. | Compatibilidad histórica T-46/T-47. No es la API para integrar a la pareja. |

La API oficial está fuera de `gateway.v1.yaml` deliberadamente: tiene su especificación propia. Gateway verifica formato, identidad de banco y cabeceras y traduce HTTP ↔ RabbitMQ; Payment decide admisión, estado y protocolo. Account es el único escritor de saldos. No hay HTTP entre servicios propios ni bases compartidas entre servicios ([ADR-019](../architecture/adr/ADR-019-payment-http-egress.md)).

### Operaciones oficiales

Prefijo `/interbank/v1`. Son siete operaciones protegidas y una sonda pública:

| Método y ruta | Respuesta principal | Qué demuestra |
| --- | --- | --- |
| `GET /health` | `200`, `UP`, `bankCode` | Responde el controlador; no sustituye `/ready` ni demuestra broker/DB disponibles. |
| `POST /transfers` | `202 PROCESSING` nuevo; `200` repetición idéntica; `409` conflicto | Admisión persistida, todavía sin afirmar crédito. |
| `GET /transfers/{id}` | `200` estado; `404` desconocido/no visible | Estado del lado receptor. |
| `POST /transfers/{id}/cancel` | `200 CANCELLED`, `ALREADY_ACCEPTED` o `ALREADY_REJECTED` | Si ya se puede liberar la reserva. |
| `POST /transfers/{id}/result` | `200`, `received: true` | Callback recibido por el emisor y publicado al broker. No asegura que toda la Saga ya cerró. |
| `POST /reversals` | `202`, estado del reverso | Solicitud de devolución extraordinaria. |
| `GET /reversals/{id}` | `200` estado o `404` | Reverso `PROCESSING`, `COMPLETED` o `FAILED`; completado identifica `refundTransferId`. |
| `GET /reconciliation?date=YYYY-MM-DD` | `200`, página | Registro diario UTC por banco; página 1 y tamaño 100 por defecto, máximo 500. |

Las consultas al servicio pasan por request/reply con techo de cinco segundos; no se mantiene HTTP abierto esperando el crédito remoto. Formato inválido da `400`, clave ausente/incorrecta `401`, depósito vencido al llegar `422` y dependencia no disponible `503`. La identidad del banco sale de la clave, nunca de confiar en `originBankCode` del cuerpo. Si un crédito ya está en vuelo al pedir cancelación, la respuesta interna `IN_PROGRESS` se traduce a `503`: decir `CANCELLED` antes de la respuesta de Account liberaría dinero que podría estar acreditándose.

## Cuerpo, límites y claves

Ejemplo ilustrativo; en una ejecución real generar `createdAt` UTC y `expiresAt` exactamente 180 s después. El ejemplo caduca y no es un comando de prueba:

```json
{
  "interbankTransferId": "11111111-1111-4111-8111-111111111111",
  "originBankCode": "BANK99",
  "destinationBankCode": "BANK02",
  "originAccount": "99-000000001",
  "destinationAccount": "02-000000001",
  "amount": "125.00",
  "currency": "GTQ",
  "description": "Depósito de prueba",
  "createdAt": "2026-10-21T18:00:00.000Z",
  "expiresAt": "2026-10-21T18:03:00.000Z"
}
```

- `Idempotency-Key` debe ser idéntica a `interbankTransferId`, un UUID v4. Igual ID y contenido devuelve estado sin segundo crédito; contenido distinto da `409`.
- `amount` es **texto decimal con dos cifras**, de Q0.01 a Q10,000.00. Se convierte a centavos por cadenas/enteros; no se redondea. `NUMERIC(14,2)` y `BIGINT` conservan exactitud al persistir.
- `INTERBANK_MAX_AMOUNT_MINOR` vale 1,000,000 centavos por defecto; puede bajarse y no elevarse sobre el contrato. Se aplica al recibir y enviar. Exceso sintácticamente válido entrante se rechaza por callback con `AMOUNT_LIMIT_EXCEEDED`; el producto de envío lo rechaza antes del débito.
- Moneda `GTQ`; códigos `BANKNN`. Nuestro código es `BANK02`; `BANK99` es el mock, no evidencia de pareja externa integrada.
- La cuenta pública sigue `[A-Za-z0-9-]{1,34}`. Account genera `02-NNNNNNNNN` mediante secuencia; el UUID sigue siendo identidad interna y no cabe en los 34 caracteres del contrato.
- El mensaje entre bancos contiene números de cuenta, no nombre, DPI, correo, credenciales ni UUID de cliente. No poner claves ni montos en etiquetas de telemetría.

Motivos públicos: `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `AMOUNT_LIMIT_EXCEEDED`, `CURRENCY_NOT_SUPPORTED`, `EXPIRED`, `CANCELLED`, `PROCESSING_ERROR`. Los nombres internos provisionales se traducen en el borde; no deben copiarse como enum público.

## Depósito recibido: decisión y callback

```text
ELIGIBILITY ──elegible──> CREDIT ──acreditado──> ACCEPTED
     │                     └──rechazo────────> REJECTED
     ├──inelegible / vence────────────────────> REJECTED
     └──cancelación segura────────────────────> CANCELLED
```

`ELIGIBILITY` pregunta a Account por broker; `CREDIT` significa orden enviada, aún sin confirmación. Sólo Account revalida la cuenta activa bajo bloqueo y acredita con claves únicas. La vigencia se decide en Payment antes de ordenar el crédito. Una cuenta inactiva **no se reactiva** mediante depósito interbancario, a diferencia del crédito ordinario. El contrato prohíbe acreditar después de `expiresAt`. La llegada HTTP ya vencida se rechaza y el barrido de Payment expira solicitudes aún cancelables. **Límite detectado por T-61:** la orden interna de crédito no lleva `expiresAt` y Account no verifica ese plazo al aplicar el saldo. En `CREDIT` ya no se puede retirar la orden. Una entrega AMQP muy retrasada podría acreditar después del vencimiento; verificar y corregir este extremo requiere trabajo de código en #167, no una afirmación documental de cumplimiento.

En la API, `ELIGIBILITY`/`CREDIT` se proyectan a `PROCESSING`. `ACCEPTED`, `REJECTED` y `CANCELLED` son finales de recepción. Cancelar un ID desconocido deja una constancia durable que impide acreditar una llegada posterior del mensaje original. Una cancelación con crédito pendiente espera la decisión de Account, con `503` hacia el banco que consulta.

La decisión, su evento y su callback tienen persistencia separada: `result_envelope`, `result_published_at`, `callback_attempts`, `callback_due_at` y `callback_delivered_at`. La URL se deriva de `INTERBANK_PARTNER_BASE_URL` + `/transfers/{id}/result`; nunca se acepta una URL arbitraria del cuerpo. El callback lleva `ACCEPTED` o `REJECTED` y el motivo oficial, con `X-Api-Key` y el contexto W3C original. Falla de red/HTTP no cambia un crédito ya aplicado; se reintenta con espera creciente. El barrido abandona callbacks pendientes después de 24 h desde la decisión y emite ERROR `callbackAbandoned`; no modifica el crédito. Ese plazo no es el TTL de 180 s del depósito.

## Depósito enviado: la Saga y la reserva

El cliente pide `POST /api/interbank/transfers` con JWT e `Idempotency-Key`; Gateway obtiene por broker el número de su cuenta origen y deriva identificadores estables. Transaction abre la Saga habitual: KYC → débito → `payment.requested.v1` con bloque `interbank`. El destino interno es la cuenta institucional de **liquidación interbancaria**, no la cuenta remota.

Payment persiste `PENDING`, envía HTTP al banco configurado y recibe `202` (o `200` por solicitud repetida): `SENT`. No hay un segundo débito HTTP ni un acceso de Payment a tablas de Account. `ACCEPTED` publica `payment.succeeded.v1` para completar la Saga y acreditar liquidación. `REJECTED` publica `payment.failed.v1` para compensar el débito, incluida la comisión de ahorro; sólo la confirmación de la compensación escribe `REVERSED`.

| Estado del envío | Reserva y siguiente paso |
| --- | --- |
| `PENDING` | Débito de la Saga aplicado; se intenta entregar. Una respuesta HTTP perdida no prueba que el receptor no lo tenga. |
| `SENT` | Acuse recibido; falta decisión. |
| `ACCEPTED` | Decisión favorable; se completa la Saga y su liquidación. |
| `TIMEOUT` | Vencieron 180 s y **el dinero sigue reservado**. Consultar/cancelar; no publicar fallo todavía. |
| `REJECTED` | Rechazo definitivo o liberación autorizada por protocolo; compensación solicitada. |
| `REVERSED` | Account confirmó devolución al origen. No significa que un reverso remoto ya se haya liquidado. |

El callback es legal desde `PENDING` (carrera de banco rápido), `SENT` y `TIMEOUT` mientras no se haya liberado. Un `ACCEPTED` repetido no mueve dinero. Los estados de depósito, Saga y reverso tienen significados distintos y se consultan por separado. La interfaz lista/detalla el depósito en `/api/interbank/transfers`, con destino enmascarado e historial; la pantalla general de Saga no reemplaza esa vista.

### Timeout sin duplicar dinero

1. `expiresAt = createdAt + 180 s`; al vencer pasa a `TIMEOUT`, sin liquidar ni compensar.
2. Consultar `GET /transfers/{id}`. `ACCEPTED` confirma; `REJECTED`/`CANCELLED` permiten devolver. `404` o `PROCESSING` requieren cancelar, **no liberar directamente**.
3. Reintentar consultas inaccesibles (tres antes de avanzar a cancelación por defecto). `POST /transfers/{id}/cancel`: `ALREADY_ACCEPTED` confirma, `CANCELLED`/`ALREADY_REJECTED` liberan.
4. Si no hay respuesta útil, reintentar cancelación con espera creciente (base 5 s, techo 60 s); la columna `resolve_not_before` conserva la cadencia al reprogramar un pod.
5. Sólo después de `release_not_before = expiresAt + 300 s`, y tras al menos un intento de cancelar, liberar sin verificación y emitir ERROR (`RELEASED_NO_ANSWER` o `RELEASED_UNKNOWN_AT_PARTNER`). El margen no retrasa una respuesta definitiva del receptor.

Son ocho minutos de retención **más** latencia del barrido/red si el receptor queda inaccesible, no una garantía de liberación exactamente a los 480 s. `INTERBANK_CONFIRMATION_TIMEOUT_MS` sigue admitida por compatibilidad pero no se lee para estos plazos. La decisión pura vive en `interbank-timeout.ts`; los hechos y fechas se persisten en `interbank_sends`.

### Aceptación tardía, reverso y reembolso

Un `ACCEPTED` posterior a `REJECTED`/`REVERSED` indica posible dinero devuelto aquí y acreditado allá: ERROR `LATE_ACCEPT_AFTER_RELEASE`. Se persiste un reverso saliente y el barrido pide `POST /reversals`, consulta su estado cada 5 s y reintenta fallos con espera creciente, techo 300 s y límite 120 intentos. Si no concluye se requiere intervención; no se cambia un estado a mano para ocultarlo.

El receptor del reverso registra `interbank_reversals`, debita la cuenta acreditada y devuelve mediante **un depósito nuevo**; `COMPLETED` requiere el identificador de ese depósito. Si nosotros ya compensamos al cliente, ese reembolso se dirige a **liquidación**, sin acreditar otra vez al cliente. Un depósito coincidente que llega antes de conocerse `refundTransferId` se retiene hasta resolver el reverso; coincidencia por monto sin identificador genera ERROR. `refund_inbound_id` único y `refund_settled_at` impiden aplicar la misma devolución dos veces. Si la retención vence sin poder resolverla, se rechaza con `EXPIRED`.

El veredicto del envío y `outbox_messages` se escriben en la misma transacción (TD-093). `verdict_enqueued_at` permite recuperar decisiones históricas sin outbox; `TIMEOUT` y `REVERSED` no se reconcilian como un nuevo fallo. `claimed_until` y reclamos con bloqueo coordinan barridos de varias réplicas.

## Mensajes y límites entre servicios

| Conversación | Flujo |
| --- | --- |
| `payment.interbank.v1.transfer.query/replied.v1` | Gateway ↔ Payment: admisión, repetición o conflicto. |
| `payment.interbank.v1.status.query/replied.v1` | Gateway ↔ Payment: estado por banco. |
| `payment.interbank.v1.cancel.query/replied.v1` | Gateway ↔ Payment: cancelación segura. |
| `payment.interbank.v1.result.received.v1` | Gateway → Payment: callback del banco receptor. |
| `payment.interbank.v1.reversal.requested/replied.v1`, `reversal.query.v1` | Gateway ↔ Payment: abrir/consultar devolución. |
| `payment.interbank.v1.reconciliation.query/replied.v1` | Gateway ↔ Payment: página diaria UTC. |
| `account.interbank.eligibility.query/replied.v1` | Payment ↔ Account por broker: existencia/estado. |
| `account.interbank.credit.requested.v1`, `credited.v1`, `credit.rejected.v1` | Payment → Account → Payment/auditoría: crédito exacto. |
| `payment.succeeded.v1`, `payment.failed.v1` | Payment → Transaction/auditoría: decisión para la Saga. |
| `account.debit.compensated.v1` | Account → Transaction y Payment: constancia de devolución. |
| `payment.interbank.sent.v1` | Payment → auditoría: estado observable del envío. |

La notación `query/replied` abrevia dos nombres y no es una routing key literal. Los nombres y categorías exactos están en [message-catalog](../domain/message-catalog.md); los payloads de extensiones no cubiertos por el generador se consultan en `apps/packages/contracts/src/events/interbank/`. La cola durable `payment.interbank` consume respuestas/eventos de Account y la compensación; `payment.commands` consume comandos `payment.#`.

## Configuración y operación

| Variable | Componente | Uso |
| --- | --- | --- |
| `INTERBANK_BANK_CODE` | Gateway/Payment/mock | Código propio; `BANK02` en banco. |
| `INTERBANK_PARTNER_BANK_CODE` | Gateway/Payment/mock | Banco participante configurado; `BANK99` identifica mock. |
| `INTERBANK_PARTNER_BASE_URL` | Payment | Base completa terminada en `/interbank/v1`; de ahí derivan todas las rutas. |
| `INTERBANK_API_KEY_INBOUND` | Gateway | Secreto exigido al banco que llama; nunca publicarlo. |
| `INTERBANK_API_KEY_OUTBOUND` | Payment | Secreto entregado por la pareja; independiente del entrante. |
| `INTERBANK_MAX_AMOUNT_MINOR` | Gateway/Payment | Límite común configurable hacia abajo, máximo 1,000,000 centavos. |
| `INTERBANK_RESOLVE_RETRY_MS` | Payment | Base local de reintento de resolución; 5,000 ms por defecto. |
| `INTERBANK_CONFIRMATION_TIMEOUT_MS` | Payment | Obsoleta; aceptada pero no decide TTL ni margen. |

El chart `bank-usac` suministra configuración y referencias a Secret. El checksum del Secret rueda los seis componentes que lo consumen; `web` consume ConfigMap. Verificar el rollout tras rotar claves y ambas direcciones de autenticación. El envío queda desactivado si la base de pareja está vacía; no usar ese entorno como evidencia de integración bancaria. Una base presente con clave saliente vacía se registra como ERROR.

El mock es opcional: `apps/partner-bank-mock`, puerto 3021, `pnpm partner:mock` o perfil `interbank` de Compose. El chart también puede desplegarlo. **Disponible en el chart no significa desplegado en cada namespace**: contrastar el inventario del entorno antes de carga. Mock en memoria no sustituye una conciliación con el banco real. Modos `ACCEPT`, `REJECT`, `TIMEOUT`, `SLOW` y configuración de demoras se reservan para pruebas controladas.

El contrato exige HTTPS. Las URLs públicas de Gateway facilitadas para esta revisión usan HTTP; por ello la publicación observada no demuestra cumplimiento de transporte seguro. Configurar autenticación no cifra el canal. El acuerdo y la evidencia deben conservar esa divergencia hasta verificar TLS en la URL que utilice la pareja.

## Investigación y verificación

1. Correlacionar `transactionId`, `interbankTransferId`, `correlationId` y `traceId` sin confundir deduplicación con trazabilidad. Consultar el detalle del depósito antes de interpretar el estado de Saga.
2. En la base de **Payment**, inspeccionar sólo lectura: estado, `confirmation_due_at`, `release_not_before`, sondeo/cancelación, outbox, historial, reverso y reembolso. Account se consulta por su interfaz; Payment no tiene acceso SQL a sus datos.
3. Logs: `LATE_ACCEPT_AFTER_RELEASE`, `RELEASED_NO_ANSWER`, `RELEASED_UNKNOWN_AT_PARTNER`, `CALLBACK_FROM_NON_PARTICIPANT`, fallos de barrido y reembolso retenido. Ver [runbook interbancario](runbooks/partner-bank.md).
4. Métricas: `bank.interbank.deposits{result=accepted|rejected}`, `bank.interbank.callbacks{result=delivered|failed}`, `bank.interbank.sent{result=accepted|rejected|timeout}`. Los identificadores van a logs/spans, no etiquetas. `timeout` se cuenta una vez al vencer; si después se resuelve no vuelve a crecer el denominador. El histograma de confirmación excluye timeout y mide decisiones remotas a tiempo, no todo el protocolo de recuperación.
5. Comprobar con bases de prueba separadas: duplicado/conflicto, cuenta inexistente/inactiva, mínimo/máximo, expiración, callback rápido/tardío/repetido, cancelación con crédito en vuelo, caída entre decisión y publicación, sondeo/cancelación, margen, reinicio, dos réplicas y reverso/reembolso sin doble crédito.

Las suites `*.integration.spec.ts` necesitan PostgreSQL real y pueden hacer `TRUNCATE`; no apuntarlas a bases de una aplicación en uso. Un resultado `skipped` no verifica locks, outbox ni unicidad. Las evidencias históricas T-46/T-47/T-56 se conservan como historia; el estado implementado T-60 se contrasta con sus pruebas y [el esquema físico acumulado](../generated/db-schema.md).
