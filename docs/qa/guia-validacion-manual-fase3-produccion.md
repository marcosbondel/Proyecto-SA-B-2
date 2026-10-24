# Guía de validación manual — Fase 3 (Bank USAC) contra producción, sólo desde el navegador

Esta guía sirve para comprobar a mano, contra el despliegue vivo de producción
(GKE + Cloud Run, release `v1.3.9`), cada requisito de la Fase 3 del enunciado
[`docs/references/780_Proyecto_3_2S2026.pdf`](../references/780_Proyecto_3_2S2026.pdf).

**Todo se hace en el navegador**, con tres herramientas web:

- el **frontend del banco**;
- **Grafana**, para métricas, logs, trazas y alertas;
- **GitHub**, para ver el código, los dashboards como código, las corridas del pipeline
  y los postmortems.

No se usa terminal, `curl`, `kubectl`, `k6` ni la consola de GCP. La única excepción,
opcional, es el script de F3-ACC-02 para disparar la anomalía en segundos. Las consultas PromQL,
LogQL y TraceQL de esta guía se escriben **dentro de Grafana**, en *Explore*. No son
comandos de terminal.

Cada bloque cita la **página del PDF** donde aparece el requisito y tiene siete partes:
requisito, cobertura web, precondiciones, cómo probarlo, resultado esperado y evidencia
a capturar. Al final hay tres secciones: las tablas §8.1 y §8.2 apuntando a los IDs, el
checklist de penalizaciones §8.3 y un orden sugerido para una corrida de unas 2 horas.

> **El repositorio es público.** Esta guía no contiene ninguna contraseña, token ni
> API key. Donde hace falta uno, se indica a quién pedirlo. **No pegues secretos en
> capturas, issues ni en este archivo.**

---

## Cobertura: qué se puede probar sólo con el navegador

Cada ID lleva una de estas tres marcas:

| Marca | Significado |
| --- | --- |
| **Web** | Se prueba completo desde el frontend, Grafana o GitHub. |
| **Web parcial** | Una parte se prueba en la web; el bloque dice qué parte queda fuera. |
| **Sin vía web** | Provocar el escenario exige terminal. Desde la web sólo se **revisa la evidencia que ya existe**. |

Hay cinco cosas que **no tienen pantalla** en ningún lado y que, por lo tanto, no se pueden
provocar desde el navegador:

| No se puede desde la web | Por qué | IDs afectados |
| --- | --- | --- |
| Cambiar en caliente la simulación del proveedor de pagos (tasa de fallo %, timeout, latencia) | Es sólo API (`PUT /api/payments/simulation`); el frontend no tiene pantalla para ella | F3-PAY-01, parte de F3-FAIL-01 y F3-SLO-06 |
| Controlar el mock del banco pareja: modos TIMEOUT / SLOW / UNAVAILABLE, callback tardío, hacer que el mock **nos envíe** un depósito | El mock es interno al clúster y su administración exige un token por cabecera | F3-IB-03 a 07, F3-IB-13, parte de F3-FAIL-04 |
| Generar carga sostenida | Hace falta k6 | F3-LOAD-01, F3-INT-04, F3-IB-13, parte de F3-SLO-06 y F3-FAIL-01 |
| Eliminar un pod o el broker | Hace falta `kubectl` o la consola de GCP | F3-FAIL-02, F3-FAIL-03 |
| Repetir un envío con la misma `Idempotency-Key` | El formulario sólo conserva la clave cuando el Gateway no contestó a tiempo, y eso no se puede forzar | F3-IB-09 |

Para esos casos la guía da dos salidas, sin salir del navegador:

1. **Revisar la evidencia que ya existe.** Prometheus, Loki y Tempo guardan **7 días**. Los
   experimentos de carga y fallos en la nube corrieron en `dev` el **2026-10-22 entre las
   04:25 y las 04:50 UTC**, es decir el 2026-10-21 de 22:25 a 22:50 hora de Guatemala.
   Siguen visibles en Grafana hasta alrededor del 2026-10-29. Además, los depósitos
   interbancarios y las notificaciones de alertas anteriores siguen en el frontend, porque
   viven en las bases de datos.
2. **Pedírselo a quien tenga acceso a la terminal.** La versión anterior de esta guía, con
   los comandos, está en
   [GitHub, commit `9495318`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/9495318/docs/qa/guia-validacion-manual-fase3-produccion.md).
   Esa persona provoca el escenario y tú lo observas en el frontend y en Grafana con los
   pasos de esta guía.

---

## 0. Antes de empezar

### 0.1 Entorno

| Componente | URL | Verificado el 2026-10-23 |
| --- | --- | --- |
| Frontend (Cloud Run) | https://bank-usac-web-mn2e6zhkwq-uc.a.run.app | `200` en `/login` |
| API Gateway **prod** | http://34.69.101.197:3000/ready | `{"status":"ready","application":"gateway","broker":"connected"}` |
| API Gateway **dev** | http://136.71.158.228:3000/health | sólo lectura; **no corras pruebas contra dev** |
| Grafana | http://35.255.103.13, usuario `admin` | `200`; 9 dashboards en la carpeta **Bank USAC**, 16 reglas de alerta |
| Repositorio | https://github.com/marcosbondel/Proyecto-SA-B-2 | público |

Las imágenes de las siete aplicaciones en `prod` son `v1.3.9`.

Códigos de banco: **nosotros `BANK02`** (cuentas `02-NNNNNNNNN`), **el mock `BANK99`**.
También está registrado **`BANK16`**, el banco real de otro grupo (ver §0.6).

Límites que vienen del ConfigMap:
- Depósito interbancario: Q10,000.00 como máximo.
- Anomalía de cuenta: más de 10 operaciones en 5 minutos.

