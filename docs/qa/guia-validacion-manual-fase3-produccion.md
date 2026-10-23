# Guía de validación manual — Fase 3 (Bank USAC) contra producción

Esta guía sirve para comprobar a mano, contra el despliegue vivo de producción
(GKE + Cloud Run, release `v1.3.3`), cada requisito de la Fase 3 del enunciado
[`docs/references/780_Proyecto_3_2S2026.pdf`](../references/780_Proyecto_3_2S2026.pdf).
Cada bloque cita la **página del PDF** donde aparece el requisito. Es el número de
página del archivo; `pdftotext -layout -f N -l N` extrae esa misma página.

Cada bloque tiene seis partes: ID, requisito, precondiciones, cómo probarlo,
resultado esperado y evidencia a capturar. Al final hay tres secciones: las tablas
§8.1 y §8.2 apuntando a los IDs, el checklist de penalizaciones §8.3 y un orden
sugerido para una corrida de 2 a 3 horas.

> **El repositorio es público.** Esta guía no contiene ninguna contraseña, token ni
> API key. Donde hace falta uno, se indica de dónde leerlo. **No pegues secretos en
> capturas, issues ni en este archivo.**

---

## 0. Antes de empezar

### 0.1 Entorno

| Componente | URL / acceso | Verificado el 2026-10-19 |
| --- | --- | --- |
| Frontend (Cloud Run) | https://bank-usac-web-mn2e6zhkwq-uc.a.run.app | `200` en `/login` |
| API Gateway **prod** | http://34.69.101.197:3000 (`/health`, `/ready`) | `{"status":"ready","broker":"connected"}` |
| API Gateway **dev** | http://136.71.158.228:3000 | `/health` → `ok` (sólo lectura; **no correr carga contra dev**) |
| Entrada interbancaria (contrato v1) | http://34.69.101.197:3000/interbank/v1 (`X-Api-Key`) | `GET /interbank/v1/health` → `{"status":"UP","bankCode":"BANK02"}` |
| Grafana (pública, admin completo) | http://35.255.103.13, usuario `admin` | 9 dashboards en la carpeta **Bank USAC**, 16 reglas de alerta |
| Mock del banco pareja (interno) | `svc/bank-usac-partner-bank-mock:3021` en `prod`, por port-forward | `/health` → `bankCode BANK99`, modo `ACCEPT` |
| kubectl sin tocar tu contexto | `tmp/t60/k-gke.sh <args>` desde la raíz del repo | p. ej. `tmp/t60/k-gke.sh -n prod get hpa` |

Códigos de banco: **nosotros `BANK02`** (cuentas `02-NNNNNNNNN`), **el mock `BANK99`**.
Límite por depósito interbancario: `INTERBANK_MAX_AMOUNT_MINOR=1000000`, es decir
Q10,000.00. Anomalía de cuenta: `ANOMALY_MAX_OPERATIONS=10`, `ANOMALY_WINDOW_MINUTES=5`.
Los tres vienen del ConfigMap `bank-usac-config`.

### 0.2 Credenciales

| Qué | Dónde |
| --- | --- |
| Usuarios sembrados | `admin@bankusac.gt` (ADMINISTRADOR), `cajero@bankusac.gt` (CAJERO_RECEPTOR), `cliente@bankusac.gt` (CLIENTE). Contraseña de demo `BankUsac#2026`, que ya es pública en las semillas. |
| Contraseña de Grafana | `tmp/t60/secretos-nube.env`, variable `GRAFANA_ADMIN_PASSWORD`, o pedírsela al responsable |
| Token de administración del mock | `tmp/t60/secretos-nube.env`, variable `PARTNER_MOCK_ADMIN_TOKEN` |
| API keys interbancarias | `tmp/t60/secretos-nube.env`, variables `INTERBANK_API_KEY_INBOUND` / `INTERBANK_API_KEY_OUTBOUND` (no hacen falta: el mock ya las tiene) |

Datos sembrados de `cliente@bankusac.gt`, el cliente `a0000000-0000-4000-8000-000000000005` (KYC `VERIFIED`):

| Cuenta | UUID | Número | Tipo |
| --- | --- | --- | --- |
| Origen de las pruebas | `b0000000-0000-4000-8000-000000000003` | `02-000000008` | MONETARIA |
| Destino de las pruebas | `b0000000-0000-4000-8000-000000000004` | `02-000000009` | AHORRO |

- **Usa siempre la MONETARIA como origen.** Cada débito de una AHORRO cobra Q3.00 de comisión.
- `c0000000-0000-4000-8000-00000000000a` es la **cuenta de liquidación interbancaria**. No la uses como destino de pruebas.

### 0.3 Herramientas

- Navegador, de preferencia en ventana privada: una sesión por rol.
- `curl`, `jq`, `uuidgen` (en macOS ya vienen).
- `k6`, para las secciones de carga.
- `tmp/t60/k-gke.sh`, que necesita `gcloud` con la cuenta autorizada.
- Opcional: `gh` para ver las corridas del pipeline y `helm`.

Variables y funciones de shell que usa toda la guía. Pega esto **una vez** en una
terminal abierta en la raíz del repositorio. Los tokens duran 3600 s; si algo
empieza a dar `401`, vuelve a ejecutar las tres líneas `export T…`.

```bash
export G=http://34.69.101.197:3000          # Gateway prod
export GD=http://136.71.158.228:3000        # Gateway dev (sólo lectura)
export GF=http://35.255.103.13              # Grafana
export ORIG=b0000000-0000-4000-8000-000000000003   # MONETARIA 02-000000008
export AHO=b0000000-0000-4000-8000-000000000004    # AHORRO    02-000000009

login() { curl -s -X POST "$G/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"credential\":\"BankUsac#2026\"}" | jq -r .token; }
export TC=$(login cliente@bankusac.gt) TJ=$(login cajero@bankusac.gt) TA=$(login admin@bankusac.gt)

# Saldos del cliente en centavos (amountMinor)
bal() { curl -s "$G/api/accounts" -H "Authorization: Bearer $TC" \
  | jq -r '.accounts[] | "\(.accountNumber) \(.accountType) \(.balance.amountMinor)"'; }

# Transferencia interna MONETARIA -> AHORRO. $1 = centavos (100 = Q1.00), $2 = paymentScenario opcional
transfer() {
  local body="{\"sourceAccount\":\"$ORIG\",\"targetAccount\":\"$AHO\",\"amount\":{\"amountMinor\":${1:-100},\"currency\":\"GTQ\"}${2:+,\"paymentScenario\":\"$2\"}}"
  curl -s -D /tmp/f3-h.txt -X POST "$G/api/transfers" -H "Authorization: Bearer $TC" \
    -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d "$body"; echo
  grep -iE '^x-(trace|correlation)-id' /tmp/f3-h.txt
}
tx() { curl -s "$G/api/transfers/$1" -H "Authorization: Bearer $TC" | jq '{status,phaseStatus,reason,payment,transitions:[.transitions[].to]}'; }
```

Mock del banco pareja. Abre el port-forward en **otra terminal** y déjala abierta;
si se cae, vuelve a lanzarlo.

```bash
tmp/t60/k-gke.sh -n prod port-forward svc/bank-usac-partner-bank-mock 13021:3021
```

```bash
export M=http://localhost:13021
# Lee SOLO el token del mock, sin imprimirlo
export PARTNER_MOCK_ADMIN_TOKEN="$(grep '^PARTNER_MOCK_ADMIN_TOKEN=' tmp/t60/secretos-nube.env | cut -d= -f2-)"
mock() { curl -s -H "X-Admin-Token: $PARTNER_MOCK_ADMIN_TOKEN" -H 'Content-Type: application/json' "$@"; }
curl -s $M/health | jq .faults      # sin token: modo actual
mock $M/admin/config | jq           # con token: fallos armados y contadores
```

Rutas del mock, de `apps/partner-bank-mock/server.mjs` y `src/app.mjs`:

| Ruta | Para qué |
| --- | --- |
| `GET/PUT /admin/config` | `PUT` es un parche parcial en caliente. Campos: `mode` (`ACCEPT`\|`REJECT`\|`TIMEOUT`\|`SLOW`\|`UNAVAILABLE`), `rejectReason`, `delayMs` (1000), `slowMs` (10000), `ackDelayMs`, `failCount`, `failureRate`, `statusBehavior` (`PROCESSING`\|`NOT_FOUND`\|`UNREACHABLE`), `honorExpiry` (true), `reversal` (`COMPLETE`\|`FAIL`\|`STALL`) |
| `POST /admin/reset` | Borra el estado en memoria y vuelve a los fallos iniciales (`ACCEPT`) |
| `GET /admin/received[/{id}]` | Lo que el mock recibió de nosotros |
| `POST /admin/received/{id}/callback` | Body `{"status":"ACCEPTED"\|"REJECTED","reasonCode"?}`. Fuerza el desenlace y manda el callback aunque haya vencido; es la vía para el ACCEPTED tardío |
| `POST /admin/transfers` | Body `{destinationAccount, amount ("1.00"), repeat?: 0..20, interbankTransferId?, expiresInSeconds?, overrides?}`. Origina un depósito **hacia** nuestro banco; `repeat` reenvía la solicitud idéntica, con la misma Idempotency-Key |
| `GET /admin/transfers[/{id}]` | Lo que el mock nos envió, lo que contestamos y el callback |

Reglas de negocio del mock en modo `ACCEPT`:

| Caso | Respuesta del mock |
| --- | --- |
| Cuenta terminada en `999999999` | `ACCOUNT_NOT_FOUND` |
| Cuenta terminada en `000000000` | `ACCOUNT_INACTIVE` |
| Monto > 10000.00 | `AMOUNT_LIMIT_EXCEEDED` |
| Banco destino distinto de `BANK99` | `PROCESSING_ERROR` |
| Cualquier otra cuenta, p. ej. `99-000000123` | `ACCEPTED` |

### 0.4 Grafana: dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Dashboards | *Dashboards → carpeta **Bank USAC*** (los 9 de §H) |
| Explore | `$GF/explore`; datasources **Prometheus** (uid `bank-prometheus`), **Loki** (`bank-loki`), **Tempo** (`bank-tempo`). Escribe la consulta en modo **Code** |
| Alertas | *Alerting → Alert rules* (`$GF/alerting/list`), carpeta **Bank USAC** |
| Entorno, en Prometheus | Etiqueta `environment` (`prod` / `dev`) |
| Entorno, en Loki | Etiqueta indexada `deployment_environment`. Las otras dos indexadas son `service_name` y `k8s_namespace_name` |
| Entorno, en Tempo | `resource.deployment.environment` |
| Campos de log en Loki | `level`, `correlationId`, `traceId`, `spanId`, `accountId`… son *structured metadata*: se filtran **después** de un `|`, p. ej. `| correlationId="…"`. `{environment="prod"}` no da error, pero no encuentra nada |

Una métrica OTel llega a Prometheus con unos **60 s de retraso** (exportación cada
15 s, más el scrape y las reglas cada 30 s). Espera 1–2 minutos antes de juzgar un panel.

### 0.5 Reglas de seguridad de la corrida

1. **Todo escenario se restaura al terminar**, aunque la prueba falle:
   - Mock: `mock -X POST $M/admin/reset`.
   - Simulación de pagos: `PUT /api/payments/simulation` con `{"reset":true}`.
   - RabbitMQ: vuelve solo a 1 réplica. **Nunca lo escales a 0**; para la caída, elimina el pod.
   - Cuentas desactivadas: se reactivan.
2. **`dev` y `prod` tienen bases de datos separadas**, pero no corras carga contra
   `dev`: es para mirar que la telemetría distingue el entorno, nada más.
3. **Los datos de prueba se quedan en prod.** Usa montos pequeños (Q1.00 = `amountMinor: 100`).
   Antes de una carga mira el saldo con `bal`. Si la MONETARIA baja de Q500, el cajero
   la recarga: `/cuentas/deposito` en el frontend, o
   `curl -X POST "$G/api/accounts/$ORIG/deposit" -H "Authorization: Bearer $TJ" -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"amount":{"amountMinor":200000,"currency":"GTQ"},"description":"Recarga pruebas F3"}'`.
4. La simulación de pagos y el modo del mock son **estado compartido**: mientras uno
   está armado, afecta a todo el que use el banco. Avisa al equipo.
5. En prod `REVEAL_ACTIVATION_LINKS=false`: los enlaces de activación salen
   enmascarados (`/activar?token=***`), y eso es justo un requisito que se prueba
   (F3-LOG-02). Un cliente que se registra por `/registro` **no puede activarse
   leyendo logs**. Por eso las pruebas de ciclo de vida usan el flujo de ventanilla y
   los usuarios sembrados.

### 0.6 Tiempo estimado por sección

| Sección | Tiempo |
| --- | --- |
| §0 preparación | 10 min |
| A. Customer/Account | 20 min |
| B. Transaction/Payment | 20 min |
| C. Notification & Audit y logs | 15 min |
| D. Interbancario | 45 min (incluye esperas de 3 a 8 min) |
| E–H. OTel, SLI, SLO, logging, dashboards | 25 min |
| I. Integración y CI/CD | 10 min |
| J. Carga y fallos | 30 min, más 35 min en segundo plano para la alerta de latencia |

---

## Índice de IDs

| Sección | IDs |
| --- | --- |
| A. Customer Service | F3-CUS-01 · F3-CUS-02 · F3-CUS-03 · F3-CUS-04 |
| A. Account Service | F3-ACC-01 · F3-ACC-02 · F3-ACC-03 |
| B. Transaction Service | F3-TRX-01 · F3-TRX-02 · F3-TRX-03 · F3-TRX-04 |
| B. Payment Service | F3-PAY-01 · F3-PAY-02 · F3-PAY-03 |
| C. Notification & Audit | F3-AUD-01 · F3-AUD-02 · F3-AUD-03 · F3-AUD-04 · F3-AUD-05 |
| D. Interbancario | F3-IB-01 … F3-IB-15 |
| E. OpenTelemetry | F3-OTL-01 · F3-OTL-02 · F3-OTL-03 · F3-OTL-04 |
| F. Métricas SLI | F3-SLI-01 … F3-SLI-06 |
| G. SLO, error budget, alertas | F3-SLO-01 … F3-SLO-06 |
| H. Logging y dashboards | F3-LOG-01 · F3-LOG-02 · F3-DSH-01 · F3-DSH-02 · F3-DSH-03 |
| I. Integración con el sistema existente | F3-INT-01 … F3-INT-05 |
| J. Carga y fallos | F3-LOAD-01 · F3-FAIL-01 … F3-FAIL-05 |
| K–M. Rúbrica | Tabla §8.1 · criterios §8.2 2.1–2.9 · checklist §8.3 |

---

## A. Extensión funcional — Customer y Account Service (§4.1)

### F3-CUS-01 — Eventos del ciclo de vida del cliente, con correlationId y logs enmascarados

**Requisito.** *Registrar eventos del ciclo de vida (creación, verificación KYC,
rechazo), asociarlos a un correlationId, generar logs estructurados por cada cambio de
estado y enmascarar u omitir documento, correo, fotografía y tokens JWT en logs y
atributos de trazas.* **Página(s): 5** (y p. 10, restricción «No registrar datos sensibles»).

**Precondiciones.**
- Sesión de `cajero@bankusac.gt` en el frontend.
- Dos imágenes JPG/PNG de menos de 5 MB, **distintas entre sí**. Una foto que ya
  pertenece a otro cliente se rechaza por digest duplicado.

**Cómo probarlo.**

*Camino de revisión (creación → verificación o rechazo):*

1. En una ventana privada abre `/registro` y completa los tres pasos:
   - Paso 1, **Datos personales**: Nombre completo, Fecha de nacimiento, Dirección, Correo electrónico → **Continuar**.
   - Paso 2: **Número de DPI (13 dígitos)**, **Foto del documento** → **Continuar**.
   - Paso 3: Contraseña, Confirmar contraseña, casilla de términos → **Crear cuenta**.
2. Anota el **Código de seguimiento** que muestra la pantalla «Solicitud de registro
   recibida». Es el correlationId de la creación.
3. Repite el paso 1 con un segundo cliente (otro correo, otro DPI, otra foto).
4. Como cajero, abre `/clientes/validaciones`. Los dos aparecen con **Revisar →**.
   - Primer cliente: **Aprobar identidad**.
   - Segundo cliente: **Rechazar**, y en el modal «Rechazar la identidad» pulsa **Rechazar identidad**.
5. Alternativa por API:
   ```bash
   curl -s -X POST "$G/api/customers" -H "Idempotency-Key: $(uuidgen)" \
     -F fullName='Prueba Fase Tres' -F identityDocument='2547896320101' \
     -F email="f3.$(date +%s)@example.com" -F dateOfBirth=1995-05-05 \
     -F address='Zona 1' -F role=CLIENTE -F credential='Prueba#2026x' \
     -F 'photo=@/ruta/foto.png;type=image/png'          # 202 {customerId, correlationId}
   curl -s "$G/api/customers/pending-validation" -H "Authorization: Bearer $TJ" | jq
   curl -s -X POST "$G/api/customers/<customerId>/identity-verdict" -H "Authorization: Bearer $TJ" \
     -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"verdict":"VALIDATED"}'   # o "REJECTED"
   ```
   `kyc-status` también existe (`{"status":"VERIFIED"|"REJECTED"}`, **sin** campo `reason`),
   pero **ningún botón del frontend lo usa**. `VERIFIED` es terminal: pasarlo luego a
   `REJECTED` contesta `202` y no cambia nada.
6. *Camino de ventanilla:* como cajero, `/clientes/nuevo` con los mismos tres pasos. El
   cliente queda **«Cliente registrado»**, activo y verificado en el acto (`path="counter"`).
   Ese cliente sí puede iniciar sesión, con la contraseña que puso el cajero.
