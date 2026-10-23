# ADR-021: Traducir el contrato interbancario v1 a la Saga existente y conservar la reserva durante TIMEOUT

- **Estado:** Registro de decisiones ya implementadas en T-56/T-60; sin nueva decisión de negocio ni aprobación de equipo inferida por T-61.
- **Fecha del registro:** 2026-10-21.
- **Referencias:** T-46, T-47, T-56, T-60 (#167), T-61 (#168); [OpenAPI oficial v1.0.0](../../references/interbank-contract-v1.openapi.yaml); [acuerdo compartido](../../operations/INTERBANK-AGREEMENT.md).
- **Relación:** complementa [ADR-009](ADR-009-distributed-transactions.md) y [ADR-019](ADR-019-payment-http-egress.md). Sustituye las descripciones operativas provisionales de Bearer, UUID externo y compensación directa a los 30 s, no la regla de aislamiento de esos ADR.

## Contexto

Cada banco actúa como emisor y receptor. El contrato del curso impone depósito asíncrono `202` + callback, idempotencia, número de cuenta de hasta 34 caracteres, importe decimal como cadena, claves API, trazabilidad y plazos comunes. Una respuesta perdida no prueba que no se acreditó: liberar dinero antes de consultar/cancelar puede dejar al cliente reembolsado mientras el receptor ya pagó.

Account es el único escritor de saldos; Transaction decide la Saga; Payment decide el proveedor externo. Gateway no tiene base ni máquina de estados. La implementación debía cumplir el contrato externo sin duplicar la Saga ni crear relaciones SQL entre servicios.

## Decisión implementada

1. **Mantener intacto el OpenAPI oficial y adaptar el borde.** `/interbank/v1` expone siete operaciones protegidas y salud pública; usa `X-Api-Key`, `traceparent` y `Idempotency-Key = interbankTransferId`. La API del cliente bajo `/api/interbank/transfers` mantiene JWT, UUID interno y centavos. Las rutas provisionales de compatibilidad no son el contrato de la pareja.
2. **Hacer del envío un pago de la Saga existente.** Gateway deriva identificadores estables de la clave, Account resuelve el número público y valida propiedad. El cliente únicamente puede enviar desde cuenta propia. El destino interno es liquidación interbancaria; KYC, débito, comisión, compensación, historial y notificación se reutilizan. Payment produce `payment.succeeded.v1` o `payment.failed.v1`; no modifica un saldo.
3. **Usar tres vocabularios explícitos.** Saga: seis estados originales. Envío: PENDING/SENT/ACCEPTED/REJECTED/TIMEOUT/REVERSED. Recepción: ELIGIBILITY/CREDIT/ACCEPTED/REJECTED/CANCELLED, proyectados a los cuatro estados públicos. Un reverso remoto tiene PROCESSING/COMPLETED/FAILED y un PENDING local al solicitarlo. Un estado de protocolo no se confunde con el apunte monetario.
4. **Conservar la reserva al vencer.** TTL fijo 180 s; TIMEOUT no genera fallo. Consultar al receptor, cancelar ante 404/PROCESSING, confirmar si ya acreditó y devolver si hay rechazo/cancelación. Si nadie responde, sólo liberar después de expiresAt + 300 s y después de intentar cancelar; emitir ERROR por liberación sin verificar. La espera creciente es política local, el TTL/margen son contrato y no configurables. La respuesta definitiva manda sobre el margen.
5. **Persistir cada frontera de recuperación.** Fechas de vencimiento/resolución, hechos de sondeo/cancelación, contador, contexto de traza, reverso e historial son columnas. Veredicto del envío y outbox se guardan en la misma transacción; una marca distingue decisiones históricas que aún necesitan publicación. Reclamos con arrendamiento evitan dos barridos simultáneos y vencen tras caída de proceso. TIMEOUT/REVERSED no se reemiten como nuevos fallos.
6. **Reparar una aceptación posterior a liberación mediante reverso.** Registrar ERROR, persistir ID estable, pedir/consultar reverso y reintentar con límite. El receptor devuelve mediante un depósito nuevo. Si el cliente ya recibió compensación, la devolución se absorbe en liquidación. Mientras no se pueda identificar el depósito de devolución se retiene; no se acredita dos veces por inferir una coincidencia. El ID de reembolso y su marca de liquidación son únicos/coherentes.
7. **Confinar HTTP al adaptador externo.** Base configurada terminada en `/interbank/v1`, rutas derivadas, redirects rechazados, timeout y cabeceras comunes; sin URL del cuerpo. Claves entrante/saliente independientes y secretas. Número público `02-NNNNNNNNN`, GTQ y Q0.01–Q10,000.00; el límite configurable sólo baja el máximo. La continuidad W3C se conserva también al reanudar trabajo por barrido.

## Alternativas descartadas por la implementación

| Alternativa | Motivo |
| --- | --- |
| Cambiar el OpenAPI para adaptarlo al Bearer/UUID de T-46 | Rompe la condición de contrato compartido e impide interoperar con una implementación oficial. |
| Compensar al vencer 30 s o los 180 s | El receptor puede haber acreditado y estar reintentando el callback; crea dinero duplicado entre bancos. |
| Liberar ante 404 sin cancelar | No deja la constancia que debe bloquear una llegada posterior del depósito. |
| Mover la máquina al Gateway | Requiere estado y decisiones de pago donde no hay dominio ni base. |
| Una Saga paralela interbancaria | Duplica fondos, comisión, compensación, historial e idempotencia ya protegidos. |
| Acreditar un posible reembolso al cliente antes de identificarlo | El cliente ya está compensado; su dinero se pagaría dos veces. |
| Llamar a Account por HTTP o leer su tabla | Viola propiedad de datos y la comunicación interna por broker. |

## Consecuencias y límites verificables

El coste elegido es retener fondos hasta 180 + 300 s más latencia real de red/barrido y de recuperación; no se promete liberación exacta al segundo 480. El cliente ve el detalle del depósito separado de la Saga y el operador dispone de trazas, alertas e historial. Los callbacks del receptor se reintentan hasta 24 h desde la decisión; el abandono se registra en ERROR. Un mock no prueba integración con el banco pareja.

**HTTPS es un requisito del contrato, no una propiedad demostrada por la API key.** Las URLs públicas entregadas para la revisión usan HTTP; la divergencia sigue abierta hasta verificar TLS en la entrada utilizada por la pareja. Este registro no cambia endpoints ni infraestructura.

**Límite del crédito después de expiresAt detectado en T-61:** Gateway rechaza una solicitud ya vencida y Payment barre las solicitudes aún cancelables. Sin embargo, `account.interbank.credit.requested.v1` no contiene expiresAt, y `InterbankAccountUseCase.credit` aplica una orden recibida si la cuenta está activa e idempotencia lo permite. Una vez CREDIT, Payment no cancela una orden cuyo efecto todavía desconoce y devuelve 503 al cancelar. Por tanto, la implementación no demuestra atomicidad del requisito “ningún crédito posterior a expiresAt” ante AMQP retrasado. Debe investigarse/probarse/corregirse en #167; una fuente o un diagrama no pueden declarar resuelta esta carrera.

El generador documental tampoco cubre el catálogo completo: 48 flujos contractuales de 134 contratos, aunque los tipos ejecutables sí están registrados. T-61 deriva los inventarios de las fuentes actuales y deja pendiente reparar el generador versionado sin cambiar código de producto.

**Evidencia técnica para revisar:** contratos en `apps/packages/contracts/src/events/interbank/`; funciones puras `interbank-send.ts`, `interbank-timeout.ts`, `interbank-receipt.ts`, `interbank-refund.ts`; casos de uso y repositorios de Payment; `interbank-account.use-case.ts`; migraciones Account 010 y Payment 012–018. Las suites de protocolo, flujo, repositorio, reverso y refund describen la cobertura; un resultado local sin PostgreSQL no demuestra sus propiedades transaccionales. Véanse [operación](../../operations/INTERBANK.md) y [esquema acumulado](../../generated/db-schema.md).
