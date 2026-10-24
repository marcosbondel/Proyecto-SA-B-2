# Manual técnico — Bank USAC

Revisión documental de Fase III: **21 de octubre de 2026, T-61**. Este manual
explica cómo ejecutar y diagnosticar el sistema; los procedimientos detallados
permanecen en sus runbooks canónicos. Una capacidad presente en código no
demuestra que esté configurada o sana en un despliegue concreto.

## 1. Arquitectura implementada

Hay siete aplicaciones: frontend, Gateway y exactamente cinco servicios de
dominio: Customer, Account, Transaction, Payment y Notification & Audit.
Los paquetes compartidos son contracts, messaging, observability y tooling.

| Componente | Responsabilidad y tecnología |
| --- | --- |
| Web | Nuxt 4.5.2, Vue 3.5.41, Nitro, Nuxt UI 4.10.0 y Tailwind 4.3.3. |
| Gateway | NestJS; JWT, permisos, validación HTTP, publicación y request/reply AMQP con techo de cinco segundos. |
| Customer | Registro, credenciales scrypt, activación, identidad y KYC. |
| Account | Saldos exactos, concurrencia, depósitos, comisión y compensación. |
| Transaction | Máquina de estados Saga, historial y coordinación mediante eventos. |
| Payment | Proveedor simulado, intentos persistentes e integración HTTP con el banco externo. |
| Notification & Audit | Eventos redactados antes de almacenar, bandejas, alertas SLO y entrega simulada/Resend. |

Cada servicio tiene su base PostgreSQL y sus migraciones. No hay consultas ni
claves foráneas entre bases de servicios. Las bases viven fuera de Kubernetes.
Los servicios internos se comunican mediante RabbitMQ/AMQP; el HTTP saliente al
banco externo y al proveedor de correo es integración con terceros.

MinIO almacena el objeto que carga el Gateway. Customer valida el digest y
persiste el documento para la consulta protegida del personal. No copies el DPI
ni su fotografía a evidencia pública.

El [diagrama de despliegue](architecture/deployment.md) distingue Terraform,
Helm, componentes de ejecución, protocolos y almacenamiento. Los
[ADR](architecture/adr/README.md), [modelo de dominio](domain/README.md),
[esquema acumulado](generated/db-schema.md) y
[catálogo de mensajes](events/catalog.md) son las referencias de detalle.
Este manual no mantiene una segunda lista parcial de tablas o columnas.

## 2. Interfaz web, proxy y sesión

Las páginas viven en `apps/web/app/pages/`; las decisiones puras en `app/lib/`,
y `useGatewayApi` centraliza sesión, errores e identificadores. Los permisos de
pantalla son una ayuda de navegación: el Gateway y los servicios aplican la
autorización real.

En navegador HTTPS, cuando la URL pública del Gateway es HTTP, el cliente usa
rutas relativas `/api`. Nitro las reenvía al Gateway, evitando contenido mixto.
El destino del proxy se toma de `GATEWAY_URL` o, si no está definido, de
`NUXT_PUBLIC_API_BASE_URL`. No hay IP de producción como fallback.

El proxy elimina `traceparent` y `tracestate` de Cloud Run para que el Gateway
inicie la traza que exportará. Nitro no instrumenta un span propio en ese proxy.
El token JWT se conserva en `sessionStorage`, sobrevive una recarga de la
pestaña y se descarta al cerrar sesión o al caducar. El frontend no revoca tokens
en el servidor.

### Variables del frontend

| Variable | Uso |
| --- | --- |
| `NODE_ENV` | Modo de ejecución. |
| `PORT` | Puerto del proceso; desarrollo fija 3010 en el script. |
| `NUXT_PUBLIC_API_BASE_URL` | Origen HTTP(S) del Gateway; configuración pública en tiempo de ejecución. |
| `GATEWAY_URL` | Override del upstream del proxy, solo servidor. |
| `NUXT_PUBLIC_GRAFANA_URL` | Opcional; origen de Grafana para enlaces de traza a Explore/Tempo. Vacío mantiene texto. |

Nunca añadas secretos con prefijo `NUXT_PUBLIC_`. Configura ambos lados del
proxy de forma coherente: un frontend que responde no prueba acceso al Gateway.
`/health` mide vida del proceso y `/ready` verifica configuración; la sonda web
no certifica la conectividad bancaria completa.