7. En Grafana, Explore → **Loki**:
   ```logql
   {service_name="customer-service", deployment_environment="prod"} |~ "customer (created|verified|rejected|registration refused)"
   ```
   ```logql
   {service_name=~".+", deployment_environment="prod"} | correlationId="<correlationId del paso 2>"
   ```

**Resultado esperado.**
- Una línea JSON por cambio de estado: `customer created`, `customer verified` y `customer rejected`.
- Cada línea con `correlationId`, `traceId` y `spanId`. El dato del cliente es `customerId`.
- Ninguna línea con el correo, el DPI, el nombre, la dirección, la foto ni un JWT.
- En la auditoría (F3-AUD-03), los eventos `customer.registered.v1`,
  `customer.identity.validated.v1` / `customer.identity.rejected.v1` y
  `customer.kyc.verified.v1` / `customer.kyc.rejected.v1`.
- Negativo, en los últimos 15 min:
  `{service_name="customer-service", deployment_environment="prod"} |= "<correo usado>"` → **0 líneas**.

**Evidencia a capturar.**
- Pantalla «Solicitud de registro recibida» con el código de seguimiento.
- `/clientes/validaciones/[id]` con el veredicto «Identidad aprobada» / «Identidad rechazada».
- Explore Loki con las tres líneas y con la búsqueda negativa del correo en 0.

### F3-CUS-02 — Métrica: clientes verificados contra rechazados

**Requisito.** *Métrica: número de clientes verificados vs rechazados.* **Página(s): 5.**

**Precondiciones.** F3-CUS-01 ejecutado: al menos una aprobación y un rechazo en la última hora.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Métricas clave (SLI)**, Entorno = `prod`, panel
   **«Clientes: verificados contra rechazados (última hora)»**.
2. Explore → Prometheus:
   ```promql
   sli:kyc_decisions:increase1h{environment="prod"}
   sum by (result, path) (bank_customer_kyc_decisions_total{environment="prod"})
   ```

**Resultado esperado.**
- Series `result="verified"` y `result="rejected"`, con `path="review"` (autoservicio + cajero) y/o `path="counter"` (ventanilla).
- Cada aprobación o rechazo del paso anterior suma 1 en su serie, unos 60 s después.
- No hay etiqueta `customerId`.

**Evidencia a capturar.** Captura del panel y de la consulta en Explore, antes y después de las decisiones.

### F3-CUS-03 — Métrica: tiempo de la creación a la verificación KYC (p95)

**Requisito.** *Métrica: tiempo desde la creación hasta la verificación KYC (percentil p95).* **Página(s): 5.**

**Precondiciones.** F3-CUS-01, con unos minutos entre la creación y la aprobación para que el número no sea trivial.

**Cómo probarlo.**
1. **Bank USAC · Métricas clave (SLI)** → panel **«KYC: tiempo desde la creación hasta la verificación (p50 / p95)»**.
2. Explore:
   ```promql
   sli:kyc_time_to_decision:seconds_p95{environment="prod"}
   histogram_quantile(0.95, sum by (le) (rate(bank_customer_kyc_time_to_decision_seconds_bucket{environment="prod"}[6h])))
   ```

**Resultado esperado.**
- Un valor en segundos, cercano al tiempo real entre el «Crear cuenta» y el «Aprobar identidad».
- Es un histograma con buckets de 1 s a 7 días, no un promedio.
- La ventana es de 6 h. Si en esas 6 h no hubo ninguna decisión, la serie sale `NaN` o vacía; eso no es un error.

**Evidencia a capturar.** Panel con el p95, y la hora de creación y de aprobación anotadas al lado.

### F3-CUS-04 — Traza: flujo completo desde la creación hasta la verificación

**Requisito.** *Traza: flujo completo desde creación hasta verificación.* **Página(s): 5.**

**Precondiciones.** El correlationId de la creación (F3-CUS-01, paso 2).

**Cómo probarlo.**
1. Explore → **Tempo** → TraceQL:
   ```traceql
   {name="customer.lifecycle verified"}
   ```
   También, con el id de la creación:
   ```traceql
   {span.bank.correlation_id="<correlationId de la creación>"}
   ```
2. Abre la traza cuya raíz es `gateway POST /api/customers`.

**Resultado esperado.** Una sola traza con, en este orden:
- `POST /api/customers` (gateway, SERVER) → `publish bank.commands`
- → `process customer.commands` (customer-service, CONSUMER) → `customer.lifecycle created`
- → … → **`customer.lifecycle verified`** (o `rejected`).

La verificación es **hija** de la creación, no un *link*, aunque ocurra después y con
otro correlationId: el de la petición del cajero. Atributos:
- `bank.customer.transition`
- `bank.customer.path` = `review`|`counter`
- `bank.customer.id`
- `bank.correlation_id`

No aparece el correo ni el documento.

**Evidencia a capturar.** Captura de la vista de traza con los dos spans `customer.lifecycle` y sus atributos.

### F3-ACC-01 — Registro de débitos y créditos; métrica por tipo de cuenta y operación

**Requisito.** *Registrar operaciones sobre cuentas (débitos, créditos). Métrica: número
de transacciones por tipo de cuenta (ahorro / corriente) y por operación (débito / crédito).*
**Página(s): 5.**

**Precondiciones.** Sesión de cliente. `bal` para anotar los saldos iniciales.

**Cómo probarlo.**
1. Haz una transferencia:
   - Frontend: `/transferencias/nueva`.
     - **Cuenta de origen** = la Monetaria.
     - **¿A dónde va el dinero?** = «A otra de mis cuentas».
     - **Cuenta de destino** = la de Ahorro.
     - **Monto** 1.00, **Escenario de pago** «Sin escenario (comportamiento real)».
     - **Continuar** → **Confirmar y enviar**.
   - O por API: `transfer 100`.
2. Explore:
   ```promql
   sum by (account_type, operation) (bank_account_operations_total{environment="prod"})
   sli:account_operations:rate5m{environment="prod"}
   ```
3. Dashboard **Bank USAC · Métricas clave (SLI)** → **«Cuentas: operaciones por tipo y operación»**.

**Resultado esperado.**
- `account_type` ∈ `MONETARIA` · `AHORRO`. La «corriente» del enunciado es `MONETARIA` en este banco.
- `operation` ∈ `debit` · `credit` · `compensation`.
- Una transferencia suma `MONETARIA/debit` +1 y `AHORRO/credit` +1.
- **No existe** una etiqueta `account_id`.

**Evidencia a capturar.** Valores antes y después; el panel.

### F3-ACC-02 — Detección de alta frecuencia → `AccountAnomalyDetected` → notificación WARNING

**Requisito.** *Detectar más de N operaciones sobre una misma cuenta en una ventana de M
minutos (N y M configurables por ConfigMap; sugerido 10 en 5). Emitir
`AccountAnomalyDetected` al broker; Notification & Audit lo registra y genera una
notificación WARNING. Bloquear la cuenta es opcional y debe justificarse.*
**Página(s): 5** (y p. 7: «Generar una notificación al recibir AccountAnomalyDetected»).

**Precondiciones.**
- Sesión de cliente y de admin.
- La cuenta origen sin una anomalía ya reclamada en los últimos 5 minutos. Se anuncia
  **una vez por ventana**. Si acabas de correr carga, espera 5 min.

**Cómo probarlo.**
1. Confirma N y M: `tmp/t60/k-gke.sh -n prod get configmap bank-usac-config -o jsonpath='{.data.ANOMALY_MAX_OPERATIONS} {.data.ANOMALY_WINDOW_MINUTES}'` → `10 5`.
2. Haz 11 transferencias en menos de 5 minutos. Cuestan Q11.00, vuelven a la misma persona:
   ```bash
   for i in $(seq 1 11); do transfer 100 >/dev/null; sleep 2; done
   ```
3. Explore → Loki:
   ```logql
   {service_name="account-service", deployment_environment="prod"} |= "account anomaly detected"
   ```
4. Como cliente: campana → `/notificaciones`. Como admin: `/auditoria/notificaciones`. O por API:
   ```bash
   curl -s "$G/api/audit/notifications?type=account.anomaly&limit=3" -H "Authorization: Bearer $TA" | jq
   curl -s "$G/api/audit/recent?severity=WARNING&service=account-service&limit=3" -H "Authorization: Bearer $TA" | jq '.events[] | {messageType,severity,payload}'
   ```

**Resultado esperado.**
- **Log**: nivel `warn`, mensaje `account anomaly detected`, con `accountId` (el de la
  MONETARIA), `operationCount` ≥ 11, `threshold: 10`, `windowMinutes: 5`, `correlationId` y `traceId`.
- **Auditoría**: evento `account.anomaly.detected.v1`, severidad **WARNING**, payload
  `rule: HIGH_FREQUENCY`, `threshold`, `windowMinutes`, `operationCount`, `accountType`.
- **Notificación** `type: account.anomaly`, `severity: WARNING`, asunto
  **«Detectamos actividad inusual en tu cuenta»**.
  - En `/notificaciones` del cliente: tipo «Actividad inusual en la cuenta», con la insignia **Advertencia**.
- **La cuenta sigue operando**: la transferencia 12 completa. No se bloquea (decisión ADR-017).

**Evidencia a capturar.** Línea de log, fila de auditoría WARNING, notificación en la bandeja del cliente y en la consola del admin.

### F3-ACC-03 — Métrica de anomalías y `accountId` sólo en logs (sin alta cardinalidad)

**Requisito.** *Métrica: número de anomalías detectadas. Logs de actividad con el
accountId; el detalle por cuenta se consulta en los logs, no como etiqueta de métrica.*
**Página(s): 5** (y p. 15: «Evitar etiquetas de alta cardinalidad (accountId, customerId)»).

**Precondiciones.** F3-ACC-02 ejecutado.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Errores en tiempo real** → stat **«Anomalías de cuenta detectadas (última hora)»**.
2. Explore:
   ```promql
   sli:account_anomalies:increase1h{environment="prod"}
   sum by (account_type, rule) (bank_account_anomalies_total{environment="prod"})
   count by (__name__) ({__name__=~"bank_.*", account_id!=""})
   ```
3. Loki, el detalle por cuenta:
   ```logql
   {service_name="account-service", deployment_environment="prod"} | accountId="b0000000-0000-4000-8000-000000000003"
   ```

**Resultado esperado.**
- El contador sube en 1 por anomalía, con etiquetas `account_type` y `rule="HIGH_FREQUENCY"` únicamente.
- La tercera consulta devuelve **vacío**: ninguna métrica tiene `account_id`.
- Loki muestra las líneas `account operation` (`accountId`, `accountType`, `operation`, `transactionId`) y la de la anomalía.

**Evidencia a capturar.** Las tres consultas, con la de cardinalidad vacía.

---

## B. Extensión funcional — Transaction y Payment Service (§4.1)

### F3-TRX-01 — Latencia del flujo de transferencia p50/p95/p99 (histograma)

**Requisito.** *Medir el tiempo de procesamiento; métrica de latencia del flujo de
transferencia en p50, p95 y p99 (histograma, no promedio).*
**Página(s): 6** (y p. 8, «Métricas (SLI base)»).

**Precondiciones.** Tráfico de transferencias en los últimos 5 min: unas cuantas con `transfer 100`, o la carga de F3-LOAD-01.

**Cómo probarlo.**
1. **Bank USAC · Métricas clave (SLI)** → **«Latencia de transferencias (p50 / p95 / p99)»**.
   El panel de texto **«Percentiles, no promedios»** explica el criterio.
2. Explore:
   ```promql
   sli:transfer_latency:seconds_p50{environment="prod"}
   sli:transfer_latency:seconds_p95{environment="prod"}
   sli:transfer_latency:seconds_p99{environment="prod"}
   sum by (le) (rate(bank_transfer_duration_seconds_bucket{environment="prod"}[5m]))
   ```

**Resultado esperado.**
- Tres líneas con p50 ≤ p95 ≤ p99, en segundos. Una transferencia sana tarda unos 1–3 s.
- La cuarta consulta muestra buckets `le`; existe un límite exacto en `le="5.0"` (SLO-2).
- No hay ningún panel de latencia que use `_sum / _count`.

**Evidencia a capturar.** Panel con las tres curvas y la consulta de buckets.

### F3-TRX-02 — Tasa de éxito / fallo

**Requisito.** *Medir la tasa de éxito / fallo; métrica: tasa de error.* **Página(s): 6.**

**Precondiciones.**
- Transferencias que terminan en estados distintos:
  - `transfer 100` (COMPLETED)
  - `transfer 100 REJECT` (COMPENSATED)
  - `transfer 900000000` (FAILED por saldo insuficiente; no mueve dinero)

**Cómo probarlo.**
1. Ejecuta las tres y anota los `transactionId`. Mira el estado de cada una con `tx <id>`.
2. **Bank USAC · Métricas clave (SLI)** → **«Transferencias: proporción por resultado final»**.
3. **Bank USAC · Estado del sistema** → **«Transferencias por resultado final»**.
4. **Bank USAC · Errores en tiempo real** → **«Transferencias que terminaron en FAILED, por motivo»**.
5. Explore:
   ```promql
   sli:transfer_outcome:ratio_rate5m{environment="prod"}
   sum by (result, reason) (increase(bank_transfer_finished_total{environment="prod"}[15m]))
   ```

**Resultado esperado.**
- `result` ∈ `completed` · `failed` · `compensated` (en minúsculas).
- `reason` ∈ `NONE` · `INSUFFICIENT_FUNDS` · `PAYMENT_DECLINED` · `PAYMENT_RETRIES_EXHAUSTED` · `KYC_NOT_VERIFIED` …
- Las proporciones suman 1.
- La FAILED aparece con `reason="INSUFFICIENT_FUNDS"`.

**Evidencia a capturar.** Los tres paneles y la consulta.

### F3-TRX-03 — Estados PENDING / APPROVED / FAILED como eventos dentro de la traza

**Requisito.** *Registrar los estados intermedios de la Fase 2 (PENDING, APPROVED,
FAILED) como spans o eventos dentro de la traza; asociar cada transacción a una traza
distribuida.* **Página(s): 6.**

**Precondiciones.** El `x-trace-id` de una transferencia COMPLETED y el de una COMPENSATED o FAILED (de F3-TRX-02).

**Cómo probarlo.**
1. Explore → Tempo → pega el traceId en TraceQL y ejecuta.
2. Busca el span **`transfer`** de `transaction-service` y abre sus **Events**.
3. Búsqueda general:
   ```traceql
   {name="transfer"} | select(span.bank.transfer.status, span.bank.transfer.phase_status)
   ```
   Es lo mismo que el panel **«Transferencias recientes (TraceQL)»** del dashboard **Bank USAC · Flujo de trazas**.

**Resultado esperado.**
- **COMPLETED**: el span `transfer` tiene los eventos `PENDING` y `APPROVED`, y los atributos:
  - `bank.transfer.status=COMPLETED`
  - `bank.transfer.phase_status=APPROVED`
  - `bank.transfer.duration_ms`
- **COMPENSATED/FAILED**: eventos `PENDING` y `FAILED`, `phase_status=FAILED`.
- Además, un span `saga.step <evento>` por transición:
  - `KYC_CHECK_ORDERED`
  - `KYC_APPROVED`
  - `DEBITED`
  - `PAYMENT_SUCCEEDED`
  - `CREDITED`
- En `/transferencias/[id]` el frontend muestra el mismo avance en **«Avance de la
  transferencia»** (Aceptada → Debitando → Procesando pago → Completada/Compensada/Fallida).

**Evidencia a capturar.** El span `transfer` con sus eventos, en las dos trazas.

### F3-TRX-04 — Traza completa de la Saga, incluidas las compensaciones

**Requisito.** *Traza completa del flujo Saga, incluyendo las compensaciones.*
**Página(s): 6** (y §8.2 2.2, p. 20).

**Precondiciones.** El traceId de `transfer 100 REJECT`, que es «Rechazar el pago» en el frontend.

**Cómo probarlo.**
1. Abre la traza en Tempo, o usa **Bank USAC · Flujo de trazas** → **«Compensaciones (TraceQL)»**,
   que ejecuta `{name="saga.compensation completed"}`.
2. Alterna la vista *Node graph* para ver los servicios.

**Resultado esperado.** Una sola traza que cruza **gateway → transaction-service →
customer-service (KYC) → account-service (débito) → payment-service (pago rechazado) →
transaction-service → account-service (compensación) → notification-audit-service**:
- Spans `publish bank.commands`/`bank.events` (PRODUCER) y `process <cola>` (CONSUMER).
- `payment.provider call`, con el evento `simulated_failure`.
- **`saga.compensation ordered`** y **`saga.compensation completed`**.
- El mensaje `account.debit.compensation.requested.v1` y luego `account.debit.compensated.v1`.

El saldo de la MONETARIA (`bal`) queda igual que antes de esa transferencia.

**Evidencia a capturar.** Captura de la traza con los dos spans de compensación resaltados; `bal` antes y después.

### F3-PAY-01 — Simulación de fallos en caliente (tasa %, timeout, latencia ms) sin redesplegar

**Requisito.** *Simular fallos intermitentes con tasa configurable (%), timeout y
respuestas lentas con latencia configurable (ms); cambiar los parámetros en tiempo de
ejecución, sin redesplegar (ConfigMap o endpoint de administración protegido en el API
Gateway); generar eventos de fallo controlados.* **Página(s): 6.**

**Precondiciones.** Token de admin (`$TA`). Avisa al equipo: es estado compartido.

**Cómo probarlo.**
1. Estado actual:
   ```bash
   curl -s "$G/api/payments/simulation" -H "Authorization: Bearer $TA" | jq
   ```
   Esperado `{"failureRatePercent":0,"timeoutRatePercent":0,"latencyMs":0,"source":"DEFAULTS",…}`.
