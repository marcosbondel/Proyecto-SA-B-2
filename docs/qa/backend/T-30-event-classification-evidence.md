# T-30 — Evidencia: clasificación de eventos, notificaciones inteligentes e historial de auditoría (Notification & Audit Service)

Registro manual, no regenerado por un script — mismo formato que
[`T-29-payment-provider-evidence.md`](T-29-payment-provider-evidence.md): salida real de los
comandos de validación que pide `T-30.md` (`pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:contract`), capturada el día de la implementación.

**Fecha**: 2026-09-11/12. **Rama**: `feature/T-30`. **Alcance tocado**:
`apps/services/notification-audit-service`, `apps/packages/contracts`, `apps/gateway`,
`apps/web`, `docs/`.

## Qué pedía el enunciado

Sección 4.1 (p. 5), literal:

> Notification & Audit Service — Nueva funcionalidad: Notificaciones inteligentes y
> auditoría extendida. El sistema deberá clasificar y registrar eventos con mayor detalle.
> Capacidades: Clasificar eventos (INFO / WARNING / ERROR); Generar notificaciones según
> tipo; Almacenar historial de eventos.

Nueve líneas y ninguna regla: no define qué evento cae en qué severidad, ni un nombre de
campo. Esa taxonomía es la decisión de este ticket, documentada en
`src/domain/classification.ts`.

## Qué ya existía y qué agregó este ticket

