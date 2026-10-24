# Contextos delimitados y propiedad de datos — Bank USAC

> Revisión T-61, 2026-10-21. Contraste con contratos, casos de uso, repositorios y migraciones actuales. Las asociaciones funcionales de este documento no crean claves foráneas entre bases.

## 1. Los cinco límites y sus escritores

| Contexto | Responsabilidad y datos propios | Reglas que decide |
| --- | --- | --- |
| **Customer** | Identidad, documento/fotografía, credencial scrypt, activación, recuperación, roles, revisión de identidad y KYC | Unicidad, coherencia de datos, hash/tokens, verificación y autorización de revisión. |
| **Account** | Cuenta UUID/número público, saldo exacto, libro DEBIT/CREDIT/COMMISSION/COMPENSATION, desactivación, anomalías y cuentas institucionales | Fondos, estado activo, bloqueo/versionado, comisión y devolución, frecuencia de uso. |
| **Transaction** | Saga, eventos/transiciones, alias, identidad del solicitante, historial, referencia y contexto interbancario, outbox | Transición legal según eventos, KYC antes de débito y compensación tras un efecto aplicado. No decide fondos. |
| **Payment** | Pago/intentos, simulación persistida, depósitos entrantes/salientes, conflictos, reversos, reserva/resolución, historial de envío y outbox | Respuesta del proveedor, reintento, admisión interbancaria, protocolo de consulta/cancelación/reembolso y publicación del veredicto. |
| **Notification & Audit** | Auditoría redactada, clasificación, trazas de referencia, buzón, entrega y repetición de alertas SLO | Qué registrar, severidad y a quién/cuándo notificar. No decide crédito, débito o estados de Saga. |

Cada servicio escribe sólo su propia base PostgreSQL. `schema_migrations` es una tabla técnica por base; las entidades no son un recuento de tablas. El [catálogo físico acumulado](../generated/db-schema.md) y los [ER](../architecture/diagrams/er/README.md) detallan las restricciones reales.

Gateway no tiene base ni capa de dominio. Autentica JWT o API key de banco, verifica permisos/formato, publica comandos y traduce respuestas. Componer `/api/accounts` con nombres o reunir secciones independientes de `/api/dashboard` es agregación. El frontend presenta la respuesta; no calcula el saldo oficial.

## 2. Referencias opacas y conversaciones

| Dato o decisión | Escritor | Otros participantes y transporte |
| --- | --- | --- |
| Identidad/rol del actor | Customer; Gateway verifica sesión y emite envelope | Los servicios reciben customerId/role, no el JWT, en comandos y seguimiento de la operación. |
| KYC | Customer | Transaction pregunta por broker; usa `allowed` del evento y no lee su tabla. |
| Nombre y correo de contacto | Customer | Gateway obtiene perfiles/nombres mediante consulta; Notification recibe los datos necesarios para entregar; auditoría elimina datos sensibles antes de guardar. |
| Documento y fotografía | Customer | Gateway recibe/sube a MinIO; comando de registro lleva datos/referencia; Customer descarga, verifica digest y conserva bytes. Staff autorizado accede mediante Gateway y broker. |
| Saldo y libro | **Sólo Account** | Consultas del Gateway; eventos de movimiento incluyen amount/balanceAfter. Transaction no consulta ni usa un saldo como precondición del débito. Audit redacta montos antes del INSERT. |
| Cuenta y número público | Account | Los consumidores guardan referencias. Payment resuelve elegibilidad/crédito por broker, no SQL; el contrato externo usa número de hasta 34 caracteres, no UUID interno. |
| Identidad/correlación de transferencia | Gateway acuña ID; Transaction conserva instancia/alias | Account y Payment reciben referencias; todas las etapas conservan correlationId y contexto W3C cuando existe. |
| Monto y clave de negocio | Solicitante/Transaction; cada servicio valida su efecto | Viajan en órdenes/eventos necesarios; claves de idempotencia no se sustituyen por correlationId. |
| Veredicto de pago | Payment | Transaction recibe succeeded/failed; audit recibe intentos y desenlaces. |
| Depósito y reverso remoto | Payment | HTTP sólo a la base del banco configurado; Account aplica los movimientos por AMQP. |
| Auditoría/buzón | Notification & Audit | Consulta por Gateway; cliente propio o consola administrativa según permiso. No hay escritura ajena sobre su base. |