2. Protección: la misma llamada con `$TC` → **403** `FORBIDDEN`.
3. Cambio en caliente. No hay pantalla para esto en el frontend; es sólo API:
   ```bash
   curl -s -X PUT "$G/api/payments/simulation" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
     -d '{"failureRatePercent":50,"timeoutRatePercent":0,"latencyMs":1500}' | jq
   ```
   Respuesta con `"source":"RUNTIME"`. Reglas: tasas de 0 a 100 con suma ≤ 100; `latencyMs` de 0 a 30000.
4. Haz 4–6 transferencias `transfer 100` y mira cada una con `tx <id>`.
5. Prueba la validación: `{"failureRatePercent":80,"timeoutRatePercent":30,"latencyMs":0}` → **400**
   con `"field":"timeoutRatePercent"` ("…juntas, no pueden superar el 100 %…"). Sin `latencyMs`
   también da 400, pero por el campo que falta, no por la suma.
6. **Restaura** y comprueba que vuelve `"source":"DEFAULTS"`:
   ```bash
   curl -s -X PUT "$G/api/payments/simulation" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{"reset":true}' | jq
   ```
7. Comprueba que nada se redesplegó: `tmp/t60/k-gke.sh -n prod get pods -l app.kubernetes.io/component=payment-service`. El `AGE` no cambió.

**Resultado esperado.**
- Con 50 %, parte de los pagos falla. Un fallo simulado es **transitorio**: la escalera
  reintenta a 1 s / 5 s / 30 s (`PAYMENT_RETRIES_EXHAUSTED` si se agota) y luego **compensa**.
- La latencia de 1.5 s se ve en `bank_payment_provider_duration_seconds`.
- `bank_payment_simulation_changes_total{action="update"}` y `{action="reset"}` suben.
- La simulación **no** aplica a los depósitos interbancarios, que no pasan por el
  proveedor simulado, ni a transferencias con `paymentScenario`.

**Evidencia a capturar.** Las respuestas del GET/PUT; un `tx` compensado; el `AGE` del pod.

### F3-PAY-02 — La Saga compensa ante fallos del proveedor y se ve en la traza

**Requisito.** *Verificar que la Saga ejecute las compensaciones y que estas sean visibles en la traza.* **Página(s): 6.**

**Precondiciones.** Admin. Nada más corriendo con la simulación.

**Cómo probarlo.**
1. Fallo total:
   `curl -s -X PUT "$G/api/payments/simulation" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{"failureRatePercent":100,"timeoutRatePercent":0,"latencyMs":0}'`.
   Los tres campos son obligatorios: con uno solo responde 400.
2. `bal`; luego `transfer 100`. Anota el `x-trace-id`.
3. Espera unos 40 s (1 + 5 + 30 s de reintentos). `tx <transactionId>`.
4. En el frontend, como cliente, `/transferencias/<transactionId>`:
   - Panel **«Resultado del pago»**: chips «Intento N de M», «Fallo transitorio».
   - Estado **Compensada**.
5. Tempo con el traceId.
6. **Restaura**: `-d '{"reset":true}'`. Repite con `{"failureRatePercent":0,"timeoutRatePercent":100,"latencyMs":0}` si quieres ver el timeout, y restaura otra vez.

**Resultado esperado.**
- `status: COMPENSATED`, `phaseStatus: FAILED`, `reason: PAYMENT_RETRIES_EXHAUSTED`.
- Las transiciones terminan en «Se devolvió el dinero a la cuenta de origen».
- La traza contiene:
  - un `saga.payment attempt` por escalón
  - `payment.provider call` con el evento `simulated_failure` (atributo `bank.payment.provider.source=runtime`)
  - `saga.compensation ordered` y `saga.compensation completed`
- El saldo queda igual que al principio.

**Evidencia a capturar.** Pantalla de la transferencia compensada, traza con la compensación, saldo antes y después.

### F3-PAY-03 — Métricas de tasa de fallos externos y p95 del externo; logs de errores simulados

**Requisito.** *Métrica: tasa de fallos externos; métrica: latencia del sistema externo simulado (p95); logs de errores simulados.* **Página(s): 6.**

**Precondiciones.** F3-PAY-01/02 ejecutados en los últimos 15 min.

**Cómo probarlo.**
1. **Bank USAC · Métricas clave (SLI)** → **«Proveedor externo: tasa de fallo por origen»** y **«Proveedor externo: latencia (p95)»**.
2. Explore:
   ```promql
   sli:payment_provider_failure:ratio_rate5m{environment="prod"}
   sli:payment_provider:seconds_p95{environment="prod"}
   sum by (result, source) (bank_payment_provider_calls_total{environment="prod"})
   ```
3. Loki:
   ```logql
   {service_name="payment-service", deployment_environment="prod"} |= "simulated provider failure"
   {service_name="payment-service", deployment_environment="prod"} |~ "provider simulation (update|reset)"
   ```

**Resultado esperado.**
- La tasa de fallo sube durante la simulación, separada por `source`:
  - `runtime`: inyectado por el admin.
  - `configuration`: tasas del ConfigMap.
  - `scenario`: `paymentScenario` de la transferencia.
- El p95 refleja la latencia configurada.
- Logs `warn`, mensaje `simulated provider failure`, con:
  - `simulated: true`, `source: "runtime"`
  - `providerResult: "FAILURE"`|`"TIMEOUT"`, `attempt`, `outcome: "retrying"`|`"exhausted"`
  - `correlationId`, `traceId`, `spanId`
- Y `provider simulation update` / `provider simulation reset`, con los valores fijados.

**Evidencia a capturar.** Los dos paneles y las líneas de log.

---

## C. Extensión funcional — Notification & Audit Service y logs (§4.1)

### F3-AUD-01 — Logs recolectados por un agente de infraestructura y almacenados en Loki (no por el broker)

**Requisito.** *Recolectar los logs de todos los servicios mediante un agente de
infraestructura (OpenTelemetry Collector, Fluent Bit o Promtail); los servicios no envían
sus logs a este microservicio por el broker; almacenar logs en ELK o Loki.*
**Página(s): 6–7** (y §8.1 «Logging centralizado», p. 16).

**Precondiciones.** Acceso con `k-gke.sh`.

**Cómo probarlo.**
1. `tmp/t60/k-gke.sh -n observability get daemonset,pods`. Aparecen el DaemonSet
   `otel-log-agent` (un pod por nodo), `loki-0`, `otel-gateway`, `tempo-0`, `prometheus-server` y `grafana`.
2. Explore → Loki → *Label browser*: `service_name` lista los siete componentes
   (`gateway`, `customer-service`, `account-service`, `transaction-service`,
   `payment-service`, `notification-audit-service`, `partner-bank-mock`), más los del sistema GKE.
3. Que no hay logs por el broker: en Explore → Prometheus,
   ```promql
   sum by (messaging_destination_name) (rate(messaging_client_sent_messages_total{environment="prod"}[1h]))
   ```
   No aparece ningún exchange ni cola de logs. Las colas de auditoría son
   `audit.customer|account|transaction|payment|alert|query`, y son de eventos de negocio.

**Resultado esperado.**
- El agente es un DaemonSet de OTel Collector que lee stdout del nodo.
- Loki tiene los siete servicios.
- No existe ningún flujo de logs por RabbitMQ.

**Evidencia a capturar.** Salida de `get daemonset,pods`; label browser de Loki.

### F3-AUD-02 — Clasificación INFO / WARNING / ERROR

**Requisito.** *Clasificar eventos de auditoría y logs: INFO, WARNING, ERROR.* **Página(s): 6–7.**

**Precondiciones.** Ninguna.

**Cómo probarlo.**
1. Admin → `/auditoria`. Tiles **«Info hoy»**, **«Advertencia hoy»**, **«Error hoy»**.
   Filtro **Nivel** = «Advertencia» → **Buscar**.
2. Explore:
   ```promql
   sum by (family, severity) (increase(bank_audit_events_total{environment="prod"}[24h]))
   ```
3. Logs: dashboard **Bank USAC · Logs** → panel **«Volumen de log por nivel»**.

**Resultado esperado.**
- Severidades exactamente `INFO`, `WARNING`, `ERROR`, por familia (`customer`, `account`,
  `transaction`, `payment`, `alert`). Ejemplos:
  - Una compensación es ERROR en `transaction`.
  - Una anomalía es WARNING en `account`.
- Los logs, con `level` ∈ `info`·`warn`·`error`·`debug`.

**Evidencia a capturar.** Tiles y tabla filtrada; consulta.

### F3-AUD-03 — Consulta histórica por correlationId, traceId, servicio y nivel a través del Gateway

**Requisito.** *Exponer, a través del API Gateway, la consulta de eventos históricos por
correlationId, traceId, servicio y nivel.* **Página(s): 7.**

**Precondiciones.**
- Admin.
- El correlationId y el traceId de una transferencia (F3-TRX-02).

**Cómo probarlo.**
1. Frontend `/auditoria`:
   - Arriba, **Código de seguimiento** = el correlationId → **Consultar**. Aparece el rastro:
     - tabla Momento / Tipo de evento / Servicio origen / eventId / Registro / Severidad
     - botón **Detalle**, con el Payload y montos «[redactado]»
   - Card **«Últimos eventos del sistema»**: filtros **Código de seguimiento**, **Traza**,
     **Servicio**, **Nivel** → **Buscar**. Prueba cada filtro por separado y combinados.
2. API (sólo ADMINISTRADOR):
   ```bash
   curl -s "$G/api/audit?correlationId=<uuid>" -H "Authorization: Bearer $TA" | jq '.events[] | {messageType,producer,severity,traceId}'
   curl -s "$G/api/audit/recent?traceId=<32hex>&limit=20" -H "Authorization: Bearer $TA" | jq '.events[] | {messageType,producer,severity}'
   curl -s "$G/api/audit/recent?service=payment-service&severity=ERROR&limit=5" -H "Authorization: Bearer $TA" | jq '.total, .events[0]'
   curl -s "$G/api/audit/recent?traceId=XYZ" -H "Authorization: Bearer $TA"         # 400
   curl -s -o /dev/null -w '%{http_code}\n' "$G/api/audit/recent" -H "Authorization: Bearer $TC"   # 403
   ```
   Valores de `service`: `gateway`, `customer-service`, `account-service`,
   `transaction-service`, `payment-service`, `notification-audit-service`.
   `limit` va de 1 a 100.

**Resultado esperado.**
- Respuestas `{events:[…], total, page, limit}`, cada evento con:
  `eventId`, `messageType`, `producer`, `occurredAt`, `correlationId`, `traceId`,
  `processingStatus`, `severity` y `payload`, redactado.
- Un traceId mal formado da **400** con mensaje claro; un CLIENTE recibe **403**.

**Evidencia a capturar.** `/auditoria` con el rastro y con cada filtro; las respuestas de la API.

### F3-AUD-04 — Notificación al recibir `AccountAnomalyDetected` o una alerta de SLO

**Requisito.** *Generar una notificación al recibir AccountAnomalyDetected o una alerta
de SLO.* **Página(s): 7** (y p. 9, «Enviar las alertas a un canal visible … o Notification & Audit Service»).

**Precondiciones.** F3-ACC-02 hecho; una alerta disparada (F3-SLO-06), o la del pipeline.

**Cómo probarlo.**
1. Admin → `/auditoria/notificaciones`, filtro «Todos los estados».
2. API:
   ```bash
   curl -s "$G/api/audit/notifications?type=alert.slo&limit=5" -H "Authorization: Bearer $TA" | jq '.notifications[] | {subject,severity,status,createdAt}'
   curl -s "$G/api/audit/recent?service=gateway&limit=5" -H "Authorization: Bearer $TA" | jq '.events[] | select(.messageType=="alert.slo.received.v1") | {severity,payload}'
   ```

**Resultado esperado.**
- Tarjetas con los asuntos:
  - **«Detectamos actividad inusual en tu cuenta»**: WARNING, tipo `account.anomaly`.
  - **«Alerta de SLO activa: <Alerta>»**: severidad `ERROR` si la alerta es `critical`, `WARNING` si es `warning`.
  - **«Alerta de SLO resuelta: <Alerta>»**: INFO.
- Estado **Enviada**; destinatario simulado `operadores@simulado.bonking.gt`.
- En auditoría, `alert.slo.received.v1` con `payload.alerts[].alertName`, `status`, `slo`, `runbookUrl`.
- Si no disparaste nada, el despliegue deja `PipelineWebhookCheck` (enviada desde `cd.yml`).

**Evidencia a capturar.** Captura de la consola de notificaciones con al menos una de cada tipo.

### F3-AUD-05 — Dashboard de logs, búsqueda por correlationId y traceId, salto de log a traza

**Requisito.** *Dashboard de logs; búsqueda por correlationId y traceId; navegación desde un log hacia su traza.* **Página(s): 7.**

**Precondiciones.** Un correlationId y un traceId de una transferencia reciente.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Logs**. Variables:
   - **Entorno** = `prod`
   - **Servicio** = All
   - **Nivel** = All
   - **correlationId** = pega el UUID (el valor por defecto `.+` significa «todos»)
   - Paneles **«Volumen de log por nivel»**, **«Volumen de log por servicio»** y **«Logs»**.
2. Cambia **correlationId** por `.+` y pon el **traceId**.
3. En el panel **Logs**, expande una línea. En *Links* aparecen dos botones:
   - **«Ver la traza»** (derived field `TraceID` → Tempo). Púlsalo.
   - **«Ver el flujo completo»** (derived field `CorrelationID` → Loki).
4. De vuelta, de traza a log: en Tempo, en un span, pulsa **«Logs for this span»**.
5. Equivalente en Explore:
   ```logql
   {service_name=~".+", deployment_environment="prod"} | correlationId="<uuid>"
   {service_name=~".+", deployment_environment="prod"} | traceId="<32hex>"
   ```

**Resultado esperado.**
- El filtro por correlationId muestra líneas de **varios servicios**: gateway `http request`,
  transaction, account, payment y notification-audit.
- El salto abre la traza correcta en Tempo, en un panel dividido.
- «Logs for this span» devuelve las líneas con ese `traceId`.

**Evidencia a capturar.** Dashboard filtrado; captura del botón «Ver la traza» y de la traza abierta.

---

## D. Integración interbancaria (§4.1)

Requisitos generales de las páginas 7 y 8 (capacidades, estados, idempotencia, datos
mínimos, validaciones, mock, frontend, observabilidad, reglas de evaluación) y la
restricción de la p. 11 (HTTP asíncrono 202 + callback, entrando por el Gateway y
saliendo desde Payment).

Siempre que no se diga otra cosa:
- `destinationAccount` = `99-000000123` (el mock la acredita).
- Monto Q1.00 (`amountMinor: 100`).
- Origen = MONETARIA del cliente.

Función auxiliar de envío, por API, con la misma forma que usa el frontend:

```bash
ibsend() {   # $1 = amountMinor (def 100), $2 = destinationAccount, $3 = Idempotency-Key (def nueva), $4 = bank (def BANK99)
  curl -s -D /tmp/f3-ib.txt -X POST "$G/api/interbank/transfers" -H "Authorization: Bearer ${TOK:-$TC}" \
    -H 'Content-Type: application/json' -H "Idempotency-Key: ${3:-$(uuidgen)}" \
    -d "{\"sourceAccount\":\"$ORIG\",\"destinationBankCode\":\"${4:-BANK99}\",\"destinationAccount\":\"${2:-99-000000123}\",\"amount\":{\"amountMinor\":${1:-100},\"currency\":\"GTQ\"}}"; echo
  grep -iE '^x-(trace|correlation)-id' /tmp/f3-ib.txt
}
ib() { curl -s "$G/api/interbank/transfers/$1" -H "Authorization: Bearer $TC" | jq '{state:.send.state,reason:.send.reason,expiresAt:.send.expiresAt,reversedAt:.send.reversedAt,releasedUnverified:.send.releasedUnverified,reversal:.send.reversal,traceId:.send.traceId,history:[.history[]|"\(.at) \(.state) \(.reason // "")"]}'; }
```

### F3-IB-01 — Envío con ACCEPT: Saga, reserva, 202 y callback ACCEPTED

**Requisito.** *Transaction Service inicia la Saga y Account reserva el monto; Payment
envía la solicitud al API Gateway del banco pareja y recibe 202; el pareja confirma por
callback; si es ACCEPTED, el débito se confirma. Estados PENDING, SENT, ACCEPTED,
REJECTED, TIMEOUT, REVERSED. Datos mínimos: interbankTransferId, idempotencyKey, banco
origen, banco destino, cuenta destino, monto, moneda GTQ, timestamp y traceparent.*
**Página(s): 7** (restricción HTTP: **p. 11**).

**Precondiciones.**
- Mock en `ACCEPT` (`curl -s $M/health | jq .faults.mode`).
- Sesión del cliente. `bal`.

**Cómo probarlo.**
1. Frontend `/transferencias/interbancaria` (**«Depósito a otro banco»**):
   - **Cuenta de origen** = Monetaria
   - **Código del banco de destino** = `BANK99`
   - **Cuenta de destino en ese banco** = `99-000000123`
   - **Monto** = `1.00`
   - **Revisar el depósito** → **Confirmar y enviar**.
2. Se redirige a `/transferencias/interbancarias/<interbankTransferId>?transferencia=<transactionId>`.
   La pantalla dice «Esta pantalla se actualiza sola.»
3. Observa **«Estado del depósito»** e **«Historial del depósito»**.
4. Lo que vio el mock: `mock $M/admin/received | jq '.items[-1]'`.
   Contiene `interbankTransferId`, `originBankCode BANK02`, `destinationBankCode BANK99`,
   `originAccount 02-000000008`, `destinationAccount`, `amount "1.00"`, `currency GTQ`,
   `createdAt`, `expiresAt` = createdAt + 180 s, y el `traceparent` recibido.