Ver la tabla completa en
[`docs/process/implementations.md`](../../process/implementations.md#t-30--clasificación-de-eventos-notificaciones-inteligentes-e-historial-de-auditoría-notification--audit-service).
Resumen: no existía ninguna noción de severidad en ninguna capa. Este ticket agrega una
función de clasificación pura (`classify()`), una columna nullable sin backfill en dos
tablas, campos aditivos y opcionales en cinco contratos, y las tres pantallas donde la
severidad se hace visible — sin agregar contratos nuevos ni tocar el catálogo de 101
mensajes.

## Comandos de validación

### `pnpm lint` (raíz)

```
$ turbo run lint
   • Packages in scope: @bank/contracts, @bank/messaging, @bank/tooling, account-service,
     customer-service, gateway, notification-audit-service, payment-service,
     transaction-service, web
   • Running lint in 10 packages

 Tasks:    11 successful, 11 total
Cached:    2 cached, 11 total
```

### `pnpm typecheck` (raíz)

```
$ turbo run typecheck
 Tasks:    11 successful, 11 total
Cached:    2 cached, 11 total
```

(El único `WARN` que imprime `web:typecheck` — "Duplicated imports `AcceptedCommand`" — es
preexistente, entre `useCommandOutcome.ts` y `useCustomerOutcome.ts`, y no lo toca este
ticket, como ya confirmaron T-28 y T-29.)

### `pnpm build` (raíz)

```
 Tasks:    9 successful, 9 total
Cached:    2 cached, 9 total
```

### `pnpm test` (raíz)

```
$ turbo run test
 Tasks:    11 successful, 11 total
```

Por paquete, relevante a este ticket:

```
notification-audit-service:test:
  Test Suites: 1 skipped, 8 passed, 8 of 9 total
  Tests:       12 skipped, 127 passed, 139 total
  (el skip es repository.integration.spec.ts, que requiere DATABASE_URL — ver abajo)

@bank/contracts:test:
  Test Suites: 16 passed, 16 total
  Tests:       763 passed, 763 total

gateway:test:
  Test Suites: 26 passed, 26 total
  Tests:       317 passed, 317 total
  (incluye dos casos nuevos en queries-reply.spec.ts: el filtro severity pasado al
   caso de uso, y su validación 400 contra un valor fuera del enum)

web:test (node --test sobre app/lib/):
  tests 269
  pass 269
  fail 0
  (incluye el describe "§4.1 classification (T-30)" en audit.test.mjs)
```

Los otros tres servicios (`account-service`, `customer-service`, `transaction-service`,
`payment-service`) también en verde — no tocados por este ticket, corridos para confirmar
que nada se rompió.

### `pnpm test:contract`

```
@bank/contracts:test:
  Test Suites: 16 passed, 16 total
  Tests:       763 passed, 763 total
```

`catalog-completeness.spec.ts` sigue en 101 mensajes exactos: los cinco campos nuevos
(`severity` en cuatro replies, `infoToday`/`warningToday`/`errorToday` en el quinto) son
adiciones a esquemas existentes, no contratos nuevos.

### Pruebas contra PostgreSQL real

Con la infraestructura levantada (`pnpm dev:infra`) y `postgres-notification-audit` sano en
`localhost:5437`:

```bash
DATABASE_URL="postgresql://notification_audit_app:changeme@localhost:5437/notification_audit" \
  pnpm turbo run test --filter=notification-audit-service --force
```

```
notification-audit-service:test:
  Test Suites: 9 passed, 9 total
  Tests:       139 passed, 139 total
```

Los 12 que se saltan sin `DATABASE_URL` (`repository.integration.spec.ts`, describe
`§4.1 classification, persisted`) cubren, contra la base real:

- la severidad computada para un evento y para su notificación se persiste tal cual;
- el `CHECK (severity IS NULL OR severity IN ('INFO','WARNING','ERROR'))` rechaza al nivel
  de la base de datos un `INSERT` con un valor fuera del enum, sin depender de que ninguna
  capa de aplicación lo haya validado antes;
- `listRecentEvents({ severity })` narrows correctamente sin afectar `total`;
- una fila insertada sin la columna (simulando una fila anterior a esta migración) se lee
  como `severity: null`, nunca como una severidad inventada.

La migración `005_event_severity` se aplicó sin fricción sobre el esquema existente — sin
`DEFAULT`, sin backfill, confirmando que las cuatro migraciones previas (`001`–`004`)
seguían corriendo limpio antes de esta.

## Trazabilidad contra el enunciado y el ticket

| Pide `T-30.md` | Dónde queda cumplido |
| --- | --- |
| Clasificación determinista y documentada | `classify()` en `domain/classification.ts`, con la precedencia y la tabla completa documentadas en el propio archivo |
| Cada evento procesable recibe exactamente una clasificación | `domain.spec.ts`: los 36 eventos de `category:'event'` del catálogo real de `@bank/contracts` reciben exactamente una de `INFO`/`WARNING`/`ERROR` |
| Las reglas cubren INFO, WARNING y ERROR | `domain.spec.ts`, "covers all three severities across the real catalogue" |
| Registrar cada evento con su severidad y estado | Migración `005_event_severity`; `postgres-audit.repository.ts` escribe `severity` en el mismo `INSERT` que ya escribía `processing_status`, sin un segundo `INSERT` (`isolation.spec.ts` lo sigue exigiendo) |
| Las notificaciones corresponden a la severidad y resultado del evento | `NotificationIntent.severity`, derivada de `classify()` — nunca escrita a mano en `POLICY`, así que no puede discrepar de la del evento que la causó |
| El historial conserva el evento y su clasificación | `trailFor`, `listRecentEvents`, `notificationsFor`, `listNotifications`, `inboxOf` devuelven `severity` |
| Mantener redacción de datos sensibles | `classify()` nunca lee el payload — sólo `messageType` y `processingStatus` — precisamente para que la clasificación sea re-derivable desde una fila ya redactada; `isolation.spec.ts` sigue exigiendo un único `redactPayload(` en el `INSERT` |
| Procesar duplicados de forma idempotente | Sin cambios en la deduplicación por `(event_id, consumer)`; `use-cases.spec.ts` confirma que un duplicado no produce segunda notificación ni segunda fila, con severidad incluida |
| Propagar correlationId | Sin cambios — la severidad viaja junto al resto de la fila, nunca en lugar de `correlationId` |
| Registrar errores de procesamiento como eventos claros | El drenaje de `bank.errors` en `main.ts` (ya existente desde T-20) ahora clasifica cada mensaje aparcado como `ERROR` vía `classify({ ..., parked: true })`; ningún camino nuevo de manejo de excepciones en `RecordEventUseCase` |
| No introducir lógica de negocio de otros servicios | `classify()` no importa `@bank/*` (dominio puro); `test/isolation.spec.ts` sin cambios en sus reglas de aislamiento — todas siguen pasando |
| Tests de dominio, casos de uso, handlers, redacción, deduplicación y notificaciones | `domain.spec.ts` (dominio y redacción — sin cambios en las pruebas de redacción, que siguen pasando), `use-cases.spec.ts` (casos de uso y deduplicación), `inbound-message.handler.spec.ts` (handlers, ampliado con el camino `ERROR`/`WARNING`/`INFO`), `simulated-notification.spec.ts` (notificaciones, ampliado con el log `warn` en `ERROR`) |

## Decisiones que se registran aquí porque no eran obvias

- **`transaction.failed.v1` es `WARNING`, no `ERROR`.** El dinero nunca salió; es un rechazo
  de negocio como cualquier `*.rejected`. Lo que sí es `ERROR` es
  `transaction.compensated.v1`: el dinero salió y tuvo que volver, que es la clase de evento
  que un operador del banco necesita ver.
- **`account.deactivated.v1` es `INFO`.** Lo produce el barrido nocturno automático haciendo
  exactamente lo que se le pidió; clasificarlo como advertencia habría llenado el filtro de
  severidad de ruido previsible cada noche.
- **La columna es nullable y sin `DEFAULT`, no `NOT NULL DEFAULT 'INFO'`.** Un valor por
  defecto habría afirmado, sobre cada fila registrada antes de T-30, una clasificación que
  nadie calculó — incluidas compensaciones que hoy leerían como si nada hubiera pasado. La
  tabla de auditoría es append-only por diseño (`migrations.ts` lo declara desde T-20);
  rellenar la columna con un `UPDATE` habría violado esa garantía. `NULL` en una fila
  antigua es el dato honesto, y así se muestra en las tres pantallas (`—`, nunca una
  severidad inventada).
- **No se agregó ningún manejo de errores nuevo en `RecordEventUseCase`.** La lectura
  literal del criterio invitaría a envolver el caso de uso en un `try`/`catch` que
  reescribiera el estado como `ERROR`. No se hizo: si `record()` ya tuvo éxito y falla
  después (`settleNotification`), un reintento de escritura con `'ERROR'` chocaría con el
  `ON CONFLICT (event_id, consumer) DO NOTHING` — no escribiría nada y se tragaría el
  fallo, dejando el rastro en `PROCESSED`. El camino que ya existía (relanzar, dejar que el
  broker reintente, y que el drenaje de `bank.errors` registre lo que se agotó) cierra el
  criterio sin ese riesgo.
- **`GET /api/audit/recent` valida `severity` contra el enum en el borde**, igual que otras
  rutas de este controlador validan `correlationId`: un valor fuera de `INFO`/`WARNING`/
  `ERROR` responde `400` sin llegar a publicar nada al broker.
- **Los tres contadores del día en `/auditoria` reutilizan `GET /api/dashboard`** en vez de
  una ruta nueva: es el único endpoint que ya compone `audit.stats.query.v1`, y ningún otro
  conteo de este sistema tiene una ruta propia — introducir una para tres números habría
  sido la primera excepción a ese patrón.

## Lo que esta evidencia no cubre

No se verificó en vivo contra un navegador en esta sesión — la verificación manual la hace
el responsable del proyecto por separado, según lo acordado antes de empezar. Los pasos
para esa verificación están en la sección "Qué probar en la web" de
`docs/process/implementations.md`. Cualquier defecto que esa prueba revele se documentará
como una fila nueva de `docs/TECH_DEBT.md`, siguiendo el mismo criterio que T-28 y T-29.
