# Guía de pruebas de Fase 2 — qué se pidió, cómo se cubrió, qué probar en la web

Este documento existe para quien pruebe el sistema **después** de que los tickets de
Fase 2 estén cerrados, sin haber participado en su implementación. No repite la
evidencia técnica — cada ticket ya tiene su propio registro en
[`docs/qa/backend/`](../qa/backend/) con la salida real de `pnpm lint` / `pnpm typecheck`
/ `pnpm test` — este documento responde una pregunta distinta: **¿qué debo hacer en el
navegador para comprobar que cada requisito del enunciado quedó cubierto?**

Cada sección cubre un ticket: qué pedía el enunciado, qué decisión de diseño se tomó
para cubrirlo, y los pasos concretos en la interfaz. Cuando un ticket no tiene
superficie visible en la web —ocurre con uno de los tres—, este documento lo dice de
frente en vez de inventar una pantalla que no existe.

## Antes de empezar

1. Levanta el stack completo: `pnpm dev` desde la raíz del repositorio (requiere
   Docker). La primera vez tarda varios minutos en construir las imágenes; las
   siguientes son casi inmediatas.
2. Confirma que todo quedó sano: `docker compose -f infra/docker/docker-compose.dev.yml
   ps -a` — los siete contenedores de aplicación y las cinco bases de datos deben
   decir `healthy`.
3. Abre `http://localhost:3010`. El Gateway responde en `http://localhost:3000/health`.
4. Usuarios de demostración ya sembrados (`SEED_DEMO_DATA=true` por defecto):

   | Rol | Correo | Contraseña |
   | --- | --- | --- |
   | Cliente | `cliente@bankusac.gt` | `BankUsac#2026` |
   | Cajero receptor | `cajero@bankusac.gt` | `BankUsac#2026` |
   | Administrador | `admin@bankusac.gt` | `BankUsac#2026` |

5. Si algo no levanta, revisa primero `docker compose ... logs <servicio>` antes de
   asumir que el código está roto — la causa más común en Windows es un problema de
   entorno (ver la nota sobre `.gitattributes` al final de este documento), no una
   regresión de la implementación.

---

## T-26 — Gestión de estado KYC (Customer Service)

### Qué pedía el enunciado

Sección 4.1 (Customer Service, p. 4-5): el cliente debe manejar los estados
`PENDING`, `VERIFIED` y `REJECTED`, permitir actualizar el estado, y bloquear
transacciones de clientes no verificados.

### Cómo se cubrió

Se agregó `kycStatus` como campo aditivo en el agregado `Customer` —distinto de
`identityStatus`, que es la revisión de Fase 1 de la foto del documento—, con sus
tres estados, transiciones deterministas (`VERIFIED` es terminal) y el comando/eventos
para fijarlo (`customer.set-kyc-status.v1`, `customer.kyc.verified.v1`,
`customer.kyc.rejected.v1`). Detalle completo en
[`docs/qa/backend/T-26-kyc-evidence.md`](../qa/backend/T-26-kyc-evidence.md).

**Decisión de alcance, explícita en el propio ticket** (`Bloquea: T-31`): T-26 deja el
estado, las transiciones, la persistencia y los eventos listos — pero **no** aplica el
bloqueo real de transferencias de un cliente no verificado. Eso es trabajo de T-31, que
consumirá los eventos de KYC dentro del Saga de transferencias. Aplicar el bloqueo desde
T-26 habría violado la invariante X-7 (el Gateway no toma decisiones de dominio) y el
propio alcance que el ticket define.

### Qué probar en la web

**Nada, por ahora, y es lo esperado.** Ni el Gateway ni `apps/web` exponen `kycStatus`
en esta fase — no hay una ruta HTTP que lo devuelva ni un campo en ninguna pantalla de
`/clientes`. Una transferencia de un cliente con `kycStatus: PENDING` **se completa
igual que la de uno `VERIFIED`**: eso no es un defecto de T-26, es exactamente el
límite que el ticket fijó a propósito.

Lo que **sí** se puede verificar hoy, sin interfaz:

- La suite de pruebas del servicio: `pnpm --filter customer-service test` — incluye las
  transiciones válidas/inválidas y, contra PostgreSQL real
  (`DATABASE_URL=postgresql://customer_app:changeme@localhost:5433/customer`), la
  persistencia y la concurrencia optimista.