5. Por API: `ibsend` → `{transactionId, interbankTransferId, correlationId}`; luego `ib <interbankTransferId>`.

**Resultado esperado.**
- Estados **«Por enviar»** (PENDING) → **«Esperando al otro banco»** (SENT) → **«Acreditado»** (ACCEPTED), en unos 2–3 s.
- Historial:
  - «Depósito registrado»
  - «Solicitud entregada al otro banco»
  - «El otro banco acreditó el depósito»
- Saldo de la MONETARIA −Q1.00; la transferencia `/transferencias/<transactionId>` queda **Completada**.
- La cuenta destino se muestra enmascarada (`********0123`).
- Badge **«Código de seguimiento del depósito»** y **«Traza»**.

**Evidencia a capturar.** Pantalla del depósito en «Acreditado» con su historial; JSON de `/admin/received`.

### F3-IB-02 — REJECTED → compensación y saldo restaurado

**Requisito.** *Si es REJECTED … se ejecuta la compensación y se libera el monto.*
**Página(s): 7** (§8.2 2.9 p. 22; penalización p. 23).

**Precondiciones.** `bal`.

**Cómo probarlo.**
1. `mock -X PUT $M/admin/config -d '{"mode":"REJECT","rejectReason":"ACCOUNT_NOT_FOUND"}' | jq .faults`.
2. Envía un depósito de Q1.00 por el frontend o con `ibsend`.
3. Mira la pantalla del depósito y la transferencia asociada (botón **«Ver la transferencia»**).
4. `bal`.
5. **Restaura**: `mock -X POST $M/admin/reset`.
6. Variante sin cambiar el modo: en `ACCEPT`, envía a `99-999999999` → `ACCOUNT_NOT_FOUND`, o a `99-000000000` → `ACCOUNT_INACTIVE`.

**Resultado esperado.**
- Estado **«Rechazado»**, con el motivo en **«Por qué no se completó»**, y luego **«Devuelto»** (REVERSED).
- El historial termina en «El dinero volvió a la cuenta de origen».
- La transferencia queda **Compensada** (`reason PAYMENT_DECLINED`).
- **Saldo final = saldo inicial**: dos movimientos, débito y compensación.
- La traza tiene `payment.interbank send` con `bank.interbank.stage=REJECTED`, `saga.compensation ordered` y `saga.compensation completed`.

**Evidencia a capturar.** Pantalla en «Devuelto», `bal` antes y después, traza con la compensación.

### F3-IB-03 — El pareja no confirma (TIMEOUT): reserva retenida, consulta, cancelación y devolución

**Requisito.** *Si … vence el tiempo de espera, se ejecuta la compensación y se libera el
monto.* El contrato fija el protocolo: TIMEOUT a los 180 s con el monto reservado →
`GET /transfers/{id}` → `POST /cancel` → REVERSED. **Página(s): 7** (y §4.1 «El banco
pareja no responde», p. 10).

**Precondiciones.** `bal`. Reserva **unos 4 minutos** de espera.

**Cómo probarlo.**
1. `mock -X PUT $M/admin/config -d '{"mode":"TIMEOUT","statusBehavior":"PROCESSING"}'`.
   El mock contesta 202 y nunca manda callback; su `GET` responde `PROCESSING`.
2. Envía Q1.00 y anota la hora. Deja abierta la pantalla del depósito.
3. Mira la pantalla:
   - Del segundo 0 al 180 → **«Esperando al otro banco»**. **«El otro banco debía
     confirmar antes de»** = `expiresAt`, es decir creación + 180 s.
   - Pasado el segundo 180 → **«Sin respuesta»** (TIMEOUT), con la alerta
     «Por qué seguimos esperando». El dinero **sigue retenido**.
   - Pocos segundos después → **«Devuelto»**.
4. `mock $M/admin/received/<id> | jq '.status'` → `CANCELLED`.
5. `ib <id>` y `bal`.
6. **Restaura**: `mock -X POST $M/admin/reset`.

**Resultado esperado.**
- Historial: «Depósito registrado» → «Solicitud entregada al otro banco» → «El otro banco
  no confirmó a tiempo» → «El dinero volvió a la cuenta de origen».
- `reason` `CANCELLED_AT_PARTNER`; `releasedUnverified: false`.
- Saldo final = inicial.
- `bank_interbank_sent_total{result="timeout"}` +1.
- **No** se devolvió el dinero antes de los 180 s.

**Evidencia a capturar.** Capturas a t≈30 s (SENT), t≈185 s (TIMEOUT) y al final (REVERSED); `bal`.

### F3-IB-04 — El pareja no contesta ni la consulta ni la cancelación: liberación a ciegas a los 180 + 300 s y alerta

**Requisito.** Mismo requisito de vencimiento (**p. 7**), más *SLO y alerta específicos
para la dependencia con el banco pareja* (**p. 8**). El contrato exige alertar en la
liberación sin confirmación.

**Precondiciones.** Reserva **unos 9 minutos**: 180 s de TTL + 300 s de margen + barrido + 1 min de evaluación de la alerta.

**Cómo probarlo.**
1. `mock -X PUT $M/admin/config -d '{"mode":"TIMEOUT","statusBehavior":"UNREACHABLE"}'`.
   El mock corta la conexión en el `GET` y en el `cancel`.
2. Envía Q1.00 y anota la hora y el `interbankTransferId`.
3. A los ~3 min: **«Sin respuesta»**, y el dinero sigue retenido.
4. A los ~8 min (180 + 300 s): **«Devuelto»**, con la alerta **«El dinero volvió sin confirmación del otro banco»**.
5. Grafana → *Alerting → Alert rules* → **InterbankReserveReleasedUnverified**: pasa a *Firing*, sin `for`.
6. Loki:
   ```logql
   {service_name="payment-service", deployment_environment="prod"} |~ "RELEASED_NO_ANSWER|RELEASED_UNKNOWN_AT_PARTNER"
   ```
7. **No restaures todavía** si vas a hacer F3-IB-05 con este mismo depósito. Si no, `mock -X POST $M/admin/reset`.

**Resultado esperado.**
- `reason: RELEASED_NO_ANSWER`, `releasedUnverified: true`.
- Saldo final = inicial.
- Alerta `critical` con runbook `partner-bank.md`.
- La notificación «Alerta de SLO activa: InterbankReserveReleasedUnverified», severidad ERROR, en `/auditoria/notificaciones`.

**Evidencia a capturar.** Pantalla con la alerta «sin confirmación»; la regla en Firing; la notificación.

### F3-IB-05 — ACCEPTED tardío sobre un depósito ya devuelto: reverso, sin doble crédito

**Requisito.** *Idempotencia obligatoria … nunca debe acreditar dos veces* (**p. 7**) y
penalización *«Depósito interbancario duplicado o monto perdido sin compensación: 50 %»*
(**p. 23**). El contrato: un ACCEPTED sobre una transferencia ya REVERSED se registra como
incidente ERROR y se pide `POST /reversals`.

**Precondiciones.**
- Un depósito ya en **«Devuelto»**: el de F3-IB-04, o uno de F3-IB-03 hecho sin resetear el mock.
- `bal`.

**Cómo probarlo.**
1. Deja que el mock vuelva a contestar: `mock -X PUT $M/admin/config -d '{"statusBehavior":"PROCESSING","reversal":"COMPLETE"}'`.
2. Fuerza el callback tardío: `mock -X POST $M/admin/received/<interbankTransferId>/callback -d '{"status":"ACCEPTED"}' | jq`.
3. Unos 10–30 s después: `ib <id>`, la pantalla del depósito y `bal`.
4. Loki:
   ```logql
   {service_name="payment-service", deployment_environment="prod"} |= "interbank v1 reversal requested"
   ```
5. `mock $M/admin/received/<id> | jq` muestra el reverso recibido.
6. **Restaura**: `mock -X POST $M/admin/reset`.

**Resultado esperado.**
- La pantalla muestra la card **«Reverso pedido al otro banco»**, con la insignia que avanza hasta **«Completado»**.
- El estado sigue siendo **«Devuelto»**.
- Una línea `error` `interbank v1 reversal requested` con el `correlationId`.
- **El saldo no cambia**: el dinero ya había vuelto y no se acredita ni se debita otra vez.
- El mock registra el reverso, de modo que nadie queda con el monto dos veces.

**Evidencia a capturar.** Card del reverso, línea de log, `bal` igual antes y después.

### F3-IB-06 — Recepción desde el pareja, acreditada una sola vez aunque se repita

**Requisito.** *La solicitud entra por el API Gateway autenticada con la API key (Secret
de K8s); Payment valida la cuenta destino y publica un evento; Account acredita; el banco
responde por callback (ACCEPTED o REJECTED con motivo). Idempotencia: un reintento del
pareja nunca acredita dos veces.* **Página(s): 7.**

**Precondiciones.** Mock en `ACCEPT`. `bal`.

