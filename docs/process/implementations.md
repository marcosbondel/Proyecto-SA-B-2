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

## Una nota sobre el entorno, no sobre el código

Si `pnpm dev` falla en el paso `rabbitmq-init` con un código de salida `127`, no es un
defecto de ningún ticket: es que Git convirtió los scripts `.sh` de `infra/` a finales
de línea CRLF al clonar en Windows, y un contenedor Linux no puede ejecutar un script
cuyo shebang termina en `\r`. Ya existe un `.gitattributes` en la raíz que lo evita en
clones nuevos; si igual ocurre, normaliza los scripts a LF y vuelve a intentar.