**Límite monetario:** que `balanceAfter` exista en un evento no autoriza a Transaction a aprobar fondos. El punto de decisión es el bloqueo de Account; una lectura previa, aun por broker, sería un saldo potencialmente obsoleto y no una reserva.

## 3. Datos sensibles: lo que cruza y lo que se persiste

No se confunde “privado en reposo” con “nunca transportado”. El sistema recibe datos por Gateway y los entrega al servicio dueño:

- El **hash scrypt** no sale de Customer. Las credenciales de entrada sí viajan en los comandos de registro, autenticación y cambio/recuperación necesarios. No se publican en eventos ni respuestas, y no se registran en logs/auditoría.
- El número de documento y la referencia de foto llegan en comandos de Customer. Los bytes se transfieren por MinIO y por la consulta autorizada de documento; no son un payload de evento financiero.
- Un token de activación/recuperación debe llegar al canal que lo entrega y a la operación que lo consume; en las tablas se guarda su digest. No poner enlaces con tokens en evidencia publicada.
- Los montos cruzan Account, Transaction y Payment cuando el movimiento los requiere; los eventos de Account pueden incluir saldo posterior. La bitácora transversal redacta montos, documento, dirección y credenciales **antes** del INSERT.
- Entre bancos sólo se intercambian números de cuenta, importe y datos de protocolo; sin DPI, nombre, dirección ni credencial del cliente. Las API keys se cargan como secretos y no aparecen en documentación/capturas.

La política de datos personales no puede garantizarse por una nota: contrastar contratos, redactor y canal de entrega. [SECURITY](../SECURITY.md) define los controles de acceso y su alcance.

## 4. Comunicaciones y operación de Fase III

La comunicación entre servicios propios usa RabbitMQ: comandos, eventos y request/reply. Ningún servicio importa código de otro ni lee su base. Las dos excepciones de salida HTTP son a **terceros**: Payment al banco pareja y Notification a Resend. [ADR-019](../architecture/adr/ADR-019-payment-http-egress.md) fija esa distinción; [ADR-021](../architecture/adr/ADR-021-interbank-protocol-v1.md) registra la ampliación actual del adaptador a consulta, cancelación y reverso.

Las señales OTLP, métricas y logs van a infraestructura de observabilidad, no a un sexto servicio de negocio. Una alerta Grafana entra por webhook protegido del Gateway y broker hasta Notification & Audit; que un SLO se incumpla no permite a observabilidad compensar una transferencia.

Los cinco escritores mantienen bases separadas por servicio. Separación de **servicio** y separación de **entorno** son ejes distintos: los nombres `_dev`, credenciales, namespace y despliegue efectivo se verifican en [CLOUD](../operations/CLOUD.md), sin inferirlos del título `customer_db`. Una consulta sólo puede certificarse con el contexto correcto de ejecución.

## 5. Límites comprobados y diferencias abiertas

- El requisito de recepción prohíbe crédito posterior al vencimiento. Payment expira antes de despachar; el comando de Account carece de expiresAt y su crédito ya en vuelo no se puede retirar. No se declara resuelta la carrera de AMQP retrasado; ver ADR-021 y #167.
- La regla C-6 expresa que una cuenta de cliente pertenece a un CLIENTE. La apertura valida actor/alcance y niega al staff abrirse a sí mismo; **no consulta la existencia ni el rol del destinatario**. Las cuentas institucionales usan un holder sintético por diseño. No presentar la referencia opaca como una FK o validación remota inexistente.
- Un mock demuestra el comportamiento del contrato de prueba, no la interoperabilidad con la pareja real ni cumplimiento TLS. El estado actual de cada entorno se registra como evidencia fechada.

Las diferencias quedan descritas para que las decisiones futuras se puedan revisar; T-61 no cambia los límites ni introduce una regla bancaria nueva.