**Cómo probarlo.**
1. Que la API key la aplica el Gateway:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$G/interbank/v1/transfers" -H 'Content-Type: application/json' -d '{}'   # 401 sin X-Api-Key
   tmp/t60/k-gke.sh -n prod get secret -o name | grep -i -E 'interbank|bank-usac'   # sólo el nombre, nunca el valor
   ```
2. El mock origina un depósito de Q1.00 hacia nuestra MONETARIA y lo **repite 3 veces**, con la misma Idempotency-Key:
   ```bash
   mock -X POST $M/admin/transfers -d '{"destinationAccount":"02-000000008","amount":"1.00","repeat":3}' | jq '{interbankTransferId, traceId, sends:[.sends[].httpStatus]}'
   ```
3. A los ~5 s: `bal` y `mock $M/admin/transfers/<interbankTransferId> | jq '{status, callbacks}'`.
4. Como cliente, `/cuentas/b0000000-0000-4000-8000-000000000003` → tabla **«Movimientos»**.
5. Explore:
   ```promql
   sum by (result) (bank_interbank_deposits_total{environment="prod"})
   ```

**Resultado esperado.**
- `sends` = `[202, 200, 200, 200]`: la primera se acepta y las repetidas devuelven el estado actual.
- **Un solo crédito** de Q1.00: saldo +100 centavos, un movimiento.
- Callback del banco al mock con `status: ACCEPTED`.
- `bank_interbank_deposits_total{result="accepted"}` +1, no +4.
- Spans `payment.interbank state` (stage ELIGIBILITY → CREDIT → ACCEPTED).

**Evidencia a capturar.** Respuesta de `/admin/transfers` con los cuatro `httpStatus`; saldo antes y después; movimiento único.

### F3-IB-07 — Validaciones de la recepción: cuenta inexistente o inactiva, monto, banco, conflicto y vencido

**Requisito.** *Validaciones: cuenta destino existente y activa … y monto máximo por
operación configurable* (**p. 7**). Contrato: `409` si se repite el id con contenido
distinto; `422` si ya venció.

**Precondiciones.** Mock en `ACCEPT`. Para el caso de cuenta inactiva, admin.

**Cómo probarlo.** Ejecuta cada caso y luego mira el callback con `mock $M/admin/transfers/<id> | jq '.callbacks'`.

| Caso | Comando | Esperado |
| --- | --- | --- |
| Cuenta inexistente | `mock -X POST $M/admin/transfers -d '{"destinationAccount":"02-999999999","amount":"1.00"}'` | 202 y callback `REJECTED`, `reasonCode ACCOUNT_NOT_FOUND`; sin crédito |
| Monto > Q10,000.00 | `… -d '{"destinationAccount":"02-000000008","amount":"10000.01"}'` | `REJECTED`, `AMOUNT_LIMIT_EXCEEDED`; saldo sin cambio |
| Banco destino equivocado | `… -d '{"destinationAccount":"02-000000008","amount":"1.00","overrides":{"destinationBankCode":"BANK55"}}'` | `REJECTED`, `PROCESSING_ERROR` (así traduce el contrato `WRONG_DESTINATION_BANK`) |
| Conflicto de idempotencia | `ID=$(uuidgen \| tr A-Z a-z)`; `… -d "{\"destinationAccount\":\"02-000000008\",\"amount\":\"1.00\",\"interbankTransferId\":\"$ID\"}"` y luego el mismo `$ID` con `"amount":"2.00"` | Primero 202 y crédito de Q1.00; segundo **409**, sin un segundo crédito |
| Vencido | `… -d '{"destinationAccount":"02-000000008","amount":"1.00","expiresInSeconds":0}'` | **422** del Gateway, sin procesar |
| Cuenta inactiva | Admin → `/cuentas/b0000000-0000-4000-8000-000000000004` → **Desactivar cuenta**, Motivo «Prueba F3» → **Confirmar desactivación**. Luego `… -d '{"destinationAccount":"02-000000009","amount":"1.00"}'`. Después **Activar cuenta** → **Confirmar activación** | `REJECTED`, `ACCOUNT_INACTIVE`; la cuenta **no** se reactiva sola por este flujo |

**Resultado esperado.**
- Cada rechazo llega por callback con su motivo, sin tocar el saldo.
- `bank_interbank_deposits_total{result="rejected"}` sube.
- En Loki, `interbank deposit state changed` con el motivo y **sin montos ni tokens**.

**Evidencia a capturar.** Tabla con el `httpStatus`/`reasonCode` de cada caso y el saldo invariante. **Reactiva la cuenta de Ahorro.**

### F3-IB-08 — Validaciones del envío: límite, banco, moneda, KYC y cuenta ajena

**Requisito.** *Validaciones: … cliente origen con KYC verificado (Fase 2) y monto máximo
por operación configurable.* **Página(s): 7.**

**Precondiciones.** Sesión del cliente; `bal`.

**Cómo probarlo.**
1. Frontend `/transferencias/interbancaria`, **Monto** `10000.01`. El formulario bloquea con
   «El monto máximo por depósito a otro banco es Q 10,000.00.»
2. API:
   ```bash
   ibsend 1000001                              # 400, límite (INTERBANK_MAX_AMOUNT_MINOR=1000000)
   ibsend 100 99-000000123 "" BANK55           # 400, banco que no es el pareja configurado
   curl -s -X POST "$G/api/interbank/transfers" -H "Authorization: Bearer $TC" -H 'Content-Type: application/json' \
     -H "Idempotency-Key: $(uuidgen)" -d "{\"sourceAccount\":\"$ORIG\",\"destinationBankCode\":\"BANK99\",\"destinationAccount\":\"99-000000123\",\"amount\":{\"amountMinor\":100,\"currency\":\"USD\"}}"   # 400, moneda
   curl -s -X POST "$G/api/interbank/transfers" -H "Authorization: Bearer $TC" -H 'Content-Type: application/json' \
     -H "Idempotency-Key: $(uuidgen)" -d '{"sourceAccount":"c0000000-0000-4000-8000-00000000000a","destinationBankCode":"BANK99","destinationAccount":"99-000000123","amount":{"amountMinor":100,"currency":"GTQ"}}'   # 404, cuenta que no es suya
   bal                                          # sin cambios
   ```
3. **KYC.** El KYC del envío es la misma puerta de la Saga que abre toda transferencia.
   En prod no se puede iniciar sesión con un CLIENTE no verificado: el autoservicio
   necesita el enlace de activación, que está enmascarado. Para ver la puerta:
   - Como cajero, registra un cliente por `/registro`, sin aprobarlo.
   - Ábrele una cuenta (`/cuentas/nueva`, o `POST /api/accounts` con `customerId`).
   - Deposítale Q5.00 en `/cuentas/deposito`.
   - Origina una transferencia interna desde esa cuenta en `/transferencias/nueva`.
   - Esperado: la pantalla avisa «Cliente titular no verificado». Por API, `POST /api/transfers`
     con `customerId` termina en **Fallida**, `reason KYC_NOT_VERIFIED`, sin débito.

**Resultado esperado.**
- Todos los rechazos de borde son **400/404 sin débito**; el saldo no cambia.
- El KYC no verificado cierra la Saga en FAILED, antes de mover dinero.

**Evidencia a capturar.** Respuestas 400/404; `bal`; la transferencia FAILED por KYC.

### F3-IB-09 — Reintento idempotente del envío con la misma `Idempotency-Key`

**Requisito.** *Idempotencia obligatoria mediante idempotencyKey.* **Página(s): 7.**

**Precondiciones.** Mock en `ACCEPT`; `bal`.

**Cómo probarlo.**
```bash
K=$(uuidgen)
ibsend 100 99-000000123 "$K"; ibsend 100 99-000000123 "$K"; ibsend 100 99-000000123 "$K"
bal; mock $M/admin/received | jq '[.items[] | select(.request.amount=="1.00")] | length'
```

**Resultado esperado.**
- Las tres respuestas devuelven **el mismo** `transactionId` e `interbankTransferId`.
- Un solo débito de Q1.00 y un solo depósito recibido por el mock.

**Evidencia a capturar.** Las tres respuestas y el saldo.

### F3-IB-10 — Roles: sólo CLIENTE origina; CAJERO y ADMIN reciben 403

**Requisito.** *Frontend: enviar depósitos al banco pareja …* (**p. 7**) junto con la
matriz de roles D-06 del sistema: un envío es un producto del cliente sobre sus cuentas.

**Precondiciones.** `$TJ`, `$TA`.

**Cómo probarlo.**
```bash
TOK=$TJ ibsend; TOK=$TA ibsend        # 403 FORBIDDEN en ambos
curl -s "$G/api/interbank/transfers?limit=3" -H "Authorization: Bearer $TJ" | jq '.sends | length'   # el cajero ve todos (lectura)
```

**Resultado esperado.**
- `{"type":"FORBIDDEN","message":"Tu rol no tiene permitido realizar esta operación.",…}` con 403, sin débito.
- Lectura: el CLIENTE ve los suyos; CAJERO y ADMIN ven todos.

**Evidencia a capturar.** Las dos respuestas 403.

### F3-IB-11 — El mismo traceId en los dos bancos

**Requisito.** *Propagar el traceparent hacia y desde el banco pareja, para relacionar un
depósito entre ambos bancos con el mismo traceId.* **Página(s): 8** (§8.2 2.9 p. 22).

**Precondiciones.** Un envío ACCEPT (F3-IB-01) y una recepción (F3-IB-06), con sus traceIds.

**Cómo probarlo.**
1. Envío: el `traceId` de `ib <id>` (o de la línea «Traza» de la pantalla). En Tempo, pégalo.
2. Recepción: el `traceId` que devuelve `POST /admin/transfers`. Pégalo en Tempo.
3. TraceQL:
   ```traceql
   {resource.service.name="partner-bank-mock" && name=~"POST /interbank/v1/transfers.*"}
   {name="payment.interbank send"}
   {name="payment.interbank state"}
   ```

**Resultado esperado.**
- **Envío**: una sola traza con:
  - `gateway POST /api/interbank/transfers`
  - … `payment-service payment.interbank send` (PENDING) → `POST` (CLIENT, 202)
  - → **`partner-bank-mock POST /interbank/v1/transfers`** (SERVER, `bank.interbank.transfer_id`)
  - → `payment.interbank send` (SENT)
  - → **`partner-bank-mock POST /interbank/v1/transfers/{id}/result`** (CLIENT)
  - → `gateway POST /interbank/v1/transfers/:interbankTransferId/result` (SERVER)
  - → `payment.interbank send` (ACCEPTED) → … → `saga.step CREDITED`
- **Recepción**: la raíz es `partner-bank-mock POST /interbank/v1/transfers`, y el Gateway, Payment y Account cuelgan de ella.

**Evidencia a capturar.** Las dos trazas con los spans del mock resaltados.

### F3-IB-12 — Métricas interbancarias: éxito enviados y recibidos, p95 de confirmación, timeouts

**Requisito.** *Métrica: tasa de éxito de depósitos interbancarios (enviados y recibidos);
métrica: latencia de confirmación del banco pareja (p95) y número de timeouts.* **Página(s): 8.**

**Precondiciones.** F3-IB-01 a 06 ejecutados.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Banco pareja**:
   - **Mitad de arriba (recibidos)**:
     - «Depósitos aceptados (SLO-28 ≥ 95 %)»
     - «Confirmación p95»
     - «Error budget restante»
     - «Depósitos en la última hora»
     - «Depósitos recibidos por resultado»
     - «Callbacks que enviamos, por resultado»
     - «Latencia de confirmación por resultado (p95)»
     - «Cambios de estado de cada depósito»
   - **Mitad de abajo, «La otra mitad del enlace: lo que ESTE banco envía»**:
     - «Depósitos enviados y confirmados (SLO-28 ≥ 95 %)»
     - «Confirmación del envío, p95»
     - «Error budget del envío»
     - «Vencimientos en la última hora»
     - «Depósitos enviados por resultado»
     - «Latencia de confirmación del envío (p95)»
2. **Bank USAC · Métricas clave (SLI)** → **«Interbancario: tasa de éxito enviados y recibidos»**.
3. Explore:
   ```promql
   sli:interbank_accepted_by_direction:ratio_rate5m{environment="prod"}
   slo:interbank_sent_confirmation:seconds_p95{environment="prod"}
   sli:interbank_sent_timeouts:increase1h{environment="prod"}
   sum by (result) (bank_interbank_sent_total{environment="prod"})
   ```

**Resultado esperado.**
- Dos series de tasa de éxito: `direction="sent"` y `direction="received"`, sin promediar.
- `bank_interbank_sent_total` con `result` ∈ `accepted`·`rejected`·`timeout`. REVERSED no se cuenta, para no duplicar.
- Vencimientos ≥ 1 tras F3-IB-03/04.

**Evidencia a capturar.** Dashboard completo del banco pareja.

### F3-IB-13 — SLO-28 y sus alertas específicas para la dependencia del pareja

**Requisito.** *SLO y alerta específicos para la dependencia con el banco pareja.* **Página(s): 8.**

**Precondiciones.**
- Token de cliente, k6.
- **Unos 12 minutos**.
- Saldo MONETARIA ≥ Q250: van unos 210 depósitos de Q1.00, y todos vuelven.

**Cómo probarlo.**
1. `mock -X PUT $M/admin/config -d '{"mode":"REJECT"}'`.
2. Carga sostenida de 7 minutos a 0.5 depósitos/s:
   ```bash
   TASA=0.5 DURACION=7m k6 run -e GATEWAY_URL=$G -e PARTNER_BANK_CODE=BANK99 -e PARTNER_ACCOUNT=99-000000123 test/load/interbank.js
   ```
3. Grafana → *Alerting → Alert rules* → **PartnerBankSendDegraded**: *Pending* y luego *Firing* (`for: 5m` sobre `slo:interbank_sent_accepted:ratio_rate5m < 0.95`).
4. `/auditoria/notificaciones` → «Alerta de SLO activa: PartnerBankSendDegraded».
5. **Restaura**: `mock -X POST $M/admin/reset`. Unos minutos después llega «Alerta de SLO resuelta: …».
6. Variante lenta, para **PartnerBankSendConfirmationSlow** (p95 > 5 s durante 5 min):
   `mock -X PUT $M/admin/config -d '{"mode":"SLOW","slowMs":10000}'` + la misma carga. Restaura al terminar.

**Resultado esperado.**
- El SLI enviado cae a 0.
- El presupuesto del envío baja («Error budget del envío»).
- La alerta dispara con `severity: warning`, `slo: SLO-28` y runbook `docs/operations/runbooks/partner-bank.md`.
- **Todas las Sagas compensan**: saldo final = inicial; k6 termina con los checks en verde.

Las otras dos de SLO-28 son **PartnerBankDegraded** y **PartnerBankConfirmationSlow**:
miran lo **recibido**, con `for: 15m`, así que necesitan rechazos o lentitud entrantes
durante más de 15 min. No hacen falta para la calificación.

**Evidencia a capturar.** Regla en Firing, notificación, dashboard **Bank USAC · Banco pareja** durante la carga, salida de k6, `bal`.

### F3-IB-14 — Logs de cada cambio de estado del depósito, sin datos sensibles

**Requisito.** *Logs de cada cambio de estado del depósito, sin exponer datos sensibles.* **Página(s): 8.**

**Precondiciones.** F3-IB-01/02/06.

**Cómo probarlo.**
1. **Bank USAC · Banco pareja** → **«Cambios de estado de cada depósito»**.
2. Explore:
   ```logql
   {service_name="payment-service", deployment_environment="prod"} |~ "interbank (send|deposit) state changed|interbank callback (delivered|failed)"
   {service_name=~"payment-service|gateway|partner-bank-mock", deployment_environment="prod"} |~ "(?i)x-api-key|apikey|bearer [A-Za-z0-9._-]{20,}"
   ```

**Resultado esperado.**
- Envío: una línea `interbank send state changed` por estado (`status` PENDING/SENT/ACCEPTED/REJECTED/TIMEOUT/REVERSED).
- Recepción: `interbank deposit state changed` (ELIGIBILITY/CREDIT/ACCEPTED/REJECTED).
- Cada línea con `correlationId`, `depositId` y el motivo si aplica.
- **Sin monto, sin API key, sin token**: la segunda consulta da **0 líneas**.

**Evidencia a capturar.** Las dos consultas.

### F3-IB-15 — Frontend del depósito, mock del contrato y acuerdo de integración

**Requisito.**
- *Implementar un simulador (mock) del banco pareja que cumpla el contrato … para inyectar fallos.*
- *Frontend: enviar depósitos y consultar el estado de cada uno.*
- *Acuerdo de integración: documento breve con URLs, autenticación, cuentas de prueba y ventana.*

**Página(s): 7** (entregables p. 12; reglas de pareja p. 8).

**Precondiciones.** Ninguna.

**Cómo probarlo.**
1. `/transferencias/interbancarias` (**«Mis depósitos a otro banco»**):
   - Columnas Fecha / Destino / Estado / Monto, filtro «Todos los estados» con los seis estados.
   - **Ver →** abre el detalle.
2. Los seis estados y sus etiquetas:

   | Estado | Etiqueta |
   | --- | --- |
   | PENDING | Por enviar |
   | SENT | Esperando al otro banco |
   | ACCEPTED | Acreditado |
   | REJECTED | Rechazado |
   | TIMEOUT | Sin respuesta |
   | REVERSED | Devuelto |

3. Mock: `tmp/t60/k-gke.sh -n prod get deploy bank-usac-partner-bank-mock`. El contrato que
   sirve está en `docs/references/interbank-contract-v1.openapi.yaml`.
4. Acuerdo: [`docs/operations/INTERBANK-AGREEMENT.md`](../operations/INTERBANK-AGREEMENT.md),
   que apunta al `AGREEMENT.md` del repositorio `bank-interbank-contract`.

**Resultado esperado.**
- Las pantallas existen.
- Las reglas de evaluación en pareja (p. 8) se cumplen: los fallos se inyectan **sólo con el
  mock propio**, y ninguna prueba toca el sistema de otro grupo.

**Evidencia a capturar.** Listado filtrado; acuerdo.

---

## E. Instrumentación con OpenTelemetry (§4.1)

### F3-OTL-01 — Todos los servicios, incluido el Gateway, generan trazas y envían por OTLP al Collector

**Requisito.** *Todos los servicios, incluido el API Gateway, deben generar trazas
distribuidas con traceId y spanId … enviar la telemetría por OTLP a un OpenTelemetry
Collector desplegado en el cluster.* **Página(s): 8** (alcance p. 10; §8.1 p. 16; §8.2 2.1 p. 20).

**Precondiciones.** Ninguna.

**Cómo probarlo.**
1. `tmp/t60/k-gke.sh -n prod get configmap bank-usac-config -o jsonpath='{.data.OTEL_EXPORTER_OTLP_ENDPOINT} {.data.OTEL_SDK_DISABLED}'`
   → `http://otel-gateway.observability.svc.cluster.local:4318 false`.
2. Explore → Tempo → *Search* → **Service Name**: deben aparecer `gateway`, `customer-service`,
   `account-service`, `transaction-service`, `payment-service`, `notification-audit-service` y `partner-bank-mock`.
3. Explore → Prometheus:
   ```promql
   count by (service_name) (last_over_time(messaging_client_consumed_messages_total{environment="prod"}[1h]))
   ```
4. En el código: `apps/<servicio>/src/instrumentation.ts` y el paquete `@bank/observability`.

**Resultado esperado.** Los siete componentes con trazas y métricas; el endpoint OTLP es el Collector del namespace `observability`.

**Evidencia a capturar.** Lista de servicios en Tempo; la consulta.

### F3-OTL-02 — Propagación W3C `traceparent` por el broker: productor y consumidor en la misma traza

**Requisito.** *Propagar el contexto con W3C Trace Context (traceparent) en los headers de
cada mensaje del broker (… propiedades AMQP de RabbitMQ …), de modo que productor y
consumidor queden en la misma traza.* **Página(s): 8** (§8.1 «Trazabilidad distribuida» p. 16; §8.2 2.2 p. 20; penalización p. 22).

**Precondiciones.** Un traceId de transferencia interna (F3-TRX-02).

**Cómo probarlo.**
1. Tempo, la traza completa. Comprueba que cada `publish <exchange>` (PRODUCER) tiene como
   hijo un `process <cola>` (CONSUMER) **de otro servicio**.
2. TraceQL:
   ```traceql
   {span.messaging.system="rabbitmq" && kind=consumer && resource.service.name="account-service"}
   {kind=client && span.server.address=~"bank-usac-(customer|account|transaction|payment|notification-audit)-service.*"}
   ```

**Resultado esperado.**
- Una traza recorre gateway → transaction → customer → account → payment → transaction → account → notification-audit.
- Los spans de mensajería llevan `messaging.system=rabbitmq`, `messaging.destination.name`, `bank.message.type` y `bank.delivery.outcome`.
- La segunda consulta (HTTP entre servicios) devuelve **0 trazas**.

**Evidencia a capturar.** Traza con la cadena PRODUCER → CONSUMER entre servicios; la consulta en 0.

### F3-OTL-03 — correlationId como atributo de span (también en el SERVER del Gateway) y en los logs

**Requisito.** *Mantener el correlationId de la Fase 1 como atributo del span y en los
logs: el traceId identifica la traza técnica y el correlationId el flujo de negocio.*
**Página(s): 8** (§8.2 2.2 p. 20).

**Precondiciones.** El `x-correlation-id` de una transferencia.

**Cómo probarlo.**
1. Tempo: `{span.bank.correlation_id="<x-correlation-id>"}`. En la traza, el span
   **`POST /api/transfers`** del Gateway (SERVER) tiene `bank.correlation_id`, y también los spans de mensajería y de dominio.
2. Loki: `{service_name=~".+", deployment_environment="prod"} | correlationId="<x-correlation-id>"`.
3. Cabeceras de respuesta: `X-Correlation-Id` y `X-Trace-Id`, expuestas a CORS (`grep -i x- /tmp/f3-h.txt`).

**Resultado esperado.**
- El mismo correlationId en el span SERVER del Gateway, en cada span de mensajería y en las líneas JSON de todos los servicios.
- Una transferencia de interbancario muestra que la decisión del pareja llega con otro correlationId (el del callback), pero en la **misma** traza.

**Evidencia a capturar.** Atributos del span SERVER; consulta de Loki.

### F3-OTL-04 — Convenciones semánticas de OpenTelemetry

**Requisito.** *Seguir las convenciones semánticas de OpenTelemetry para nombrar spans,
métricas y atributos.* **Página(s): 8.**

**Precondiciones.** Ninguna.

**Cómo probarlo.**
1. En una traza revisa los nombres:
   - `POST /api/transfers` con `http.route`, `http.response.status_code`
   - `publish bank.commands`, `process account.commands`, con `messaging.system`, `messaging.destination.name`
   - `pg.query:…`
2. Prometheus:
   ```promql
   count by (__name__) ({__name__=~"http_server_request_duration_seconds_count|messaging_client_sent_messages_total|messaging_client_consumed_messages_total|messaging_process_duration_seconds_count"})
   ```
3. Catálogo: [`docs/sre/telemetry-catalog.md`](../sre/telemetry-catalog.md).

**Resultado esperado.**
- Nombres estándar: `http.server.request.duration`, `messaging.client.*`.
- Los atributos propios del banco van bajo el prefijo `bank.*`.

**Evidencia a capturar.** Atributos de un span HTTP y uno de mensajería.

---

## F. Métricas (SLI base) (§4.1)

### F3-SLI-01 — Latencia de transacciones en percentiles

**Requisito.** *Latencia de transacciones en percentiles p50, p95 y p99 (histogramas, no
promedios).* **Página(s): 8** (§8.2 2.4 p. 20).

**Cómo probarlo.**
- Ver F3-TRX-01.
- Para el Gateway: **Bank USAC · Métricas clave (SLI)** → **«Latencia del Gateway por método (p95)»**.
- Explore:
  ```promql
  sli:gateway_latency:seconds_p50{environment="prod"}
  sli:gateway_latency:seconds_p95{environment="prod"}
  sli:gateway_latency:seconds_p99{environment="prod"}
  ```

**Resultado esperado.**
- Series por `http_request_method` (GET/POST). `NaN` en un método sin tráfico en 5 min es correcto.
- No hay `_sum/_count` en ningún panel de latencia.

**Evidencia a capturar.** El panel.

### F3-SLI-02 — Tasa de errores

**Requisito.** *Tasa de errores.* **Página(s): 8.**

**Cómo probarlo.**
1. **Bank USAC · Errores en tiempo real**:
   - **«5xx del Gateway (por segundo)»**
   - **«Entregas a la cola muerta (por segundo)»**
   - **«Mensajes ilegibles en auditoría (por segundo)»**
   - **«Entregas que no terminaron en ack, por cola»**
   - **«Transferencias que terminaron en FAILED, por motivo»**
   - **«Todos los errores, de todos los servicios»** (Loki, `| level="error"`)
2. **Bank USAC · Estado del sistema** → **«Respuestas 5xx del Gateway por ruta»**.
3. Explore:
   ```promql
   sum(rate(http_server_request_duration_seconds_count{service_name="gateway", environment="prod", http_response_status_code=~"5.."}[5m])) or vector(0)
   sli:transfer_outcome:ratio_rate5m{environment="prod", result!="completed"}
   ```

**Resultado esperado.** Valores en 0 con el sistema sano. Suben durante F3-FAIL-03 (broker) y F3-PAY-02.

**Evidencia a capturar.** Dashboard de errores.

### F3-SLI-03 — Throughput por servicio y por cola

**Requisito.** *Throughput (eventos por segundo por servicio y por tópico/cola).* **Página(s): 8.**

**Cómo probarlo.**
1. Paneles:
   - **Bank USAC · Estado del sistema** → **«Throughput por servicio: consumido y publicado (mensajes/s)»**
   - **Bank USAC · Métricas clave (SLI)** → **«Throughput por cola (mensajes/s)»** y **«Mensajes publicados por servicio (mensajes/s)»**
   - **Bank USAC · Consumer lag del broker** → **«Consumo por cola (mensajes/s)»** y **«Publicación por exchange (mensajes/s)»**
2. Explore:
   ```promql
   sli:throughput_by_service:rate5m{environment="prod"}
   sli:throughput_by_queue:rate5m{environment="prod"}
   sli:published_by_exchange:rate5m{environment="prod"}
   ```