- El comando existe en el catálogo de mensajes (`docs/events/catalog.md`,
  `customer.set-kyc-status.v1`) y puede publicarse directo al broker con la consola de
  administración de RabbitMQ (`http://localhost:15672`, credenciales de
  `infra/docker/.env`) para confirmar que Customer Service lo procesa y emite el evento
  correspondiente — el mismo método que usó la verificación manual de T-27.

**Qué SÍ deberá poder probarse en la web una vez llegue T-31**: crear una transferencia
desde un cliente no verificado y ver que el sistema la rechaza con un motivo claro, en
vez de completarla en silencio.

---

## T-27 — Cuentas con reglas diferenciadas por tipo (Account Service)

### Qué pedía el enunciado

Sección 4.1 (Account Service, p. 5-6): crear cuentas de Ahorro y Corriente, definir
límite de saldo mínimo y comisión por transacción (opcional).

### Cómo se cubrió

Cada tipo carga su propia regla, fija en el dominio (`account-type-rules.ts`):

| Tipo | Saldo mínimo | Comisión por débito |
| --- | --- | --- |
| **Monetaria** (el "Corriente" del enunciado) | Ninguno — abre en Q0.00 | Ninguna |
| **Ahorro** | Q100.00, **solo como depósito de apertura** | Q3.00, en cada transferencia saliente |

Detalle completo, incluida una corrección registrada el mismo día de la
implementación tras una prueba en vivo en esta misma interfaz, en
[`docs/qa/backend/T-27-account-type-rules-evidence.md`](../qa/backend/T-27-account-type-rules-evidence.md).
Vale la pena leer esa corrección: el diseño original interpretó "saldo mínimo" como un
piso que se re-verificaba en cada transferencia, y la prueba manual en `/transferencias/nueva`
sobre una cuenta Ahorro mostró que ese no era el comportamiento correcto — el saldo
mínimo es un requisito **de apertura**, no algo que la cuenta deba mantener después. Una
cuenta Ahorro puede vaciarse a Q0.00 por transferencias normales, igual que Monetaria.

### Qué probar en la web

1. **Apertura de cuenta Monetaria** (`/cuentas/nueva`, accesible con cualquier rol — un
   cliente abre para sí mismo, staff elige a nombre de qué cliente): elige tipo
   **Monetaria** — no debe pedir depósito inicial, y la cuenta debe abrir en Q 0.00.
2. **Apertura de cuenta Ahorro**: elige tipo **Ahorro** — debe aparecer el campo de
   depósito inicial, con el mensaje *"La cuenta ahorro requiere un depósito de al
   menos..."*. Prueba:
   - Un monto **menor** a Q100.00 → debe rechazarse con el mensaje de mínimo, sin
     crear la cuenta.
   - Un monto de Q100.00 o más → debe abrir con ese saldo.
3. **Comisión por débito**: con la cuenta Ahorro ya fondeada, haz una transferencia
   saliente desde `/transferencias/nueva`. Confirma en el estado de cuenta (`/cuentas/{id}`)
   que se ven **dos movimientos**: el monto transferido y una comisión de Q3.00 aparte —
   no un solo movimiento por el total.
4. **Sin piso reforzado después de abrir**: transfiere desde la cuenta Ahorro hasta
   dejarla en Q0.00 (o cerca, considerando la comisión). La transferencia debe
   completarse — el sistema **no** debe rechazarla por quedar bajo Q100.00. Solo debe
   rechazar por fondos insuficientes de verdad (`INSUFFICIENT_FUNDS`), igual que
   Monetaria.
5. **Comisión ausente en Monetaria**: la misma prueba de transferencia saliente desde
   una cuenta Monetaria no debe generar ningún movimiento de comisión.

---

## T-28 — Historial completo y trazabilidad de transacciones (Transaction Service)

### Qué pedía el enunciado

Sección 4.1 (Transaction Service, p. 5-6): consultar historial por cuenta, filtrar por
fecha y por estado, y registrar los estados intermedios `PENDING`, `APPROVED`, `FAILED`.

### Cómo se cubrió

El historial y los filtros de cuenta/estado ya existían desde T-18 (cerraban TD-033);
T-28 agregó lo que faltaba:

- **Filtro por fecha** (`Desde`/`Hasta`, ambos extremos inclusivos).
- **`PENDING`/`APPROVED`/`FAILED`** del enunciado, cubiertos como una **proyección** de
  los seis estados reales de la Saga (`PENDING`, `DEBITING`, `PAYMENT_PENDING` →
  `PENDING`; `COMPLETED` → `APPROVED`; `FAILED`, `COMPENSATED` → `FAILED`) — nunca como
  estados nuevos, porque el propio ticket prohíbe crear estados que contradigan la
  máquina de la Saga.
- **Trazabilidad real**: una tabla nueva (`transaction_transitions`) registra cada
  transición que la transacción atravesó de verdad, con hora — no solo el estado
  actual.

Detalle completo en
[`docs/qa/backend/T-28-transaction-history-evidence.md`](../qa/backend/T-28-transaction-history-evidence.md),
incluida la corrección registrada tras correr por primera vez las pruebas de
concurrencia contra PostgreSQL real.

### Qué probar en la web

1. **Genera transferencias con distintos desenlaces**, desde `/transferencias/nueva`,
   usando el campo de escenario de pago (solo demostración):
   - `APPROVE` → termina **Completada**.
   - `REJECT` → termina **Fallida** (el débito se rechaza; el dinero nunca sale).
   - `TRANSIENT_FAILURE` → agota reintentos y termina **Compensada** (el dinero sale y
     vuelve — dos movimientos en el estado de cuenta).
2. **Filtro por estado**, en `/transferencias`: el selector ofrece las tres fases del
   enunciado ("En proceso" / "Aprobada" / "Fallida"). Verifica que cada una muestra
   solo lo que corresponde — una transferencia `Compensada` debe aparecer bajo
   "Fallida" (money out y de vuelta cuenta como no-aprobada, aunque el estado interno
   sea distinto de una simple rechazada).
3. **Filtro por fecha**: usa `Desde`/`Hasta` para acotar a un rango. Prueba un rango
   invertido (`Desde` posterior a `Hasta`) — debe mostrar un error claro junto al
   campo, no una lista vacía silenciosa.
4. **Combinación de filtros**: fecha + estado a la vez, y confirma que el resultado es
   la intersección de ambos, no la unión.
5. **Trazabilidad real**, en el detalle de cualquier transferencia
   (`/transferencias/{id}`): la línea de avance debe mostrar las transiciones reales
   con hora — no solo una proyección genérica del estado actual. En la compensada, debe
   verse el paso de compensación explicado.