## 3. Ejecución local y despliegue

Usa **Node 24.19.0** y **pnpm 11.21.0**, desde la raíz del repositorio:

```sh
pnpm install
pnpm dev
```

`pnpm dev` inicia el stack Docker, con aplicaciones. Alternativamente, para
desarrollo watch en host:

```sh
pnpm dev:infra
pnpm dev:host
```

Son dos modalidades; no las arranques simultáneamente sobre los mismos puertos.
Prepara los `.env` y verifica puertos según el
[runbook de contenedores](operations/CONTAINERS.md) y el
[README Docker](../infra/docker/README.md). Usa `docker ps` y la configuración
real antes de elegir broker o base: sus puertos publicados pueden diferir de los
defaults de los productos.

La web usa 3010 y el Gateway 3000. Los cinco servicios usan 3001–3005. El equipo
local tiene las bases normalmente en 5433–5437; las URLs exactas dependen del
`.env`. No copies contraseñas de ejemplo como si fueran credenciales vigentes.

Para Kubernetes local usa el [runbook de despliegue](operations/DEPLOYMENT.md).
Para cloud sigue [CLOUD](operations/CLOUD.md) y el
[módulo GCP](../infra/terraform/gcp/README.md). Terraform aprovisiona la
infraestructura; Helm instala las cargas de Bank USAC y observabilidad. GitHub
Actions publica imágenes versionadas y despliega los componentes afectados.
No sustituyas esos procedimientos por un `terraform apply` incompleto:
requieren contexto, variables, estado, secretos y valores del entorno correcto.

### Puntos de acceso comunicados para Fase III