**Resultado esperado.**
- Series por `service_name` y por `messaging_destination_name` (colas como `transaction.saga`,
  `account.commands`, `payment.commands`, `audit.*`).
- Suben con cada transferencia.

**Evidencia a capturar.** Los paneles durante la carga de F3-LOAD-01.

### F3-SLI-04 — Consumer lag del broker

**Requisito.** *Consumer lag del broker (mensajes pendientes por consumidor).* **Página(s): 8.**

**Cómo probarlo.**
1. Dashboard **Bank USAC · Consumer lag del broker**:
   - **«De dónde sale»**
   - **«Cola más atascada (mensajes pendientes)»**
   - **«Total pendiente en el broker»**
   - **«Entregado sin confirmar (unacked)»**
   - **«Mensajes pendientes por cola»**
   - **«Entregado sin confirmar por cola»**
   - **«Tiempo de proceso por cola (p95)»**
2. Explore:
   ```promql
   sli:broker_consumer_lag:messages{environment="prod"}
   max by (environment) (sli:broker_consumer_lag:messages)
   sli:broker_unacked:messages{environment="prod"}
   ```
3. Para verlo moverse: durante F3-FAIL-02 o F3-LOAD-01 el lag de `transaction.saga` /
   `account.commands` sube por unos segundos y vuelve a 0.

**Resultado esperado.**
- Una serie por `queue`: ~60 colas por entorno, incluidas las `*.retry.*` y `*.dlq`. Es el
  plugin `rabbitmq_prometheus`, endpoint detallado.
- Valor 0 en reposo.

**Evidencia a capturar.** Dashboard de lag durante la carga.

### F3-SLI-05 — Disponibilidad del Gateway (respuestas no 5xx)

**Requisito.** *Disponibilidad: porcentaje de solicitudes exitosas (respuestas distintas de 5xx) en el API Gateway.* **Página(s): 8.**

**Cómo probarlo.**
1. **Bank USAC · Estado del sistema** → **«Disponibilidad del Gateway (SLO-27 ≥ 99 %)»**.
2. Explore:
   ```promql
   slo:gateway_availability:ratio_rate5m{environment="prod"}
   ```
3. Que `/health` y `/ready` quedan fuera: la regla filtra `http_route!~"/health|/ready"`
   (`infra/k8s/helm/bank-observability/values.yaml`, grupo `slo-gateway-availability`).

**Resultado esperado.** ≈ 1 en reposo. Baja durante F3-FAIL-03.

**Evidencia a capturar.** Stat y consulta.

### F3-SLI-06 — Sin etiquetas de alta cardinalidad

**Requisito.** *Métricas medidas sin etiquetas de alta cardinalidad.* **Página(s): 20** (§8.2 2.4); recomendación p. 15; Account p. 5.

**Cómo probarlo.**
```promql
count({__name__=~"bank_.*|messaging_.*|http_server_.*", account_id!=""} or {__name__=~"bank_.*|messaging_.*|http_server_.*", customer_id!=""} or {__name__=~"bank_.*|messaging_.*|http_server_.*", transaction_id!=""})
count by (http_route) (http_server_request_duration_seconds_count{service_name="gateway", environment="prod"})
```

**Resultado esperado.**
- La primera da vacío.
- La segunda lista rutas **plantilla** (`/api/transfers/:transactionId`), no URLs con UUID.
- Lo hace cumplir `apps/packages/observability/test/metric-cardinality.spec.ts`.

**Evidencia a capturar.** Las dos consultas.

---

## G. SLO, error budget y alertas (§4.1)

### F3-SLO-01 — Los SLO de la Fase 1 medidos con datos reales en un dashboard

**Requisito.** *Medir cada SLO con datos reales y mostrar su cumplimiento en un dashboard.*
**Página(s): 9** (introducción p. 8; §8.1 «SLO y alertas» p. 17; §8.2 2.5 p. 21).

**Cómo probarlo.**
1. **Bank USAC · Estado del sistema**, los cuatro stats:
   - **«Disponibilidad del Gateway (SLO-27 ≥ 99 %)»**
   - **«Transferencias < 5 s (SLO-2 ≥ 95 %)»**
   - **«Entregas fuera de la cola muerta (SLO-1 ≥ 99 %)»**
   - **«Interbancario aceptado (SLO-28 ≥ 95 %): recibidos y enviados»**
2. **Bank USAC · SLO y error budget**:
   - **«SLI contra su objetivo · Gateway (99 %)»**
   - **«SLI contra su objetivo · Transferencias (95 %)»**
   - **«SLI contra su objetivo · Latencia del Gateway (95 %)»**
3. Definiciones: [`docs/sre/sli-slo-sla.md`](../sre/sli-slo-sla.md) §5.3.

**Resultado esperado.** Siete SLO medidos con reglas grabadas:

| SLO | Qué mide | Objetivo |
| --- | --- | --- |
| SLO-27 | Disponibilidad del Gateway | 99 % |
| SLO-2 | Transferencias bajo 5 s | 95 % |
| SLO-1 | Entregas fuera de la cola muerta | 99 % |
| SLO-6 | Lecturas GET bajo 1 s | 95 % |
| SLO-7 | Comandos POST bajo 3 s, contra el bucket de 2.5 s | 95 % |
| SLO-28 | Depósitos interbancarios aceptados, recibidos y enviados | 95 % |
| SLO-26 | Reinicios | — |

**Evidencia a capturar.** Los dos dashboards.

### F3-SLO-02 — Error budget restante de cada SLO

**Requisito.** *Calcular el error budget restante de cada SLO.* **Página(s): 9.**

**Cómo probarlo.**
1. **Bank USAC · SLO y error budget**:
   - **«Cómo se lee»**
   - **«Error budget · SLO-27 Gateway»**
   - **«Error budget · SLO-2 Transferencias»**
   - **«Error budget · SLO-1 Cola muerta»**
   - **«Error budget · SLO-28 Banco pareja (enviados y recibidos)»**
   - **«Error budget · SLO-6 Lecturas GET < 1 s»**
   - **«Error budget · SLO-7 Comandos POST < 3 s»**
2. Explore:
   ```promql
   {__name__=~"slo:.*:budget_remaining7d", environment="prod"}
   ```

**Resultado esperado.**
- Un número por SLO (fracción de 1; 1 = presupuesto intacto), calculado como
  `1 − (1 − proporción_7d) / (1 − objetivo)` desde `increase(…[7d])` de los contadores.
- **La ventana es de 7 días**, pero Prometheus se reinstaló en este despliegue; la
  «semana» empieza cuando empezó Prometheus.
- **Un valor negativo es legítimo**: el presupuesto se agotó por las pruebas de fallo
  anteriores. El 2026-10-19, SLO-2 y SLO-28 (envío) estaban en negativo por las cargas
  de rechazo y latencia.
- Lo que **no** debe salir es `NaN`. Si un SLO no tuvo tráfico en 7 d, la serie no existe; eso tampoco es `NaN`.

**Evidencia a capturar.** Los seis stats con su valor; explicar los negativos.

### F3-SLO-03 — Al menos 4 alertas, incluida una por burn rate, como código

**Requisito.** *Configurar al menos 4 alertas (Grafana Alerting o Alertmanager), incluida al
menos una por tasa de consumo del error budget (burn rate).* **Página(s): 9** (versionadas: p. 9 «Dashboards obligatorios», último párrafo).

**Cómo probarlo.**
1. Grafana → *Alerting → Alert rules* → carpeta **Bank USAC**: 16 reglas en 3 grupos:
   `slo-burn-rate` (4), `slo-breach` (5) y `slo-partner-bank` (7, que incluye también las dos de reinicios y la liberación interbancaria).
2. Código: `infra/k8s/helm/bank-observability/values.yaml`, sección `alerting.rules.yaml`.

**Resultado esperado.** Las 16 reglas:

| # | Alerta | Expresión / umbral | `for` | Severidad | Runbook |
| --- | --- | --- | --- | --- | --- |
| 1 | GatewayAvailabilityFastBurn | `slo:gateway_availability:burn_rate1h > 14.4` | 5m | critical | `gateway-availability-burn.md` |
| 2 | GatewayAvailabilitySlowBurn | `slo:gateway_availability:burn_rate6h > 6` | 30m | warning | `gateway-availability-burn.md` |
| 3 | TransferLatencyFastBurn | `min(burn_rate1h, burn_rate5m) > 14.4` (SLO-2) | 2m | critical | `transfer-latency.md` |
| 4 | TransferLatencySlowBurn | `min(burn_rate6h, burn_rate30m) > 6` (SLO-2) | 15m | warning | `transfer-latency.md` |
| 5 | TransferLatencyBreach | `slo:transfer_under_5s:ratio_rate5m < 0.95` | 30m | warning | `transfer-latency.md` |
| 6 | GatewayReadLatencyBreach | `slo:gateway_reads_under_1s:ratio_rate5m < 0.95` | 30m | warning | `gateway-latency.md` |
| 7 | GatewayCommandLatencyBreach | `slo:gateway_commands_under_3s:ratio_rate5m < 0.95` | 30m | warning | `gateway-latency.md` |
| 8 | DeadLetterGrowing | `slo:messages_not_dead_lettered:ratio_rate5m < 0.99` | 15m | critical | `dead-letter.md` |
| 9 | BrokerConsumerLagHigh | `max by (environment, queue) (sli:broker_consumer_lag:messages) > 500` | 10m | warning | `consumer-lag.md` |
| 10 | PartnerBankDegraded | `slo:interbank_accepted:ratio_rate5m < 0.95` (recibidos) | 15m | warning | `partner-bank.md` |
| 11 | PartnerBankConfirmationSlow | `slo:interbank_confirmation:seconds_p95 > 5` (recibidos) | 15m | warning | `partner-bank.md` |
| 12 | PartnerBankSendDegraded | `slo:interbank_sent_accepted:ratio_rate5m < 0.95` | 5m | warning | `partner-bank.md` |
| 13 | PartnerBankSendConfirmationSlow | `slo:interbank_sent_confirmation:seconds_p95 > 5` | 5m | warning | `partner-bank.md` |
| 14 | PodRestarting | `sli:pod_restarts_by_environment:max10m > 2` | — | warning | `restarts.md` |
| 15 | MassRestartDependencyLost | `sli:pods_restarting_by_environment:ratio10m > 0.5` | — | critical | `restarts.md` |
| 16 | InterbankReserveReleasedUnverified | Loki: `count_over_time({service_name="payment-service"} \|~ "RELEASED_NO_ANSWER\|RELEASED_UNKNOWN_AT_PARTNER" [15m]) > 0` | — | critical | `partner-bank.md` |

Burn rate: las 1–4. Todas con `noDataState: OK` y la anotación `runbook_url`. La
alerta 15 aparece con un `environment` por namespace (`gmp-system`, `kube-system`…); es
esperado, y esos van a la ruta por defecto.

**Evidencia a capturar.** La lista de reglas en Grafana y el bloque YAML.

### F3-SLO-04 — Las alertas llegan a un canal visible (Notification & Audit)

**Requisito.** *Enviar las alertas a un canal visible (correo, Slack, Discord o Notification & Audit Service).* **Página(s): 9** (y p. 7).

**Cómo probarlo.**
1. Grafana → *Alerting → Contact points*:
   - `bank-audit-prod` → webhook `http://bank-usac-gateway.prod.svc.cluster.local:3000/api/alerts/slo`
   - `bank-audit-dev` → `bank-usac-dev-gateway.dev…`
2. *Notification policies*: `environment=dev` → dev; el resto → prod.
3. Ver F3-AUD-04 para la recepción.
4. Que el webhook está protegido:
   `curl -s -o /dev/null -w '%{http_code}\n' -X POST "$G/api/alerts/slo" -H 'Content-Type: application/json' -d '{}'` → **401**.

**Resultado esperado.**
- Cada alerta disparada genera `alert.slo.received.v1` en auditoría y una notificación «Alerta de SLO activa: …».
- Al resolverse, otra «…resuelta».

**Evidencia a capturar.** Contact point y notificación.

### F3-SLO-05 — Un runbook por alerta

**Requisito.** *Documentar un runbook por alerta: qué significa, cómo diagnosticarla y cómo mitigarla.* **Página(s): 9.**

**Cómo probarlo.**
1. En Grafana abre cualquier regla → anotación **runbook_url** → abre el enlace.
2. Índice: [`docs/operations/runbooks/README.md`](../operations/runbooks/README.md).
   Son 7 runbooks que cubren las 16 alertas (tabla de F3-SLO-03).

**Resultado esperado.** Todos los enlaces abren. Cada runbook tiene significado, diagnóstico (consultas) y mitigación.

**Evidencia a capturar.** Una alerta con su runbook abierto.

### F3-SLO-06 — Las alertas se disparan durante las pruebas

**Requisito.** *Alertas con runbook que se disparan durante las pruebas.* **Página(s): 21** (§8.2 2.5).

**Precondiciones.** Planear el orden (§N). Son estados compartidos: avisa al equipo.

**Cómo probarlo.**

| Alerta | Cómo provocarla de forma segura | Tiempo hasta Firing | Restaurar |
| --- | --- | --- | --- |
| **PartnerBankSendDegraded** | F3-IB-13 (mock `REJECT` + k6 `TASA=0.5 DURACION=7m`) | ~7–10 min | `mock -X POST $M/admin/reset` |
| **PartnerBankSendConfirmationSlow** | Mock `{"mode":"SLOW","slowMs":10000}` + la misma carga | ~7–10 min | reset del mock |
| **InterbankReserveReleasedUnverified** | F3-IB-04 (TIMEOUT + `UNREACHABLE`) | ~9 min desde el envío | reset del mock |
| **TransferLatencyBreach** (y quizá **TransferLatencySlowBurn**) | `PUT /api/payments/simulation {"latencyMs":6500}` + `k6 run -e GATEWAY_URL=$G --vus 1 --duration 35m test/load/transfer.js` en segundo plano. Unas 260 transferencias de Q1.00 entre cuentas propias; los umbrales de k6 fallarán, y es lo esperado | ≥ 31 min | `PUT … {"reset":true}` y Ctrl-C a k6 |
| GatewayAvailabilityFastBurn | Puede disparar en F3-FAIL-03 (broker) si el 5xx se sostiene; no forzarlo más | variable | el broker vuelve solo |

Luego, Grafana → *Alerting → Alert rules* (estado *Firing*) y `/auditoria/notificaciones`.

**Resultado esperado.**
- **Al menos cuatro** alertas distintas en *Firing* durante la sesión, cada una con su runbook.
- Cada una con su notificación «activa» y luego «resuelta».
- Las de burn rate de transferencias exigen las **dos ventanas**: si la última hora estuvo
  sana, FastBurn no dispara aunque los últimos 5 min estén mal, y es correcto.

**Evidencia a capturar.** Cada regla en Firing (captura con la hora); las notificaciones correspondientes.

---

## H. Logging estructurado y dashboards (§4.1)

### F3-LOG-01 — Logs JSON con timestamp, serviceName, correlationId, traceId, spanId, nivel, environment y version

**Requisito.** *Todos los logs deben estar en JSON e incluir timestamp, serviceName,
correlationId, traceId y spanId, nivel de log, environment (dev/prod) y version (tag de la
imagen desplegada).* **Página(s): 9** (§8.1 «Logs estructurados» p. 16; §8.2 2.3 p. 20).

**Cómo probarlo.**
1. Explore → Loki, uno por servicio:
   ```logql
   {service_name="transaction-service", deployment_environment="prod"} | json | __error__=""
   ```
   Repite para `gateway`, `customer-service`, `account-service`, `payment-service`,
   `notification-audit-service` y `partner-bank-mock`.
2. Que ninguna línea de los servicios del banco deja de ser JSON:
   ```logql
   sum by (service_name) (count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service", deployment_environment="prod"} | json | __error__!="" [1h]))
   ```
3. Directo del pod:
   `tmp/t60/k-gke.sh -n prod logs deploy/bank-usac-transaction-service --tail=3`.
4. La `version` coincide con la imagen:
   `tmp/t60/k-gke.sh -n prod get deploy bank-usac-transaction-service -o jsonpath='{.spec.template.spec.containers[0].image}'`.

**Resultado esperado.**
- Ejemplo real:
  `{"timestamp":"2026-10-20T00:17:56.919Z","level":"info","serviceName":"account-service","environment":"prod","version":"v1.3.2","message":"account operation","correlationId":"…","traceId":"…","spanId":"…",…}`.
- La consulta 2 da vacío o 0.
- `version` = tag de la imagen (`v1.3.3` tras el último despliegue).
- Un campo que no aplica se **omite** (p. ej. el `correlationId` de un barrido); nunca va en `null`.

**Evidencia a capturar.** Una línea de cada servicio; la versión contra la imagen.

### F3-LOG-02 — Datos sensibles omitidos o enmascarados

**Requisito.** *Omitir o enmascarar datos sensibles: número de documento, correo,
fotografías, contraseñas y tokens JWT.* **Página(s): 9** (p. 5; restricción p. 10; penalización p. 23).

**Cómo probarlo.** En Explore → Loki, rango **Last 24 hours**. Si una regex da *timeout*
(502), baja a 6 h.

```logql
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `eyJ[A-Za-z0-9_-]{10,}\.` [24h]))
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `token=[^*&" ]{6,}` [24h]))
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `\b[0-9]{13}\b` [24h]))
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}` [6h]))
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `(?i)bearer [A-Za-z0-9._-]{20,}|"(password|credential|identityDocument|photo)"` [24h]))
```

Y el positivo de enmascarado:
```logql
{service_name="notification-audit-service", deployment_environment="prod"} |= "customer.activation"
```

