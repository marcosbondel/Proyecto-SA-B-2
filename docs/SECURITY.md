# Seguridad — Bank USAC

Revisión documental **2026-10-21**. Este documento describe controles presentes
y límites comprobables; una prueba de código no sustituye verificar los valores
efectivos del despliegue. La responsabilidad primaria consta en
[OWNERSHIP](OWNERSHIP.md).

## Clases de datos y destinos permitidos

| Clase | Dónde pertenece | Tratamiento en observabilidad y evidencia |
| --- | --- | --- |
| Credenciales, JWT, API keys y tokens de activación/recuperación | Runtime y secretos; Customer guarda credenciales derivadas y tokens resumidos | No publicar valores en Markdown, screenshots, logs, spans o capas de imágenes |
| Identidad: documento, foto, nombre, correo, dirección, nacimiento | Customer; objeto temporal de fotografía en MinIO | Auditoría redacta antes del insert; logger/SDK/Collector aplican filtros distintos |
| Saldos, montos y movimientos | Bases propietarias de Account, Transaction y Payment | La auditoría sustituye montos/saldos; los adaptadores de log evitan emitirlos |
| Identificadores, estados y correlación | Contratos y bases del dominio propietario | Permitidos en logs y spans; no como etiquetas de métricas |
| Alertas SLO y evidencia operativa | Grafana, Audit y documentos fechados | Entorno, versión, ventana y consultas; no credenciales ni datos personales reales |

No se guarda una copia del payload sin redactar en la base de auditoría.
Los datos visibles en la interfaz del usuario requieren su autorización de
negocio y no deben copiarse indiscriminadamente a evidencia pública.

## Autenticación y autorización

El Gateway es la entrada externa de la aplicación. Las sesiones siguen
[ADR-010](architecture/adr/ADR-010-authentication.md): JWT **HS256**, firmado y
validado sólo por el Gateway, expiración configurable con default **3600 s**,
sin refresh token ni revocación anterior a expiración. Los servicios reciben la
identidad verificada en el envelope y aplican el alcance de su consulta; no
validan la sesión otra vez.

La autorización está **implementada**: `JwtGuard` y `RolesGuard` son globales,
las rutas públicas se declaran y `@Roles` aplica D-06. Las restricciones de
propiedad de filas se deciden en el servicio dueño; un UUID difícil de adivinar
no reemplaza esa comprobación. Consultar la
[matriz de actores](domain/actors.md) y el [OpenAPI](../apps/gateway/openapi/).
No existe ya un bloqueo pendiente de T-15 para definir guardas.

Las credenciales de máquina tienen límites separados:

- **Grafana → `POST /api/alerts/slo`:** `AlertTokenGuard`, Bearer
  `ALERT_WEBHOOK_TOKEN`; sin valor configurado rechaza la entrada. El token no
  es una sesión de administrador.
- **Contrato `/interbank/v1`:** `X-Api-Key` identifica el banco llamante.
  `InterbankApiKeyGuard` compara digests con `timingSafeEqual` y propaga su
  `bankCode`; consultas, cancelaciones y conciliación se limitan al participante.
  La ruta de salud del contrato es pública.
- **Rutas interbancarias heredadas bajo `/api/`:** conservan su autenticación
  Bearer de integración. No intercambiarla con la API key oficial o con un JWT.

Fuentes: [guardas](../apps/gateway/src/interfaces/guards/),
[sesiones](../apps/gateway/src/infrastructure/auth/jwt.service.ts),
[contrato interbancario](operations/INTERBANK.md).

## Aislamiento entre servicios y entornos

- Cada servicio usa únicamente su PostgreSQL; no hay consultas cruzadas ni HTTP
  entre servicios internos. Las pruebas de aislamiento y ESLint comprueban
  dependencias, no el estado de firewall de una VM.
- Los productores internos comparten el usuario de aplicación RabbitMQ. Ese
  usuario puede publicar mensajes: la confianza del envelope presupone un
  runtime interno confiable y credenciales protegidas. No hay firma individual
  de mensajes que haga imposible la suplantación por un pod comprometido.
- `dev` emplea cinco bases con sufijo `_dev`; producción usa los nombres sin
  sufijo. Comparten cinco VMs y capacidad, por lo que una caída o carga elevada
  de la VM puede afectar ambos entornos. Comprobar nombre y usuario efectivos
  antes de cualquier suite que haga `TRUNCATE` (TD-077).
- Gateway sube la fotografía a MinIO; Customer lee, valida su digest y guarda su
  copia. Los buckets y los procesos son internos; el tramo público hacia el
  Gateway en la entrega actual sigue siendo HTTP.

### Red de observabilidad y exposición pública

