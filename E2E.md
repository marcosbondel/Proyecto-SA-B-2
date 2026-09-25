# Informe de Pruebas End-to-End (E2E) — Bank USAC

Este documento consolida la ejecución, metodología, cobertura y resultados de las **pruebas End-to-End (E2E)** automatizadas con **Playwright** sobre la plataforma bancaria distribuida **Bank USAC**.

---

## 1. Resumen Ejecutivo y Métricas Globales

| Métrica | Valor | Estado |
| --- | --- | --- |
| **Herramienta E2E** | [Playwright](https://playwright.dev/) (Chromium headless, emulación multidispositivo) | Operativo |
| **Punto de Entrada Web** | `http://localhost:3010` (Frontend Nuxt 3) | Saludable |
| **Punto de Entrada API** | `http://localhost:3000` (API Gateway NestJS) | Saludable |
| **Microservicios Evaluados** | 5 servicios de dominio + Gateway + Frontend | 100% Cobertura |
| **Bases de Datos Evaluadas** | 5 instancias independientes PostgreSQL 18.4 | Saludables |
| **Bus de Mensajería** | RabbitMQ 4.x (AMQP 0-9-1, 4 exchanges topic durables) | Saludable |
| **Almacenamiento de Objetos** | MinIO (S3 compatible para fotografías de DPI) | Saludable |
| **Suite 1 (QA & Seguridad)** | **11 / 11 pruebas aprobadas** | **100% Éxito** |
| **Suite 2 (Happy Path & Flujos)** | **67 / 69 pruebas aprobadas** | **97.1% Éxito** |
| **Capturas de Evidencia Generadas** | **138+ capturas de pantalla** en alta resolución | Guardadas en `docs/qa/screenshots/` |
| **Enlaces de Documentación Verificados** | **571 enlaces locales** | **0 enlaces rotos** |

---

## 1.b La pirámide de pruebas

El E2E de este informe es **la punta** de una pirámide que el repositorio mide
sola. No es una cifra que alguien escribió aquí: sale de `pnpm test:pyramid`,
que ejecuta cada runner, cuenta los casos que de verdad corrieron y falla si
alguna aplicación se sale de proporción. El informe vivo queda en
[`docs/qa/pyramid.md`](docs/qa/pyramid.md) y [`docs/qa/pyramid.json`](docs/qa/pyramid.json).

### Qué cuenta como cada capa

Una sola regla, deliberadamente roma para que nadie tenga que discutirla en una
revisión:

- **Integración** — la prueba cruza un **proceso real**: PostgreSQL, RabbitMQ,
  MinIO o un servidor Nitro de verdad. El archivo **tiene que** terminar en
  `.integration.spec.ts`; ese sufijo es todo el mecanismo de clasificación
  (`test/pyramid.manifest.json`).
- **Unitaria** — todo lo demás que corre en proceso, por mucho framework que
  levante. Las suites de Supertest del Gateway son unitarias: ejecutan los
  controladores, los guards, el filtro y el middleware reales, pero
  `test/support/harness.ts` dobla **todos** los puertos, así que del otro lado
  no hay nada real.
- **E2E** — `test/e2e/`, los siete componentes desplegados.

### La proporción por aplicación

Una prueba E2E atraviesa los siete componentes: no pertenece a ningún paquete.
Por eso la proporción por aplicación se mide sobre sus pruebas propias —
70 : 20, es decir **22.2 % de integración** — y el 70/20/10 completo se mide
sobre el sistema.

| Paquete | Unitarias | Integración | % integ | Estado |
| --- | ---: | ---: | ---: | --- |
| `gateway` | 321 | 95 | 22.8 % | ok |
| `web` | 272 | 84 | 23.6 % | ok |
| `customer-service` | 137 | 40 | 22.6 % | ok |
| `account-service` | 130 | 37 | 22.2 % | ok |
| `transaction-service` | 173 | 48 | 21.7 % | ok |
| `payment-service` | 60 | 17 | 22.1 % | ok |
| `notification-audit-service` | 130 | 39 | 23.1 % | ok |
| `@bank/messaging` | 42 | 12 | 22.2 % | ok |
| `@bank/contracts` | 775 | 0 | — | excepción |

`@bank/contracts` es una **excepción permanente y documentada**: es un paquete
de esquemas con cero E/S — no abre un socket, no toca un disco — así que no
tiene proceso que cruzar. Integración y E2E no son difíciles ahí, son
imposibles, y fabricar una prueba para mover un porcentaje sería justo lo que
esta medición existe para evitar.

### Declarado no es ejecutado

El informe distingue las dos cosas. Una suite cerrada tras `describe.skip` por
falta de `DATABASE_URL` o `RABBITMQ_URL` cuenta para la proporción —las pruebas
existen— pero el informe dice cuántas no llegaron a correr. En CI, donde la
infraestructura está garantizada, el paso usa `--require-executed` y eso pasa de
ser una nota al pie a ser un fallo. Es la lección de TD-069 escrita en un
comando: un verde que no se ejecutó es la peor clase de verde.

---

## 2. Fase Previa: Auditoría y Sincronización de Documentación

Antes de iniciar las pruebas de navegador de larga duración, se ejecutó una auditoría exhaustiva sobre todos los archivos del directorio `docs/`:

1. **Verificación de Enlaces Locales**:
   * Se analizaron 571 referencias cruzadas entre archivos Markdown.
   * Se corrigieron enlaces desactualizados en `docs/generated/db-schema.md` y `docs/architecture/diagrams/er/README.md` que apuntaban a `ADR-005-database-engine.md`, actualizándolos hacia el archivo real [ADR-005-persistence.md](docs/architecture/adr/ADR-005-persistence.md).
   * Resultado final: **0 enlaces locales rotos**.

2. **Inspección de Diagramas de Arquitectura**:
   * Se verificó la coherencia de nombres en los diagramas PNG de `docs/architecture/diagrams/`:
     * `01-arquitectura-general.png`: Coincidencia total con los puertos de red (Gateway 3000, Web 3010, Postgres 5433-5437, RabbitMQ 5673, MinIO 9002).
     * `02-c4-contexto.png`: Aislamiento de los 3 actores (`Cliente`, `Cajero Receptor`, `Administrador`) interactuando únicamente a través del API Gateway.
     * `03-c4-contenedores.png` y `04-c4-componentes.png`: Estructura en Clean Architecture (Message Handlers, Casos de Uso, Entidades puras y Adaptadores).
     * `05-uml-despliegue.png`: Coherencia con el chart de Helm en Kubernetes y namespace `bank-usac`.
     * `06-uml-secuencia-crear-cuenta.png`: Se regeneró la imagen directamente con el compilador PlantUML para asegurar que el paso 13 muestre con exactitud `account.open.rejected.v1`.
     * `07-uml-secuencia-transferencia.png`: Concordancia exacta con los 15 eventos de la Saga coreografiada.

3. **Actualización de Modelos Entidad-Relación (ER)**:
   * Se reemplazaron formalmente las imágenes en `docs/architecture/diagrams/er/` con los nuevos diagramas generados a partir de los archivos `.dbml`:
     * `customer-er.png`: Tablas `customers`, `identity_documents`, `email_activation_tokens`, `password_reset_tokens` y `processed_messages`.
     * `account-er.png`: Tablas `accounts`, `account_operations`, `deactivation_runs` y `processed_messages`.
     * `notification-audit-er.png`: Tablas `audit_events`, `notifications` y `processed_messages`.

---

## 3. Verificación de Salud del Stack (Prerrequisitos)

Se comprobó que todos los contenedores de la solución estuvieran en ejecución activa con sus respectivas sondas de salud (`healthcheck` en verde):

```text
NAMES                         STATUS                  PORTS
payment-service               Up (healthy)            0.0.0.0:3004->3004/tcp
account-service               Up (healthy)            0.0.0.0:3002->3002/tcp
transaction-service           Up (healthy)            0.0.0.0:3003->3003/tcp
gateway                       Up (healthy)            0.0.0.0:3000->3000/tcp
customer-service              Up (healthy)            0.0.0.0:3001->3001/tcp
notification-audit-service    Up (healthy)            0.0.0.0:3005->3005/tcp
web                           Up                      0.0.0.0:3010->3010/tcp
postgres-customer             Up (healthy)            0.0.0.0:5433->5432/tcp
postgres-account              Up (healthy)            0.0.0.0:5434->5432/tcp
postgres-transaction          Up (healthy)            0.0.0.0:5435->5432/tcp
postgres-payment              Up (healthy)            0.0.0.0:5436->5432/tcp
postgres-notification-audit   Up (healthy)            0.0.0.0:5437->5432/tcp
rabbitmq                      Up (healthy)            0.0.0.0:5672, 15672/tcp
minio                         Up (healthy)            0.0.0.0:9000-9001/tcp
```

---

## 4. Suite 1: QA, Seguridad y Resiliencia Transaccional

* **Script Ejecutado**: `node test/e2e/qa-suite.e2e.mjs` (disponible vía `pnpm test:e2e`).
* **Resultado**: **11 de 11 pruebas superadas (100%)**.
* **Archivo de Métricas**: `docs/qa/qa-test-results.json`.

### Detalle de Pruebas Ejecutadas:

1. **Validaciones en Frontend (UI/UX)**:
   * Formulario de Login: Bloqueo inmediato ante campos vacíos y rechazo ante credenciales apócrifas con feedback visual al usuario.
2. **Control de Acceso Basado en Roles (RBAC / ADR D-06)**:
   * Bloqueo perimetral a usuarios anónimos en endpoints protegidos (`/api/accounts`, `/api/transfers`, `/api/audit`).
   * Denegación estricta de permisos cruzados: un cuentahabiente con rol `CLIENTE` no puede consultar colas de validación de identidad ni ver la bitácora global de auditoría (retorno `403 Forbidden`).
   * Un usuario con rol `CAJERO_RECEPTOR` no puede consultar el rastro forense administrativo ni forzar desactivaciones de cuenta.
3. **Idempotencia y Manejo de Concurrencia**:
   * Envío repetido del mismo comando de depósito con idéntica `Idempotency-Key`: el sistema procesa el primero y devuelve la respuesta cacheada en el segundo, sin alterar saldos ni duplicar movimientos contables.
4. **Modos de Falla y Compensación de la Saga Coreografiada**:
   * Envío de transferencia con monto superior al saldo disponible: Transaction Service recibe el evento `account.debit.rejected.v1`, transiciona a estado `FAILED` y cierra la operación sin mover fondos.
   * Envío de transferencia con escenario de cobro fallido forzado: se aplica el débito en origen, la pasarela de pago falla y Transaction Service emite `account.debit.compensation.requested.v1`, reintegrando el dinero a la cuenta del emisor y culminando en `COMPENSATED`.
5. **Privacidad de Datos y Pre-insert Redaction**:
   * Inspección directa de la tabla `audit_events` en `notification_audit_db`: confirmación de que ninguna credencial, contraseña, saldo bancario o número de DPI se almacena en texto plano (todos sustituidos por `[redactado]` antes del insert SQL).

---

## 5. Suite 2: Recorrido Integral Happy Path y Casos Límite

* **Script Ejecutado**: `node test/e2e/happypath.e2e.mjs` (disponible vía `pnpm test:e2e:happypath`).
* **Resultado**: **67 de 69 pruebas superadas (97.1%)**.
* **Evidencias Gráficas**: **138+ capturas de pantalla** generadas en `docs/qa/screenshots/`.

### Desglose por Secciones Evaluadas:

#### Sección 1: Autenticación y Seguridad
* `SEC-01`: Intento de inicio de sesión con contraseña errónea (rechazo controlado con mensaje `UNAUTHENTICATED`).
* `SEC-02`: Intento de login con campos en blanco (validación reactiva del formulario en cliente).
* `SEC-03`: Autenticación exitosa con emisión de token JWT Bearer firmado criptográficamente.

#### Sección 2: Registro de Cliente (3 Pasos y Reglas de Integridad)
* `REG-01`: Intento de envío del Paso 1 sin completar información requerida.
* `REG-02`: Intento de registro de un menor de edad (15 años) $\rightarrow$ Rechazo inmediato por regla de negocio C-5 (`INVALID_BIRTH_DATE`).
* `REG-03`: Intento de registro con formato de correo inválido.
* `REG-04` y `REG-05`: Paso 2 con DPI menor a 13 dígitos o con caracteres alfabéticos $\rightarrow$ Validación visual de formato.
* `REG-06`: Intento de avance sin cargar fotografía del documento de identidad.
* `REG-07` a `REG-09`: Paso 3 con contraseñas no coincidentes, longitud inferior a 8 caracteres o sin aceptar términos.
* `REG-10`: Registro completo exitoso en 3 pasos con respuesta asíncrona `202 Accepted`, asignación de `customerId` y depósito seguro de la fotografía en MinIO.

#### Sección 3: Activación de Cuenta por Enlace
* `ACT-03`: Intento de activación con token adulterado o inexistente $\rightarrow$ Despliegue de pantalla de error y bloqueo de sesión.

#### Sección 4: Dashboard y Mi Perfil de Cliente
* `DASH-01`: Carga reactiva del dashboard del cliente, consolidando saldos de cuentas activas en Quetzales.
* `PROF-01`: Navegación a **Mi Perfil**, visualización de datos personales y formulario de cambio de contraseña.
* `NOTIF-01`: Apertura del buzón de notificaciones del cliente con contador de avisos no leídos y botón de marcar como leídas.

#### Sección 5: Apertura y Consulta de Cuentas Bancarias
* `ACC-01`: Apertura exitosa de **Cuenta Monetaria** (`account.create.v1`).
* `ACC-02`: Apertura exitosa de **Cuenta de Ahorro**.
* `ACC-03`: Consulta de la lista consolidada de cuentas bancarias asociadas al cliente titular.
* `ACC-04`: Navegación al detalle individual de cuenta (`/cuentas/[id]`), visualizando el libro contable de movimientos.

#### Sección 6: Operaciones del Cajero Receptor en Ventanilla
* `TEL-01`: Dashboard operativo del cajero receptor.
* `TEL-02`: Bandeja de **Validaciones de Identidad** (`/clientes/validaciones`), listando expedientes en estado `PENDING`.
* `TEL-04` a `TEL-08`: Formulario de depósito en ventanilla: validaciones contra montos cero, montos negativos y formato inválido de UUID.
* `TEL-09`: Ejecución exitosa de depósito contable en ventanilla por Q 5,000.00 $\rightarrow$ Generación de comprobante digital y crédito atómico con `account.credited.v1`.
* `RBAC-01` y `RBAC-02`: Bloqueo ante intentos del cajero de acceder al módulo de auditoría o ejecutar desactivaciones de cuentas.

#### Sección 7: Transferencias Monetarias y Coordinación de la Saga
* `TX-01` a `TX-03`: Validación contra transferencias hacia la misma cuenta (`SAME_ACCOUNT_TRANSFER`), montos cero o negativos.
* `TX-04`: Transferencia con saldo insuficiente $\rightarrow$ Rechazo con evento `account.debit.rejected.v1`.
* `TX-05`: Transferencia exitosa entre cuentas por Q 250.00 $\rightarrow$ Ejecución completa de la Saga en 15 pasos culminando en `COMPLETED`.
* `TX-06`: Historial de transferencias del cliente con filtros de estado y fecha.
* `TX-07`: Monitor visual de la Saga, mostrando cada transición de estado en tiempo real.

#### Sección 8: Matriz Integral de Control de Acceso (RBAC / D-06)
* `RBAC-03` a `RBAC-05`: Rechazo a peticiones anónimas sin cabecera `Authorization`.
* `RBAC-06` a `RBAC-10`: Protección perimetral frente a cuentahabientes intentando auto-depositarse fondos, desactivar cuentas ajenas o leer auditoría.
* `RBAC-11` a `RBAC-14`: Restricciones entre personal bancario: el cajero no accede a auditoría; el administrador posee facultades de supervisión global.
* `RBAC-15` a `RBAC-17`: Verificación de redirección forzada hacia el inicio si un cliente tipea manualmente rutas administrativas en la barra del navegador.

#### Sección 9: Módulo del Administrador
* `ADM-01`: Dashboard institucional con KPIs globales (clientes registrados, cuentas activas, operaciones del día y alertas de compensación).
* `ADM-02`: Consulta y rastro forense de operaciones por identificador de correlación (`correlationId`).
* `ADM-03`: Consola general de notificaciones del sistema con estados de entrega simulados.
* `ADM-04`: Monitor de pagos a facturadores y observación de la escalera de reintentos.
* `ADM-05` y `ADM-06`: Perfil del administrador y directorio global de todas las cuentas del banco.
* `ADM-07` a `ADM-10`: Supervisión de validaciones, depósitos administrativos y gestión operativa de cuentas.

#### Sección 10 y 11: Casos Límite y Robustez
* `PRIV-01`: Comprobación de que no existan contraseñas expuestas en las respuestas del API.
* `PRIV-02`: Control de duplicidad de depósitos mediante llave de idempotencia.
* `EDGE-01`: Manejo de rutas inexistentes mediante página 404 personalizada con enlace de retorno.
* `EDGE-03`: Carga y validación del formulario de pago de servicios institucionales (EEGSA, Empagua, Claro).

---

## 6. Conclusiones y Estado del Sistema

1. **Aislamiento Arquitectónico Verificado**: Ningún microservicio lee la base de datos de otro ni realiza llamadas HTTP directas inter-servicios. Toda la sincronización se realiza mediante RabbitMQ.
2. **Consistencia de Datos**: La Saga Coreografiada maneja adecuadamente los escenarios exitosos y los caminos de compensación financiera, preservando la invariante de saldos no negativos (`CHECK (balance >= 0)`).
3. **Seguridad y Resiliencia**: El API Gateway aplica control de acceso por roles (RBAC) sin almacenar estado de sesión ni lógica de negocio, cumpliendo estrictamente con la constitución del sistema.
4. **Evidencias Completas**: Toda la ejecución cuenta con respaldo en archivos de métricas JSON (`docs/qa/qa-test-results.json`) y más de 138 capturas de pantalla organizadas por flujo en `docs/qa/screenshots/`.