6. **Alcance por rol**: inicia sesión como cliente y como administrador (o cajero) por
   separado.
   - El **cliente** solo debe ver sus propias transferencias en `/transferencias`,
     nunca las de otro cliente — ni siquiera manipulando los filtros.
   - El **administrador**/**cajero** debe ver todas, y además tiene
     `/transferencias/monitor` con contadores operativos (en vuelo, compensadas, débito
     sin cerrar). Ese monitor **no se actualiza solo** — hay que darle "Actualizar" o
     recargar para ver transferencias nuevas.
7. **Buscar una transferencia por su número de operación**, en la tarjeta *"Consultar
   una transferencia"* al final de `/transferencias` — disponible para **todos los
   roles**, cliente incluido. Prueba con:
   - Un número de operación propio → debe abrir el detalle.
   - Un número de operación de otra persona (cliente) → debe responder "no existe",
     nunca mostrar los datos de otra cuenta.

---

## T-29 — Simulación de proveedor externo de pagos (Payment Service)

### Qué pedía el enunciado

Sección 4.1 (Payment Service, p. 5-6): procesar pagos externos simulando éxito, fallo y
**timeout**, con reintentos acotados, idempotencia y sin doble cargo.

### Cómo se cubrió

Éxito y fallo ya existían desde T-19 (`APPROVE`/`REJECT`/`TRANSIENT_FAILURE`). Lo que
faltaba era el timeout como su propio resultado disparable: antes de T-29,
`TRANSIENT_FAILURE` describía a la vez "un timeout, un reset de conexión, un 503" — tres
causas distintas en un solo valor, así que un timeout no se podía ensayar por separado de
un fallo transitorio cualquiera.

T-29 separa el proveedor simulado (`callProvider`: responde `SUCCESS`/`FAILURE`/`TIMEOUT`,
sin reloj ni azar) de la política de reintentos (`decideAttempt`, sin cambios en su
escalera). `TIMEOUT` sube exactamente la misma escalera que `TRANSIENT_FAILURE` — 1 s, 5 s,
30 s, cuatro intentos — y se agota con el mismo código `PAYMENT_RETRIES_EXHAUSTED`; lo único
nuevo es que cada intento fallido ahora dice, en `providerResult`, si el proveedor respondió
que no o si simplemente no respondió.

Detalle completo en
[`docs/qa/backend/T-29-payment-provider-evidence.md`](../qa/backend/T-29-payment-provider-evidence.md).

### Qué probar en la web

1. **Dispara el timeout**, desde `/transferencias/nueva`, eligiendo "El proveedor no
   responde (timeout)" en el campo de escenario de pago (solo demostración).
2. **Observa la escalera**, en `/transferencias/{id}`: el panel de la transferencia debe
   mostrar hasta cuatro intentos, con esperas de 1 s, 5 s y 30 s entre uno y otro — el
   mismo aviso que ya existía para "Fallo transitorio".
3. **Cada intento debe decir qué respondió el proveedor**: en la ficha de intentos, junto
   al tipo de fallo, debe leerse "el proveedor no respondió (timeout)" — distinto del
   texto que aparece con "Fallo transitorio" ("el proveedor rechazó"), aunque ambos
   comparten la misma escalera y el mismo desenlace final.
4. **Confirma la compensación**: tras agotar los cuatro intentos, la transferencia debe
   cerrar en **Compensada**, con el dinero de vuelta en la cuenta origen — dos movimientos
   en el estado de cuenta, igual que un fallo transitorio agotado.
5. **Compara con los otros dos resultados** en la misma pantalla: `APPROVE` cierra
   Completada de inmediato; `REJECT` cierra Fallida sin subir la escalera. Los tres deben
   poder dispararse por separado, sin depender uno del otro.
6. **Repite los cinco pasos anteriores desde `/pagos/nuevo`** ("Pago de servicios"), no
   solo desde `/transferencias/nueva`. Un pago de servicio es la misma transferencia con
   el destino puesto en la cuenta recaudadora de un biller, así que atraviesa exactamente
   el mismo Payment Service — y hasta la corrección de abajo, esa pantalla nunca ofrecía
   el campo "Escenario de pago", así que el proveedor externo (lo que este ticket trata)
   solo se podía ensayar transfiriendo entre cuentas, nunca pagando un servicio real.

### Dos correcciones surgidas de probar esto en vivo, no del alcance original del ticket

Probando el flujo completo con el responsable del proyecto (frontend + backend reales,
no solo los comandos de validación) surgieron dos defectos que ningún test automatizado
de T-27 o T-29 cubría, porque ninguno ejercitaba una compensación sobre una cuenta
`AHORRO` ni el escenario de pago desde la pantalla de servicios:

- **La comisión de Q3.00 no se devolvía en una transferencia compensada** (defecto de
  T-27, expuesto agotando la escalera de T-29 sobre una cuenta `AHORRO`). Registrado como
  **TD-065** (`docs/TECH_DEBT.md`, **Resuelto**) y en
  [`docs/qa/backend/T-27-account-type-rules-evidence.md`](../qa/backend/T-27-account-type-rules-evidence.md).
- **`/pagos/nuevo` no ofrecía el campo "Escenario de pago"**, así que un pago de servicio
  jamás podía demostrar el timeout, el rechazo o el fallo transitorio que este ticket
  añade — solo una transferencia entre cuentas podía. Corregido reutilizando
  `PaymentScenarioSelect` (el mismo componente de `/transferencias/nueva`) en
  `apps/web/app/pages/pagos/nuevo.vue`, sin tocar el Gateway ni Payment Service: el
  endpoint (`POST /api/transfers`) ya aceptaba `paymentScenario` para cualquier destino,
  biller incluido — faltaba solo exponerlo en este formulario.

---

## T-30 — Clasificación de eventos, notificaciones inteligentes e historial de auditoría (Notification & Audit Service)

### Qué pedía el enunciado

Sección 4.1 (p. 5): nueve líneas, sin más detalle — "clasificar eventos" en `INFO`,
`WARNING` o `ERROR`; "generar notificaciones según tipo"; "almacenar historial de
eventos". No define ninguna regla de clasificación ni ningún nombre de campo; la
taxonomía y el mapeo son la decisión de este ticket.

### Qué ya existía y qué agregó este ticket

El servicio ya registraba todo lo que oía (T-20) y notificaba según una tabla de quince
tipos de evento, pero no existía ninguna noción de severidad en ninguna capa — dominio,
esquema, contratos o interfaz. Lo más cercano era `tintFor()` en el frontend, que
*infería* un color con una expresión regular sobre el nombre del mensaje: una conjetura
del navegador, no un hecho calculado por el servicio dueño del rastro.

También había un hueco ya presente en el código: `AuditProcessingStatus` declaraba
`'ERROR'` y el `CHECK` de la tabla lo permitía, pero ningún camino lo escribía nunca — los
dos escritores fijaban siempre `PROCESSED` o `INVALID`. Ese hueco es exactamente lo que el
alcance del ticket llama "registrar errores de procesamiento como eventos claros", y se
cierra sin agregar un camino de manejo de errores nuevo: se aprovecha que un fallo real de
este servicio ya relanza el mensaje hasta que agota su escalera de reintentos y cae en
`bank.errors`, cuyo drenaje ya existía (T-20) y ahora lo clasifica `ERROR`.

| Capa | Qué se agregó |
| --- | --- |
| Dominio | `domain/classification.ts` (nuevo): `EventSeverity`, `classify()` — pura, depende sólo de `(messageType, processingStatus, parked)`, nunca del payload — y `severityCatalogue()`. Precedencia: `processingStatus === 'ERROR'` → `ERROR`; `parked` → `ERROR`; `processingStatus === 'INVALID'` → `WARNING`; si no, una tabla explícita sobre los 36 contratos de evento que las cuatro colas de auditoría oyen, con fallback por sufijo para uno futuro. `domain/notification.ts`: `NotificationIntent.severity`, derivada de `classify()` y no escrita a mano en `POLICY`, para que la severidad del aviso y la del evento nunca puedan discrepar. |
| Persistencia | Migración `005_event_severity`: `audit_events.severity` y `notifications.severity`, ambas `VARCHAR(10)` **nullable, sin `DEFAULT` y sin backfill**, con `CHECK` y un índice por severidad. Nullable a propósito: un `DEFAULT 'INFO'` afirmaría una clasificación que nadie calculó sobre filas que pudieron ser compensaciones, y un `UPDATE` de relleno rompería la regla append-only de la tabla. `NULL` en una fila anterior a T-30 es el dato honesto. |
| Contratos | `eventSeverity` en `primitives.ts`. Campo `severity` aditivo y opcional en `audit.query.replied.v1`, `audit.events.list.replied.v1`, `notification-view.ts`, `notification.inbox.replied.v1`; filtro `severity` opcional en `audit.events.list.query.v1`; `infoToday`/`warningToday`/`errorToday` opcionales en `audit.stats.replied.v1`. Ningún contrato nuevo — `catalog-completeness.spec.ts` fija el catálogo en 101 mensajes exactos. |
| Aplicación | `RecordEventHandler` clasifica cada evento antes de pasarlo al caso de uso; el drenaje de `bank.errors` en `main.ts` clasifica con `parked: true`. `ListAuditEventsUseCase` y `GetAuditStatsUseCase` propagan la severidad y sus contadores. |
| Gateway | `GET /api/audit/recent` acepta `severity`, validado contra el enum (`400` con `field: "severity"` si no lo es, nunca una consulta al broker). |
| Web | `lib/audit.ts`: `EventSeverity`, `SEVERITY_PRESENTATION`, `severityTint()` — que prefiere la severidad registrada por el servicio y cae a `tintFor()` sólo para una fila sin clasificar. `tintFor` no se borró: sigue siendo el respaldo honesto mientras una fila pueda llegar sin `severity`. Columna "Severidad" y filtro en `/auditoria`; tres contadores del día (reutilizando `GET /api/dashboard`, que ya compone `audit.stats.query.v1` — ninguna ruta nueva para tres números); badge de severidad en el rastro (`AuditEventTable.vue`, `AuditEventDetail.vue`), en el buzón del cliente (`/notificaciones`) y en la consola (`AuditNotificationCard.vue`). |
| Tests | `domain.spec.ts`: los 36 eventos del catálogo real (cruzados contra `@bank/contracts`, no una lista copiada a mano) reciben exactamente una severidad; las tres están cubiertas; la precedencia de `ERROR`/`parked`/`INVALID`; el fallback por sufijo; la severidad es re-derivable desde `(messageType, processingStatus)`. `inbound-message.handler.spec.ts` (ampliado): el camino `ERROR`/`WARNING`/`INFO` de `RecordEventHandler`. `simulated-notification.spec.ts`: una notificación `ERROR` se registra como `warn`, no como `info`. `repository.integration.spec.ts`: la columna persiste, el `CHECK` rechaza un valor desconocido, el filtro funciona y una fila sin severidad lee `null` — contra PostgreSQL real. `apps/web/test/audit.test.mjs`: `SEVERITY_PRESENTATION` cubre las tres severidades y la severidad registrada gana sobre la inferida. |

### Comandos de validación

```
$ pnpm lint          # 11 tareas exitosas
$ pnpm typecheck     # 11 tareas exitosas
$ pnpm test          # 11 tareas exitosas (contratos: 763; notification-audit-service: 139 con
                      #   DATABASE_URL, 127 sin él más 12 saltadas; gateway: 317; web: 269)
$ pnpm test:contract # 763 pasan
$ pnpm build         # 9 tareas exitosas
```

Corrida completa contra PostgreSQL real (`pnpm dev:infra`,
`DATABASE_URL=postgresql://notification_audit_app:changeme@localhost:5437/notification_audit
turbo run test --filter=notification-audit-service`): 139 pruebas, incluida la migración
`005_event_severity` y el `CHECK` de severidad. Detalle completo con la salida pegada en
[`docs/qa/backend/T-30-event-classification-evidence.md`](../qa/backend/T-30-event-classification-evidence.md).

### Qué probar en la web

1. **Entra a `/auditoria` como `ADMINISTRADOR`.** La tabla "Últimos eventos del sistema"
   trae ahora una columna **Severidad** y un selector para filtrar por ella, más tres
   contadores del día (Info / Advertencia / Error) arriba de la tabla. Los eventos
   registrados **antes** de este cambio aparecen "sin clasificar" (`—`) a propósito: no se
   les inventó una severidad retroactiva.
2. **Provoca las tres severidades** con transferencias nuevas:
   - Un registro de cliente y una transferencia exitosa → **Info**.
   - Una transferencia rechazada por saldo insuficiente → **Advertencia**.
   - Una transferencia con escenario de pago `REJECT`, o agotando la escalera con
     `TIMEOUT` (que termina compensando), → **Error**.
3. **Consulta por `correlationId`** en la misma pantalla: cada fila del rastro trae su
   propia severidad, con una explicación al pasar el cursor.
4. **Entra como `CLIENTE` a `/notificaciones`.** El aviso de una transferencia compensada
   o fallida lleva la severidad que corresponde al resultado, junto al asunto.
5. **Entra como `ADMINISTRADOR` a `/auditoria/notificaciones`.** La consola muestra la
   misma severidad junto al estado de entrega de cada notificación.

## T-31 — Integración de las cinco extensiones en el flujo de transferencia

### Qué pedía el enunciado

Secciones 4.1, 4.2, 4.4, 6 y 8: conectar KYC, reglas de cuenta, historial, pagos
externos y clasificación de eventos **dentro** del flujo de transferencia que la
rúbrica califica — no como capacidades aisladas dentro de cada servicio.

### Cómo se cubrió

De las cinco capacidades, cuatro ya estaban conectadas al Saga desde sus
propios tickets: T-27 (reglas de cuenta) actúa en el paso del débito, T-28
(historial) registra cada transición real, T-29 (pagos externos) ya es el
proveedor que Payment Service consulta, y T-30 (clasificación) ya clasifica
todo lo que el Saga produce. Lo único que faltaba, y que T-26 dejó escrito con
todas sus letras ("enforcing it inside the transfer Saga is T-31's job"), era
el bloqueo real de KYC.

**El chequeo de KYC es ahora el primer paso del Saga.** `transfer.requested.v1`
crea la transacción en `PENDING` y publica `customer.kyc.check.requested.v1`;
Customer Service responde `customer.kyc.checked.v1` con `allowed` derivado de
`mayInitiateTransactions` (nunca recalculado por Transaction Service, que no
puede leer la tabla de clientes — X-1). `allowed: true` mueve `PENDING →
DEBITING` y ordena el débito, exactamente como antes; `allowed: false` mueve
`PENDING → FAILED` con `reason: KYC_NOT_VERIFIED`, sin ninguna compensación,
porque el dinero nunca salió. Los seis estados de la máquina no cambiaron —
`PENDING` simplemente pasó a significar "aceptada, veredicto KYC pendiente" en
vez de "aceptada, débito sin ordenar".

Un cliente sin identidad en el sobre (`customerId: null`) no tiene a quién
preguntarle, así que el chequeo se omite y el Saga avanza igual que antes —
la misma excepción que ya existía para el rol distinto de `CLIENTE`
(`mayInitiateTransactions`).

**El resto de las conexiones fueron de superficie, no de dominio:**
- Gateway: `POST /api/customers/{id}/kyc-status` (staff), con la forma exacta
  de `setIdentityVerdict`.
- `apps/web`: badge y explicación de KYC (`KYC_PRESENTATION`), columna en
  `/clientes`, acciones de verificar/rechazar en `/clientes/{id}`, estado
  propio en `/perfil`, aviso de cortesía (no bloqueante en el cliente, el Saga
  ya bloquea de verdad) en `/transferencias/nueva` y `/pagos/nuevo`, y la
  etiqueta del paso KYC en la línea de tiempo real de `/transferencias/{id}`.
- `@bank/contracts`: dos mensajes nuevos (`customer.kyc.check.requested.v1`,
  `customer.kyc.checked.v1`) y el código `KYC_NOT_VERIFIED`, aditivo en todos
  los contratos que lo admiten.

Detalle completo en
[`docs/qa/backend/T-31-integration-evidence.md`](../qa/backend/T-31-integration-evidence.md).

### Comandos de validación

```
$ pnpm lint          # 11 tareas exitosas
$ pnpm typecheck     # 11 tareas exitosas
$ pnpm test          # 11 tareas exitosas (contratos: 775; gateway: 321; web: 272)
$ pnpm test:contract # 775 pasan
$ pnpm build         # 9 tareas exitosas
```

Corrida completa contra PostgreSQL y RabbitMQ reales (`pnpm dev:infra`, cada
servicio con su propia `DATABASE_URL`): 150 pruebas en customer-service, 170 en
transaction-service (las de concurrencia sobre el nuevo paso KYC incluidas),
150 en account-service, 141 en notification-audit-service y 70 en
payment-service — todas verdes.

`pnpm images:flow` se actualizó con un paso nuevo: un cliente recién
registrado intenta transferir **antes** de que un cajero verifique su KYC, la
transferencia cierra `FAILED` con `KYC_NOT_VERIFIED` y el saldo de origen
queda intacto; solo entonces el cajero lo verifica y las tres formas del Saga
(completada, compensada por rechazo, compensada por escalera agotada) se
ejecutan como antes.

### Qué probar en la web

1. **Registra un cliente nuevo** y ábrele una cuenta con saldo (depósito de
   ventanilla). Su KYC queda en `PENDING` — visible en `/perfil` con un aviso
   explícito.
2. **Intenta transferir** desde `/transferencias/nueva` o `/pagos/nuevo`: verás
   el aviso de cortesía "Verificación de cumplimiento (KYC) pendiente", pero el
   formulario no te impide enviarla. Envíala: el detalle en
   `/transferencias/{id}` debe cerrar **Fallida**, con el motivo "El cliente
   que origina la transferencia no tiene su verificación KYC completa" y la
   línea de tiempo marcando el paso "Se resolvió la verificación de
   cumplimiento (KYC)" como fallido — nunca un débito.
3. **Entra como `CAJERO_RECEPTOR` o `ADMINISTRADOR` a `/clientes/{id}`** del
   cliente registrado. La tarjeta "Verificación de cumplimiento (KYC)" debe
   ofrecer **Verificar KYC** y **Rechazar**. Verifícalo.
4. **Repite la transferencia.** Ahora debe completarse (o compensar, si eliges
   un escenario de pago que falle) exactamente como antes de este ticket — el
   único cambio es que ya no se rechaza por KYC.
5. **Confirma en `/clientes`** que la columna KYC del cliente muestra
   "KYC verificado", y que un segundo intento de rechazarlo desde la ficha no
   hace nada (`VERIFIED` es terminal).

## Una nota sobre el entorno, no sobre el código

Si `pnpm dev` falla en el paso `rabbitmq-init` con un código de salida `127`, no es un
defecto de ningún ticket: es que Git convirtió los scripts `.sh` de `infra/` a finales
de línea CRLF al clonar en Windows, y un contenedor Linux no puede ejecutar un script
cuyo shebang termina en `\r`. Ya existe un `.gitattributes` en la raíz que lo evita en
clones nuevos; si igual ocurre, normaliza los scripts a LF y vuelve a intentar.