Terraform configura GKE con **Dataplane V2** (`ADVANCED_DATAPATH`), confirmado
activo en la consulta del clúster del 2026-10-21. El chart
contiene nueve NetworkPolicies, pero `networkPolicies.enabled` tiene default
**false**. La inspección del clúster del 2026-10-21 encontró **cero políticas**
en `observability`, `dev` y `prod`. Por tanto no se afirma aislamiento de
telemetría por NetworkPolicy. Activarlas y demostrar tráfico permitido/denegado
es trabajo operativo pendiente; el [inventario de observabilidad](qa/load/2026-10-21-gke-observability-inventory.txt) conserva Services/PVC, y la ausencia de políticas se consultó por separado. Ver
[ADR-023](architecture/adr/ADR-023-observability-evolution.md).

Grafana usa **LoadBalancer, puerto 80**, con login y sin acceso anónimo. La URL
entregada usa **HTTP**, igual que la entrada del Gateway. El HTTPS del frontend
en Cloud Run no cifra por sí solo esos otros endpoints. No se incorpora la
contraseña de Grafana ni API keys de integración a la documentación. Prometheus,
Tempo, Loki y OTLP permanecen en Services `ClusterIP`; esto limita exposición
pública directa, pero no impide acceso desde otro pod mientras falten políticas.

## Secretos y rotación

Los secretos llegan en runtime: `.env` local ignorado, Kubernetes Secrets y
secretos/variables del pipeline. Los charts sólo definen nombres y referencias.
Grafana usa `grafana-admin` y `grafana-alert-webhook`; ningún valor real debe
aparecer en una captura de configuración o comando versionado.

La carga de secretos de T-22 ya existe. **No hay una política completa de
rotación periódica y revocación automatizada**: registrar responsable, ventana,
servicios afectados y comprobación de recuperación por cada rotación. Cambiar
un secreto JWT invalida sesiones firmadas con la clave anterior cuando los pods
la adoptan; un despliegue con pods de claves distintas necesita coordinarse.

RabbitMQ con PVC conserva usuarios y contraseñas: cambiar sólo
`RABBITMQ_DEFAULT_PASS` o el Secret **no** actualiza la contraseña ya persistida.
El runbook del [broker](operations/runbooks/consumer-lag.md) exige coordinar
cambio del usuario, clientes y prueba de conexión sin imprimir la clave.
No borrar el volumen para rotarla.

## Redacción y correo real

Hay tres superficies con reglas propias:

1. [Auditoría](../apps/services/notification-audit-service/src/domain/redaction.ts):
   sustituye por `[redactado]` documento, correo, nombre, dirección, monto,
   saldo, tokens y demás nombres sensibles **antes del insert**; limita
   profundidad y longitud. No inspecciona semánticamente cualquier texto libre.
2. [Logger](../apps/packages/observability/src/logger.ts): elimina campos por
   nombre y enmascara JWT, Bearer y correo por forma. Su filtro **no contiene
   `amount` ni `balance`**: los adaptadores deben omitirlos. No atribuirle una
   garantía de redacción financiera universal.
3. [SDK](../apps/packages/observability/src/redaction.ts) y Collector: redactan
   URLs, atributos, eventos y texto de trazas; el agente limpia el cuerpo crudo
   de logs antes de parsearlo. Sus patrones no sustituyen revisar un nuevo
   campo o integración con datos sintéticos.

Con `NOTIFICATION_CHANNEL=resend`, `deliverableEmailFrom` permite dirección
real para **cuatro tipos**: `customer.activation.requested.v1`,
`customer.password-reset.issued.v1`, `customer.identity.rejected.v1` y
`customer.password-changed.v1`, cuando `payload.email` existe. Los demás usan
el canal simulado. La dirección real y el enlace son transitorios para la
entrega; la fila conserva destinatario simulado y payload redactado. La lista
ejecutable prevalece sobre comentarios antiguos que sólo mencionan activación.
Ver [política de notificación](../apps/services/notification-audit-service/src/domain/notification.ts)
y [Resend](operations/EMAIL_RESEND.md).

## Verificación y revisión

- Pruebas de guardas, roles y alcance en Gateway y servicios; registrar
  por separado suites unitarias e integración real.
- `@bank/observability`: pruebas de logger, redacción de spans, contexto,
  inicialización de contadores y cardinalidad. La allow-list métrica está en
  el test y debe mantenerse junto al catálogo.
- Notification & Audit: pruebas de redacción previa y deduplicación; un contador
  no prueba que todas las filas de una base real estén limpias.
- `images:smoke`: usuario, ausencia de credenciales en capas y comportamiento
  de sondas. No demuestra TLS, NetworkPolicy o backup del despliegue cloud.
- Antes de publicar capturas: ocultar credenciales completas y datos personales
  reales, conservando entorno, fecha, consulta y resultado medido.

Revisar seguridad ante cambios de autenticación, autorización, contratos,
persistencia, integración externa, carga/exportación de archivos, telemetría,
exposición de Services o mecanismos de secretos.