Los valores están en el repositorio:
[`infra/k8s/helm/bank-usac/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-usac/values.yaml)
(`services.account.anomaly` e `interbank.maxAmountMinor`).

### 0.2 Usuarios y datos de prueba

| Rol | Correo | Contraseña |
| --- | --- | --- |
| ADMINISTRADOR | `admin@bankusac.gt` | `BankUsac#2026` (contraseña de demo, ya pública en las semillas) |
| CAJERO_RECEPTOR | `cajero@bankusac.gt` | la misma |
| CLIENTE | `cliente@bankusac.gt` | la misma |

La contraseña de Grafana **pídesela al responsable de infraestructura**. No la anotes en
ninguna captura.

Cuentas sembradas de `cliente@bankusac.gt` (KYC verificado):

| Uso | Número | Tipo | UUID (aparece en la URL de la cuenta) |
| --- | --- | --- | --- |
| Origen de las pruebas | `02-000000008` | MONETARIA | `b0000000-0000-4000-8000-000000000003` |
| Destino de las pruebas | `02-000000009` | AHORRO | `b0000000-0000-4000-8000-000000000004` |

- **Usa siempre la Monetaria como origen.** Cada débito de una cuenta de Ahorro cobra Q3.00 de comisión.
- La cuenta `c0000000-0000-4000-8000-00000000000a` es la **cuenta de liquidación
  interbancaria**. No la uses como destino.

### 0.3 Qué necesitas

- **Tres sesiones a la vez**, una por rol. La sesión vive en la pestaña, así que lo más
  seguro es una ventana normal, una ventana privada y otro navegador.
- Una pestaña con **Grafana** (`http://35.255.103.13`) y otra con el **repositorio en GitHub**.
- Una **hoja de registro** donde anotar cada prueba. Muchas pruebas usan los datos de otras:

  | ID | Hora (Guatemala) | Código de seguimiento | Traza | Id de la operación | Saldo antes | Saldo después | Resultado |
  | --- | --- | --- | --- | --- | --- | --- | --- |

### 0.4 De dónde sale cada dato en la web

| Dato | Dónde lo ves |
| --- | --- |
| **correlationId** | El recuadro **«Código de seguimiento…»** de cada operación, con el botón **Copiar**. En el registro de un cliente aparece en la pantalla «Solicitud de registro recibida». |
| **traceId** | La línea **«Traza»** del mismo recuadro. En producción es **texto copiable, no un enlace**, porque `NUXT_PUBLIC_GRAFANA_URL` está vacío. Cópialo y pégalo en Grafana (§0.5). |
| Id de la transferencia | La URL: `/transferencias/<transactionId>`. |
| Id del depósito interbancario | La URL: `/transferencias/interbancarias/<interbankTransferId>`. |
| Saldos | **Cuentas** (`/cuentas`) o **Inicio**, con la sesión del cliente. |
| Eventos de una operación | Como admin, **Auditoría** → **Código de seguimiento** → **Consultar**. |

> **Copia el traceId justo después de la operación.** Si recargas la página o la abres
> desde un enlace, la línea cambia a **«Traza de esta consulta»**: es la traza de la
> lectura, no la de la operación. Si ya la perdiste, recupérala como admin en
> **Auditoría**: consulta el código de seguimiento y abre **Detalle** en cualquier
> evento. Ahí aparece la traza completa.

### 0.5 Grafana: dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Dashboards | Menú → *Dashboards* → carpeta **Bank USAC** (los 9 de §H). Arriba, el selector **Entorno** = `prod`. |
| Explore | Menú → *Explore*. Arriba a la izquierda eliges el datasource: **Prometheus**, **Loki** o **Tempo**. |
| Alertas | Menú → *Alerting* → *Alert rules*, carpeta **Bank USAC**. |
| Contact points y políticas | *Alerting* → *Contact points* y *Notification policies*. |

**Cómo correr una consulta de esta guía en Explore:**
1. Elige el datasource que indica el bloque.
2. Cambia el editor de *Builder* a **Code**, con el interruptor de la derecha.
3. Pega la consulta y pulsa **Run query** (arriba a la derecha).
4. Ajusta el rango de tiempo con el selector de arriba: *Last 15 minutes*, *Last 1 hour*,
   o un rango absoluto.

**Cómo abrir una traza a partir de un traceId:** Explore → **Tempo** → pestaña
**TraceQL** → pega los 32 caracteres del traceId → **Run query**. Para ver la cadena de
servicios, cambia a la vista *Node graph*.

**Etiquetas útiles:**
- En Prometheus, el entorno es la etiqueta `environment` (`prod` / `dev`).
- En Loki, las etiquetas indexadas son `deployment_environment`, `service_name` y
  `k8s_namespace_name`. Campos como `level`, `correlationId`, `traceId` o `accountId` se
  filtran **después** de un `|`, por ejemplo `| correlationId="…"`.
- En Tempo, el entorno es `resource.deployment.environment`.

Una métrica llega a Prometheus con unos **60 s de retraso**. Espera 1–2 minutos antes de
juzgar un panel.

**Rangos absolutos:** en el selector de tiempo, *Absolute time range*, `From` y `To`. Grafana
usa la hora del navegador. Para los experimentos del 2026-10-22, escribe `2026-10-21 22:20:00`
a `2026-10-21 22:55:00` si tu navegador está en hora de Guatemala.

### 0.6 Reglas de la corrida

1. **Montos pequeños.** Q1.00 basta para casi todo. Los datos de prueba se quedan en prod.
2. **Si la Monetaria baja de Q100, recárgala** como cajero: **Cuentas** → **Depósito** →
   busca `02-000000008` → **Monto** → **Continuar** → **Registrar depósito**.
3. **El escenario de pago sólo afecta a esa transferencia.** El campo **«Escenario de
   pago»** viaja con la operación. A diferencia de la simulación por API, no cambia nada
   para el resto del equipo, así que puedes usarlo sin avisar.
4. **Toda cuenta que desactives, la reactivas** antes de terminar.
5. **No envíes depósitos a `BANK16`.** Es el banco de otro grupo, no un mock. Un envío ahí
   mueve dinero en su sistema. Las reglas de la p. 8 permiten inyectar fallos **sólo con el
   mock propio**. Usa siempre `BANK99`.
6. **No corras pruebas contra `dev`.** Sólo se mira para comprobar que la telemetría
   distingue el entorno.

### 0.7 Tiempo estimado por sección

| Sección | Tiempo |
| --- | --- |
| §0 preparación | 10 min |
| A. Customer/Account | 25 min |
| B. Transaction/Payment | 20 min |
| C. Notification & Audit y logs | 15 min |
| D. Interbancario | 20 min |
| E–H. OTel, SLI, SLO, logging, dashboards | 25 min |
| I. Integración y CI/CD | 10 min |
| J. Carga y fallos (revisión de evidencia) | 15 min |

---

## Índice de IDs

| Sección | ID | Cobertura |
| --- | --- | --- |
| A. Customer | F3-CUS-01 · 02 · 03 · 04 | Web |
| A. Account | F3-ACC-01 · 02 · 03 | Web |
| B. Transaction | F3-TRX-01 · 02 · 03 · 04 | Web |
| B. Payment | F3-PAY-01 | Sin vía web (el cambio en caliente) |
| B. Payment | F3-PAY-02 · 03 | Web |
| C. Notification & Audit | F3-AUD-01 · 02 · 03 · 04 · 05 | Web |
| D. Interbancario | F3-IB-01 · 02 · 10 · 12 · 14 · 15 | Web |
| D. Interbancario | F3-IB-08 · 11 | Web parcial |
| D. Interbancario | F3-IB-03 · 04 · 05 · 06 · 07 · 09 · 13 | Sin vía web |
| E. OpenTelemetry | F3-OTL-01 · 02 · 03 · 04 | Web |
| F. Métricas SLI | F3-SLI-01 … 06 | Web |
| G. SLO y alertas | F3-SLO-01 … 05 | Web |
| G. SLO y alertas | F3-SLO-06 | Web parcial |
| H. Logging y dashboards | F3-LOG-01 · 02 · F3-DSH-01 · 02 · 03 | Web |
| I. Integración | F3-INT-01 · 02 · 03 · 05 | Web |
| I. Integración | F3-INT-04 | Sin vía web |
| J. Carga y fallos | F3-FAIL-05 | Web |
| J. Carga y fallos | F3-FAIL-01 · 04 | Web parcial |
| J. Carga y fallos | F3-LOAD-01 · F3-FAIL-02 · 03 | Sin vía web |
| K–M. Rúbrica | Tabla §8.1 · criterios §8.2 2.1–2.9 · checklist §8.3 | — |

---

## A. Extensión funcional — Customer y Account Service (§4.1)

### F3-CUS-01 — Eventos del ciclo de vida del cliente, con correlationId y logs enmascarados

**Requisito.** *Registrar eventos del ciclo de vida (creación, verificación KYC,
rechazo), asociarlos a un correlationId, generar logs estructurados por cada cambio de
estado y enmascarar u omitir documento, correo, fotografía y tokens JWT en logs y
atributos de trazas.* **Página(s): 5** (y p. 10, restricción «No registrar datos sensibles»).

**Cobertura.** Web.

**Precondiciones.**
- Sesión de cajero y sesión de admin.
- Dos correos que controles. Producción **envía de verdad** el correo de activación, por
  Resend. Si usas Gmail, sirven alias como `tucorreo+f3a@gmail.com` y `tucorreo+f3b@gmail.com`.
- Dos fotos JPG/PNG de menos de 5 MB, **distintas entre sí**. Una foto que ya pertenece a
  otro cliente se rechaza por estar duplicada.
- Dos números de DPI de 13 dígitos que no existan en el sistema.

**Cómo probarlo.**

*Camino de revisión (creación → verificación o rechazo):*

1. En la ventana privada, sin sesión, abre `/registro`, o pulsa **Crear cuenta** en `/login`. Completa los tres pasos:
   - **Datos personales**: Nombre completo, Fecha de nacimiento, Dirección, Correo electrónico → **Continuar**.
   - **Documento**: Número de DPI (13 dígitos) y la foto → **Continuar**.
   - **Confirmación**: Contraseña, Confirmar contraseña, casilla de términos → **Crear cuenta**.
2. Anota el **Código de seguimiento** de la pantalla «Solicitud de registro recibida» y la
   hora. Es el correlationId de la creación.
3. Repite los pasos 1 y 2 con **dos clientes más**: otro correo, otro DPI y otra foto en
   cada uno. Son tres en total; F3-CUS-03 necesita **dos aprobaciones** por la cola.
4. **Espera unos 3 minutos.** Así el tiempo hasta la verificación (F3-CUS-03) no es trivial.
5. Como cajero, en **Inicio** pulsa **Revisar la cola**, o abre `/clientes/validaciones`.
   Los tres aparecen con **Revisar →**.
   - Primer cliente: **Aprobar identidad**. Anota la hora.
   - Segundo cliente: **Rechazar**, y en el modal «Rechazar la identidad», **Rechazar identidad**.
   - Tercer cliente: **Aprobar identidad**, al menos 1 minuto después del primero. Anota la hora.

*Camino de ventanilla:*

6. Como cajero, **Clientes** → **Nuevo cliente** (`/clientes/nuevo`), los mismos tres
   pasos, con un tercer correo, DPI y foto. Al terminar dice **«Cliente registrado»**: el
   cliente queda activo y verificado en el acto. Pulsa **Ver el cliente**.

*Revisión:*

7. Como admin, **Auditoría** → **Código de seguimiento** = el del paso 2 → **Consultar**.
8. En Grafana, Explore → **Loki**:
   ```logql
   {service_name="customer-service", deployment_environment="prod"} |~ "customer (created|verified|rejected|registration refused)"
   ```
   ```logql
   {service_name=~".+", deployment_environment="prod"} | correlationId="<código del paso 2>"
   ```
9. La búsqueda negativa, con el rango en **Last 1 hour**:
   ```logql
   {service_name="customer-service", deployment_environment="prod"} |= "<uno de los correos que usaste>"
   ```

**Resultado esperado.**
- En Loki, una línea JSON por cambio de estado: `customer created`, `customer verified` y `customer rejected`.
- Cada línea con `correlationId`, `traceId` y `spanId`. El dato del cliente es `customerId`.
- Ninguna línea con el correo, el DPI, el nombre, la dirección, la foto ni un JWT.
  **La búsqueda negativa devuelve 0 líneas.**
- En **Auditoría**, el rastro muestra los eventos «Cliente registrado»
  (`customer.registered.v1`) y la validación o el rechazo de la identidad, con su
  severidad.
- El correo de activación llega al buzón con un enlace a `/activar?token=…`. No hace falta
  activarlo para esta prueba.

**Evidencia a capturar.**
- Pantalla «Solicitud de registro recibida» con el código de seguimiento.
- Pantalla de revisión con «Identidad verificada» e «Identidad rechazada».
- Rastro en **Auditoría**.
- Explore Loki con las tres líneas y la búsqueda negativa en 0.

### F3-CUS-02 — Métrica: clientes verificados contra rechazados

**Requisito.** *Métrica: número de clientes verificados vs rechazados.* **Página(s): 5.**

**Cobertura.** Web.

**Precondiciones.** F3-CUS-01 hecho: al menos una aprobación y un rechazo en la última hora.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Métricas clave (SLI)**, Entorno = `prod`, panel
   **«Clientes: verificados contra rechazados (última hora)»**.
2. Explore → Prometheus:
   ```promql
   sum by (result, path) (bank_customer_kyc_decisions_total{environment="prod"})
   ```

**Resultado esperado.**
- Series `result="verified"` y `result="rejected"`, con `path="review"` (cola de
  validaciones) o `path="counter"` (ventanilla).
- Cada aprobación o rechazo de F3-CUS-01 suma 1 en su serie, unos 60 s después.
- No hay etiqueta `customerId`.

**Evidencia a capturar.** El panel y la consulta, antes y después de las decisiones.

### F3-CUS-03 — Métrica: tiempo de la creación a la verificación KYC (p95)

**Requisito.** *Métrica: tiempo desde la creación hasta la verificación KYC (percentil p95).* **Página(s): 5.**

**Cobertura.** Web.

**Precondiciones.** F3-CUS-01, con **dos aprobaciones** por la cola de validaciones y sus
horas de creación y de aprobación anotadas.

> **Por qué hacen falta dos aprobaciones.** El histograma sólo registra **aprobaciones**:
> un rechazo no suma. Además, su serie no existe hasta la primera aprobación que recibe el
> pod de customer-service, y nace ya con esa aprobación dentro. `rate()` necesita dos
> muestras para ver un cambio, así que **la primera aprobación de cada camino es invisible**
> para el panel. Con una sola aprobación el panel queda en blanco, como si no hubiera
> datos. La segunda aprobación por el mismo camino sí aparece. Esto pasa otra vez cada vez
> que el pod se reinicia o se despliega.
>
> Los contadores se arreglaron sembrándolos en 0 al arrancar el proceso, en el commit
> `5d37d25`. A un histograma no se le puede hacer lo mismo sin registrar una observación
> falsa de 0 s. Por eso la siembra no lo cubre.

**Cómo probarlo.**
1. Comprueba que la serie existe. En Explore → Prometheus:
   ```promql
   sum by (path) (bank_customer_kyc_time_to_decision_seconds_count{environment="prod"})
   ```
   - **Sin resultado**: el pod no ha recibido ninguna aprobación desde que arrancó.
   - **`path="review"` en 1**: hubo una sola aprobación por la cola, la invisible. Aprueba
     otra en `/clientes/validaciones`.
   - **2 o más**: debe haber valor. Espera 1–2 minutos: la regla grabada se evalúa cada 30 s.
2. **Bank USAC · Métricas clave (SLI)** → panel **«KYC: tiempo desde la creación hasta la verificación (p50 / p95)»**.
3. Explore → Prometheus:
   ```promql
   histogram_quantile(0.95, sum by (le) (rate(bank_customer_kyc_time_to_decision_seconds_bucket{environment="prod"}[6h])))
   ```

**Resultado esperado.**
- La consulta del paso 1 en 2 o más para `path="review"`.
- Un valor en segundos, del orden del tiempo real entre **Crear cuenta** y la **segunda**
  **Aprobar identidad**. La primera no entra en el cálculo.
- Es un histograma con buckets de 1 s a 7 días, no un promedio.
- La ventana es de 6 h. Pasadas 6 h sin aprobaciones nuevas, el panel vuelve a quedar en blanco.

**Evidencia a capturar.** La consulta del paso 1; el panel con el p95, con las horas anotadas al lado.

### F3-CUS-04 — Traza: flujo completo desde la creación hasta la verificación

**Requisito.** *Traza: flujo completo desde creación hasta verificación.* **Página(s): 5.**

**Cobertura.** Web.

**Precondiciones.** El código de seguimiento de la creación (F3-CUS-01, paso 2).

**Cómo probarlo.**
1. Explore → **Tempo** → TraceQL:
   ```traceql
   {span.bank.correlation_id="<código de seguimiento de la creación>"}
   ```
   O todas las verificaciones recientes:
   ```traceql
   {name="customer.lifecycle verified"}
   ```
2. Abre la traza cuya raíz es `POST /api/customers` del gateway.

**Resultado esperado.** Una sola traza con, en este orden:
- `POST /api/customers` (gateway, SERVER) → `publish bank.commands`
- → `process customer.commands` (customer-service, CONSUMER) → `customer.lifecycle created`
- → … → **`customer.lifecycle verified`** (o `rejected`).

La verificación es **hija** de la creación, aunque ocurra minutos después y con el
correlationId de la petición del cajero. Atributos de los spans `customer.lifecycle`:
`bank.customer.transition`, `bank.customer.path` (`review` | `counter`),
`bank.customer.id` y `bank.correlation_id`. No aparece el correo ni el documento.

**Evidencia a capturar.** La vista de la traza con los dos spans `customer.lifecycle` y sus atributos.

### F3-ACC-01 — Registro de débitos y créditos; métrica por tipo de cuenta y operación

**Requisito.** *Registrar operaciones sobre cuentas (débitos, créditos). Métrica: número
de transacciones por tipo de cuenta (ahorro / corriente) y por operación (débito / crédito).*
**Página(s): 5.**

**Cobertura.** Web.

**Precondiciones.** Sesión de cliente. Anota los saldos de las dos cuentas en **Cuentas**.

**Cómo probarlo.**
1. Anota el valor actual de la consulta del paso 3.
2. Como cliente, **Transferencias** → **Nueva transferencia** (`/transferencias/nueva`):
   - **Cuenta de origen** = la Monetaria `02-000000008`.
   - **¿A dónde va el dinero?** = «A otra de mis cuentas».
   - **Cuenta de destino** = la de Ahorro `02-000000009`.
   - **Monto** = `1.00`; **Escenario de pago** = «Sin escenario (comportamiento real)».
   - **Continuar** → **Confirmar y enviar**.
3. Explore → Prometheus:
   ```promql
   sum by (account_type, operation) (bank_account_operations_total{environment="prod"})
   ```
4. Dashboard **Bank USAC · Métricas clave (SLI)** → **«Cuentas: operaciones por tipo y operación»**.
5. Como cliente, abre la Monetaria desde **Cuentas** y mira la tabla **«Movimientos»**.

**Resultado esperado.**
- `account_type` ∈ `MONETARIA` · `AHORRO`. La «corriente» del enunciado es `MONETARIA` en este banco.
- `operation` ∈ `debit` · `credit` · `compensation`.
- La transferencia suma `MONETARIA/debit` +1 y `AHORRO/credit` +1.
- **No existe** una etiqueta `account_id`.
- El movimiento aparece en las dos cuentas y los saldos cambian en Q1.00.

**Evidencia a capturar.** Los valores antes y después; el panel; los movimientos.

### F3-ACC-02 — Detección de alta frecuencia → `AccountAnomalyDetected` → notificación WARNING

**Requisito.** *Detectar más de N operaciones sobre una misma cuenta en una ventana de M
minutos (N y M configurables por ConfigMap; sugerido 10 en 5). Emitir
`AccountAnomalyDetected` al broker; Notification & Audit lo registra y genera una
notificación WARNING. Bloquear la cuenta es opcional y debe justificarse.*
**Página(s): 5** (y p. 7: «Generar una notificación al recibir AccountAnomalyDetected»).

**Cobertura.** Web. Para una demostración rápida hay además un script, **la única excepción
de esta guía al «sólo navegador»**.

**Precondiciones.**
- Sesiones de cliente, cajero y admin.
- Que la Monetaria no haya tenido una anomalía en los últimos 5 minutos. Se anuncia
  **una vez por ventana**.
- N y M: abre en GitHub
  [`infra/k8s/helm/bank-usac/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-usac/values.yaml)
  y busca `anomaly:` → `maxOperations: 10`, `windowMinutes: 5`.

**Opción rápida: el script (menos de 1 minuto).** Desde la raíz del repositorio:

```bash
./test/scripts/f3-anomalia-cuenta.sh
```

[`test/scripts/f3-anomalia-cuenta.sh`](../../test/scripts/f3-anomalia-cuenta.sh) sólo
necesita `curl`, `jq` y `uuidgen`, que en macOS ya vienen. No usa `kubectl` ni lee
secretos. En orden:
1. Inicia sesión como cliente y como admin.
2. Imprime los saldos.
3. Hace 11 transferencias de Q1.00 Monetaria → Ahorro, con su código de seguimiento.
4. Espera hasta 90 s la notificación `account.anomaly` creada después de empezar.
5. Muestra el evento WARNING de auditoría con su payload.
6. Hace una transferencia 12 para comprobar que la cuenta sigue operando.
7. Imprime los saldos finales.

Si no llega la notificación, la cuenta ya tuvo una anomalía en los últimos 5 minutos:
espera y repítelo. Variables opcionales: `OPERACIONES` (11), `MONTO_MINOR` (100),
`GATEWAY_URL` (prod). Al terminar, sigue con los pasos 2 y 3 de abajo para verlo en la
web y en Grafana.

**Cómo probarlo desde la web.**
1. Hay que hacer **11 operaciones sobre la Monetaria en menos de 5 minutos**. Cuentan los
   débitos y los créditos; las compensaciones no. Para llegar a tiempo, hazlo entre dos personas:
   - **Cliente**: transferencias de Q1.00 Monetaria → Ahorro, como en F3-ACC-01. Tras
     cada **Confirmar y enviar**, vuelve a **Nueva transferencia**.
   - **Cajero**, al mismo tiempo: depósitos de Q1.00 a la Monetaria en **Cuentas** →
     **Depósito**: busca `02-000000008` → **Monto** `1.00` → **Continuar** → **Registrar depósito** → **Registrar otro depósito**.
2. Al pasar de 10, mira:
   - Como cliente, la **campana** o el menú del avatar → **Notificaciones**.
   - Como admin, el menú del avatar → **Consola de notificaciones** (`/auditoria/notificaciones`).
   - Como admin, **Auditoría** → «Últimos eventos del sistema»: **Servicio** =
     `account-service`, **Nivel** = «Advertencia» → **Buscar**.
3. Explore → Loki:
   ```logql
   {service_name="account-service", deployment_environment="prod"} |= "account anomaly detected"
   ```
4. Haz **una transferencia más** como cliente.

**Resultado esperado.**
- **Notificación** con asunto **«Detectamos actividad inusual en tu cuenta»**. En la
  bandeja del cliente: tipo «Actividad inusual en la cuenta», con la insignia **Advertencia**.
  En la consola del admin: tipo `account.anomaly`, severidad Advertencia, estado Enviada.
- **Auditoría**: evento `account.anomaly.detected.v1`, severidad **WARNING**. En **Detalle**,
  el payload trae `rule: HIGH_FREQUENCY`, `threshold`, `windowMinutes`, `operationCount` y `accountType`.
- **Log** de nivel `warn`, mensaje `account anomaly detected`, con `accountId`,
  `operationCount` ≥ 11, `threshold: 10`, `windowMinutes: 5`, `correlationId` y `traceId`.
- **La cuenta sigue operando**: la transferencia del paso 4 se completa. No se bloquea (ADR-017).

**Evidencia a capturar.** La notificación en la bandeja del cliente y en la consola del
admin; la fila WARNING en Auditoría; la línea de log.

### F3-ACC-03 — Métrica de anomalías y `accountId` sólo en logs (sin alta cardinalidad)

**Requisito.** *Métrica: número de anomalías detectadas. Logs de actividad con el
accountId; el detalle por cuenta se consulta en los logs, no como etiqueta de métrica.*
**Página(s): 5** (y p. 15: «Evitar etiquetas de alta cardinalidad (accountId, customerId)»).

**Cobertura.** Web.

**Precondiciones.** F3-ACC-02 hecho.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Errores en tiempo real** → stat **«Anomalías de cuenta detectadas (última hora)»**.
2. Explore → Prometheus:
   ```promql
   sum by (account_type, rule) (bank_account_anomalies_total{environment="prod"})
   ```
   ```promql
   count by (__name__) ({__name__=~"bank_.*", account_id!=""})
   ```
3. Explore → Loki, el detalle por cuenta:
   ```logql
   {service_name="account-service", deployment_environment="prod"} | accountId="b0000000-0000-4000-8000-000000000003"
   ```

**Resultado esperado.**
- El contador sube en 1 por anomalía, sólo con las etiquetas `account_type` y `rule="HIGH_FREQUENCY"`.
- La segunda consulta devuelve **vacío**: ninguna métrica tiene `account_id`.
- Loki muestra las líneas `account operation` (con `accountId`, `accountType`,
  `operation` y `transactionId`) y la de la anomalía.

**Evidencia a capturar.** Las tres consultas, con la de cardinalidad vacía.

---

## B. Extensión funcional — Transaction y Payment Service (§4.1)

### F3-TRX-01 — Latencia del flujo de transferencia p50/p95/p99 (histograma)

**Requisito.** *Medir el tiempo de procesamiento; métrica de latencia del flujo de
transferencia en p50, p95 y p99 (histograma, no promedio).*
**Página(s): 6** (y p. 8, «Métricas (SLI base)»).

**Cobertura.** Web.

**Precondiciones.** Transferencias en los últimos 5 minutos. Las de F3-ACC-02 sirven.

**Cómo probarlo.**
1. **Bank USAC · Métricas clave (SLI)** → **«Latencia de transferencias (p50 / p95 / p99)»**.
   El panel de texto **«Percentiles, no promedios»** explica el criterio.
2. Explore → Prometheus:
   ```promql
   sli:transfer_latency:seconds_p95{environment="prod"}
   ```
   ```promql
   sum by (le) (rate(bank_transfer_duration_seconds_bucket{environment="prod"}[5m]))
   ```
3. Para ver cómo está hecho el panel: menú del panel → *Edit*. La consulta es un
   `histogram_quantile`, no `_sum / _count`.

**Resultado esperado.**
- Tres líneas con p50 ≤ p95 ≤ p99, en segundos. Una transferencia sana tarda unos 1–3 s.
- La consulta de buckets muestra los límites `le`, incluido uno exacto en `le="5.0"` (SLO-2).
- Ningún panel de latencia usa `_sum / _count`.

**Evidencia a capturar.** El panel con las tres curvas y la consulta de buckets.

### F3-TRX-02 — Tasa de éxito / fallo

**Requisito.** *Medir la tasa de éxito / fallo; métrica: tasa de error.* **Página(s): 6.**

**Cobertura.** Web.

**Precondiciones.** Sesión de cliente y anotar los saldos.

**Cómo probarlo.**
1. Haz tres transferencias desde **Nueva transferencia**, Monetaria → Ahorro, y anota de
   cada una el código de seguimiento, la traza y el id de la URL:
   - **A**, completada: Monto `1.00`, «Sin escenario (comportamiento real)».
   - **B**, compensada: Monto `1.00`, **Escenario de pago** = **«Rechazar el pago»**.
   - **C**, fallida: un monto **mayor que el saldo** de la Monetaria, por ejemplo
     `9000000.00`, sin escenario. El formulario no la frena: la decide la Saga.
2. Mira cada una en su pantalla `/transferencias/<id>`.
3. **Bank USAC · Métricas clave (SLI)** → **«Transferencias: proporción por resultado final»**.
4. **Bank USAC · Estado del sistema** → **«Transferencias por resultado final»**.
5. **Bank USAC · Errores en tiempo real** → **«Transferencias que terminaron en FAILED, por motivo»**.
6. Explore → Prometheus:
   ```promql
   sum by (result, reason) (increase(bank_transfer_finished_total{environment="prod"}[15m]))
   ```

**Resultado esperado.**
- **A** termina en **Completada**.
- **B** termina en **Compensada**, con «Por qué no se completó». El saldo vuelve a su valor anterior.
- **C** termina en **Fallida**, motivo «La cuenta de origen no tenía saldo suficiente.» No hay débito.
- En la consulta: `result` ∈ `completed` · `failed` · `compensated`; `reason` ∈ `NONE`,
  `INSUFFICIENT_FUNDS`, `PAYMENT_DECLINED`, … La C aparece con `reason="INSUFFICIENT_FUNDS"`
  y la B con `PAYMENT_DECLINED`.

**Evidencia a capturar.** Las tres pantallas de transferencia; los tres paneles; la consulta.

### F3-TRX-03 — Estados PENDING / APPROVED / FAILED como eventos dentro de la traza

**Requisito.** *Registrar los estados intermedios de la Fase 2 (PENDING, APPROVED,
FAILED) como spans o eventos dentro de la traza; asociar cada transacción a una traza
distribuida.* **Página(s): 6.**

**Cobertura.** Web.

**Precondiciones.** Las trazas de A y B de F3-TRX-02.

**Cómo probarlo.**
1. Explore → Tempo → pega la traza de A → **Run query**.
2. Busca el span **`transfer`** de `transaction-service` y despliega sus **Events**.
3. Repite con la traza de B.
4. Vista general: dashboard **Bank USAC · Flujo de trazas** → **«Transferencias recientes (TraceQL)»**, o en Explore:
   ```traceql
   {name="transfer"} | select(span.bank.transfer.status, span.bank.transfer.phase_status)
   ```
5. En el frontend, `/transferencias/<id>` de A y de B.

**Resultado esperado.**
- **A (COMPLETED)**: el span `transfer` tiene los eventos `PENDING` y `APPROVED`, y los
  atributos `bank.transfer.status=COMPLETED`, `bank.transfer.phase_status=APPROVED` y
  `bank.transfer.duration_ms`.
- **B (COMPENSATED)**: eventos `PENDING` y `FAILED`, `phase_status=FAILED`.
- Además, un span `saga.step <evento>` por transición: `KYC_CHECK_ORDERED`, `KYC_APPROVED`,
  `DEBITED`, `PAYMENT_SUCCEEDED`, `CREDITED`.
- En el frontend, el bloque **«Avance de la transferencia»** muestra el mismo avance:
  Aceptada → Debitando → Procesando pago → Completada / Compensada / Fallida.

**Evidencia a capturar.** El span `transfer` con sus eventos, en las dos trazas; el avance en el frontend.

### F3-TRX-04 — Traza completa de la Saga, incluidas las compensaciones

**Requisito.** *Traza completa del flujo Saga, incluyendo las compensaciones.*
**Página(s): 6** (y §8.2 2.2, p. 20).

**Cobertura.** Web.

**Precondiciones.** La traza de B («Rechazar el pago»), de F3-TRX-02.

**Cómo probarlo.**
1. Abre la traza de B en Tempo, o usa **Bank USAC · Flujo de trazas** → **«Compensaciones (TraceQL)»**.
2. Cambia a la vista *Node graph* para ver los servicios.
3. Como admin, **Auditoría** → **Código de seguimiento** de B → **Consultar**: el rastro de eventos de la misma Saga.

**Resultado esperado.** Una sola traza que cruza **gateway → transaction-service →
customer-service (KYC) → account-service (débito) → payment-service (pago rechazado) →
transaction-service → account-service (compensación) → notification-audit-service**:
- Spans `publish bank.commands` / `bank.events` (PRODUCER) y `process <cola>` (CONSUMER).
- `payment.provider call`, con el evento `simulated_failure`.
- **`saga.compensation ordered`** y **`saga.compensation completed`**.
- El mensaje `account.debit.compensation.requested.v1` y luego `account.debit.compensated.v1`.

El saldo de la Monetaria queda igual que antes de B.

**Evidencia a capturar.** La traza con los dos spans de compensación resaltados; el
rastro de Auditoría; el saldo antes y después.

### F3-PAY-01 — Simulación de fallos en caliente (tasa %, timeout, latencia ms) sin redesplegar

**Requisito.** *Simular fallos intermitentes con tasa configurable (%), timeout y
respuestas lentas con latencia configurable (ms); cambiar los parámetros en tiempo de
ejecución, sin redesplegar (ConfigMap o endpoint de administración protegido en el API
Gateway); generar eventos de fallo controlados.* **Página(s): 6.**

**Cobertura.** **Sin vía web para el cambio en caliente.** La simulación global sólo se
cambia por API (`PUT /api/payments/simulation`, protegido para ADMINISTRADOR), y el
frontend no tiene pantalla para ella. Lo que sí se hace en la web son los **fallos
controlados por operación**, con el campo «Escenario de pago».

**Precondiciones.** Sesión de cliente y de admin.

**Cómo probarlo.**

*Fallos controlados desde la web:*

1. Haz dos transferencias de Q1.00 desde **Nueva transferencia**, una con cada escenario:
   - **«Fallo transitorio»**: el pago falla y se reintenta.
   - **«El proveedor no responde (timeout)»**: el proveedor no contesta y se reintenta igual.

   La leyenda del formulario avisa: «Son hasta 4 intentos, con esperas de 1 s, 5 s, 30 s…».
2. Deja abierta la pantalla de cada una. El panel **«Resultado del pago»** muestra
   «Reintentando · Intento X de 4».
3. Como admin, **Pagos** → **Monitoreo** (`/pagos/monitor`): las dos filas con el chip
   **Demostración** y la columna **Intentos**. **Ver estado** abre el detalle con la lista de intentos.

*El cambio en caliente, sólo como evidencia que ya existe:*

4. Explore → Loki, rango **Last 7 days**:
   ```logql
   {service_name="payment-service"} |~ "provider simulation (update|reset)"
   ```
5. Explore → Prometheus:
   ```promql
   sum by (environment, action) (bank_payment_simulation_changes_total)
   ```
6. El código del endpoint, en GitHub: `apps/gateway/src` (ruta `/api/payments/simulation`) y
   el postmortem [`2026-10-21-cloud-provider.md`](../sre/postmortems/2026-10-21-cloud-provider.md),
   que cambió la simulación en `dev` y la restauró sin redesplegar.

**Resultado esperado.**
- Los escenarios recorren la escalera de reintentos (1 s / 5 s / 30 s) y terminan en
  **Completada** o, si se agotan los 4 intentos, en **Compensada** con el motivo
  `PAYMENT_RETRIES_EXHAUSTED`.
- Si la simulación se cambió en los últimos 7 días, Loki muestra las líneas
  `provider simulation update` / `provider simulation reset` con los valores fijados, y el
  contador sube por `action`. Si no hay nada en 7 días, la consulta sale vacía; anótalo y
  apóyate en el postmortem.
- **Para demostrarlo en vivo hace falta la terminal**: quien la tenga sigue F3-PAY-01 de la
  [versión con comandos](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/9495318/docs/qa/guia-validacion-manual-fase3-produccion.md#f3-pay-01--simulación-de-fallos-en-caliente-tasa--timeout-latencia-ms-sin-redesplegar),
  y tú lo observas con F3-PAY-03.

**Evidencia a capturar.** El panel «Resultado del pago» reintentando; el monitor de pagos
con la columna Intentos; las líneas de Loki o el postmortem.

### F3-PAY-02 — La Saga compensa ante fallos del proveedor y se ve en la traza

**Requisito.** *Verificar que la Saga ejecute las compensaciones y que estas sean visibles en la traza.* **Página(s): 6.**

**Cobertura.** Web, con el escenario de pago.

**Precondiciones.** Sesión de cliente. Anota el saldo de la Monetaria.

**Cómo probarlo.**
1. **Nueva transferencia**, Q1.00, **Escenario de pago** = **«Rechazar el pago»**. Copia la traza.
2. En `/transferencias/<id>` mira el panel **«Resultado del pago»** y el estado final.
3. Repite con **«El proveedor no responde (timeout)»** y espera unos 40 s (1 + 5 + 30 s de reintentos).
4. Abre las dos trazas en Tempo.
5. Mira el saldo de la Monetaria.

**Resultado esperado.**
- La de «Rechazar el pago» termina en **Compensada**, motivo `PAYMENT_DECLINED`.
- La de timeout termina en **Completada** o **Compensada** (`PAYMENT_RETRIES_EXHAUSTED`), con los intentos visibles.
- En las compensadas, el avance termina en «Se devolvió el dinero a la cuenta de origen».
- La traza contiene:
  - un `saga.payment attempt` por intento;
  - `payment.provider call` con el evento `simulated_failure`;
  - `saga.compensation ordered` y `saga.compensation completed`.
- El saldo queda como al principio, salvo las que se completaron.

**Evidencia a capturar.** La pantalla de la transferencia compensada; la traza con la
compensación; el saldo antes y después.

### F3-PAY-03 — Métricas de tasa de fallos externos y p95 del externo; logs de errores simulados

**Requisito.** *Métrica: tasa de fallos externos; métrica: latencia del sistema externo simulado (p95); logs de errores simulados.* **Página(s): 6.**

**Cobertura.** Web.

**Precondiciones.** F3-PAY-01 y 02 hechos en los últimos 15 min.

**Cómo probarlo.**
1. **Bank USAC · Métricas clave (SLI)** → **«Proveedor externo: tasa de fallo por origen»** y **«Proveedor externo: latencia (p95)»**.
2. Explore → Prometheus:
   ```promql
   sum by (result, source) (bank_payment_provider_calls_total{environment="prod"})
   ```
3. Explore → Loki:
   ```logql
   {service_name="payment-service", deployment_environment="prod"} |= "simulated provider failure"
   ```

**Resultado esperado.**
- La tasa de fallo sube, separada por `source`. Con esta guía sale `scenario`, el
  escenario de la transferencia. Las otras dos fuentes son `runtime` (simulación del
  admin por API) y `configuration` (tasas del ConfigMap).
- El p95 del proveedor refleja los intentos que esperaron.
- Logs de nivel `warn`, mensaje `simulated provider failure`, con `simulated: true`,
  `source`, `providerResult` (`FAILURE` | `TIMEOUT`), `attempt`, `outcome`
  (`retrying` | `exhausted`), `correlationId`, `traceId` y `spanId`.

**Evidencia a capturar.** Los dos paneles y las líneas de log.

---

## C. Extensión funcional — Notification & Audit Service y logs (§4.1)

### F3-AUD-01 — Logs recolectados por un agente de infraestructura y almacenados en Loki (no por el broker)

**Requisito.** *Recolectar los logs de todos los servicios mediante un agente de
infraestructura (OpenTelemetry Collector, Fluent Bit o Promtail); los servicios no envían
sus logs a este microservicio por el broker; almacenar logs en ELK o Loki.*
**Página(s): 6–7** (y §8.1 «Logging centralizado», p. 16).

**Cobertura.** Web.

**Cómo probarlo.**
1. Explore → Loki → *Label browser* → `service_name`. Deben aparecer los siete
   componentes: `gateway`, `customer-service`, `account-service`, `transaction-service`,
   `payment-service`, `notification-audit-service` y `partner-bank-mock`, además de los del sistema GKE.
2. El agente, en Explore → Prometheus:
   ```promql
   kube_daemonset_status_number_ready{namespace="observability"}
   ```
   ```promql
   count by (namespace, pod) (kube_pod_info{namespace="observability"})
   ```
3. Que no hay logs por el broker, en Explore → Prometheus:
   ```promql
   sum by (messaging_destination_name) (rate(messaging_client_sent_messages_total{environment="prod"}[1h]))
   ```
4. La configuración, en GitHub:
   [`infra/k8s/helm/bank-observability/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-observability/values.yaml)
   (busca `otel-log-agent`).

**Resultado esperado.**
- El DaemonSet `otel-log-agent` con un pod listo por nodo, y los pods `loki-0`,
  `otel-gateway`, `tempo-0`, `prometheus-server` y `grafana` en `observability`.
- Loki tiene los siete servicios.
- En la consulta 3 no aparece ningún exchange ni cola de logs. Las colas `audit.*` son de
  eventos de negocio, no de logs.

**Evidencia a capturar.** El label browser de Loki; las dos consultas de Prometheus.

### F3-AUD-02 — Clasificación INFO / WARNING / ERROR

**Requisito.** *Clasificar eventos de auditoría y logs: INFO, WARNING, ERROR.* **Página(s): 6–7.**

**Cobertura.** Web.

**Cómo probarlo.**
1. Admin → **Auditoría**. Tiles **«Info hoy»**, **«Advertencia hoy»** y **«Error hoy»**.
2. En «Últimos eventos del sistema», **Nivel** = «Advertencia» → **Buscar**. Luego «Error».
3. Explore → Prometheus:
   ```promql
   sum by (family, severity) (increase(bank_audit_events_total{environment="prod"}[24h]))
   ```
4. Los logs: dashboard **Bank USAC · Logs** → **«Volumen de log por nivel»**.

**Resultado esperado.**
- Severidades exactamente `INFO`, `WARNING` y `ERROR`, por familia (`customer`, `account`,
  `transaction`, `payment`, `alert`). La anomalía de F3-ACC-02 es WARNING en `account`; la
  compensación de F3-TRX-02 es ERROR en `transaction`.
- Los logs, con `level` ∈ `info` · `warn` · `error` · `debug`.

**Evidencia a capturar.** Los tiles; la tabla filtrada; la consulta.

### F3-AUD-03 — Consulta histórica por correlationId, traceId, servicio y nivel a través del Gateway

**Requisito.** *Exponer, a través del API Gateway, la consulta de eventos históricos por
correlationId, traceId, servicio y nivel.* **Página(s): 7.**

**Cobertura.** Web. La pantalla **Auditoría** llama a la API del Gateway, así que probarla
en el navegador es probar la consulta del Gateway.

**Precondiciones.** Sesiones de admin y de cliente. El código de seguimiento y la traza de una transferencia (F3-TRX-02).

**Cómo probarlo.**
1. Admin → **Auditoría**:
   - Arriba, **Código de seguimiento** = el correlationId → **Consultar**. Aparece el rastro
     de la operación. **Detalle** muestra el payload, con montos «[redactado]».
   - En «Últimos eventos del sistema», prueba cada filtro por separado y luego combinados:
     - **Código de seguimiento** = el mismo correlationId → **Buscar**.
     - **Traza** = los 32 caracteres → **Buscar**.
     - **Servicio** = `payment-service` → **Buscar**.
     - **Nivel** = «Error» → **Buscar**.
     - **Servicio** = `transaction-service` + **Nivel** = «Error» → **Buscar**.
   - **Limpiar filtros** entre una prueba y otra.
2. Validación: **Traza** = `XYZ` → **Buscar**.
3. Roles: con la sesión del **cliente**, escribe `/auditoria` en la barra de direcciones.

**Resultado esperado.**
- Cada búsqueda devuelve eventos con Fecha y hora, Tipo de evento, Servicio, Código de
  seguimiento, Traza, Estado y Severidad. **Ver rastro** abre la cadena completa de la operación.
- La traza mal formada no se busca: el campo avisa «Debe tener 32 caracteres hexadecimales…».
- El cliente no ve «Auditoría» en el menú; al abrir `/auditoria` vuelve a Inicio.

**Evidencia a capturar.** **Auditoría** con el rastro y con cada filtro; el mensaje de la traza inválida; la redirección del cliente.

### F3-AUD-04 — Notificación al recibir `AccountAnomalyDetected` o una alerta de SLO

**Requisito.** *Generar una notificación al recibir AccountAnomalyDetected o una alerta
de SLO.* **Página(s): 7** (y p. 9, «Enviar las alertas a un canal visible … o Notification & Audit Service»).

**Cobertura.** Web.

**Precondiciones.** F3-ACC-02 hecho.

**Cómo probarlo.**
1. Admin → menú del avatar → **Consola de notificaciones** → filtro **«Todos los estados»**.
2. Busca las tarjetas de tipo `account.anomaly` y `alert.slo`. Las de alertas pueden ser
   de corridas anteriores: también cuentan como evidencia.
3. En **Auditoría** → «Últimos eventos del sistema», **Servicio** = `gateway` → **Buscar**.
   Abre **Detalle** de un evento `alert.slo.received.v1`.

**Resultado esperado.**
- Tarjetas con los asuntos:
  - **«Detectamos actividad inusual en tu cuenta»**: Advertencia, tipo `account.anomaly`.
  - **«Alerta de SLO activa: <Alerta>»**: Error si la alerta es `critical`, Advertencia si es `warning`.
  - **«Alerta de SLO resuelta: <Alerta>»**: Info.
- Estado **Enviada**; destinatario simulado `operadores@simulado.bonking.gt`.
- El payload de `alert.slo.received.v1` trae `alerts[].alertName`, `status`, `slo` y `runbookUrl`.
- Si no aparece ninguna de alertas, cada despliegue deja una `PipelineWebhookCheck`.

**Evidencia a capturar.** La consola de notificaciones con al menos una de cada tipo.

### F3-AUD-05 — Dashboard de logs, búsqueda por correlationId y traceId, salto de log a traza

**Requisito.** *Dashboard de logs; búsqueda por correlationId y traceId; navegación desde un log hacia su traza.* **Página(s): 7.**

**Cobertura.** Web.

**Precondiciones.** El código de seguimiento y la traza de una transferencia reciente.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Logs**, con las variables de arriba:
   - **Entorno** = `prod`, **Servicio** = All, **Nivel** = All.
   - **correlationId** = pega el código de seguimiento. El valor por defecto `.+` significa «todos».
   - Mira **«Volumen de log por nivel»**, **«Volumen de log por servicio»** y **«Logs»**.
2. Vuelve a poner **correlationId** en `.+` y busca ahora por el traceId.
3. En el panel **Logs**, despliega una línea. En *Links* hay dos botones:
   - **«Ver la traza»**: púlsalo; abre la traza en Tempo.
   - **«Ver el flujo completo»**: abre en Loki todas las líneas del mismo correlationId.
4. De vuelta, de la traza al log: en Tempo, abre un span y pulsa **«Logs for this span»**.

**Resultado esperado.**
- El filtro por correlationId muestra líneas de **varios servicios**: gateway
  `http request`, transaction, account, payment y notification-audit.
- «Ver la traza» abre la traza correcta en un panel dividido.
- «Logs for this span» devuelve las líneas con ese `traceId`.

**Evidencia a capturar.** El dashboard filtrado; el botón «Ver la traza» y la traza abierta.

---

## D. Integración interbancaria (§4.1)

Requisitos generales de las páginas 7 y 8 (capacidades, estados, idempotencia, datos
mínimos, validaciones, mock, frontend, observabilidad, reglas de evaluación) y la
restricción de la p. 11 (HTTP asíncrono 202 + callback, entrando por el Gateway y
saliendo desde Payment).

Siempre que no se diga otra cosa: banco `BANK99`, cuenta destino `99-000000123`, Q1.00,
origen la Monetaria del cliente.

**El mock en modo `ACCEPT` decide por la cuenta destino**, y eso es lo que permite probar
rechazos desde la web sin tocar el mock:

| Cuenta destino | Respuesta del mock |
| --- | --- |
| Termina en `999999999`, p. ej. `99-999999999` | Rechaza: `ACCOUNT_NOT_FOUND` |
| Termina en `000000000`, p. ej. `99-000000000` | Rechaza: `ACCOUNT_INACTIVE` |
| Cualquier otra, p. ej. `99-000000123` | Acredita: `ACCEPTED` |

Si un envío a `99-000000123` no termina en «Acreditado», el mock quedó en otro modo de una
prueba anterior. Pídele a quien tenga la terminal que lo restaure.

### F3-IB-01 — Envío con ACCEPT: Saga, reserva, 202 y callback ACCEPTED

**Requisito.** *Transaction Service inicia la Saga y Account reserva el monto; Payment
envía la solicitud al API Gateway del banco pareja y recibe 202; el pareja confirma por
callback; si es ACCEPTED, el débito se confirma. Estados PENDING, SENT, ACCEPTED,
REJECTED, TIMEOUT, REVERSED. Datos mínimos: interbankTransferId, idempotencyKey, banco
origen, banco destino, cuenta destino, monto, moneda GTQ, timestamp y traceparent.*
**Página(s): 7** (restricción HTTP: **p. 11**).

**Cobertura.** Web.

**Precondiciones.** Sesión de cliente. Anota el saldo de la Monetaria.

**Cómo probarlo.**
1. **Transferencias** → **A otro banco** (`/transferencias/interbancaria`, «Depósito a otro banco»):
   - **Cuenta de origen** = Monetaria.
   - **Código del banco de destino** = `BANK99`.
   - **Cuenta de destino en ese banco** = `99-000000123`.
   - **Monto** = `1.00`.
   - Fíjate en **«Código de esta operación»**: es la `Idempotency-Key`.
   - **Revisar el depósito** → **Confirmar y enviar**.
2. Te lleva a `/transferencias/interbancarias/<interbankTransferId>`. La pantalla se
   actualiza sola. Copia la traza del recuadro **«Código de seguimiento del depósito»**.
3. Observa **«Estado del depósito»** y el historial.
4. **Ver la transferencia** abre la transferencia asociada.
5. Lo que llegó al mock, desde Grafana: abre la traza en Tempo y busca el span
   `partner-bank-mock POST /interbank/v1/transfers`. Sus atributos traen el
   `bank.interbank.transfer_id`.

**Resultado esperado.**
- Estados **«Por enviar»** (PENDING) → **«Esperando al otro banco»** (SENT) → **«Acreditado»** (ACCEPTED), en unos 2–3 s.
- Historial: «Depósito registrado» → «Solicitud entregada al otro banco» → «El otro banco acreditó el depósito».
- Datos visibles: Banco de destino, Cuenta de destino **enmascarada**, Cuenta de origen,
  Solicitado, Entregado al otro banco, **El otro banco debía confirmar antes de**
  (creación + 180 s) y Respuesta del otro banco.
- Saldo de la Monetaria −Q1.00. La transferencia asociada queda **Completada**.

**Evidencia a capturar.** El depósito en «Acreditado» con su historial; el span del mock en Tempo.

### F3-IB-02 — REJECTED → compensación y saldo restaurado

**Requisito.** *Si es REJECTED … se ejecuta la compensación y se libera el monto.*
**Página(s): 7** (§8.2 2.9 p. 22; penalización p. 23).

**Cobertura.** Web, con las cuentas de rechazo del mock.

**Precondiciones.** Anota el saldo de la Monetaria.

**Cómo probarlo.**
1. Envía Q1.00 a `BANK99`, cuenta **`99-999999999`**, como en F3-IB-01.
2. Mira la pantalla del depósito hasta que se detenga. Pulsa **Ver la transferencia**.
3. Repite con la cuenta **`99-000000000`**.
4. Mira el saldo. Abre una de las dos trazas en Tempo.

**Resultado esperado.**
- Estado **«Rechazado»** con el motivo en **«Por qué no se completó»**: la cuenta no
  existe, o está inactiva. Luego pasa a **«Devuelto»** (REVERSED).
- El historial termina en «El dinero volvió a la cuenta de origen».
- La transferencia asociada queda **Compensada**, motivo `PAYMENT_DECLINED`.
- **Saldo final = saldo inicial**: en Movimientos hay dos líneas por envío, el débito y la compensación.
- La traza tiene `payment.interbank send` con `bank.interbank.stage=REJECTED`,
  `saga.compensation ordered` y `saga.compensation completed`.

**Evidencia a capturar.** El depósito en «Devuelto»; el saldo antes y después; la traza con la compensación.

### F3-IB-03 — El pareja no confirma (TIMEOUT): reserva retenida, consulta, cancelación y devolución

**Requisito.** *Si … vence el tiempo de espera, se ejecuta la compensación y se libera el
monto.* El contrato fija el protocolo: TIMEOUT a los 180 s con el monto reservado →
`GET /transfers/{id}` → `POST /cancel` → REVERSED. **Página(s): 7** (y §4.1 «El banco
pareja no responde», p. 10).

**Cobertura.** **Sin vía web para provocarlo**: hay que poner el mock en modo `TIMEOUT`.
Desde la web se revisan los depósitos que ya pasaron por ese camino, o se observa en vivo
uno que provoque alguien con terminal.

**Cómo revisarlo.**
1. Como cajero o admin, **Transferencias** → **A otro banco** → listado
   «Depósitos a otros bancos» (`/transferencias/interbancarias`). Filtro **«Devuelto»**.
2. Abre con **Ver →** los que tengan en el historial «El otro banco no confirmó a tiempo».
3. Explore → Prometheus:
   ```promql
   sum by (environment, result) (bank_interbank_sent_total)
   ```

**Resultado esperado.**
- Historial: «Depósito registrado» → «Solicitud entregada al otro banco» → «El otro banco
  no confirmó a tiempo» → «El dinero volvió a la cuenta de origen».
- Entre la creación y «El dinero volvió…» hay **más de 180 s**: no se devolvió antes del vencimiento.
- Motivo: «Pedimos cancelar el depósito porque el otro banco no lo confirmó a tiempo, y lo
  canceló: no se acreditó.» Sin la advertencia «El dinero volvió sin confirmación del otro banco».
- `result="timeout"` > 0 si hubo alguno en los últimos 7 días.
- **En vivo**: mientras está vencido, la pantalla muestra **«Sin respuesta»** con la alerta
  **«Por qué seguimos esperando»**: «El otro banco no confirmó a tiempo. Le estamos
  preguntando qué pasó y el dinero sigue reservado…». Pocos segundos después, **«Devuelto»**.

**Evidencia a capturar.** Un depósito devuelto tras TIMEOUT con su historial y sus horas.

### F3-IB-04 — El pareja no contesta ni la consulta ni la cancelación: liberación a ciegas a los 180 + 300 s y alerta

**Requisito.** Mismo requisito de vencimiento (**p. 7**), más *SLO y alerta específicos
para la dependencia con el banco pareja* (**p. 8**). El contrato exige alertar en la
liberación sin confirmación.

**Cobertura.** **Sin vía web para provocarlo** (mock en `TIMEOUT` + `UNREACHABLE`). Se revisa lo que ya existe.

**Cómo revisarlo.**
1. Listado de depósitos con el filtro **«Devuelto»**. Busca uno con la advertencia **«El
   dinero volvió sin confirmación del otro banco»**.
2. Grafana → *Alerting* → *Alert rules* → **InterbankReserveReleasedUnverified** → pestaña
   del historial de estados.
3. **Consola de notificaciones** → «Alerta de SLO activa: InterbankReserveReleasedUnverified».
4. Explore → Loki, **Last 7 days**:
   ```logql
   {service_name="payment-service"} |~ "RELEASED_NO_ANSWER|RELEASED_UNKNOWN_AT_PARTNER"
   ```

**Resultado esperado.**
- Unos 8 minutos (180 + 300 s) entre la creación y la devolución.
- La regla es `critical`, sin `for`, con runbook `partner-bank.md`.
- La notificación, con severidad Error.

**Evidencia a capturar.** El depósito con la advertencia; la regla y su historial; la notificación.

### F3-IB-05 — ACCEPTED tardío sobre un depósito ya devuelto: reverso, sin doble crédito

**Requisito.** *Idempotencia obligatoria … nunca debe acreditar dos veces* (**p. 7**) y
penalización *«Depósito interbancario duplicado o monto perdido sin compensación: 50 %»*
(**p. 23**). El contrato: un ACCEPTED sobre una transferencia ya REVERSED se registra como
incidente ERROR y se pide `POST /reversals`.

**Cobertura.** **Sin vía web para provocarlo**: el callback tardío lo fuerza la
administración del mock.

**Cómo revisarlo.**
1. Listado de depósitos, filtro **«Devuelto»**. Busca uno con la sección **«Reverso pedido al otro banco»**.
2. Explore → Loki, **Last 7 days**:
   ```logql
   {service_name="payment-service"} |= "interbank v1 reversal requested"
   ```

**Resultado esperado.**
- La sección «Reverso pedido al otro banco», con la insignia en **«Completado»** y el `reversalId`.
- El estado sigue en **«Devuelto»**.
- Una línea `error` `interbank v1 reversal requested` con su `correlationId`.
- En **Movimientos** de la cuenta de origen, el dinero volvió **una sola vez**.

**Evidencia a capturar.** La sección del reverso; la línea de log.

### F3-IB-06 — Recepción desde el pareja, acreditada una sola vez aunque se repita

**Requisito.** *La solicitud entra por el API Gateway autenticada con la API key (Secret
de K8s); Payment valida la cuenta destino y publica un evento; Account acredita; el banco
responde por callback (ACCEPTED o REJECTED con motivo). Idempotencia: un reintento del
pareja nunca acredita dos veces.* **Página(s): 7.**

**Cobertura.** **Sin vía web para provocarlo.** Para que nos llegue un depósito, el mock
tiene que originarlo (administración con token), o el grupo de `BANK16` tiene que
enviarlo desde su sistema. Esto último sólo **coordinado con ellos** y sin inyectar fallos (p. 8).

**Cómo revisarlo.**
1. Dashboard **Bank USAC · Banco pareja**, rango **Last 7 days**, mitad de arriba
   (recibidos): «Depósitos recibidos por resultado», «Callbacks que enviamos, por resultado».
2. Explore → Tempo:
   ```traceql
   {name="payment.interbank state"}
   ```
3. Si el depósito fue a una cuenta del cliente sembrado, en **Cuentas** → la cuenta →
   **Movimientos** aparece un **Crédito** por cada depósito recibido, sin duplicados.
4. La autenticación por API key, en GitHub:
   [`apps/gateway/src/application/interbank-partners.ts`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/apps/gateway/src/application/interbank-partners.ts).

**Resultado esperado.**
- `result="accepted"` en los recibidos; spans `payment.interbank state` con stage ELIGIBILITY → CREDIT → ACCEPTED.
- Un solo crédito por depósito.

**Evidencia a capturar.** El dashboard y una traza de recepción.

### F3-IB-07 — Validaciones de la recepción: cuenta inexistente o inactiva, monto, banco, conflicto y vencido

**Requisito.** *Validaciones: cuenta destino existente y activa … y monto máximo por
operación configurable* (**p. 7**). Contrato: `409` si se repite el id con contenido
distinto; `422` si ya venció.

**Cobertura.** **Sin vía web**: los depósitos entrantes con datos inválidos los origina el mock.

**Cómo revisarlo.**
1. **Bank USAC · Banco pareja**, **Last 7 days** → «Depósitos recibidos por resultado» y
   «Cambios de estado de cada depósito».
2. Explore → Loki, **Last 7 days**:
   ```logql
   {service_name="payment-service"} |= "interbank deposit state changed" |~ "REJECTED"
   ```
3. Explore → Prometheus:
   ```promql
   sum by (environment, result) (bank_interbank_deposits_total)
   ```

**Resultado esperado.**
- Rechazos con su motivo (`ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `AMOUNT_LIMIT_EXCEEDED`, …), sin crédito.
- Las líneas de log con el motivo, **sin montos ni tokens**.

**Evidencia a capturar.** El dashboard y las consultas.

### F3-IB-08 — Validaciones del envío: límite, banco, moneda, KYC y cuenta ajena

**Requisito.** *Validaciones: … cliente origen con KYC verificado (Fase 2) y monto máximo
por operación configurable.* **Página(s): 7.**

**Cobertura.** Web parcial. La moneda y la cuenta ajena no se pueden ni intentar desde el
formulario: no hay campo de moneda (siempre GTQ) y **Cuenta de origen** sólo lista las
cuentas propias. Que el frontend no deje es la evidencia; el rechazo del Gateway lo cubren
las pruebas automáticas.

**Precondiciones.** Sesiones de cliente y de cajero. Anota el saldo.

**Cómo probarlo.**
1. **Límite**: en **A otro banco**, **Monto** = `10000.01` → **Revisar el depósito**.
2. **Banco no registrado**: **Código del banco de destino** = `BANK55`, Monto `1.00` → **Revisar el depósito** → **Confirmar y enviar**.
3. **Formato de banco**: **Código del banco de destino** = `BANCO1`.
4. **Moneda y cuenta ajena**: abre la lista **Cuenta de origen**. Sólo están las cuentas del cliente.
5. **KYC**:
   - Usa el cliente **rechazado** de F3-CUS-01. Si no lo tienes, registra uno nuevo por `/registro` y **no** lo apruebes.
   - Como cajero, **Cuentas** → **Abrir cuenta** (`/cuentas/nueva`) → busca al cliente por nombre o DPI → Monetaria → **Continuar** → **Crear la cuenta**.
   - Deposítale Q5.00 en **Cuentas** → **Depósito**.
   - Como cajero, **Nueva transferencia** y elige esa cuenta como **Cuenta de origen**.
6. Mira el saldo del cliente sembrado.

**Resultado esperado.**
- Límite: el formulario bloquea con «El monto máximo por depósito a otro banco es Q 10,000.00.»
- `BANK55`: el envío se rechaza con un mensaje de error y no se crea ningún depósito.
- `BANCO1`: el formulario no lo acepta; el código debe ser `BANK` seguido de dos dígitos.
- KYC: la pantalla avisa **«Cliente titular no verificado»**: «…No es posible realizar
  transferencias con fondos de clientes no verificados.» No hay débito.
- El saldo no cambia en ningún caso.

**Evidencia a capturar.** Los tres mensajes; la lista de cuentas de origen; el aviso de KYC.

### F3-IB-09 — Reintento idempotente del envío con la misma `Idempotency-Key`

**Requisito.** *Idempotencia obligatoria mediante idempotencyKey.* **Página(s): 7.**

**Cobertura.** **Sin vía web.** El formulario muestra la clave en **«Código de esta
operación»** («Se mantiene igual mientras reintentas…»), y sólo la reutiliza si el Gateway
no contestó a tiempo. En ese caso el botón cambia a **«Volver a intentar el envío»**. Esa
falla no se puede provocar desde el navegador.

**Cómo revisarlo.**
1. Muestra el campo «Código de esta operación» en el formulario de **A otro banco**.
2. Si en alguna corrida apareció **«Volver a intentar el envío»**, revisa que en el listado
   haya **un solo** depósito para esa clave y un solo débito en **Movimientos**.
3. El comportamiento lo cubren las pruebas automáticas. Su ubicación en el repositorio:
   [`apps/web/app/components/shared/SharedIdempotencyKeyField.vue`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/apps/web/app/components/shared/SharedIdempotencyKeyField.vue)
   y las suites de idempotencia del Gateway y de Payment.

**Evidencia a capturar.** El campo en el formulario. Para la prueba en vivo,
[la versión con comandos](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/9495318/docs/qa/guia-validacion-manual-fase3-produccion.md#f3-ib-09--reintento-idempotente-del-envío-con-la-misma-idempotency-key).

### F3-IB-10 — Roles: sólo CLIENTE origina; CAJERO y ADMIN reciben 403

**Requisito.** *Frontend: enviar depósitos al banco pareja …* (**p. 7**) junto con la
matriz de roles D-06 del sistema: un envío es un producto del cliente sobre sus cuentas.

**Cobertura.** Web.

**Cómo probarlo.**
1. Como **cajero**, **Transferencias** → **A otro banco**. Origen = la Monetaria del cliente
   sembrado, `BANK99`, `99-000000123`, Q1.00 → **Revisar el depósito** → **Confirmar y enviar**.
2. Repite como **admin**.
3. Como cajero, abre el listado «Depósitos a otros bancos».
4. Como cliente, abre «Mis depósitos a otro banco».

**Resultado esperado.**
- Cajero y admin: el envío se rechaza con «Tu rol no tiene permitido realizar esta
  operación.» No se crea depósito ni hay débito.
- Lectura: el cajero y el admin ven los depósitos de **todos**; el cliente, sólo los suyos.

**Evidencia a capturar.** Los dos mensajes de rechazo; los dos listados.

### F3-IB-11 — El mismo traceId en los dos bancos

**Requisito.** *Propagar el traceparent hacia y desde el banco pareja, para relacionar un
depósito entre ambos bancos con el mismo traceId.* **Página(s): 8** (§8.2 2.9 p. 22).

**Cobertura.** Web para el envío. Web parcial para la recepción: sólo las que ya existan.

**Precondiciones.** La traza del depósito de F3-IB-01.

**Cómo probarlo.**
1. Explore → Tempo → pega la traza del envío.
2. Recepciones anteriores, rango **Last 7 days**:
   ```traceql
   {resource.service.name="partner-bank-mock" && name=~"POST /interbank/v1/transfers.*"}
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
- **Recepción**, si existe alguna: la raíz es el mock, y el Gateway, Payment y Account cuelgan de ella.

**Evidencia a capturar.** La traza del envío con los spans del mock resaltados.

### F3-IB-12 — Métricas interbancarias: éxito enviados y recibidos, p95 de confirmación, timeouts

**Requisito.** *Métrica: tasa de éxito de depósitos interbancarios (enviados y recibidos);
métrica: latencia de confirmación del banco pareja (p95) y número de timeouts.* **Página(s): 8.**

**Cobertura.** Web para los **enviados**. Para los **recibidos**, sólo la revisión de los
que ya existan: desde la web no se puede originar un depósito hacia nosotros (F3-IB-06).

**Precondiciones.** F3-IB-01 y 02 hechos **en los últimos 5 minutos**. Si pasó más tiempo,
haz otro envío ACCEPT antes de abrir el dashboard.

> **Cómo leer este dashboard.**
> - **La mitad de arriba es lo que RECIBIMOS** de otro banco. **La de abajo es lo que
>   ENVIAMOS.** Tus envíos de F3-IB-01 y 02 sólo aparecen abajo.
> - Las tasas y los p95 miran **los últimos 5 minutos**. Sin depósitos en esos 5 minutos,
>   la proporción no tiene denominador y el panel dice «No data» a propósito, en vez de
>   inventar un 0 % o un 100 %.
> - Los recuadros muestran el **último valor no vacío del rango** (`lastNotNull`). Por eso,
>   ampliar el rango a *Last 7 days* muestra el último valor que tuvieron.

**Cómo probarlo.**
1. **Mitad de abajo, «La otra mitad del enlace: lo que ESTE banco envía»**, de **Bank USAC ·
   Banco pareja**, rango *Last 15 minutes*: «Depósitos enviados y confirmados (SLO-28 ≥ 95 %)»,
   «Confirmación del envío, p95», «Error budget del envío», «Vencimientos en la última hora»,
   «Depósitos enviados por resultado», «Latencia de confirmación del envío (p95)».
2. **Mitad de arriba (recibidos)**, rango ***Last 7 days***: «Depósitos aceptados (SLO-28 ≥ 95 %)»,
   «Confirmación p95», «Error budget restante», «Depósitos en la última hora», «Depósitos
   recibidos por resultado», «Callbacks que enviamos, por resultado», «Latencia de
   confirmación por resultado (p95)», «Cambios de estado de cada depósito».
3. **Bank USAC · Métricas clave (SLI)** → **«Interbancario: tasa de éxito enviados y recibidos»**.
4. Explore → Prometheus. Los totales no dependen de la ventana de 5 minutos:
   ```promql
   sum by (result) (bank_interbank_sent_total{environment="prod"})
   ```
   ```promql
   sum by (result) (bank_interbank_deposits_total{environment="prod"})
   ```

**Resultado esperado.**
- Abajo, con los envíos recientes: la tasa de enviados con valor y «Depósitos enviados por
  resultado» con `accepted` y `rejected`.
- Arriba, con *Last 7 days*: el último valor de los recibidos, si entró alguno en la
  semana. **Si sigue en «No data» con 7 días, no hubo ninguno**, y la segunda consulta
  del paso 4 está en 0. Anótalo como pendiente de F3-IB-06, que necesita terminal o el
  banco del otro grupo.
- Dos series de tasa de éxito, `direction="sent"` y `direction="received"`, sin promediar.
- `bank_interbank_sent_total` con `result` ∈ `accepted` · `rejected` · `timeout`. REVERSED no se cuenta, para no duplicar.
- Tus envíos de F3-IB-01 y 02 suman en `accepted` y `rejected`.
- Los paneles de **p95 de confirmación** son histogramas con el mismo límite que F3-CUS-03:
  la primera observación de cada serie desde que arrancó el pod de payment-service no se
  ve. Si «Confirmación del envío, p95» sale en blanco, haz un segundo envío ACCEPT
  (F3-IB-01) y espera 1–2 minutos.

**Evidencia a capturar.** El dashboard completo del banco pareja.

### F3-IB-13 — SLO-28 y sus alertas específicas para la dependencia del pareja

**Requisito.** *SLO y alerta específicos para la dependencia con el banco pareja.* **Página(s): 8.**

**Cobertura.** **Sin vía web para dispararlas**: hace falta el mock en `REJECT` o `SLOW` más
k6 durante 7 minutos. Desde la web se revisan las reglas y sus disparos anteriores.

**Cómo revisarlo.**
1. Grafana → *Alerting* → *Alert rules* → abre **PartnerBankSendDegraded**,
   **PartnerBankSendConfirmationSlow**, **PartnerBankDegraded** y
   **PartnerBankConfirmationSlow**. Mira la expresión, el `for`, las etiquetas
   (`severity`, `slo: SLO-28`), la anotación `runbook_url` y el historial de estados.
2. **Consola de notificaciones** → filtro «Todos los estados» → busca «Alerta de SLO activa: PartnerBank…».
3. **Bank USAC · Banco pareja** y **Bank USAC · SLO y error budget** →
   «Error budget · SLO-28 Banco pareja (enviados y recibidos)», con rango **Last 7 days**.

**Resultado esperado.**
- `PartnerBankSendDegraded`: `slo:interbank_sent_accepted:ratio_rate5m < 0.95`, `for: 5m`, `warning`.
- `PartnerBankSendConfirmationSlow`: p95 > 5 s, `for: 5m`, `warning`.
- Las dos de recibidos, con `for: 15m`.
- Las cuatro con runbook `docs/operations/runbooks/partner-bank.md`.
- Si hubo disparos en los últimos días, el historial y las notificaciones lo muestran.

**Evidencia a capturar.** Las reglas con su runbook; el historial o las notificaciones de disparos anteriores.

### F3-IB-14 — Logs de cada cambio de estado del depósito, sin datos sensibles

**Requisito.** *Logs de cada cambio de estado del depósito, sin exponer datos sensibles.* **Página(s): 8.**

**Cobertura.** Web.

**Precondiciones.** F3-IB-01 y 02 hechos.

**Cómo probarlo.**
1. **Bank USAC · Banco pareja** → **«Cambios de estado de cada depósito»**.
2. Explore → Loki:
   ```logql
   {service_name="payment-service", deployment_environment="prod"} |~ "interbank (send|deposit) state changed|interbank callback (delivered|failed)"
   ```
   ```logql
   {service_name=~"payment-service|gateway|partner-bank-mock", deployment_environment="prod"} |~ "(?i)x-api-key|apikey|bearer [A-Za-z0-9._-]{20,}"
   ```

**Resultado esperado.**
- Envío: una línea `interbank send state changed` por estado (`status` PENDING / SENT / ACCEPTED / REJECTED / TIMEOUT / REVERSED).
- Recepción: `interbank deposit state changed` (ELIGIBILITY / CREDIT / ACCEPTED / REJECTED).
- Cada línea con `correlationId`, `depositId` y el motivo si aplica.
- **Sin monto, sin API key, sin token**: la segunda consulta da **0 líneas**.

**Evidencia a capturar.** Las dos consultas.

### F3-IB-15 — Frontend del depósito, mock del contrato y acuerdo de integración

**Requisito.**
- *Implementar un simulador (mock) del banco pareja que cumpla el contrato … para inyectar fallos.*
- *Frontend: enviar depósitos y consultar el estado de cada uno.*
- *Acuerdo de integración: documento breve con URLs, autenticación, cuentas de prueba y ventana.*

**Página(s): 7** (entregables p. 12; reglas de pareja p. 8).

**Cobertura.** Web.

**Cómo probarlo.**
1. Como cliente, «Mis depósitos a otro banco» (`/transferencias/interbancarias`):
   - Columnas Fecha / Destino / Estado / Monto; **Ver →** abre el detalle.
   - Filtro **«Todos los estados»** con los seis estados. Prueba cada uno y **Limpiar filtro**.

   | Estado | Etiqueta |
   | --- | --- |
   | PENDING | Por enviar |
   | SENT | Esperando al otro banco |
   | ACCEPTED | Acreditado |
   | REJECTED | Rechazado |
   | TIMEOUT | Sin respuesta |
   | REVERSED | Devuelto |

2. En el detalle: **Actualizar ahora**, **Ver la transferencia**, y **Ver auditoría** si entras como admin.
3. El mock existe y sirve: Explore → Loki → *Label browser* → `service_name` = `partner-bank-mock`.
4. En GitHub:
   - El mock: [`apps/partner-bank-mock/`](https://github.com/marcosbondel/Proyecto-SA-B-2/tree/main/apps/partner-bank-mock).
   - El contrato: [`docs/references/interbank-contract-v1.openapi.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/docs/references/interbank-contract-v1.openapi.yaml).
   - El acuerdo: [`docs/operations/INTERBANK-AGREEMENT.md`](../operations/INTERBANK-AGREEMENT.md), que apunta al `AGREEMENT.md` del repositorio `bank-interbank-contract`.

**Resultado esperado.**
- Las pantallas existen y filtran.
- Los fallos se inyectan **sólo con el mock propio**; ninguna prueba toca el sistema de otro grupo (p. 8).

**Evidencia a capturar.** El listado filtrado; el detalle; el acuerdo.

---

## E. Instrumentación con OpenTelemetry (§4.1)

### F3-OTL-01 — Todos los servicios, incluido el Gateway, generan trazas y envían por OTLP al Collector

**Requisito.** *Todos los servicios, incluido el API Gateway, deben generar trazas
distribuidas con traceId y spanId … enviar la telemetría por OTLP a un OpenTelemetry
Collector desplegado en el cluster.* **Página(s): 8** (alcance p. 10; §8.1 p. 16; §8.2 2.1 p. 20).

**Cobertura.** Web.

**Cómo probarlo.**
1. Explore → Tempo → *Search* → **Service Name**: deben aparecer `gateway`,
   `customer-service`, `account-service`, `transaction-service`, `payment-service`,
   `notification-audit-service` y `partner-bank-mock`.
2. Explore → Prometheus:
   ```promql
   count by (service_name) (last_over_time(messaging_client_consumed_messages_total{environment="prod"}[1h]))
   ```
3. El código, en GitHub: `apps/<servicio>/src/instrumentation.ts` y el paquete
   [`apps/packages/observability`](https://github.com/marcosbondel/Proyecto-SA-B-2/tree/main/apps/packages/observability).
4. El Collector: Explore → Prometheus, `count by (pod) (kube_pod_info{namespace="observability", pod=~"otel-gateway.*"})`.

**Resultado esperado.** Los siete componentes con trazas y métricas, y el Collector `otel-gateway` corriendo en `observability`.

**Evidencia a capturar.** La lista de servicios en Tempo; la consulta.

### F3-OTL-02 — Propagación W3C `traceparent` por el broker: productor y consumidor en la misma traza

**Requisito.** *Propagar el contexto con W3C Trace Context (traceparent) en los headers de
cada mensaje del broker (… propiedades AMQP de RabbitMQ …), de modo que productor y
consumidor queden en la misma traza.* **Página(s): 8** (§8.1 «Trazabilidad distribuida» p. 16; §8.2 2.2 p. 20; penalización p. 22).

**Cobertura.** Web.

**Precondiciones.** La traza de A (F3-TRX-02).

**Cómo probarlo.**
1. Abre la traza en Tempo. Comprueba que cada `publish <exchange>` (PRODUCER) tiene como
   hijo un `process <cola>` (CONSUMER) **de otro servicio**.
2. TraceQL:
   ```traceql
   {span.messaging.system="rabbitmq" && kind=consumer && resource.service.name="account-service"}
   ```
   ```traceql
   {kind=client && span.server.address=~"bank-usac-(customer|account|transaction|payment|notification-audit)-service.*"}
   ```

**Resultado esperado.**
- Una traza recorre gateway → transaction → customer → account → payment → transaction → account → notification-audit.
- Los spans de mensajería llevan `messaging.system=rabbitmq`, `messaging.destination.name`,
  `bank.message.type` y `bank.delivery.outcome`.
- La segunda consulta (HTTP entre servicios) devuelve **0 trazas**.

**Evidencia a capturar.** La traza con la cadena PRODUCER → CONSUMER entre servicios; la consulta en 0.

### F3-OTL-03 — correlationId como atributo de span (también en el SERVER del Gateway) y en los logs

**Requisito.** *Mantener el correlationId de la Fase 1 como atributo del span y en los
logs: el traceId identifica la traza técnica y el correlationId el flujo de negocio.*
**Página(s): 8** (§8.2 2.2 p. 20).

**Cobertura.** Web.

**Precondiciones.** El código de seguimiento de A.

**Cómo probarlo.**
1. Tempo: `{span.bank.correlation_id="<código de seguimiento>"}`. En la traza, abre el span
   **`POST /api/transfers`** del Gateway (SERVER) y busca `bank.correlation_id`; luego un
   span de mensajería y uno de dominio.
2. Loki: `{service_name=~".+", deployment_environment="prod"} | correlationId="<código de seguimiento>"`.
3. En el frontend, el recuadro de la transferencia muestra **las dos cosas**: el código de
   seguimiento (correlationId) y la traza (traceId). Las dos vienen de las cabeceras
   `X-Correlation-Id` y `X-Trace-Id` del Gateway.

**Resultado esperado.**
- El mismo correlationId en el span SERVER del Gateway, en cada span de mensajería y en las líneas JSON de todos los servicios.
- En un envío interbancario, la decisión del pareja llega con otro correlationId (el del callback), pero en la **misma** traza.

**Evidencia a capturar.** Los atributos del span SERVER; la consulta de Loki; el recuadro del frontend.

### F3-OTL-04 — Convenciones semánticas de OpenTelemetry

**Requisito.** *Seguir las convenciones semánticas de OpenTelemetry para nombrar spans,
métricas y atributos.* **Página(s): 8.**

**Cobertura.** Web.

**Cómo probarlo.**
1. En una traza revisa los nombres y atributos:
   - `POST /api/transfers`, con `http.route` y `http.response.status_code`;
   - `publish bank.commands` y `process account.commands`, con `messaging.system` y `messaging.destination.name`;
   - `pg.query:…`.
2. Explore → Prometheus:
   ```promql
   count by (__name__) ({__name__=~"http_server_request_duration_seconds_count|messaging_client_sent_messages_total|messaging_client_consumed_messages_total|messaging_process_duration_seconds_count"})
   ```
3. El catálogo, en GitHub: [`docs/sre/telemetry-catalog.md`](../sre/telemetry-catalog.md).

**Resultado esperado.**
- Nombres estándar: `http.server.request.duration`, `messaging.client.*`.
- Los atributos propios del banco van bajo el prefijo `bank.*`.

**Evidencia a capturar.** Los atributos de un span HTTP y de uno de mensajería.

---

## F. Métricas (SLI base) (§4.1)

### F3-SLI-01 — Latencia de transacciones en percentiles

**Requisito.** *Latencia de transacciones en percentiles p50, p95 y p99 (histogramas, no
promedios).* **Página(s): 8** (§8.2 2.4 p. 20).

**Cobertura.** Web.

**Cómo probarlo.**
- Las transferencias: F3-TRX-01.
- El Gateway: **Bank USAC · Métricas clave (SLI)** → **«Latencia del Gateway por método (p95)»**.
- Explore → Prometheus:
  ```promql
  sli:gateway_latency:seconds_p95{environment="prod"}
  ```

**Resultado esperado.**
- Series por `http_request_method` (GET / POST). `NaN` en un método sin tráfico en 5 min es correcto.
- Ningún panel de latencia usa `_sum / _count`.

**Evidencia a capturar.** El panel.

### F3-SLI-02 — Tasa de errores

**Requisito.** *Tasa de errores.* **Página(s): 8.**

**Cobertura.** Web.

**Cómo probarlo.**
1. **Bank USAC · Errores en tiempo real**:
   - **«5xx del Gateway (por segundo)»**
   - **«Entregas a la cola muerta (por segundo)»**
   - **«Mensajes ilegibles en auditoría (por segundo)»**
   - **«Entregas que no terminaron en ack, por cola»**
   - **«Transferencias que terminaron en FAILED, por motivo»**
   - **«Todos los errores, de todos los servicios»**
2. **Bank USAC · Estado del sistema** → **«Respuestas 5xx del Gateway por ruta»**.

**Resultado esperado.** Valores en 0 con el sistema sano. «Transferencias que terminaron en
FAILED, por motivo» muestra la C de F3-TRX-02; «Todos los errores» muestra las compensaciones.

**Evidencia a capturar.** El dashboard de errores.

### F3-SLI-03 — Throughput por servicio y por cola

**Requisito.** *Throughput (eventos por segundo por servicio y por tópico/cola).* **Página(s): 8.**

**Cobertura.** Web.

**Cómo probarlo.**
1. Paneles:
   - **Bank USAC · Estado del sistema** → **«Throughput por servicio: consumido y publicado (mensajes/s)»**
   - **Bank USAC · Métricas clave (SLI)** → **«Throughput por cola (mensajes/s)»** y **«Mensajes publicados por servicio (mensajes/s)»**
   - **Bank USAC · Consumer lag del broker** → **«Consumo por cola (mensajes/s)»** y **«Publicación por exchange (mensajes/s)»**
2. Explore → Prometheus:
   ```promql
   sli:throughput_by_queue:rate5m{environment="prod"}
   ```

**Resultado esperado.**
- Series por `service_name` y por cola (`transaction.saga`, `account.commands`, `payment.commands`, `audit.*`).
- Suben con cada transferencia. Para ver un pico claro, haz la ráfaga de F3-ACC-02 con el panel abierto.

**Evidencia a capturar.** Los paneles con el pico de la ráfaga.

### F3-SLI-04 — Consumer lag del broker

**Requisito.** *Consumer lag del broker (mensajes pendientes por consumidor).* **Página(s): 8.**

**Cobertura.** Web.

**Cómo probarlo.**
1. Dashboard **Bank USAC · Consumer lag del broker**: «De dónde sale», «Cola más atascada
   (mensajes pendientes)», «Total pendiente en el broker», «Entregado sin confirmar
   (unacked)», «Mensajes pendientes por cola», «Entregado sin confirmar por cola», «Tiempo
   de proceso por cola (p95)».
2. Para verlo moverse sin terminal: Entorno = `dev` y el rango absoluto de los
   experimentos del 2026-10-22 (§0.5). El lag de `transaction.*` sube en la carga y en la
   eliminación del pod, y vuelve a 0.

**Resultado esperado.**
- Una serie por `queue`: unas 60 colas por entorno, incluidas las `*.retry.*` y `*.dlq`.
- Valor 0 en reposo.

**Evidencia a capturar.** El dashboard en reposo y en la ventana de los experimentos.

### F3-SLI-05 — Disponibilidad del Gateway (respuestas no 5xx)

**Requisito.** *Disponibilidad: porcentaje de solicitudes exitosas (respuestas distintas de 5xx) en el API Gateway.* **Página(s): 8.**

**Cobertura.** Web.

**Cómo probarlo.**
1. **Bank USAC · Estado del sistema** → **«Disponibilidad del Gateway (SLO-27 ≥ 99 %)»**.
2. Explore → Prometheus: `slo:gateway_availability:ratio_rate5m{environment="prod"}`.
3. Que `/health` y `/ready` quedan fuera: en GitHub,
   [`infra/k8s/helm/bank-observability/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-observability/values.yaml),
   grupo `slo-gateway-availability`, filtro `http_route!~"/health|/ready"`.

**Resultado esperado.** ≈ 1 en reposo.

**Evidencia a capturar.** El stat y la regla.

### F3-SLI-06 — Sin etiquetas de alta cardinalidad

**Requisito.** *Métricas medidas sin etiquetas de alta cardinalidad.* **Página(s): 20** (§8.2 2.4); recomendación p. 15; Account p. 5.

**Cobertura.** Web.

**Cómo probarlo.** Explore → Prometheus:
```promql
count({__name__=~"bank_.*|messaging_.*|http_server_.*", account_id!=""} or {__name__=~"bank_.*|messaging_.*|http_server_.*", customer_id!=""} or {__name__=~"bank_.*|messaging_.*|http_server_.*", transaction_id!=""})
```
```promql
count by (http_route) (http_server_request_duration_seconds_count{service_name="gateway", environment="prod"})
```

**Resultado esperado.**
- La primera da vacío.
- La segunda lista rutas **plantilla** (`/api/transfers/:transactionId`), no URLs con UUID.
- Lo hace cumplir la prueba
  [`apps/packages/observability/test/metric-cardinality.spec.ts`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/apps/packages/observability/test/metric-cardinality.spec.ts).

**Evidencia a capturar.** Las dos consultas.

---

## G. SLO, error budget y alertas (§4.1)

### F3-SLO-01 — Los SLO de la Fase 1 medidos con datos reales en un dashboard

**Requisito.** *Medir cada SLO con datos reales y mostrar su cumplimiento en un dashboard.*
**Página(s): 9** (introducción p. 8; §8.1 «SLO y alertas» p. 17; §8.2 2.5 p. 21).

**Cobertura.** Web.

**Cómo probarlo.**
1. **Bank USAC · Estado del sistema**, los cuatro stats:
   - **«Disponibilidad del Gateway (SLO-27 ≥ 99 %)»**
   - **«Transferencias < 5 s (SLO-2 ≥ 95 %)»**
   - **«Entregas fuera de la cola muerta (SLO-1 ≥ 99 %)»**
   - **«Interbancario aceptado (SLO-28 ≥ 95 %): recibidos y enviados»**
2. **Bank USAC · SLO y error budget**: **«SLI contra su objetivo · Gateway (99 %)»**,
   **«SLI contra su objetivo · Transferencias (95 %)»** y **«SLI contra su objetivo · Latencia del Gateway (95 %)»**.
3. Las definiciones: [`docs/sre/sli-slo-sla.md`](../sre/sli-slo-sla.md) §5.3.

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

**Cobertura.** Web.

**Cómo probarlo.**
1. **Bank USAC · SLO y error budget**: **«Cómo se lee»** y los stats **«Error budget · SLO-27
   Gateway»**, **«… SLO-2 Transferencias»**, **«… SLO-1 Cola muerta»**, **«… SLO-28 Banco
   pareja (enviados y recibidos)»**, **«… SLO-6 Lecturas GET < 1 s»** y **«… SLO-7 Comandos POST < 3 s»**.
2. Explore → Prometheus:
   ```promql
   {__name__=~"slo:.*:budget_remaining7d", environment="prod"}
   ```

**Resultado esperado.**
- Un número por SLO, como fracción de 1 (1 = presupuesto intacto), calculado como
  `1 − (1 − proporción_7d) / (1 − objetivo)`.
- La ventana es de 7 días.
- **Un valor negativo es legítimo**: el presupuesto se agotó en pruebas de fallo anteriores.
  Explícalo en la evidencia; no es un error de cálculo.
- Lo que **no** debe salir es `NaN`.

**Evidencia a capturar.** Los stats con su valor; la explicación de los negativos.

### F3-SLO-03 — Al menos 4 alertas, incluida una por burn rate, como código

**Requisito.** *Configurar al menos 4 alertas (Grafana Alerting o Alertmanager), incluida al
menos una por tasa de consumo del error budget (burn rate).* **Página(s): 9** (versionadas: p. 9 «Dashboards obligatorios», último párrafo).

**Cobertura.** Web.

**Cómo probarlo.**
1. Grafana → *Alerting* → *Alert rules* → carpeta **Bank USAC**: 16 reglas en 3 grupos:
   `slo-burn-rate` (4), `slo-breach` (5) y `slo-partner-bank` (7, que incluye también las dos
   de reinicios y la liberación interbancaria).
2. El código, en GitHub:
   [`infra/k8s/helm/bank-observability/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-observability/values.yaml),
   sección `alerting` → `rules.yaml`.

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

Burn rate: las 1–4. Todas tienen `noDataState: OK` y la anotación `runbook_url`. Las
reglas aparecen como *Provisioned*: Grafana no deja borrarlas porque salen del repositorio.

**Evidencia a capturar.** La lista de reglas en Grafana y el bloque YAML en GitHub.

### F3-SLO-04 — Las alertas llegan a un canal visible (Notification & Audit)

**Requisito.** *Enviar las alertas a un canal visible (correo, Slack, Discord o Notification & Audit Service).* **Página(s): 9** (y p. 7).

**Cobertura.** Web.

**Cómo probarlo.**
1. Grafana → *Alerting* → *Contact points*:
   - `bank-audit-prod` → webhook `http://bank-usac-gateway.prod.svc.cluster.local:3000/api/alerts/slo`.
   - `bank-audit-dev` → el Gateway de dev.
2. *Notification policies*: `environment=dev` va a dev; el resto, a prod.
3. La recepción: F3-AUD-04.

**Resultado esperado.**
- Cada alerta disparada genera `alert.slo.received.v1` en Auditoría y una notificación «Alerta de SLO activa: …».
- Al resolverse, otra «…resuelta».

**Evidencia a capturar.** El contact point, la política y una notificación.

### F3-SLO-05 — Un runbook por alerta

**Requisito.** *Documentar un runbook por alerta: qué significa, cómo diagnosticarla y cómo mitigarla.* **Página(s): 9.**

**Cobertura.** Web.

**Cómo probarlo.**
1. En Grafana abre cualquier regla → anotación **runbook_url** → abre el enlace.
2. El índice: [`docs/operations/runbooks/README.md`](../operations/runbooks/README.md).
   Son 7 runbooks que cubren las 16 alertas (tabla de F3-SLO-03).

**Resultado esperado.** Todos los enlaces abren. Cada runbook explica qué significa la
alerta, cómo diagnosticarla (con consultas) y cómo mitigarla.

**Evidencia a capturar.** Una alerta con su runbook abierto.

### F3-SLO-06 — Las alertas se disparan durante las pruebas

**Requisito.** *Alertas con runbook que se disparan durante las pruebas.* **Página(s): 21** (§8.2 2.5).

**Cobertura.** Web parcial. Las alertas que dependen de carga, del mock o de la simulación
global no se pueden disparar desde el navegador. Se revisan sus disparos anteriores, y se
intenta una desde la web.

**Cómo probarlo.**

*Disparos anteriores:*
1. Admin → **Consola de notificaciones** → «Todos los estados». Anota cada alerta distinta
   con una tarjeta «Alerta de SLO activa: …» y su «…resuelta».
2. Grafana → *Alerting* → *Alert rules* → abre cada regla → historial de estados.

*Una alerta disparada desde la web (opcional, unos 40 min):*
3. **TransferLatencyBreach** exige que menos del 95 % de las transferencias de los últimos
   5 minutos termine en 5 s, sostenido 30 minutos. Desde la web:
   - Haz **una transferencia de Q1.00 cada 2–3 minutos durante 35 minutos**, siempre con
     **«El proveedor no responde (timeout)»**. Cada una tarda más de 5 s por la escalera
     de reintentos.
   - En ese tiempo **no hagas transferencias rápidas**: cada una que termine en menos de
     5 s sube la proporción.
   - Mira **Bank USAC · SLO y error budget** y la regla: *Pending* y, pasados 30 min, *Firing*.
   - Si otra persona está haciendo transferencias normales, la proporción no baja de 95 % y
     la alerta no dispara. Eso es correcto, no un fallo.

**Resultado esperado.**
- **Al menos cuatro** alertas distintas con notificación «activa» y «resuelta», cada una con su runbook.
- Las de burn rate de transferencias exigen **las dos ventanas**: si la última hora estuvo
  sana, FastBurn no dispara aunque los últimos 5 minutos estén mal. Es correcto.
- Si hay menos de cuatro en la consola, hay que dispararlas con terminal: tabla de F3-SLO-06 en la
  [versión con comandos](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/9495318/docs/qa/guia-validacion-manual-fase3-produccion.md#f3-slo-06--las-alertas-se-disparan-durante-las-pruebas).

**Evidencia a capturar.** La consola de notificaciones con las alertas y sus horas; las reglas con su historial.

---

## H. Logging estructurado y dashboards (§4.1)

### F3-LOG-01 — Logs JSON con timestamp, serviceName, correlationId, traceId, spanId, nivel, environment y version

**Requisito.** *Todos los logs deben estar en JSON e incluir timestamp, serviceName,
correlationId, traceId y spanId, nivel de log, environment (dev/prod) y version (tag de la
imagen desplegada).* **Página(s): 9** (§8.1 «Logs estructurados» p. 16; §8.2 2.3 p. 20).

**Cobertura.** Web.

**Cómo probarlo.**
1. Explore → Loki, uno por servicio. Despliega una línea y mira sus campos:
   ```logql
   {service_name="transaction-service", deployment_environment="prod"} | json | __error__=""
   ```
   Repite con `gateway`, `customer-service`, `account-service`, `payment-service`,
   `notification-audit-service` y `partner-bank-mock`.
2. Que ninguna línea de los servicios del banco deja de ser JSON:
   ```logql
   sum by (service_name) (count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service", deployment_environment="prod"} | json | __error__!="" [1h]))
   ```
3. La `version` contra la imagen desplegada, en Explore → Prometheus:
   ```promql
   count by (container, image) (kube_pod_container_info{namespace="prod"})
   ```
   O la anotación **Release** más reciente en **Bank USAC · Estado del sistema** (F3-DSH-03).

**Resultado esperado.**
- Cada línea con `timestamp`, `level`, `serviceName`, `environment`, `version`, `message`,
  `correlationId`, `traceId` y `spanId`.
- La consulta 2 da vacío o 0.
- `version` = `v1.3.9`, el mismo tag de las imágenes.
- Un campo que no aplica se **omite**, por ejemplo el `correlationId` de un barrido. Nunca va en `null`.

**Evidencia a capturar.** Una línea de cada servicio; la versión contra la imagen.

### F3-LOG-02 — Datos sensibles omitidos o enmascarados

**Requisito.** *Omitir o enmascarar datos sensibles: número de documento, correo,
fotografías, contraseñas y tokens JWT.* **Página(s): 9** (p. 5; restricción p. 10; penalización p. 23).

**Cobertura.** Web.

**Cómo probarlo.** Explore → Loki, rango **Last 24 hours**. Si una consulta da *timeout*,
baja a 6 h.

```logql
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `eyJ[A-Za-z0-9_-]{10,}\.` [24h]))
```
```logql
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `token=[^*&" ]{6,}` [24h]))
```
```logql
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `\b[0-9]{13}\b` [24h]))
```
```logql
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}` [6h]))
```
```logql
sum(count_over_time({service_name=~"gateway|customer-service|account-service|transaction-service|payment-service|notification-audit-service|partner-bank-mock", deployment_environment="prod"} |~ `(?i)bearer [A-Za-z0-9._-]{20,}|"(password|credential|identityDocument|photo)"` [24h]))
```

Y el positivo del enmascarado, después de registrar un cliente (F3-CUS-01):
```logql
{service_name="notification-audit-service", deployment_environment="prod"} |= "customer.activation"
```

En las trazas: abre la de `POST /api/customers` (F3-CUS-04). Ningún atributo lleva el
correo, el DPI, la foto ni un JWT.

En el frontend: como admin, **Auditoría** → **Detalle** de un evento de transferencia: los
montos del payload aparecen como «[redactado]».

**Resultado esperado.**
- Las cinco consultas dan **resultado vacío**: sin series quiere decir 0 coincidencias.
- La línea de activación muestra `"deliveryLink":"/activar?token=***"`.
- Los montos, «[redactado]» en Auditoría.

**Evidencia a capturar.** Las cinco consultas vacías, la línea `token=***` y el payload redactado.

### F3-DSH-01 — Los 8 dashboards obligatorios

**Requisito.** *Dashboards que muestren: estado del sistema, métricas clave (SLI),
cumplimiento de SLO y error budget, errores en tiempo real, flujo de trazas, consumer lag
del broker, uso de CPU/memoria y número de pods (HPA), despliegues marcados como
anotaciones.* **Página(s): 9** (§8.1 «Dashboards» p. 16; §8.2 2.6 p. 21).

**Cobertura.** Web.

**Cómo probarlo.** *Dashboards* → carpeta **Bank USAC**; Entorno = `prod`. Revisa cada uno.

| Obligatorio (p. 9) | Dashboard (JSON en `infra/k8s/helm/bank-observability/dashboards/`) | Qué mirar |
| --- | --- | --- |
| Estado del sistema | **Bank USAC · Estado del sistema** (`00-estado-del-sistema.json`) | los 4 SLO, «Réplicas disponibles por componente», 5xx por ruta |
| Métricas clave (SLI) | **Bank USAC · Métricas clave (SLI)** (`01-…`) | latencias, throughput, proveedor, KYC, cuentas, interbancario |
| SLO y error budget | **Bank USAC · SLO y error budget** (`02-…`) | presupuestos y burn rates |
| Errores en tiempo real | **Bank USAC · Errores en tiempo real** (`03-…`) | stats + «Todos los errores, de todos los servicios» |
| Flujo de trazas | **Bank USAC · Flujo de trazas** (`04-…`) | «Cómo seguir una Saga», «Transferencias recientes (TraceQL)», «Compensaciones (TraceQL)», «Depósitos interbancarios (TraceQL)» |
| Consumer lag | **Bank USAC · Consumer lag del broker** (`05-…`) | lag y unacked por cola |
| CPU / memoria / pods (HPA) | **Bank USAC · CPU, memoria, pods y HPA** (`06-…`) | «Pods listos», «Pods no listos», «CPU en uso (cores)», «Memoria en uso», «Réplicas por HPA: actuales, deseadas y máximo», «CPU por componente (cores)», «Memoria por componente», «Reinicios de contenedor (última hora)» |
| Despliegues como anotaciones | **en los 9**: anotaciones «Despliegues» y «Releases» | marcas verticales (F3-DSH-03) |
| (extra) Logs | **Bank USAC · Logs** (`07-logs.json`) | F3-AUD-05 |
| (extra) Banco pareja | **Bank USAC · Banco pareja** (`08-banco-pareja.json`) | F3-IB-12 |

**Ejercicio de diagnóstico** (criterio 2.6, «permiten diagnosticar un fallo»), con la
transferencia B de F3-TRX-02:
1. **Estado del sistema** → «Transferencias por resultado final»: aparece una `compensated`.
2. **Métricas clave (SLI)** → «Proveedor externo: tasa de fallo por origen»: el fallo es del proveedor, origen `scenario`.
3. **Flujo de trazas** → «Compensaciones (TraceQL)» → abre la traza.
4. Desde un span → «Logs for this span» → la línea `simulated provider failure`.

**Resultado esperado.** Los 9 cargan sin paneles en «No data» en las partes con tráfico, y
el ejercicio va del síntoma a la causa en cuatro saltos.

**Evidencia a capturar.** Una captura por dashboard; la secuencia de diagnóstico.

### F3-DSH-02 — Dashboards y reglas versionados como código

**Requisito.** *Los dashboards y las reglas de alerta deben versionarse como código (JSON / YAML) en el repositorio; no se aceptan dashboards creados solo a mano.* **Página(s): 9** (entregables p. 12; §8.2 2.6 p. 21).

**Cobertura.** Web.

**Cómo probarlo.**
1. En GitHub,
   [`infra/k8s/helm/bank-observability/dashboards/`](https://github.com/marcosbondel/Proyecto-SA-B-2/tree/main/infra/k8s/helm/bank-observability/dashboards): 9 JSON + README.
2. Las reglas y los datasources, en
   [`infra/k8s/helm/bank-observability/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-observability/values.yaml)
   (`datasources.yaml`, `alerting`, `recording_rules.yml`).
3. En Grafana, abre un dashboard → *Edit* → *Settings* → *JSON Model*. El `uid` coincide con el del archivo:

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

4. Las reglas de alerta aparecen como *Provisioned*, sin opción de borrarlas.

**Resultado esperado.** Todo lo que se ve en Grafana sale del repositorio.

**Evidencia a capturar.** Una regla «Provisioned» y el listado de archivos en GitHub.

### F3-DSH-03 — Despliegues marcados como anotaciones

**Requisito.** *Despliegues marcados como anotaciones.* **Página(s): 9.**

**Cobertura.** Web.

**Cómo probarlo.**
1. **Bank USAC · Estado del sistema**, rango **Last 7 days**. Busca las marcas verticales y pasa el ratón:
   - **Releases**: «Release **v1.3.x** en prod · corrida».
   - **Despliegues**: ReplicaSets nuevos.
2. Con la sesión de Grafana abierta, pega en la barra de direcciones
   `http://35.255.103.13/api/annotations?tags=release&limit=5`. El navegador muestra el JSON
   de las últimas anotaciones de release.

**Resultado esperado.**
- Anotaciones de los últimos releases, hasta `v1.3.9`, cada una enlazada a su corrida de GitHub Actions.
- Las crea `cd.yml` en el job de producción.

**Evidencia a capturar.** La anotación con su tooltip.

---

## I. Integración con el sistema existente (§4.1)

### F3-INT-01 — Integración con la Saga, sus compensaciones y los eventos del sistema

**Requisito.** *Las nuevas funcionalidades deben integrarse con el flujo de Saga existente,
incluidas sus compensaciones, y con los eventos del sistema.* **Página(s): 9** (§8.1 «Integración con Saga» p. 16; §8.2 2.7 p. 21).

**Cobertura.** Web.

**Cómo probarlo.** Repasa la evidencia ya capturada:
- **KYC** → puerta de la Saga (F3-IB-08, paso 5).
- **Anomalía** → evento `account.anomaly.detected.v1` al broker (F3-ACC-02).
- **Fallo del proveedor** → compensación (F3-PAY-02).
- **Interbancario** = la Saga de siempre, con el paso de pago hecho por el pareja (F3-IB-01 y 02).
- **Alertas** → evento `alert.slo.received.v1` (F3-AUD-04).

**Resultado esperado.** Cada funcionalidad nueva produce métricas, logs y trazas reales y usa los eventos del broker.

**Evidencia a capturar.** Referencias cruzadas a las capturas anteriores.

### F3-INT-02 — El stack de observabilidad se despliega desde el pipeline, sin pasos manuales

**Requisito.** *Pipeline CI/CD de la Fase 2: el stack de observabilidad se despliega con
Terraform / Helm desde el pipeline, sin pasos manuales.* **Página(s): 9** (restricción p. 10;
§8.1 «Stack de observabilidad» p. 17; penalización p. 23).

**Cobertura.** Web.

**Cómo probarlo.**
1. GitHub → **Actions** → workflow **CD**. Abre la última corrida en verde. Jobs:
   - «Verificacion de credenciales e infraestructura»
   - **«Stack de observabilidad (Collector, Prometheus, Tempo, Loki, Grafana)»**
   - «Despliegue Continuo a Produccion (Rolling Update)»
2. Abre el job de observabilidad y despliega el paso del `helm upgrade bank-observability`.
3. El workflow, en GitHub:
   [`.github/workflows/cd.yml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/.github/workflows/cd.yml),
   job `deploy-observability`. Corre en `main` o con `workflow_dispatch` + `deploy_observability`.
4. La infraestructura:
   [`infra/terraform/gcp/`](https://github.com/marcosbondel/Proyecto-SA-B-2/tree/main/infra/terraform/gcp)
   (VPC, GKE, VMs de PostgreSQL, Cloud Run, IP del Gateway) y el procedimiento en
   [`docs/operations/CLOUD.md`](../operations/CLOUD.md).

**Resultado esperado.**
- La corrida en verde del job de observabilidad, con la salida de `helm upgrade` del release `bank-observability`.
- Tres releases de Helm: `bank-usac` (prod), `bank-usac-dev` (dev) y `bank-observability`.

**Evidencia a capturar.** La corrida con el job de observabilidad abierto.

### F3-INT-03 — Entornos dev y prod identificados en la telemetría

**Requisito.** *Entornos dev y prod: la telemetría debe identificar el entorno.* **Página(s): 9.**

**Cobertura.** Web.

**Cómo probarlo.**
1. Prometheus: `count by (environment) (sli:gateway_requests:rate5m)`.
2. Loki: `sum by (deployment_environment) (count_over_time({service_name="gateway"}[15m]))`.
3. Tempo: `{resource.deployment.environment="dev"}` y luego `{resource.deployment.environment="prod"}`.
4. En cualquier dashboard, cambia el selector **Entorno** entre `prod` y `dev`.
5. En Loki, el campo `environment` de cada línea.

**Resultado esperado.** Las tres señales separan `dev` de `prod`, y los dashboards filtran por entorno.

**Evidencia a capturar.** Las tres consultas.

### F3-INT-04 — Autoescalado (HPA) evidenciado en los dashboards

**Requisito.** *Autoescalado (HPA) de la Fase 2: evidenciar el escalado bajo carga en los dashboards.* **Página(s): 9** (p. 10; §8.2 2.8 p. 22).

**Cobertura.** **Sin vía web para generar la carga.** Unas transferencias a mano no suben la
CPU al 80 %. Se revisa la configuración y la ventana de los experimentos del 2026-10-22.

**Cómo revisarlo.**
1. **Bank USAC · CPU, memoria, pods y HPA**, Entorno = `prod`, **Last 1 hour**: «Réplicas por
   HPA: actuales, deseadas y máximo». Siete HPA, mínimo 1 y máximo 5.
2. El mismo dashboard con Entorno = `dev` y el rango absoluto de §0.5: «Réplicas por HPA» y
   «CPU por componente (cores)» durante la carga.
3. Explore → Prometheus, con ese mismo rango:
   ```promql
   max by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_status_desired_replicas{namespace="dev"})
   ```
4. La configuración, en GitHub:
   [`infra/k8s/helm/bank-usac/values.yaml`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/infra/k8s/helm/bank-usac/values.yaml) (busca `autoscaling`).

**Resultado esperado.**
- La configuración: objetivo de CPU 80 %, de 1 a 5 réplicas.
- En la ventana de los experimentos, si la carga cruzó el umbral, `desired` sube por
  encima de 1 y `current` lo sigue. **Si no subió, anótalo tal cual**: no es evidencia de
  escalado, y hace falta una carga con k6
  ([versión con comandos](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/9495318/docs/qa/guia-validacion-manual-fase3-produccion.md#f3-int-04--autoescalado-hpa-evidenciado-en-los-dashboards)).

**Evidencia a capturar.** El panel de HPA en reposo y en la ventana de los experimentos.

### F3-INT-05 — Frontend: correlationId / traceId de cada operación y consulta de auditoría

**Requisito.** *Frontend: mostrar el correlationId / traceId de cada operación y permitir
consultar la auditoría.* **Página(s): 9** (entregables p. 12).

**Cobertura.** Web.

**Cómo probarlo.**
1. Como cliente, haz una transferencia. En `/transferencias/<id>` aparece el recuadro
   **«Código de seguimiento de la transferencia»**, con **Copiar**, y la línea **«Traza»**.
2. En un depósito interbancario: **«Código de seguimiento del depósito»** + **«Traza»**.
3. Recarga la página: la etiqueta pasa a **«Traza de esta consulta»**, porque ahora es la
   traza de la lectura, no la de la operación.
4. La traza es **texto copiable, no enlace**, porque en Cloud Run `NUXT_PUBLIC_GRAFANA_URL`
   está vacío. El enlace a Grafana sólo aparece donde esa variable está configurada. Copia
   la traza y pégala en Explore → Tempo.
5. Admin → **Auditoría**: consulta por código de seguimiento y los filtros de «Últimos
   eventos del sistema» (F3-AUD-03). Otros roles no ven «Auditoría» en el menú.

**Resultado esperado.**
- Cada operación muestra su código de seguimiento, y su traza cuando el Gateway la devolvió.
- La traza copiada abre la misma operación en Tempo.

**Evidencia a capturar.** El recuadro en la transferencia y en el depósito; **Auditoría** con resultados.

---

## J. Pruebas de carga y escenarios de fallo (§4.1)

Esta sección es la que menos se puede hacer desde la web. La guía la cubre con la
**revisión de la evidencia** que dejaron los experimentos en la nube. Los cuatro escenarios
de la p. 10 tienen postmortem; tres de ellos se repitieron en `dev` el 2026-10-22 entre las
04:25 y las 04:50 UTC.

| Experimento | Postmortem | Ventana (UTC, 2026-10-22) |
| --- | --- | --- |
| Carga base | [`2026-10-21-cloud-baseline-latency.md`](../sre/postmortems/2026-10-21-cloud-baseline-latency.md) | 04:28 – 04:31 |
| Fallos y timeouts del proveedor bajo carga | [`2026-10-21-cloud-provider.md`](../sre/postmortems/2026-10-21-cloud-provider.md) | 04:42 – 04:45 |
| Pod de Transaction eliminado bajo carga | [`2026-10-21-cloud-pod.md`](../sre/postmortems/2026-10-21-cloud-pod.md) | 04:46 – 04:49 |

### F3-LOAD-01 — Carga con k6 sobre el flujo de transferencia, con latencia, error rate, throughput y HPA en los dashboards

**Requisito.** *Ejecutar pruebas de carga con k6, Locust o JMeter sobre el flujo de
transferencia; evidenciar en los dashboards la latencia, el error rate, el throughput y la
creación de pods por el HPA.* **Página(s): 10** (entregables p. 12; §8.2 2.8 p. 22).

**Cobertura.** **Sin vía web para correr k6.** Se revisa la carga ya ejecutada.

**Cómo revisarlo.**
1. El script, en GitHub:
   [`test/load/transfer.js`](https://github.com/marcosbondel/Proyecto-SA-B-2/blob/main/test/load/transfer.js).
   Sus umbrales son los SLO: `http_req_failed < 1 %`, `transfer_accept_ms p95 < 3 s`,
   `transfer_saga_ms p95 < 5 s`, `checks > 99 %`.
2. El postmortem de carga base: resultados de k6 y saldo conservado.
3. Grafana, Entorno = `dev`, rango 04:25 – 04:35 UTC del 2026-10-22:
   - **Métricas clave (SLI)** → «Latencia de transferencias (p50 / p95 / p99)» y «Throughput por cola (mensajes/s)».
   - **Errores en tiempo real** y **Estado del sistema** → «Transferencias por resultado final».
   - **CPU, memoria, pods y HPA** → «Réplicas por HPA: actuales, deseadas y máximo».

**Resultado esperado.**
- Latencia, error rate y throughput subiendo en la ventana y volviendo a reposo.
- El postmortem reporta el p95 de k6 y la suma de saldos inalterada.
- Lo que no se ve en esa ventana (por ejemplo, el HPA escalando) se anota como pendiente
  de una carga con terminal.

**Evidencia a capturar.** Los tres dashboards en la ventana; el postmortem.

### F3-FAIL-01 — Fallos y timeouts del Payment Service bajo carga

**Requisito.** *Escenario de fallo: fallos y timeouts del Payment Service.* Documentar en
postmortem. **Página(s): 10** (§8.1 «Simulación de fallos» p. 16; §8.2 2.8 p. 22).

**Cobertura.** Web parcial. Los fallos y timeouts del proveedor se provocan desde la web
con el escenario de pago (F3-PAY-01 y 02), pero **sin carga**. La versión bajo carga se revisa.

**Cómo probarlo.**
1. En vivo, sin carga: F3-PAY-02 con «Rechazar el pago», «Fallo transitorio» y «El proveedor no responde (timeout)».
2. Bajo carga, revisión: Grafana, Entorno = `dev`, rango 04:40 – 04:47 UTC del 2026-10-22:
   - «Transferencias por resultado final»
   - «Proveedor externo: tasa de fallo por origen» (origen `runtime`)
   - «Proveedor externo: latencia (p95)»
   - «Compensaciones (TraceQL)»
   - «Burn rate de transferencias (5 m, 30 m, 1 h y 6 h)»
3. Que no quedaron Sagas en vuelo: como admin, **Transferencias** → **Monitoreo**; tiles
   **En vuelo** y **Débito sin cerrar** en 0, y filtro **Procesando pago** vacío.
4. Los postmortems:
   [`2026-10-21-cloud-provider.md`](../sre/postmortems/2026-10-21-cloud-provider.md) y
   [`2026-10-15-proveedor-de-pagos.md`](../sre/postmortems/2026-10-15-proveedor-de-pagos.md).

**Resultado esperado.**
- Mezcla de `completed` y `compensated` en la ventana, con la tasa de fallo de origen `runtime`.
- Cada compensación visible en la traza.
- **En vuelo** = 0 y **Débito sin cerrar** = 0.

**Evidencia a capturar.** Los paneles en la ventana; el monitor de transferencias; los postmortems.

### F3-FAIL-02 — Eliminación de un pod durante la carga

**Requisito.** *Escenario de fallo: eliminación de un pod durante la carga.* **Página(s): 10.**

**Cobertura.** **Sin vía web para provocarlo.** Se revisa el experimento del 2026-10-22.

**Cómo revisarlo.**
1. Grafana, Entorno = `dev`, rango 04:45 – 04:50 UTC del 2026-10-22:
   - **CPU, memoria, pods y HPA**: «Pods no listos» y «Reinicios de contenedor (última hora)».
   - **Consumer lag del broker**: el lag de `transaction.*` sube y se vacía.
   - **Estado del sistema**: «Réplicas disponibles por componente».
2. Explore → Prometheus, mismo rango:
   ```promql
   sum by (deployment) (kube_deployment_status_replicas_unavailable{namespace="dev"})
   ```
3. Postmortems:
   [`2026-10-21-cloud-pod.md`](../sre/postmortems/2026-10-21-cloud-pod.md) y
   [`2026-10-15-pod-eliminado.md`](../sre/postmortems/2026-10-15-pod-eliminado.md).

**Resultado esperado.**
- Una réplica no disponible de transaction-service durante segundos, y luego vuelta a 0.
- El lag sube y vuelve a 0: los mensajes esperaron en la cola durable.
- El postmortem: 234 transferencias completadas, suma de saldos inalterada.

**Evidencia a capturar.** Los paneles en la ventana; el postmortem.

### F3-FAIL-03 — Caída temporal del broker

**Requisito.** *Escenario de fallo: latencia o caída temporal del broker.* **Página(s): 10.**

**Cobertura.** **Sin vía web para provocarlo.** Se revisa el postmortem. Si alguien con
terminal lo provoca, tú lo observas así:
- Abre `http://34.69.101.197:3000/ready` en el navegador y recarga cada pocos segundos.
  Pasa de `ready` a error y vuelve a `{"status":"ready",…,"broker":"connected"}` en menos de un minuto.
- **Estado del sistema**: la disponibilidad SLO-27 cae y vuelve; «Respuestas 5xx del Gateway por ruta».
- **CPU, memoria, pods y HPA**: «Reinicios de contenedor (última hora)».
- Después, en **Transferencias** → **Monitoreo**, **En vuelo** vuelve a 0.

**Cómo revisarlo.**
1. Postmortems:
   [`2026-10-15-latido-amqp.md`](../sre/postmortems/2026-10-15-latido-amqp.md) y
   [`2026-10-19-rabbitmq-persistence-cookie.md`](../sre/postmortems/2026-10-19-rabbitmq-persistence-cookie.md).
2. La persistencia del broker, en GitHub: el chart de RabbitMQ en
   [`infra/k8s/helm/bank-usac/`](https://github.com/marcosbondel/Proyecto-SA-B-2/tree/main/infra/k8s/helm/bank-usac) (PVC `rabbitmq-data`).

**Resultado esperado.** El postmortem documenta la cronología, el impacto en los SLO y la recuperación.

**Evidencia a capturar.** El postmortem y, si se provocó en vivo, las capturas de `/ready` y de los dashboards.

### F3-FAIL-04 — El banco pareja no responde, responde lento o rechaza (con el mock) — **obligatorio**

**Requisito.** *El banco pareja no responde, responde lento o rechaza depósitos (simulado
con el mock)* — escenario **obligatorio**. **Página(s): 10** (reglas de pareja p. 8).

**Cobertura.** Web parcial.

**Cómo probarlo.**
- **Rechaza**: en vivo desde la web, F3-IB-02 (cuentas `99-999999999` y `99-000000000`).
- **No responde**: revisión, F3-IB-03 y F3-IB-04.
- **Lento**: revisión, F3-IB-13 (`PartnerBankSendConfirmationSlow`).
- El postmortem: [`2026-10-15-banco-pareja.md`](../sre/postmortems/2026-10-15-banco-pareja.md).

**Resultado esperado.**
- El banco propio reacciona bien en todos los casos: compensación, devolución, alertas.
- Saldo íntegro: en el rechazo, saldo final = inicial.

**Evidencia a capturar.** Las de F3-IB-02, 03, 04 y 13; el postmortem.

### F3-FAIL-05 — Un postmortem blameless por escenario (mínimo 3)

**Requisito.** *Documentar cada escenario en un postmortem blameless: cronología, impacto en
los SLO, evidencia (trazas, logs y métricas), causa raíz y acciones de mejora.*
**Página(s): 10** (objetivo p. 3; entregables p. 12; §8.1 p. 17; §8.2 1.3 p. 19).

**Cobertura.** Web.

**Cómo probarlo.** En GitHub, abre
[`docs/sre/postmortems/README.md`](../sre/postmortems/README.md) y cada postmortem.
Comprueba que cada uno tiene las cinco secciones.

**Resultado esperado.**
- Cuatro postmortems de la sesión del 2026-10-15 en **kind** (latido AMQP / broker, banco
  pareja, proveedor de pagos y pod eliminado), que cubren los cuatro escenarios de la p. 10.
- Tres de la nube, en `dev`, del 2026-10-21: carga base, proveedor y pod.
- Un registro del incidente de RabbitMQ del 2026-10-19 en producción.

**Evidencia a capturar.** El índice de postmortems.

---

## K. Tabla §8.1 — Requisitos para optar a la calificación (pp. 15–17)

> «De no cumplir usted tendrá una nota con valor de cero puntos» (p. 15).

| Tema (§8.1) | Página | Cómo se demuestra desde la web |
| --- | --- | --- |
| Despliegue en nube (K8s) | 16 | §0.1 (URLs vivas), F3-INT-02 |
| OpenTelemetry (trazas + métricas en todos) | 16 | F3-OTL-01 |
| Trazabilidad distribuida (traceId / correlationId por el broker) | 16 | F3-OTL-02, F3-OTL-03 |
| Logging centralizado (ELK o Loki con ingestión) | 16 | F3-AUD-01 |
| Logs estructurados (JSON, sin datos sensibles) | 16 | F3-LOG-01, F3-LOG-02 |
| Dashboards (métricas y logs) | 16 | F3-DSH-01, F3-AUD-05 |
| Métricas SRE (percentiles, error rate, throughput, lag, disponibilidad) | 16 | F3-SLI-01…05 |
| Integración con Saga | 16 | F3-TRX-03, F3-TRX-04, F3-INT-01 |
| Nuevas funcionalidades en los 5 servicios | 16 | F3-CUS-*, F3-ACC-*, F3-TRX-*, F3-PAY-02/03, F3-AUD-* |
| Simulación de fallos (timeouts, errores, delays) | 16 | En vivo: escenarios de pago (F3-PAY-01, 02). Simulación global en caliente: **sólo revisión** |
| Consistencia arquitectónica (asincronía, desacoplamiento) | 16 | F3-OTL-02 (0 HTTP entre servicios); checklist §M |
| Documentación actualizada | 16 | En GitHub: `docs/architecture/`, `docs/sre/telemetry-catalog.md`, `docs/sre/sli-slo-sla.md`, runbooks |
| Sistema funcional (flujo end-to-end con trazas y logs) | 17 | F3-TRX-04 + F3-AUD-05 |
| Stack de observabilidad sin pasos manuales | 17 | F3-INT-02 |
| SLO y alertas (SLO medidos, ≥ 4 alertas) | 17 | F3-SLO-01, F3-SLO-03 |
| Postmortems (mínimo 3) | 17 | F3-FAIL-05 |
| Integración interbancaria (enviados y recibidos, idempotencia, compensación) | 17 | En vivo: F3-IB-01, 02. Recepción e idempotencia: **sólo revisión** (F3-IB-06, 09) |
| UEDI (entrega en fecha) | 17 | No es verificable en el sistema: confirmar la entrega en UEDI |
| Repositorio (commit antes de la fecha; auxiliar como colaborador) | 17 | GitHub → la rama `main` (fecha del último commit) y *Settings* → *Collaborators* |

## L. Criterios §8.2, conocimientos 2.1–2.9 (pp. 20–22)

| Criterio | Pts | Página | Qué ve el calificador | IDs | Desde la web |
| --- | --- | --- | --- | --- | --- |
| 2.1 Instrumentación OpenTelemetry | 6 | 20 | OTel en el código de los 5 servicios y el Gateway, enviando al Collector | F3-OTL-01, F3-OTL-04 | Completo |
| 2.2 Trazas distribuidas y propagación | 8 | 20 | La Saga completa en **una** traza, contexto por el broker, correlationId como atributo | F3-TRX-04, F3-OTL-02, F3-OTL-03 | Completo |
| 2.3 Logging centralizado y estructurado | 6 | 20 | JSON de todos los servicios con traceId, consultables, sin datos sensibles | F3-AUD-01, F3-AUD-05, F3-LOG-01, F3-LOG-02 | Completo |
| 2.4 Métricas (SLI) | 6 | 20–21 | Percentiles, error rate, throughput, lag, disponibilidad, sin alta cardinalidad | F3-SLI-01…06 | Completo |
| 2.5 SLO, error budget y alertas | 8 | 21 | SLO medidos, presupuesto calculado, alertas con runbook **que se disparan en las pruebas** | F3-SLO-01…06 | Disparos: parcial |
| 2.6 Dashboards | 6 | 21 | Útiles, como código, que permiten diagnosticar un fallo | F3-DSH-01…03 | Completo |
| 2.7 Funcionalidades nuevas | 6 | 21 | Las de los 5 servicios, integradas a la Saga, con métricas, logs y trazas reales | A, B, C, F3-INT-01 | Completo, salvo la simulación global |
| 2.8 Pruebas de carga y fallos | 6 | 22 | Carga + 3 escenarios, con HPA y compensaciones visibles | F3-LOAD-01, F3-INT-04, F3-FAIL-01…04 | Sólo revisión |
| 2.9 Integración interbancaria | 8 | 22 | Enviados y recibidos, idempotencia, compensación ante rechazo o timeout, mismo traceId | F3-IB-01…06, 09, 11 | Envío y rechazo en vivo; el resto, revisión |

Los criterios de habilidades 1.1–1.4 (pp. 18–19) no se prueban en el sistema: trabajo en
equipo (commits), documentación técnica, postmortems (F3-FAIL-05) y justificación de
decisiones (ADR en [`docs/adr.md`](../adr.md)).

## M. Checklist de penalizaciones críticas §8.3 (pp. 22–23) — cómo confirmar que NO ocurren

| Penalización | % | Página | Cómo confirmar desde la web que no ocurre | Debe verse |
| --- | --- | --- | --- | --- |
| No existen trazas distribuidas reales (el contexto no cruza el broker) | 50 | 22 | Tempo: una transferencia → spans `publish …` (PRODUCER) con hijos `process …` (CONSUMER) **de otros servicios** en la misma traza (F3-OTL-02) | 6+ servicios en una traza |
| OpenTelemetry no está integrado en el código | 50 | 22 | Spans de dominio que sólo el código puede emitir: `transfer`, `saga.step …`, `saga.compensation …`, `customer.lifecycle …`, `payment.provider call`, `payment.interbank send`; en GitHub, `apps/*/src/instrumentation.ts` | presentes |
| Métricas que no reflejan el sistema real (fijas o simuladas) | 50 | 23 | Explore → Prometheus, `sum(bank_transfer_finished_total{environment="prod"})`. Anota el valor, haz **exactamente 3** transferencias de Q1.00 desde la web, espera 90 s y vuelve a consultar | sube **exactamente 3**, si nadie más hizo transferencias en ese momento |
| Se rompe la comunicación asíncrona o hay acoplamiento | 50 | 23 | TraceQL `{kind=server && resource.service.name=~"customer-service\|account-service\|transaction-service\|payment-service\|notification-audit-service"}` y `{kind=client && span.server.address=~"bank-usac-(customer\|account\|transaction\|payment\|notification-audit)-service.*"}`; en GitHub, la corrida de CI con `pnpm lint` en verde | **0 trazas** en ambas; el único HTTP saliente es Payment → banco pareja (permitido, p. 11) |
| Logs no centralizados | 25 | 23 | F3-AUD-01: Loki tiene los 7 servicios; DaemonSet `otel-log-agent` | 7 `service_name` |
| Dashboards que no aportan valor para diagnosticar | 25 | 23 | El ejercicio de diagnóstico de F3-DSH-01 | del síntoma a la causa en 4 saltos |
| Las nuevas funcionalidades no generan observabilidad | 25 | 23 | Cada bloque de A–D tiene métrica + log + traza propia | ninguna sin las tres |
| Despliegue manual del stack de observabilidad | 25 | 23 | F3-INT-02: corrida de CD con el job de observabilidad en verde | job verde, release `bank-observability` |
| Datos sensibles en logs o trazas | 25 | 23 | F3-LOG-02: las cinco búsquedas vacías; `token=***` | 0 coincidencias |
| Depósito interbancario duplicado o monto perdido sin compensación | 50 | 23 | En vivo: F3-IB-02 (saldo final = inicial). Revisión: F3-IB-03, 04 y 05 en el listado de depósitos; F3-IB-06 en Movimientos | los saldos cuadran |

## N. Orden sugerido para una corrida de unas 2 horas

Con esta guía no hay estado compartido que se pise: el escenario de pago afecta sólo a su
transferencia, y el mock no se toca. El orden sirve para reutilizar los datos de un paso en el siguiente.

| # | Bloque | Duración | Notas |
| --- | --- | --- | --- |
| 1 | §0: tres sesiones, Grafana, GitHub, hoja de registro, saldos | 10 min | Comprueba `/ready` en el navegador |
| 2 | F3-CUS-01 (registro de dos clientes) | 5 min | Arranca aquí: la aprobación va 3 min después |
| 3 | F3-ACC-01, F3-TRX-02 (A, B, C) | 10 min | Mientras esperan los 3 min de KYC |
| 4 | F3-CUS-01 aprobación/rechazo y ventanilla → F3-CUS-02, 03, 04 | 10 min | |
| 5 | F3-ACC-02 (ráfaga de 11 operaciones, cliente + cajero) → F3-ACC-03 | 10 min | Ten abierto F3-SLI-03 para ver el pico |
| 6 | F3-TRX-01, 03, 04 + F3-PAY-01, 02, 03 | 15 min | Las de timeout tardan unos 40 s |
| 7 | F3-IB-01, 02, 08, 10 (envíos y validaciones) | 15 min | Usa sólo `BANK99` |
| 8 | F3-IB-11, 12, 14, 15 sobre los envíos del paso 7 | 10 min | |
| 9 | F3-AUD-01…05, F3-OTL-01…04, F3-LOG-01, 02 sobre lo ya generado | 15 min | |
| 10 | F3-SLI-*, F3-SLO-01…05, F3-DSH-01…03, F3-INT-01, 02, 03, 05 | 15 min | Incluye el ejercicio de diagnóstico |
| 11 | Revisión: F3-IB-03…07, 09, 13; F3-SLO-06; F3-INT-04; sección J | 15 min | Rangos absolutos y **Last 7 days** |
| 12 | Cierre: cuentas que desactivaste, otra vez activas; saldo final; lista de lo que quedó «Sin vía web» para quien tenga terminal | 5 min | |

Total: unas 2 h 15 min. Si haces la alerta de latencia de F3-SLO-06 desde la web, suma unos
40 minutos, en paralelo a los pasos 9 a 11, sin hacer transferencias rápidas en ese tiempo.