| Servicio | URL |
| --- | --- |
| Web producción | [Cloud Run](https://bank-usac-web-mn2e6zhkwq-uc.a.run.app) |
| Gateway producción | [API](http://34.69.101.197:3000), [health](http://34.69.101.197:3000/health), [ready](http://34.69.101.197:3000/ready) |
| Entrada interbancaria | [Base v1](http://34.69.101.197:3000/interbank/v1) |
| Gateway dev | [API dev](http://136.71.158.228:3000) |
| Grafana | [Observabilidad](http://35.255.103.13) |

Estas son direcciones suministradas por el equipo; las verificaciones observadas,
fecha y entorno se registran en la evidencia de Fase III. La base interbancaria
no es una página de usuario ni un endpoint de salud. Las credenciales se
obtienen por el canal del equipo y no forman parte de este documento.

## 4. Contratos y operación bancaria

Las interfaces HTTP versionadas están en `apps/gateway/openapi/`. El
[runbook interbancario](operations/INTERBANK.md) y su
[acuerdo](operations/INTERBANK-AGREEMENT.md) describen autenticación,
idempotencia, callbacks, límites y reconciliación.

El `202` del envío no implica crédito. Separa:

- La Saga interna: PENDING, DEBITING, PAYMENT_PENDING, COMPLETED, FAILED y
  COMPENSATED.
- La proyección de Fase II: PENDING, APPROVED y FAILED.
- El envío interbancario: PENDING, SENT, ACCEPTED, REJECTED, TIMEOUT y REVERSED.

TIMEOUT interbancario conserva la reserva mientras se consulta/cancela y
reconcilia. Una liberación sin confirmación del banco externo exige atención
operativa aunque ya exista devolución local. Consulta movimientos y estados
persistidos; una etiqueta de pantalla no sustituye la evidencia monetaria.

### Simulación administrativa de pagos

Solo un JWT de Administrador accede a:

- `GET /api/payments/simulation`: parámetros efectivos.
- `PUT /api/payments/simulation`: sustitución completa o reset, con respuesta
  de los parámetros que quedaron vigentes.

Cuerpo completo válido, para usar únicamente en pruebas autorizadas de dev:

```json
{
  "failureRatePercent": 25,
  "timeoutRatePercent": 10,
  "latencyMs": 200
}
```

Las tasas son números entre 0 y 100 y su suma no puede superar 100.
`latencyMs` es entero entre 0 y 30000. **Los tres campos son obligatorios
juntos**; no es un PATCH. La alternativa exclusiva es:

```json
{ "reset": true }
```

No combines reset y tasas/latencia. La respuesta incluye los tres parámetros,
`source` (`DEFAULTS` o `RUNTIME`) y `updatedAt` (nulo con defaults).
El override persiste en PostgreSQL y lo leen las réplicas; reiniciar un pod no
lo borra. Reset elimina el override y recupera los `PAYMENT_SIM_*` del entorno;
no equivale necesariamente a cero fallos.

La configuración global afecta a pagos **sin escenario explícito**. Los
escenarios APPROVE, REJECT, TRANSIENT_FAILURE y TIMEOUT del formulario tienen
precedencia. La escalera usa hasta cuatro intentos con esperas 1/5/30 segundos.
No hay pantalla de edición de la simulación global.

Antes de un experimento, registra el GET inicial. Al terminar, restaura los
valores originales: aplica los tres parámetros si había RUNTIME, o reset si
había DEFAULTS. Comprueba el GET final. Usa el
[procedimiento SRE](operations/runbooks/README.md) para interpretar fallos.

## 5. Correo, auditoría y trazas

`NOTIFICATION_CHANNEL` selecciona simulated o resend. El adaptador Resend usa
`RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL` y `RESEND_API_URL`.
El conjunto ejecutable `DELIVERABLE` autoriza dirección real en activación,
recuperación, rechazo de identidad y cambio de contraseña. Sin dirección, se
usa el fallback simulado. La dirección de entrega es transitoria; no es el
destinatario simulado persistido en auditoría.

La configuración y el diagnóstico están en
[EMAIL_RESEND](operations/EMAIL_RESEND.md). No publiques tokens de activación o
recuperación. En el fallback de Resend los enlaces se enmascaran incluso si
`REVEAL_ACTIVATION_LINKS` está habilitado. Una entrega fallida se registra como
FAILED y el adaptador no programa reintento de correo.

El Gateway devuelve `X-Correlation-Id` y, si existe una traza válida,
`X-Trace-Id`. La interfaz conserva una asociación acotada entre ambos para
mostrar el enlace técnico. El filtro de traza de Auditoría exige 32 caracteres
hexadecimales; el de correlación, UUID v4.

OpenTelemetry propaga contexto por AMQP y al banco externo HTTP. Prometheus,
Tempo y Loki se consultan desde Grafana, con el catálogo y consultas de
[telemetría](sre/telemetry-catalog.md) y los
[runbooks](operations/runbooks/README.md). Los objetivos y presupuestos están en
[SLI/SLO/SLA](sre/sli-slo-sla.md); son objetivos a medir, no garantías demostradas
por el hecho de arrancar. Registra entorno, ventana y consulta al reportarlos.

## 6. Pruebas y diagnóstico

Desde la raíz:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:pyramid
```

Turborepo resuelve las dependencias de build. Para pruebas solo web:

```sh
pnpm exec turbo run test --filter=web
pnpm --filter web test:unit
pnpm --filter web test:integration
```

La primera ejecuta también los builds previos necesarios. `test:unit` usa
Node test runner sobre módulos puros y comprobaciones estáticas. La integración
usa Vitest y `@nuxt/test-utils` contra procesos Nitro reales: SSR, guards,
proxy, pantallas de auditoría/interbancario e identificadores. Su setup compila
Nuxt y usa upstreams controlados. No equivale a una prueba del backend bancario
completo ni a cobertura de componentes montados.

Las integraciones de servicios PostgreSQL/RabbitMQ pueden omitirse si faltan
sus variables. **Las suites de repositorio vacían la base configurada**: nunca
las ejecutes sobre bases de producción ni sobre los datos de una demo activa.
Usa bases separadas. Un `pnpm test` verde con suites omitidas no prueba locks,
outbox ni idempotencia persistente.

Para diagnóstico empieza por health/ready, estado de pods y eventos; sigue
correlación → traza → logs y consulta el servicio dueño del estado. Conserva la
diferencia entre error de transporte, rechazo de negocio y resultado incierto.
Las verificaciones visuales y su estado real están en la
[guía manual de Fase III](qa/guia-validacion-manual-fase3.md).