Además, en trazas: abre la traza de `POST /api/customers` (F3-CUS-04). Ningún atributo
lleva el correo, el DPI, la foto ni un JWT. El `url.full`/`url.query` de una petición con
`?token=` aparece redactado.

**Resultado esperado.**
- Las cinco consultas dan **resultado vacío** (sin series = 0 coincidencias). Verificado el 2026-10-19.
- La línea de activación muestra `"deliveryLink":"/activar?token=***"`.
- En auditoría, los montos del payload aparecen como `"[redactado]"`.

**Evidencia a capturar.** Las cinco consultas vacías y la línea `token=***`.

### F3-DSH-01 — Los 8 dashboards obligatorios

**Requisito.** *Dashboards que muestren: estado del sistema, métricas clave (SLI),
cumplimiento de SLO y error budget, errores en tiempo real, flujo de trazas, consumer lag
del broker, uso de CPU/memoria y número de pods (HPA), despliegues marcados como
anotaciones.* **Página(s): 9** (§8.1 «Dashboards» p. 16; §8.2 2.6 p. 21).

**Cómo probarlo.** Dashboards → carpeta **Bank USAC**; Entorno = `prod`. Revisa cada uno.

| Obligatorio (p. 9) | Dashboard (JSON en `infra/k8s/helm/bank-observability/dashboards/`) | Qué mirar |
| --- | --- | --- |
| Estado del sistema | **Bank USAC · Estado del sistema** (`00-estado-del-sistema.json`) | los 4 SLO, «Réplicas disponibles por componente», 5xx por ruta |
| Métricas clave (SLI) | **Bank USAC · Métricas clave (SLI)** (`01-…`) | latencias, throughput, proveedor, KYC, cuentas, interbancario |
| SLO y error budget | **Bank USAC · SLO y error budget** (`02-…`) | presupuestos y burn rates |
| Errores en tiempo real | **Bank USAC · Errores en tiempo real** (`03-…`) | stats + «Todos los errores, de todos los servicios» |
| Flujo de trazas | **Bank USAC · Flujo de trazas** (`04-…`) | «Cómo seguir una Saga», «Transferencias recientes (TraceQL)», «Compensaciones (TraceQL)», «Depósitos interbancarios (TraceQL)» |
| Consumer lag | **Bank USAC · Consumer lag del broker** (`05-…`) | lag y unacked por cola |
| CPU / memoria / pods (HPA) | **Bank USAC · CPU, memoria, pods y HPA** (`06-…`) | «Pods listos», «Pods no listos», «CPU en uso (cores)», «Memoria en uso», «Réplicas por HPA: actuales, deseadas y máximo», «CPU por componente (cores)», «Memoria por componente», «Reinicios de contenedor (última hora)» |
| Despliegues como anotaciones | **en los 9**: anotaciones «Despliegues» (`kube_replicaset_created`) y «Releases» (tag `release`) | marcas verticales (F3-DSH-03) |
| (extra) Logs | **Bank USAC · Logs** (`07-logs.json`) | F3-AUD-05 |
| (extra) Banco pareja | **Bank USAC · Banco pareja** (`08-banco-pareja.json`) | F3-IB-12 |

**Resultado esperado.**
- Los 9 cargan sin paneles en «No data» en las partes con tráfico.
- Ejercicio de diagnóstico que pide el criterio 2.6, «permiten diagnosticar un fallo»:
  durante F3-PAY-02 se pasa de «Transferencias por resultado final» (Estado) a «Proveedor
  externo: tasa de fallo por origen» (SLI), luego a «Compensaciones (TraceQL)» (Trazas) y a
  la línea `simulated provider failure` (Logs).

**Evidencia a capturar.** Una captura por dashboard; la secuencia de diagnóstico.

### F3-DSH-02 — Dashboards y reglas versionados como código

**Requisito.** *Los dashboards y las reglas de alerta deben versionarse como código (JSON / YAML) en el repositorio; no se aceptan dashboards creados solo a mano.* **Página(s): 9** (entregables p. 12; §8.2 2.6 p. 21).

**Cómo probarlo.**
1. `ls infra/k8s/helm/bank-observability/dashboards/` → 9 JSON + README.
2. Reglas y datasources en `infra/k8s/helm/bank-observability/values.yaml` (`datasources.yaml`, `alerting`, `recording_rules.yml`).
3. En Grafana, abre un dashboard → *Settings → JSON Model*. El `uid` coincide con el del archivo:

   | Dashboard | uid |
   | --- | --- |
   | Estado del sistema | `bank-estado` |
   | Métricas clave (SLI) | `bank-sli` |
   | SLO y error budget | `bank-slo` |
   | Errores en tiempo real | `bank-errores` |
   | Flujo de trazas | `bank-trazas` |
   | Consumer lag del broker | `bank-lag` |
   | CPU, memoria, pods y HPA | `bank-plataforma` |
   | Logs | `bank-logs` |
   | Banco pareja | `bank-interbancario` |

   Las reglas aparecen como *Provisioned*, sin opción de borrarlas.

**Resultado esperado.** Todo lo que se ve en Grafana sale del repositorio.

**Evidencia a capturar.** Captura de una regla «Provisioned» y del listado de archivos.

### F3-DSH-03 — Despliegues marcados como anotaciones

**Requisito.** *Despliegues marcados como anotaciones.* **Página(s): 9.**

**Cómo probarlo.**
1. **Bank USAC · Estado del sistema**, rango «Last 12 hours». Busca las marcas verticales y pasa el ratón:
   - **Releases**: «Release **v1.3.3** en prod · corrida».
   - **Despliegues**: ReplicaSets nuevos.
2. API: `$GF/api/annotations?tags=release&limit=3`, con login de admin en el navegador.

**Resultado esperado.**
- Anotaciones de `v1.3.1`, `v1.3.2` y `v1.3.3`, cada una enlazada a su corrida de GitHub Actions (la de `v1.3.3` es la 39368783150).
- Las crea `cd.yml` en el job de producción.

**Evidencia a capturar.** Captura de la anotación con su tooltip.

---

## I. Integración con el sistema existente (§4.1)

### F3-INT-01 — Integración con la Saga, sus compensaciones y los eventos del sistema

**Requisito.** *Las nuevas funcionalidades deben integrarse con el flujo de Saga existente,
incluidas sus compensaciones, y con los eventos del sistema.* **Página(s): 9** (§8.1 «Integración con Saga» p. 16; §8.2 2.7 p. 21).

**Cómo probarlo.** Repasa la evidencia ya capturada:
- **KYC** → puerta de la Saga (F3-IB-08 paso 3).
- **Anomalía** → evento `account.anomaly.detected.v1` al broker (F3-ACC-02).
- **Simulación** → compensación (F3-PAY-02).
- **Interbancario** = la Saga de siempre, con el paso de pago hecho por el pareja (F3-IB-01/02).
- **Alertas** → evento `alert.slo.received.v1` (F3-AUD-04).

**Resultado esperado.** Cada funcionalidad nueva produce métricas, logs y trazas reales y usa los eventos del broker.

**Evidencia a capturar.** Referencias cruzadas a las capturas anteriores.

### F3-INT-02 — El stack de observabilidad se despliega desde el pipeline, sin pasos manuales

**Requisito.** *Pipeline CI/CD de la Fase 2: el stack de observabilidad se despliega con
Terraform / Helm desde el pipeline, sin pasos manuales.* **Página(s): 9** (restricción p. 10;
§8.1 «Stack de observabilidad» p. 17; penalización p. 23).

**Cómo probarlo.**
1. `gh run list --workflow cd.yml --limit 5` y `gh run view 39368783150`, o GitHub → Actions → **CD**. Jobs:
   - «Verificacion de credenciales e infraestructura»
   - **«Stack de observabilidad (Collector, Prometheus, Tempo, Loki, Grafana)»**
   - «Despliegue Continuo a Produccion (Rolling Update)»
2. En `.github/workflows/cd.yml`, job `deploy-observability`: `helm upgrade bank-observability infra/k8s/helm/bank-observability --namespace observability …`.
   Corre en `main` o con `workflow_dispatch` + `deploy_observability`.
3. Releases gestionados por Helm, sin leer Secrets:
   ```bash
   for ns in prod dev observability; do tmp/t60/k-gke.sh -n $ns get deploy,statefulset,daemonset \
     -o custom-columns='KIND:.kind,NAME:.metadata.name,RELEASE:.metadata.annotations.meta\.helm\.sh/release-name,MANAGED:.metadata.labels.app\.kubernetes\.io/managed-by'; done
   ```
   Si tienes permisos de Helm: `KUBECONFIG=tmp/t60/gke.kubeconfig helm list -A`.
4. Infraestructura: `infra/terraform/gcp/` (VPC, GKE, VMs de PostgreSQL, Cloud Run, IP del Gateway).
   `terraform plan` es sólo lectura. Procedimiento en [`docs/operations/CLOUD.md`](../operations/CLOUD.md).

**Resultado esperado.**
- Tres releases: `bank-usac` (prod), `bank-usac-dev` (dev) y `bank-observability` (observability).
- Todo `MANAGED=Helm`, incluidos `otel-log-agent`, `loki`, `tempo`, `prometheus-server` y `grafana`.
- La corrida en verde del job de observabilidad.

**Evidencia a capturar.** Captura de la corrida con el job de observabilidad; la salida de `custom-columns`.

### F3-INT-03 — Entornos dev y prod identificados en la telemetría

**Requisito.** *Entornos dev y prod: la telemetría debe identificar el entorno.* **Página(s): 9.**

**Cómo probarlo.**
1. Prometheus: `count by (environment) (sli:gateway_requests:rate5m)` → `prod`, `dev`.
2. Loki: `sum by (deployment_environment) (count_over_time({service_name="gateway"}[15m]))` → `prod`, `dev`.
3. Tempo: `{resource.deployment.environment="dev"}` y `{resource.deployment.environment="prod"}`.
4. Genera tráfico de **lectura** en dev: `curl -s $GD/health`, o un login en dev. Cambia el selector **Entorno** de un dashboard entre `prod` y `dev`.
5. Logs: el campo `environment` de cada línea.

**Resultado esperado.** Las tres señales separan `dev` de `prod`; los dashboards filtran por entorno.

**Evidencia a capturar.** Las tres consultas.

### F3-INT-04 — Autoescalado (HPA) evidenciado en los dashboards

**Requisito.** *Autoescalado (HPA) de la Fase 2: evidenciar el escalado bajo carga en los dashboards.* **Página(s): 9** (p. 10; §8.2 2.8 p. 22).

**Cómo probarlo.** Se ejecuta junto con F3-LOAD-01.
1. Antes: `tmp/t60/k-gke.sh -n prod get hpa`. Siete HPA, min 1, max 5, objetivo CPU 80 %.
2. Durante la carga:
   - `tmp/t60/k-gke.sh -n prod get hpa -w`
   - Dashboard **Bank USAC · CPU, memoria, pods y HPA** → **«Réplicas por HPA: actuales, deseadas y máximo»** y **«CPU por componente (cores)»**.
3. Explore:
   ```promql
   max by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_status_current_replicas{namespace="prod"})
   max by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_status_desired_replicas{namespace="prod"})
   ```

**Resultado esperado.**
- `desired` sube por encima de 1 en `gateway`, `transaction-service` y `payment-service`;
  en cargas previas llegaron a 5. `current` lo sigue.
- **Bank USAC · Estado del sistema** → «Réplicas disponibles por componente» sube.
- Al terminar la carga, bajan tras el *stabilization window*, unos 5 min.

**Evidencia a capturar.** Panel de HPA con la subida y la bajada; salida de `get hpa -w`.

### F3-INT-05 — Frontend: correlationId / traceId de cada operación y consulta de auditoría

**Requisito.** *Frontend: mostrar el correlationId / traceId de cada operación y permitir
consultar la auditoría.* **Página(s): 9** (entregables p. 12).

**Cómo probarlo.**
1. Como cliente, haz una transferencia. En `/transferencias/[id]` aparece el badge **«Código de seguimiento de la transferencia»**, con **Copiar**, y la línea **«Traza»**.
2. En un depósito interbancario: **«Código de seguimiento del depósito»** + **«Traza»**.
3. Abre la pantalla desde un enlace o recarga la página: la etiqueta pasa a **«Traza de esta consulta»**, porque es la traza de la consulta y no la de la operación.
4. **Enlace a Grafana.** En Cloud Run `NUXT_PUBLIC_GRAFANA_URL` está **vacío**, verificado en
   el runtime config del HTML. Por eso la traza se muestra como **texto copiable, no como enlace**.
   El enlace «Abrir esta traza en Grafana ↗» sólo aparece donde la variable está configurada.
   Copia el traceId y pégalo en Explore → Tempo.
5. Admin → `/auditoria`: consulta por **Código de seguimiento** y los filtros de **«Últimos eventos del sistema»** (F3-AUD-03).
   Otros roles no ven «Auditoría» en el menú; al abrir `/auditoria` se les redirige a `/`.

**Resultado esperado.**
- Cada operación muestra su correlationId, y su traceId cuando el Gateway lo devolvió (cabecera `X-Trace-Id`).
- El traceId copiado abre la misma traza en Tempo.

**Evidencia a capturar.** Badge en la transferencia y en el depósito; `/auditoria` con resultados.

---

## J. Pruebas de carga y escenarios de fallo (§4.1)

### F3-LOAD-01 — Carga con k6 sobre el flujo de transferencia, con latencia, error rate, throughput y HPA en los dashboards

**Requisito.** *Ejecutar pruebas de carga con k6, Locust o JMeter sobre el flujo de
transferencia; evidenciar en los dashboards la latencia, el error rate, el throughput y la
creación de pods por el HPA.* **Página(s): 10** (entregables p. 12; §8.2 2.8 p. 22).

**Precondiciones.**
- Simulación de pagos en `DEFAULTS`.
- Mock en `ACCEPT`.
- `bal`: la MONETARIA con ≥ Q1,500. Si no, recárgala (§0.5).
- Abiertos los dashboards Estado del sistema, Métricas clave y CPU/memoria/HPA.

**Cómo probarlo.**
1. Variables que lee `test/load/transfer.js`, vía `support.js`:
   - `GATEWAY_URL` (por defecto `http://localhost:3000`)
   - `SEED_PASSWORD` (por defecto `BankUsac#2026`)

   El script hace login como `cliente@bankusac.gt`, elige la MONETARIA de mayor saldo como
   origen y otra cuenta del mismo titular como destino. Mueve Q1.00 por iteración.
2. Rampa del script, 1 → 5 → 15 VUs en 80 s:
   ```bash
   k6 run -e GATEWAY_URL=http://34.69.101.197:3000 test/load/transfer.js
   ```
3. Para que el HPA tenga tiempo de escalar, carga sostenida de 4 minutos:
   ```bash
   k6 run -e GATEWAY_URL=http://34.69.101.197:3000 --vus 20 --duration 4m test/load/transfer.js
   ```
   `--vus`/`--duration` reemplazan los escenarios del script.
4. En paralelo, F3-INT-04 (HPA) y F3-SLI-03/04 (throughput, lag).
5. Al final: `bal`. Los umbrales del script son los SLO:
   - `http_req_failed < 1 %`
   - `transfer_accept_ms p95 < 3 s`
   - `transfer_saga_ms p95 < 5 s`
   - `checks > 99 %`

**Resultado esperado.**
- k6 informa `transfer_accept_ms` y `transfer_saga_ms` con sus percentiles.
- Los dashboards muestran:
  - p95 de transferencias (SLO-2)
  - error rate (5xx y FAILED)
  - throughput por servicio y cola subiendo
  - HPA escalando
- Saldo total del titular conservado: sólo se movió entre sus cuentas.
- Se dispararán anomalías de cuenta (WARNING); son esperadas con esta carga.

**Evidencia a capturar.** Resumen de k6 y capturas de los tres dashboards durante el pico, con la hora.

### F3-FAIL-01 — Fallos y timeouts del Payment Service bajo carga

**Requisito.** *Escenario de fallo: fallos y timeouts del Payment Service.* Documentar en
postmortem. **Página(s): 10** (§8.1 «Simulación de fallos» p. 16; §8.2 2.8 p. 22).

**Precondiciones.** Admin; MONETARIA ≥ Q500.

**Cómo probarlo.**
1. `curl -s -X PUT "$G/api/payments/simulation" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{"failureRatePercent":30,"timeoutRatePercent":20,"latencyMs":800}'`.
2. `k6 run -e GATEWAY_URL=$G --vus 5 --duration 2m test/load/transfer.js`.
3. Observa:
   - «Transferencias por resultado final»
   - «Proveedor externo: tasa de fallo por origen»
   - «Proveedor externo: latencia (p95)»
   - «Compensaciones (TraceQL)»
   - «Burn rate de transferencias (5 m, 30 m, 1 h y 6 h)»
4. **Restaura**: `-d '{"reset":true}'`.
5. Balance de control: `bal`, y que no quedan Sagas en vuelo:
   ```bash
   curl -s "$G/api/transfers?status=PAYMENT_PENDING&limit=100" -H "Authorization: Bearer $TC" | jq '.total'
   curl -s "$G/api/transfers?phaseStatus=PENDING&limit=100" -H "Authorization: Bearer $TC" | jq '.total'
   ```

**Resultado esperado.**
- Mezcla de `completed` y `compensated` (`PAYMENT_RETRIES_EXHAUSTED`).
- Tasa de fallo `source="runtime"` ≈ 50 %.
- Cada compensación visible en la traza.
- `PAYMENT_PENDING` y `phaseStatus=PENDING` en 0, unos 40 s después de terminar la carga.
- El dinero vuelve en todas las compensadas.

**Evidencia a capturar.** Dashboards durante el fallo; el balance de control. Postmortem:
[`docs/sre/postmortems/2026-10-15-proveedor-de-pagos.md`](../sre/postmortems/2026-10-15-proveedor-de-pagos.md).

### F3-FAIL-02 — Eliminación de un pod durante la carga

**Requisito.** *Escenario de fallo: eliminación de un pod durante la carga.* **Página(s): 10.**

**Precondiciones.** F3-LOAD-01 paso 3 corriendo.

**Cómo probarlo.**
1. A mitad de la carga:
   ```bash
   tmp/t60/k-gke.sh -n prod delete pod -l app.kubernetes.io/component=transaction-service --wait=false
   tmp/t60/k-gke.sh -n prod get pods -l app.kubernetes.io/component=transaction-service -w
   ```
2. Observa:
   - **Bank USAC · CPU, memoria, pods y HPA**: «Pods no listos» y «Reinicios de contenedor (última hora)».
   - **Bank USAC · Consumer lag del broker**: sube el lag de `transaction.commands`/`transaction.saga` y se vacía.
   - **Bank USAC · Estado del sistema**: «Réplicas disponibles por componente».
3. Al terminar k6, el balance de control de F3-FAIL-01 paso 5.

**Resultado esperado.**
- El Deployment recrea el pod en segundos.
- Los mensajes esperan en la cola durable y se procesan al volver.
- **Ninguna transferencia queda en vuelo**; ninguna se pierde ni se duplica.
- Puede verse un pico de `transfer_saga_ms`.
- No hace falta restaurar nada: el ReplicaSet lo hace.

**Evidencia a capturar.** Salida de `-w`, lag subiendo y bajando, balance de control. Postmortem:
[`2026-10-15-pod-eliminado.md`](../sre/postmortems/2026-10-15-pod-eliminado.md).

### F3-FAIL-03 — Caída temporal del broker

**Requisito.** *Escenario de fallo: latencia o caída temporal del broker.* **Página(s): 10.**

**Precondiciones.**
- Avisa al equipo: **la IP pública del Gateway deja de responder unos 20–30 s, por diseño**.
  `/ready` devuelve 503 mientras no hay broker y el LoadBalancer saca el pod de servicio.
- RabbitMQ en prod es un Deployment de 1 réplica con PVC `rabbitmq-data`: las colas durables sobreviven.
- **No lo escales a 0.**

**Cómo probarlo.**
1. Opcional: carga ligera, `k6 run -e GATEWAY_URL=$G --vus 3 --duration 3m test/load/transfer.js`.
2. En otra terminal, vigila: `while true; do date +%T; curl -s -m 2 $G/ready; echo; sleep 2; done`.
3. Elimina el pod del broker:
   ```bash
   tmp/t60/k-gke.sh -n prod delete pod -l app.kubernetes.io/component=rabbitmq --wait=false
   tmp/t60/k-gke.sh -n prod rollout status deploy/rabbitmq
   ```
4. Observa:
   - `/ready` pasa a `503`/sin respuesta y vuelve a `{"status":"ready","broker":"connected"}`.
   - **Bank USAC · Estado del sistema**: disponibilidad SLO-27 cae y vuelve; «Respuestas 5xx del Gateway por ruta».
   - **Bank USAC · Errores en tiempo real**.
   - **Bank USAC · CPU, memoria, pods y HPA**: «Reinicios de contenedor (última hora)». Un Gateway puede reiniciarse.
   - Alertas `PodRestarting` / `MassRestartDependencyLost` / `GatewayAvailabilityFastBurn` si el corte se alarga.
5. Comprobación:
   - `tmp/t60/k-gke.sh -n prod get pods`: todos `1/1 Running`, rabbitmq con 1 réplica.
   - El balance de control de F3-FAIL-01 paso 5.
   - `curl -s $G/ready`.

**Resultado esperado.**
- El sistema se recupera solo en menos de 1 minuto.
- Las transferencias aceptadas antes del corte terminan; las que llegaron durante el corte
  reciben 503/5xx, y la disponibilidad lo refleja.
- **Ninguna queda en vuelo** pasados unos minutos.
- Si alguna queda en `PAYMENT_PENDING`, anótala para el postmortem; su barrido debería cerrarla.

**Evidencia a capturar.** Cronología del bucle `/ready`; dashboards con la caída; estado final de pods. Postmortem:
[`2026-10-15-latido-amqp.md`](../sre/postmortems/2026-10-15-latido-amqp.md).

### F3-FAIL-04 — El banco pareja no responde, responde lento o rechaza (con el mock) — **obligatorio**

**Requisito.** *El banco pareja no responde, responde lento o rechaza depósitos (simulado
con el mock)* — escenario **obligatorio**. **Página(s): 10** (reglas de pareja p. 8).

**Cómo probarlo.**
- **Rechaza**: F3-IB-02 y, bajo carga, F3-IB-13.
- **No responde**: F3-IB-03 y F3-IB-04.
- **Lento**: F3-IB-13, variante `SLOW`.
- **No disponible**, opcional:
  1. `mock -X PUT $M/admin/config -d '{"mode":"UNAVAILABLE"}'` (todo el contrato responde 503).
  2. Envía 1 depósito. Queda en **«Por enviar»**/**«Esperando al otro banco»** con «Intentos de entrega» > 1.
  3. Antes de 180 s, `mock -X POST $M/admin/reset`: se entrega y acredita **una vez**.
     Pasados 180 s, el protocolo de TIMEOUT de F3-IB-03 lo devuelve.

**Resultado esperado.**
- El banco propio reacciona bien en todos los casos (compensación, reintentos, alertas). Es la regla de evaluación de la p. 8.
- Saldo íntegro en todos.

**Evidencia a capturar.** Las de F3-IB-02/03/04/13. Postmortem:
[`2026-10-15-banco-pareja.md`](../sre/postmortems/2026-10-15-banco-pareja.md).

### F3-FAIL-05 — Un postmortem blameless por escenario (mínimo 3)

**Requisito.** *Documentar cada escenario en un postmortem blameless: cronología, impacto en
los SLO, evidencia (trazas, logs y métricas), causa raíz y acciones de mejora.*
**Página(s): 10** (objetivo p. 3; entregables p. 12; §8.1 p. 17; §8.2 1.3 p. 19).

**Cómo probarlo.** Abre [`docs/sre/postmortems/README.md`](../sre/postmortems/README.md) y los cuatro
postmortems. Comprueba que cada uno tiene las cinco secciones.

**Resultado esperado.**
- Cuatro postmortems: latido AMQP/broker, banco pareja, proveedor de pagos y pod eliminado. Cubren los cuatro escenarios de la p. 10.
- Los cuatro son de la sesión del 2026-10-15 en **kind**. Si la calificación pide evidencia
  de la nube, adjunta las capturas de esta corrida (F3-FAIL-01…04) como anexo.

**Evidencia a capturar.** Captura del índice de postmortems.

---

## K. Tabla §8.1 — Requisitos para optar a la calificación (pp. 15–17)

> «De no cumplir usted tendrá una nota con valor de cero puntos» (p. 15).

| Tema (§8.1) | Página | Cómo se demuestra |
| --- | --- | --- |
| Despliegue en nube (K8s) | 16 | §0.1 (URLs vivas), F3-INT-02 |
| OpenTelemetry (trazas + métricas en todos) | 16 | F3-OTL-01 |
| Trazabilidad distribuida (traceId / correlationId por el broker) | 16 | F3-OTL-02, F3-OTL-03 |
| Logging centralizado (ELK o Loki con ingestión) | 16 | F3-AUD-01 |
| Logs estructurados (JSON, sin datos sensibles) | 16 | F3-LOG-01, F3-LOG-02 |
| Dashboards (métricas y logs) | 16 | F3-DSH-01, F3-AUD-05 |
| Métricas SRE (percentiles, error rate, throughput, lag, disponibilidad) | 16 | F3-SLI-01…05 |
| Integración con Saga | 16 | F3-TRX-03, F3-TRX-04, F3-INT-01 |
| Nuevas funcionalidades en los 5 servicios | 16 | F3-CUS-*, F3-ACC-*, F3-TRX-*, F3-PAY-*, F3-AUD-* |
| Simulación de fallos (timeouts, errores, delays) | 16 | F3-PAY-01, F3-FAIL-01 |
| Consistencia arquitectónica (asincronía, desacoplamiento) | 16 | F3-OTL-02 (0 HTTP entre servicios); checklist §M |
| Documentación actualizada | 16 | `docs/architecture/`, `docs/sre/telemetry-catalog.md`, `docs/sre/sli-slo-sla.md`, runbooks |
| Sistema funcional (flujo end-to-end con trazas y logs) | 17 | F3-TRX-04 + F3-AUD-05 |
| Stack de observabilidad sin pasos manuales | 17 | F3-INT-02 |
| SLO y alertas (SLO medidos, ≥ 4 alertas) | 17 | F3-SLO-01, F3-SLO-03 |
| Postmortems (mínimo 3) | 17 | F3-FAIL-05 |
| Integración interbancaria (enviados y recibidos, idempotencia, compensación) | 17 | F3-IB-01, 02, 06, 09 |
| UEDI (entrega en fecha) | 17 | No es verificable en el sistema: confirmar la entrega en UEDI |
| Repositorio (commit antes de la fecha; auxiliar como colaborador) | 17 | `git log -1 --format=%cI origin/main`; GitHub → Settings → Collaborators |

## L. Criterios §8.2, conocimientos 2.1–2.9 (pp. 20–22)

| Criterio | Pts | Página | Qué ve el calificador | IDs |
| --- | --- | --- | --- | --- |
| 2.1 Instrumentación OpenTelemetry | 6 | 20 | OTel en el código de los 5 servicios y el Gateway, enviando al Collector | F3-OTL-01, F3-OTL-04 |
| 2.2 Trazas distribuidas y propagación | 8 | 20 | La Saga completa en **una** traza, contexto por el broker, correlationId como atributo | F3-TRX-04, F3-OTL-02, F3-OTL-03 |
| 2.3 Logging centralizado y estructurado | 6 | 20 | JSON de todos los servicios con traceId, consultables, sin datos sensibles | F3-AUD-01, F3-AUD-05, F3-LOG-01, F3-LOG-02 |
| 2.4 Métricas (SLI) | 6 | 20–21 | Percentiles, error rate, throughput, lag, disponibilidad, sin alta cardinalidad | F3-SLI-01…06 |
| 2.5 SLO, error budget y alertas | 8 | 21 | SLO medidos, presupuesto calculado, alertas con runbook **que se disparan en las pruebas** | F3-SLO-01…06 |
| 2.6 Dashboards | 6 | 21 | Útiles, como código, que permiten diagnosticar un fallo | F3-DSH-01…03 |
| 2.7 Funcionalidades nuevas | 6 | 21 | Las de los 5 servicios, integradas a la Saga, con métricas, logs y trazas reales | A, B, C, F3-INT-01 |
| 2.8 Pruebas de carga y fallos | 6 | 22 | Carga + 3 escenarios, con HPA y compensaciones visibles | F3-LOAD-01, F3-INT-04, F3-FAIL-01…04 |
| 2.9 Integración interbancaria | 8 | 22 | Enviados y recibidos, idempotencia, compensación ante rechazo o timeout, mismo traceId | F3-IB-01…06, 09, 11 |

Los criterios de habilidades 1.1–1.4 (pp. 18–19) no se prueban en el sistema: trabajo en
equipo (commits), documentación técnica, postmortems (F3-FAIL-05) y justificación de
decisiones (ADR en `docs/adr.md`).

## M. Checklist de penalizaciones críticas §8.3 (pp. 22–23) — cómo confirmar que NO ocurren

| Penalización | % | Página | Cómo confirmar que no ocurre | Debe verse |
| --- | --- | --- | --- | --- |
| No existen trazas distribuidas reales (el contexto no cruza el broker) | 50 | 22 | Tempo: una transferencia → spans `publish …` (PRODUCER) con hijos `process …` (CONSUMER) **de otros servicios** en la misma traza (F3-OTL-02) | 6+ servicios en una traza |
| OpenTelemetry no está integrado en el código | 50 | 22 | Spans de dominio que sólo el código puede emitir: `transfer`, `saga.step …`, `saga.compensation …`, `customer.lifecycle …`, `account.activity anomaly`, `payment.provider call`, `payment.interbank send`; `apps/*/src/instrumentation.ts` | presentes |
| Métricas que no reflejan el sistema real (fijas o simuladas) | 50 | 23 | Anota `sum(bank_transfer_finished_total{environment="prod"})`, haz exactamente 3 `transfer 100`, espera 90 s y vuelve a consultar | sube **exactamente 3** (si ningún pod se reinició en medio) |
| Se rompe la comunicación asíncrona o hay acoplamiento | 50 | 23 | TraceQL `{kind=server && resource.service.name=~"customer-service\|account-service\|transaction-service\|payment-service\|notification-audit-service"}` y `{kind=client && span.server.address=~"bank-usac-(customer\|account\|transaction\|payment\|notification-audit)-service.*"}`; las pruebas `test/isolation.spec.ts` y `pnpm lint` en CI | **0 trazas** en ambas; el único HTTP saliente es Payment → banco pareja (permitido, p. 11) |
| Logs no centralizados | 25 | 23 | F3-AUD-01: Loki tiene los 7 servicios; `otel-log-agent` DaemonSet | 7 `service_name` |
| Dashboards que no aportan valor para diagnosticar | 25 | 23 | Ejercicio de diagnóstico de F3-DSH-01 durante F3-PAY-02 | del síntoma a la causa en ≤ 4 clics |
| Las nuevas funcionalidades no generan observabilidad | 25 | 23 | Cada bloque de A–D tiene métrica + log + traza propia (tablas de cada ID) | ninguna sin las tres |
| Despliegue manual del stack de observabilidad | 25 | 23 | F3-INT-02: corrida de `cd.yml` con el job de observabilidad en verde; recursos `managed-by=Helm` | job verde, release `bank-observability` |
| Datos sensibles en logs o trazas | 25 | 23 | F3-LOG-02: las cinco búsquedas vacías; `token=***` | 0 coincidencias |
| Depósito interbancario duplicado o monto perdido sin compensación | 50 | 23 | F3-IB-06 (repeat ×3 → 1 crédito), F3-IB-09 (misma Idempotency-Key → 1 débito), F3-IB-02/03/04 (saldo final = inicial), F3-IB-05 (ACCEPTED tardío → reverso, sin doble), F3-IB-13 (210 rechazos → 210 compensaciones, saldo íntegro) | saldos cuadran en todos |

## N. Orden sugerido para una corrida de 2 a 3 horas

El orden evita que dos estados compartidos se pisen. La simulación de pagos afecta a las
transferencias internas; el mock afecta sólo a las interbancarias.

| # | Bloque | Duración | Notas |
| --- | --- | --- | --- |
| 1 | §0: variables, tokens, port-forward del mock, `bal`, `/ready`, `curl $M/health` | 10 min | Comprueba simulación en `DEFAULTS` y mock en `ACCEPT` |
| 2 | F3-CUS-01…04 (registro, validación, métricas, traza) | 15 min | Aprobación unos minutos después de crear, para el p95 |
| 3 | F3-ACC-01…03 (11 transferencias → anomalía) | 10 min | |
| 4 | F3-TRX-01…04 + F3-PAY-01…03 (escenarios, simulación al 100 %, compensación) | 20 min | **Restaura la simulación** al terminar |
| 5 | F3-AUD-01…05, F3-OTL-01…04, F3-LOG-01/02 sobre las trazas ya generadas | 20 min | |
| 6 | **Arranca en segundo plano** la alerta de latencia (F3-SLO-06, fila TransferLatencyBreach): simulación `latencyMs 6500` + k6 1 VU 35 min | — | A partir de aquí no hagas pruebas de transferencias internas que necesiten ser rápidas |
| 7 | F3-IB-01, 02, 09, 10, 08 (envíos y validaciones) | 15 min | Mientras corre el paso 6: los interbancarios no usan el proveedor simulado |
| 8 | F3-IB-04 (UNREACHABLE, 9 min) y, en paralelo, F3-IB-06, 07 (recepciones) | 15 min | No resetees el mock hasta terminar el paso 9 |
| 9 | F3-IB-05 (ACCEPTED tardío sobre el depósito del paso 8), luego reset del mock | 5 min | |
| 10 | F3-IB-13 (REJECT + k6 7 min → PartnerBankSendDegraded), luego reset | 12 min | Con el paso 6 aún corriendo |
| 11 | ~min 40 del paso 6: TransferLatencyBreach en Firing → captura; **restaura la simulación** y detén k6 | 2 min | |
| 12 | F3-IB-03 (TIMEOUT con cancelación, 4 min) mientras revisas F3-IB-11, 12, 14, 15 | 10 min | Reset del mock al final |
| 13 | F3-LOAD-01 + F3-INT-04 + F3-FAIL-02 (pod eliminado en la carga de 4 min) | 10 min | Simulación en `DEFAULTS` |
| 14 | F3-FAIL-01 (fallos del proveedor bajo carga), restaurar | 5 min | |
| 15 | F3-FAIL-03 (broker), comprobación de pods y Sagas en vuelo | 5 min | **Nunca escalar a 0** |
| 16 | F3-SLI-*, F3-SLO-01…05, F3-DSH-01…03, F3-INT-02, 03, 05, F3-FAIL-05 con los datos ya generados | 15 min | |
| 17 | Cierre: `mock -X POST $M/admin/reset`, `PUT /api/payments/simulation {"reset":true}`, cuenta de Ahorro **activa**, `tmp/t60/k-gke.sh -n prod get pods` todo `1/1`, `bal` final, cerrar port-forwards | 5 min | |

Total: unas 2 h 50 min. Sin la alerta de latencia (paso 6), se puede bajar a unas 2 h.
