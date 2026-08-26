---

description: "Task list for T-15 — API Gateway y shell de frontend"
---

# Tasks: API Gateway y shell de frontend (T-15)

**Input**: Design documents from `/specs/007-api-gateway-web-shell/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **sí, se incluyen.** No es una preferencia: FR-048 y la sección
"Evidencia Esperada" del ticket exigen pruebas de cada ruta, del vencimiento del
plazo, de la correlación, del broker caído y de las rutas protegidas. Las tareas
de prueba de este documento **son** parte del entregable.

**Frontend design gate**: T072 importa e inspecciona la referencia de Claude
Design; T108 recoge la evidencia visual comparada. Ninguna de las dos es
opcional.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivo distinto, sin dependencias abiertas)
- **[Story]**: a qué historia de usuario pertenece

## Path Conventions

Monorepo pnpm. Rutas reales, desde la raíz del repositorio:

- Gateway: `apps/gateway/src/{domain,application,infrastructure,interfaces}/`
- Frontend: `apps/web/app/`
- Paquetes compartidos: `apps/packages/{contracts,messaging}/src/`

**Todos los comandos se ejecutan desde la raíz**, nunca desde una carpeta de
aplicación.

---

## Phase 1: Setup

**Purpose**: dependencias y entorno. Nada de lógica.

- [X] T001 Añadir `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` y `@types/passport-jwt` a `apps/gateway/package.json`, usando `catalog:` como el resto de dependencias del monorepo
- [X] T002 [P] Añadir `@nestjs/swagger` a `apps/gateway/package.json` y el script `openapi:emit` que escribe `apps/gateway/openapi/gateway.v1.yaml`
- [X] T003 [P] Añadir `@aws-sdk/client-s3` y `@types/multer` a `apps/gateway/package.json`
- [X] T004 Ampliar `GatewayEnvironment` en `apps/gateway/src/infrastructure/config/environment.ts` con `JWT_SECRET` (mínimo 32 caracteres), `JWT_EXPIRES_IN`, `GATEWAY_INSTANCE_ID`, `REPLY_TIMEOUT_MS` y las cinco `OBJECT_STORAGE_*` de data-model.md §10
- [X] T005 [P] Actualizar `apps/gateway/.env.example` con las variables nuevas, **conservando el comentario que explica por qué no existe `DATABASE_URL`**
- [X] T006 [P] Ampliar `apps/gateway/test/environment.spec.ts` para cubrir las variables nuevas: cada ausencia falla el arranque nombrando la variable culpable

**Checkpoint**: `pnpm install && pnpm build` pasa. Nada funciona todavía.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: ninguna historia puede empezar antes de terminar esta fase.

### Paquetes compartidos — las tres escrituras fuera del Gateway

Cada una lleva su prueba. Son paquetes de los que dependen cinco tickets
bloqueados; no viajan escondidas dentro de una tarea del Gateway.

- [X] T007 Añadir el campo opcional `paymentScenario: z.enum(['APPROVE','REJECT','TRANSIENT_FAILURE']).optional()` a `apps/packages/contracts/src/events/transaction/transfer.requested.v1.ts`, sin cambiar la versión y sin tocar las dos invariantes existentes
- [X] T008 Documentar la enmienda en `docs/events/` junto al resto del catálogo, señalándola como aditiva, retrocompatible y de demostración
- [X] T009 Prueba de retrocompatibilidad en `apps/packages/contracts/test/`: un mensaje sin `paymentScenario` valida, los tres valores validan, un cuarto valor no valida, y `messageVersion` sigue siendo 1 — corre bajo `pnpm test:contract` (SC-013)
- [X] T010 [P] Exportar desde `apps/packages/contracts/src/routing/topology.ts` las ligaduras de la cola del Gateway —`bank.replies`/`#`, `bank.events`/`customer.email.verified.v1`, `bank.events`/`customer.email.verification.rejected.v1`— **fuera de `QUEUES`**, para no convertirlas en cola durable compartida (R1)
- [X] T011 [P] Prueba en `apps/packages/contracts/test/` de que las ligaduras del Gateway no aparecen en `allQueueDeclarations()` y de que `audit.all` sigue recibiendo los dos eventos de activación
- [X] T012 Añadir a `apps/packages/messaging/src/broker.ts` un modo de suscripción exclusiva: cola no durable, autodelete, exclusiva, **sin escalera de reintentos y sin DLQ**, y exportarlo desde `apps/packages/messaging/src/index.ts`
- [X] T013 Prueba en `apps/packages/messaging/test/` de que el modo exclusivo no declara colas de reintento ni DLQ, y de que el modo durable existente no cambió de comportamiento

### Capa de aplicación del Gateway — puertos y errores

Recordar la regla que `pnpm lint` ejecuta: `application/` no importa
`infrastructure` ni `interfaces`.

- [X] T014 [P] Definir los puertos `MessagePublisherPort`, `ReplyWaiterPort` y `ObjectStoragePort` en `apps/gateway/src/application/ports/`, sin ninguna dependencia de framework ni de transporte
- [X] T015 [P] Definir `GatewayError` y los siete códigos (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `BUSINESS_REJECTION`, `REPLY_TIMEOUT`, `BROKER_UNAVAILABLE`, `INTERNAL_ERROR`) en `apps/gateway/src/application/errors/gateway-error.ts`, **sin importar nada de HTTP**
- [X] T016 Crear el servicio de correlación en `apps/gateway/src/application/correlation.ts`: conserva `X-Correlation-Id` si viene, genera un UUID v4 si no (FR-018)

### Adaptadores de infraestructura

- [X] T017 [P] Implementar `broker-publisher.adapter.ts` en `apps/gateway/src/infrastructure/messaging/`, usando `destinationFor()` de `@bank/contracts` para no duplicar la topología, y traduciendo un fallo de publicación a `BROKER_UNAVAILABLE`
- [X] T018 Implementar `reply-queue.adapter.ts` en `apps/gateway/src/infrastructure/messaging/`: declara la cola exclusiva `gateway.replies.<GATEWAY_INSTANCE_ID>` con las tres ligaduras de T010, y conecta las entregas a `ReplyRegistry.settle()` (depende de T012)
- [X] T019 [P] Implementar `s3-object-storage.adapter.ts` en `apps/gateway/src/infrastructure/storage/`, contra el bucket `customer-identity-documents`; un fallo de subida se traduce a `INTERNAL_ERROR` sin revelar bucket ni punto final
- [X] T020 [P] Implementar `jwt.service.ts` en `apps/gateway/src/infrastructure/auth/`: firma y verifica HS256 con `JWT_SECRET`, caducidad de una hora, sin renovación (ADR-010)

### Cableado y frontera HTTP

- [X] T021 Cablear puertos y adaptadores en `apps/gateway/src/app.module.ts` y registrar el apagado ordenado en `apps/gateway/src/main.ts`, incluido `ReplyRegistry.abortAll()` para que ninguna espera quede colgada (R6)
- [X] T022 Implementar `gateway-exception.filter.ts` en `apps/gateway/src/interfaces/filters/`: traduce `GatewayError` a la forma común del contrato de errores, con `correlationId` **en toda respuesta, también en las de error** (FR-019)

**Checkpoint**: el Gateway arranca, se conecta al broker, declara su cola
exclusiva y responde `/health` y `/ready`. Ninguna ruta funcional existe aún.

---

## Phase 3: User Story 1 — Iniciar sesión y recibir una identidad verificable (P1) 🎯 MVP

**Goal**: `POST /api/auth/login` devuelve un JWT con credenciales válidas y
cuenta activa, y el mismo rechazo genérico en los tres casos de fallo.

**Independent Test**: contra un respondedor simulado de Customer Service sobre
el broker real, con los cuatro desenlaces: aprobado, contraseña incorrecta,
correo inexistente, y aprobado con `activationPending: true`.

### Tests for User Story 1

- [X] T023 [P] [US1] Prueba en `apps/gateway/test/auth-login.spec.ts`: credenciales válidas y cuenta activa devuelven `200` con un JWT que lleva `customerId`, `username`, `role` y `exp` a una hora
- [X] T024 [P] [US1] Prueba en `apps/gateway/test/auth-login-rejection.spec.ts`: los tres rechazos —contraseña incorrecta, correo inexistente, `activationPending: true`— producen respuestas **idénticas** en cuerpo, código y cabeceras (SC-002, criterio 9)
- [X] T025 [P] [US1] Prueba en `apps/gateway/test/auth-login-secrets.spec.ts`: `credential` no aparece en ningún log durante ninguno de los cuatro desenlaces (FR-015)

### Implementation for User Story 1

- [X] T026 [US1] Implementar el caso de uso de inicio de sesión en `apps/gateway/src/application/routes/login.use-case.ts`: publica `customer.authenticate.v1`, espera `customer.authenticate.replied.v1` por `ReplyWaiterPort` con techo de 5 s, y firma el token solo cuando `outcome: APPROVED` y `activationPending: false`
- [X] T027 [US1] Implementar `apps/gateway/src/interfaces/auth.controller.ts` con `POST /api/auth/login` y su DTO de validación
- [X] T028 [US1] Asegurar en `apps/gateway/src/application/routes/login.use-case.ts` que `activationPending: true` produce **el mismo** rechazo genérico que `INVALID_CREDENTIALS`, sin diferencia observable de tiempo de respuesta (FR-013)
- [X] T029 [US1] Redactar el log en `apps/gateway/src/interfaces/auth.controller.ts` y `apps/gateway/src/application/routes/login.use-case.ts` para que `credential` nunca se serialice, ni siquiera al registrar un fallo

**Checkpoint**: se puede obtener un token. Ninguna ruta lo exige todavía.

---

## Phase 4: User Story 2 — Solo quien tiene el rol correcto atraviesa el Gateway (P1)

**Goal**: toda ruta protegida rechaza sin token (`401`) y con rol no autorizado
(`403`), sin publicar nada; la identidad verificada viaja en el sobre.

**Independent Test**: una tabla de casos recorre cada ruta protegida sin token,
con token caducado, con firma alterada y con token válido de cada rol, y compara
contra [`contracts/authorization-matrix.md`](contracts/authorization-matrix.md).

### Tests for User Story 2

- [X] T030 [P] [US2] Prueba en `apps/gateway/test/auth-guard.spec.ts`: sin token, con firma alterada y con token caducado devuelven `401`, y **el contador de mensajes del broker no se mueve**
- [X] T031 [P] [US2] Prueba en `apps/gateway/test/roles-guard.spec.ts`: un token de `CLIENTE` contra `GET /api/audit` devuelve `403` —resultado distinto del `401`— sin publicar nada (SC-003, criterio 10)
- [X] T032 [P] [US2] Prueba en `apps/gateway/test/identity-envelope.spec.ts`: el sobre lleva `customerId` y `role` tomados del token, y un cuerpo que declare otro `customerId` no prevalece (FR-012)

### Implementation for User Story 2

- [X] T033 [US2] Implementar `apps/gateway/src/interfaces/guards/jwt.guard.ts`: verifica firma y expiración, y **no publica nada** cuando falla
- [X] T034 [US2] Implementar `apps/gateway/src/interfaces/guards/roles.guard.ts` con la matriz de [`contracts/authorization-matrix.md`](contracts/authorization-matrix.md) como **dato**, no como condicionales
- [X] T035 [US2] Crear los decoradores `@Public()` y `@Roles()` en `apps/gateway/src/interfaces/guards/route-access.decorator.ts` y aplicarlos en cada controlador, alimentando tanto la guarda como el OpenAPI (FR-011)
- [X] T036 [US2] Conectar la identidad verificada a `envelopeForRequest()` de `apps/gateway/src/application/request-envelope.ts`, distinguiendo **actor** (del token) de **sujeto** (del payload) según R4

**Checkpoint**: la frontera de seguridad está probada de punta a punta.

---

## Phase 5: User Story 3 — Un comando asíncrono se acepta y se puede seguir (P1)

**Goal**: las cuatro rutas de comando validan, publican y devuelven `202` con
`correlationId`; ninguna decide nada de negocio.

**Independent Test**: cada ruta con carga válida, observando en la
administración de RabbitMQ el mensaje publicado con su clave de enrutamiento y el
`correlationId` que devolvió el HTTP.

### Tests for User Story 3

- [X] T037 [P] [US3] Prueba en `apps/gateway/test/commands-publish.spec.ts`: las cuatro rutas publican el mensaje del catálogo con su nombre exacto y devuelven `202` con `correlationId` (SC-001)
- [X] T038 [P] [US3] Prueba en `apps/gateway/test/commands-validation.spec.ts`: campo ausente, tipo equivocado, monto no positivo y cuenta origen igual a la destino producen `400` nombrando el campo, **sin publicar nada** (SC-004)
- [X] T039 [P] [US3] Prueba en `apps/gateway/test/correlation.spec.ts`: sin `X-Correlation-Id` el Gateway genera uno y lo devuelve; con uno propio, lo conserva
- [X] T040 [P] [US3] Prueba en `apps/gateway/test/idempotency.spec.ts`: dos transferencias con la misma clave viajan **ambas** al broker con esa clave en el sobre, sin que el Gateway reconozca la repetición
- [X] T041 [P] [US3] Prueba en `apps/gateway/test/photo-upload.spec.ts`: el mensaje lleva solo la referencia —`objectKey`, `contentType`, `sizeBytes`, `sha256`—, el objeto existe en MinIO, y una foto de más de 5 MB o de tipo no admitido produce `400` sin publicar
- [X] T042 [P] [US3] Prueba en `apps/gateway/test/payment-scenario.spec.ts`: los tres valores viajan intactos, un cuarto produce `400` sin publicar, y su ausencia es el camino normal (SC-013)

### Implementation for User Story 3

- [X] T043 [US3] Implementar el caso de uso de registro en `apps/gateway/src/application/routes/register-customer.use-case.ts` con el orden obligatorio de R7: validar → SHA-256 → subir → publicar. **Si la subida falla, no se publica nada**
- [X] T044 [P] [US3] Implementar los casos de uso de actualización de cliente, apertura de cuenta y solicitud de transferencia en `apps/gateway/src/application/routes/`, generando `accountId` y `transactionId` donde corresponda
- [X] T045 [US3] Implementar `apps/gateway/src/interfaces/customers.controller.ts` con `POST /api/customers` (`multipart/form-data`, tope de 5 MB) y `PATCH /api/customers/:customerId`
- [X] T046 [P] [US3] Implementar `apps/gateway/src/interfaces/accounts.controller.ts` con `POST /api/accounts`, aceptando `customerId` opcional como sujeto (R4)
- [X] T047 [P] [US3] Implementar `apps/gateway/src/interfaces/transfers.controller.ts` con `POST /api/transfers`, incluido `paymentScenario` opcional validado contra los tres valores
- [X] T048 [US3] Trasladar `idempotencyKey` al sobre en `apps/gateway/src/application/request-envelope.ts` **sin reinterpretarlo**, y asegurar que ningún caso de uso de `apps/gateway/src/application/routes/` espera respuesta en las cuatro rutas de comando

**Checkpoint**: las cuatro rutas asíncronas funcionan y se observan en el broker.

---

## Phase 6: User Story 4 — Una consulta espera respuesta, y el silencio también es una respuesta (P1)

**Goal**: las tres consultas devuelven el dato o un vencimiento del plazo a los
cinco segundos que dice que la operación no fue cancelada.

**Independent Test**: cada consulta contra un respondedor simulado, y luego con
el respondedor apagado.

### Tests for User Story 4

- [X] T049 [P] [US4] Prueba en `apps/gateway/test/queries-reply.spec.ts`: saldo, estado de transacción y auditoría devuelven `200` con `FOUND`, y `404` con `NOT_FOUND` conservando el código del catálogo
- [X] T050 [P] [US4] Prueba en `apps/gateway/test/reply-timeout.spec.ts`: sin respuesta, `504` a los 5 s con `correlationId` intacto y un mensaje que declara que la operación **no fue cancelada** — **inyectando `setTimeoutFn`, sin dormir 5 s reales** (R6)
- [X] T051 [P] [US4] Prueba en `apps/gateway/test/reply-correlation.spec.ts`: dos consultas simultáneas no cruzan sus respuestas, y una respuesta tardía se descarta en silencio sin romper nada
- [X] T052 [P] [US4] Prueba en `apps/gateway/test/reply-registry-leak.spec.ts`: tras mil consultas vencidas, `pendingCount` vuelve a cero (SC-005)

### Implementation for User Story 4

- [X] T053 [US4] Implementar los tres casos de uso de consulta en `apps/gateway/src/application/routes/`, usando `ReplyRegistry` tal cual y **sin reimplementar el temporizador**
- [X] T054 [P] [US4] Implementar `GET /api/accounts/:accountId/balance` en `apps/gateway/src/interfaces/accounts.controller.ts` y `GET /api/transfers/:transactionId` en `apps/gateway/src/interfaces/transfers.controller.ts`
- [X] T055 [US4] Implementar `apps/gateway/src/interfaces/audit.controller.ts` con `GET /api/audit?correlationId=...`, restringido a `ADMINISTRADOR`

**Checkpoint**: las cinco esperas del sistema funcionan y ninguna queda colgada.

---

## Phase 7: User Story 5 — Los cinco modos de fallo se distinguen entre sí y no filtran nada (P1)

**Goal**: los cinco tipos de error tienen forma común, se distinguen, y ninguno
revela credenciales, rutas internas ni rastros de pila.

**Independent Test**: provocar los cinco según la tabla de
[`quickstart.md`](quickstart.md) y comparar contra
[`contracts/error-contract.md`](contracts/error-contract.md).

### Tests for User Story 5

- [X] T056 [P] [US5] Prueba en `apps/gateway/test/error-taxonomy.spec.ts`: los cinco tipos se provocan y se distinguen, y los siete códigos mapean al estado HTTP que declara el contrato
- [X] T057 [P] [US5] **Prueba de cobertura del enum** en `apps/gateway/test/failure-code-table.spec.ts`: recorre los veinte valores de `failureCode` de `@bank/contracts` y **falla si alguno no está en la tabla**. Sin ella, un código nuevo cae en el genérico y nadie se entera (R5)
- [X] T058 [P] [US5] Prueba en `apps/gateway/test/error-no-leak.spec.ts`: ninguna respuesta de error contiene rastro de pila, cadena de conexión, credencial, nombre de bucket ni nombre de servicio interno (FR-028)
- [X] T059 [P] [US5] Prueba en `apps/gateway/test/broker-down.spec.ts`: con el broker inalcanzable, toda ruta responde `503` y deja un **registro correlacionado** en el log (FR-029, criterio 3)

### Implementation for User Story 5

- [X] T060 [US5] Implementar la tabla `failureCode → HttpStatus` en `apps/gateway/src/application/errors/failure-code-table.ts` como **dato**, con las veinte entradas de `contracts/error-contract.md`
- [X] T061 [US5] Completar `apps/gateway/src/interfaces/filters/gateway-exception.filter.ts` para que `BUSINESS_REJECTION` conserve el `failureCode` del catálogo intacto en el cuerpo (FR-030)
- [X] T062 [P] [US5] Implementar el saneamiento en `apps/gateway/src/interfaces/filters/gateway-exception.filter.ts`: nada de pila, conexión, credencial ni nombre interno, en ningún entorno
- [X] T063 [P] [US5] Implementar el registro correlacionado en `apps/gateway/src/infrastructure/logging/correlated-logger.ts` para broker no disponible y fallo interno, con `correlationId` en cada línea
- [X] T064 [US5] Traducir el fallo del almacenamiento en `apps/gateway/src/infrastructure/storage/s3-object-storage.adapter.ts` a `INTERNAL_ERROR`, sin revelar bucket ni punto final (R7)

**Checkpoint**: los cinco modos de fallo están probados. El Gateway está completo salvo la activación por correo.

---

## Phase 8: User Story 6 — Activar la cuenta desde el enlace del correo (P2)

**Goal**: `GET /api/customers/verify-email` da **veredicto en la misma
respuesta**, y el silencio produce vencimiento del plazo, no rechazo.

**Independent Test**: las tres variantes de token, más un simulador que no
contesta.

### Tests for User Story 6

- [X] T065 [P] [US6] Prueba en `apps/gateway/test/verify-email.spec.ts`: token válido devuelve `200` con `ACTIVE`; token usado, caducado e inventado devuelven un `409` **idéntico entre los tres** (FR-015e)
- [X] T066 [P] [US6] Prueba en `apps/gateway/test/verify-email-timeout.spec.ts`: sin respuesta, `504` y **no** `409` — confundir silencio con rechazo dejaría cuentas activas cuyo dueño cree que no lo están
- [X] T067 [P] [US6] Prueba en `apps/gateway/test/verify-email-audit.spec.ts`: `customer.email.verified.v1` sigue llegando a `audit.all`; que el Gateway lo observe no lo quita de la auditoría (FR-015c)
- [X] T068 [P] [US6] Prueba en `apps/gateway/test/verify-email-replicas.spec.ts`: con dos instancias, el evento llega a **ambas** colas exclusivas y solo la que esperaba responde; la otra obtiene `false` de `settle()` y lo descarta (R2)
- [X] T069 [P] [US6] Prueba en `apps/gateway/test/verify-email-secrets.spec.ts`: el token de activación no aparece en ningún log

### Implementation for User Story 6

- [X] T070 [US6] Implementar el caso de uso de verificación en `apps/gateway/src/application/routes/verify-email.use-case.ts`: publica `customer.verify-email.v1` y espera cualquiera de los dos eventos correlacionados con el mismo techo de 5 s
- [X] T071 [US6] Implementar `GET /api/customers/verify-email` en `apps/gateway/src/interfaces/customers.controller.ts`, validando el token entre 16 y 512 caracteres antes de publicar

**Checkpoint**: las nueve rutas funcionales del Gateway están completas y probadas.

---

## Phase 9: User Story 7 — El shell del frontend existe una sola vez (P2)

**Goal**: layout, navegación filtrada por rol, tema y sesión — la base que
T-16 a T-20 heredan.

**Independent Test**: un comando levanta el frontend; una sesión de cada uno de
los tres roles comprueba qué módulos ve cada uno.

### Referencia visual — no es opcional

- [X] T072 [US7] Importar e inspeccionar el proyecto de Claude Design `4a48d652-297f-4351-9170-d8049427e897` (`bonking.dc.html`, `support.js`), con foco en `show.login`, `show.activate`, `show.app`, `show.dash`, `show.cashierDash`, `show.adminDash` y `show.notFound`, y anotar composición, interacciones y comportamiento responsive en `specs/007-api-gateway-web-shell/evidence/design-review.md`, según manda `docs/DESIGN.md`
- [X] T073 [US7] Actualizar `docs/DESIGN.md` a la revisión **`bonking. Core`**: frontmatter de tokens y las secciones Colors, Buttons, Form Fields y Badges. Decisión del responsable del 2026-08-24. **La paleta azul (`#002db5`, `#2A53FD`) no se implementa en ninguna parte**

### Tests for User Story 7

- [X] T074 [P] [US7] Prueba en `apps/web/test/navigation.test.mjs`: cada rol ve exactamente los módulos de `contracts/authorization-matrix.md` — `CLIENTE` y `CAJERO_RECEPTOR` **no** ven Auditoría (SC-014, sin navegador)
- [X] T075 [P] [US7] Prueba en `apps/web/test/navigation-parity.test.mjs`: la matriz del frontend y la del Gateway derivan de la misma fuente y **falla si divergen**
- [X] T076 [P] [US7] Prueba en `apps/web/test/gateway-error.test.mjs`: los siete códigos se normalizan y uno desconocido cae en `INTERNAL_ERROR`

### Implementation for User Story 7

- [X] T077 [US7] Crear `apps/web/app/app.config.ts` con los tokens de `bonking. Core`: paleta monocroma obsidiana, Inter, rejilla de 8 px, radios de 8 px en controles y 16–24 px en superficies (depende de T073)
- [X] T078 [P] [US7] Crear `apps/web/app/lib/navigation.ts` con los cuatro módulos y los roles que los ven, como **dato puro** y verificable sin navegador
- [X] T079 [P] [US7] Crear `apps/web/app/lib/gateway-error.ts` con la normalización de los siete códigos
- [X] T080 [P] [US7] Crear `apps/web/app/lib/money.ts`: `es-GT`, prefijo `Q `, separador de miles, dos decimales, y conversión a `amountMinor` al enviar
- [X] T081 [US7] Crear `apps/web/app/layouts/default.vue` con `UApp` y `UNavigationMenu` filtrada por rol, y `apps/web/app/layouts/public.vue` para las tres pantallas sin sesión; reemplazar el `NuxtWelcome` de `apps/web/app/app.vue`
- [X] T082 [US7] Crear `apps/web/app/composables/useSession.ts`: token en `useState`, **no** en `localStorage` (R10), con `role` decodificado para la interfaz
- [X] T083 [US7] Crear `apps/web/app/composables/useGatewayApi.ts`: `baseURL` desde `NUXT_PUBLIC_API_BASE_URL`, token adjunto a toda ruta protegida, errores normalizados, `correlationId` expuesto, y `UNAUTHENTICATED` descarta sesión y lleva a `/login` (FR-041c, FR-041d)
- [X] T084 [US7] Crear `apps/web/app/middleware/auth.global.ts`: sin sesión, todo módulo lleva a `/login`; una ruta no autorizada para el rol **no se renderiza** aunque se escriba su dirección (FR-041e)
- [X] T085 [P] [US7] Crear `apps/web/app/pages/login.vue` y `apps/web/app/pages/activar.vue`, con el rechazo genérico de inicio de sesión —**no** el estado separado "cuenta no activa" del prototipo— y las dos resoluciones de activación
- [X] T086 [P] [US7] Crear las cuatro páginas esqueleto en `apps/web/app/pages/{clientes,cuentas,transferencias,auditoria}/index.vue`, cada una con su título
- [X] T087 [US7] Documentar la convención de módulos en `apps/web/README.md`, remitiendo a [`contracts/shell-contract.md`](contracts/shell-contract.md) (FR-045)

**Checkpoint**: `pnpm --filter web dev` levanta el shell con sesión y navegación por rol.

---

## Phase 10: User Story 8 — Las cuatro piezas compartidas de interfaz asíncrona (P2)

**Goal**: las cuatro piezas existen, y una página de demostración las ejercita
con los cinco estados sin necesitar broker.

**Independent Test**: `/demo` contra respuestas simuladas.

### Tests for User Story 8

- [X] T088 [P] [US8] Prueba en `apps/web/test/money-input.test.mjs`: se rechaza menos de un centavo y más de dos decimales, y la conversión a `amountMinor` es exacta
- [X] T089 [P] [US8] Prueba en `apps/web/test/idempotency-key.test.mjs`: la clave se mantiene estable entre reintentos y cambia solo cuando cambia la intención

### Implementation for User Story 8

- [X] T090 [P] [US8] Crear `apps/web/app/components/shared/SharedCorrelationIdBadge.vue`, con cifras tabulares y acción de copiar, portando el tratamiento del prototipo
- [X] T091 [US8] Crear `apps/web/app/components/shared/SharedAsyncStateAlert.vue` con los **cinco** estados sobre `UAlert`, portando literal la copia del prototipo para pendiente, éxito, rechazo y vencimiento
- [X] T092 [US8] Componer el quinto estado —**broker no disponible**, que el prototipo no dibuja— en la familia ámbar `#B4740A`/`#7A4F06`, en `apps/web/app/components/shared/SharedAsyncStateAlert.vue`, con copia propia que diga que no se hizo nada y que reintentar es seguro; registrarlo como adición intencional en `specs/007-api-gateway-web-shell/evidence/design-review.md`
- [X] T093 [P] [US8] Crear `apps/web/app/components/shared/SharedMoneyInput.vue` sobre `UInputNumber`, mínimo `0.01` y dos decimales (depende de T080)
- [X] T094 [P] [US8] Crear `apps/web/app/components/shared/SharedIdempotencyKeyField.vue`, con UUID estable entre reintentos
- [X] T095 [US8] Crear `apps/web/app/pages/demo.vue` que ejercite visiblemente las cuatro piezas y los cinco estados **sin broker** (FR-044, SC-009)
- [X] T096 [US8] Asegurar en `apps/web/app/composables/useGatewayApi.ts` y `apps/web/app/components/shared/SharedAsyncStateAlert.vue` que un `202` nunca se presenta como éxito: estado pendiente hasta confirmarlo por consulta o auditoría (FR-043)

**Checkpoint**: T-16 a T-20 tienen todo lo que necesitan para empezar.

---

## Phase 11: User Story 9 — El contrato está escrito y la frontera está probada (P3)

**Goal**: el OpenAPI existe, es consistente con T-05, y la ausencia de bases y
de clientes HTTP internos está demostrada.

**Independent Test**: el contrato se valida contra su propio esquema y se
compara ruta por ruta con el catálogo; una búsqueda estática recorre el Gateway.

### Tests for User Story 9

- [X] T097 [P] [US9] Prueba de deriva en `apps/gateway/test/openapi-drift.spec.ts`: el YAML versionado es **idéntico** al que produce el código; si alguien cambia una ruta y no regenera, falla
- [X] T098 [P] [US9] Prueba de consistencia en `apps/gateway/test/openapi-catalog.spec.ts`: cada ruta nombra un mensaje que existe en `catalog` de `@bank/contracts` — cero rutas huérfanas (SC-010, criterio 5)
- [X] T099 [P] [US9] Prueba en `apps/gateway/test/openapi-roles.spec.ts`: cada ruta protegida declara sus roles y coinciden con `contracts/authorization-matrix.md`
- [X] T100 [P] [US9] Prueba estática en `apps/gateway/test/no-database-no-http.spec.ts`: cero coincidencias de `DATABASE_URL`, `postgres://`, `typeorm`, `prisma`, `axios`, `node-fetch`, `got` y de direcciones HTTP a servicios internos, sobre `src/`, `.env.example` y `package.json` (SC-007, criterio 4)

### Implementation for User Story 9

- [X] T101 [US9] Decorar los controladores de `apps/gateway/src/interfaces/` con `@nestjs/swagger`: cargas, respuestas, los cinco tipos de error, y por ruta protegida los roles autorizados (FR-046)
- [X] T102 [US9] Implementar el script `openapi:emit` y versionar `apps/gateway/openapi/gateway.v1.yaml` en el repositorio
- [X] T103 [US9] Declarar en `apps/gateway/openapi/gateway.v1.yaml`, vía extensión `x-bank-message` en los decoradores de cada controlador, el nombre del mensaje que publica cada ruta, para que T097–T099 lo puedan comprobar

**Checkpoint**: el criterio 2.4 del enunciado es demostrable sin ejecutar nada.

---

## Phase 12: Polish & Cross-Cutting Concerns

- [X] T104 [P] Crear `apps/gateway/Dockerfile` con construcción por etapas y `HEALTHCHECK` sobre `/health`; **ninguna variable de base de datos** en la imagen (criterio 4)
- [X] T105 [P] Actualizar `apps/web/.env.example` retirando la nota de TD-011: el frontend ya sí llama al Gateway y `NUXT_PUBLIC_API_BASE_URL` pasa a ser obligatoria
- [X] T106 Corregir el destino de la autorización por endpoint en `docs/domain/actors.md` y `docs/domain/README.md`, que la apuntan a **T-13** cuando ADR-010 la asigna a **T-15** (trabajo que la spec identificó fuera de su alcance)
- [X] T107 [P] Actualizar `AGENTS.md` y `CLAUDE.md`: el Gateway y el frontend dejan de ser andamiaje
- [X] T108 Recoger la evidencia visual: capturas del shell con la navegación de los tres roles, inicio de sesión con rechazo genérico, las dos resoluciones de activación, y `/demo`; cada una comparada con su entrada de `bonking.dc.html` y con una nota en `specs/007-api-gateway-web-shell/evidence/design-review.md` que nombre **las tres discrepancias** del plan
- [X] T109 Recoger en `specs/007-api-gateway-web-shell/evidence/` las capturas de la administración de RabbitMQ con los mensajes de las nueve rutas y sus `correlationId`
- [X] T110 Ejecutar `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:contract` desde la raíz y archivar la salida real en `specs/007-api-gateway-web-shell/evidence/`
- [X] T111 Recorrer [`quickstart.md`](quickstart.md) de principio a fin y archivar la salida de cada comprobación en `specs/007-api-gateway-web-shell/evidence/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de Setup. **Bloquea las nueve historias.**
- **US1–US5 (Fases 3–7)**: dependen de Foundational. Son las cinco P1 y forman el Gateway.
- **US6 (Fase 8)**: depende de Foundational; reutiliza el mecanismo de espera de US4, así que va después.
- **US7 (Fase 9)**: depende de Foundational. Es frontend puro y **no depende de que el Gateway esté terminado** — se desarrolla contra respuestas simuladas.
- **US8 (Fase 10)**: depende de US7, que aporta el armazón donde viven las piezas.
- **US9 (Fase 11)**: depende de que existan las rutas que documenta (US1–US6).
- **Polish (Fase 12)**: depende de todo lo demás.

### Dependencias notables dentro de las fases

- T009 depende de T007 · T011 depende de T010 · T013 depende de T012
- T018 depende de T010 y T012 — la cola exclusiva necesita las ligaduras y el modo exclusivo
- T021 depende de T014–T020 — el cableado necesita todos los adaptadores
- T026 depende de T018 — el inicio de sesión es la primera espera de respuesta
- T043 depende de T019 — el registro con foto necesita el almacenamiento
- T053 depende de T018 · T060 depende de T015
- T077 depende de T073 — los tokens salen del documento actualizado
- T083 depende de T079 y T082 · T093 depende de T080
- T097–T099 dependen de T101–T103

### Parallel Opportunities

- **Fase 1**: T002, T003, T005 y T006 en paralelo tras T001 y T004.
- **Fase 2**: los tres paquetes compartidos son independientes entre sí —
  T007→T009, T010→T011 y T012→T013 son tres cadenas paralelas. T014, T015, T017,
  T019 y T020 también.
- **Entre historias**: US7 y US8 son frontend; US1–US6 son backend. **Dos
  personas pueden trabajar en paralelo desde el final de la Fase 2**, que es la
  mayor oportunidad de paralelismo de esta feature.
- **Dentro de cada historia**: todas las pruebas marcadas `[P]` corren juntas.

---

## Parallel Example: Fase 2

```bash
# Las tres escrituras a paquetes compartidos, en paralelo:
Task: "T007 paymentScenario en transfer.requested.v1.ts"
Task: "T010 ligaduras del Gateway en topology.ts"
Task: "T012 modo de suscripción exclusiva en broker.ts"

# Y los puertos y adaptadores que no dependen entre sí:
Task: "T014 puertos en application/ports/"
Task: "T015 GatewayError en application/errors/"
Task: "T019 s3-object-storage.adapter.ts"
Task: "T020 jwt.service.ts"
```

## Parallel Example: backend y frontend a la vez

```bash
# Persona A, tras la Fase 2:
Task: "Fase 3 → US1: inicio de sesión"
Task: "Fase 4 → US2: guardas y matriz de roles"

# Persona B, tras la Fase 2, contra respuestas simuladas:
Task: "Fase 9 → US7: shell, sesión y navegación por rol"
Task: "Fase 10 → US8: las cuatro piezas compartidas"
```

---

## Implementation Strategy

### MVP: US1

Fase 1 → Fase 2 → Fase 3. Al terminar hay un Gateway que autentica contra el
broker y emite un token. **Parar y validar** con T023–T025 antes de seguir.

Es un MVP honesto pero pequeño: por sí solo no demuestra el criterio 2.4 del
enunciado.

### El incremento que de verdad importa: US1–US5

Las cinco P1 juntas son el Gateway completo salvo la activación por correo, y
son lo que hace demostrable el criterio 2.4. Si hubiera que entregar una sola
cosa de este ticket, es esto.

### Entrega incremental

1. Fases 1–2 → cimiento, y **dos personas pueden separarse aquí**
2. US1 → hay token → validar
3. US2 → hay frontera de seguridad → validar
4. US3 + US4 → las nueve rutas menos activación → validar contra el broker
5. US5 → los cinco errores probados → **aquí el Gateway está listo**
6. US6 → activación por correo
7. US7 + US8 → el shell → **desbloquea T-16 a T-20**
8. US9 → el contrato y la evidencia estática
9. Fase 12 → evidencia y limpieza

### Dónde está el riesgo real

**T073 es la tarea con más alcance fuera de esta feature.** Actualizar
`docs/DESIGN.md` toca un artefacto de T-01 que consumen cinco tickets. Está
decidido por el responsable, pero conviene hacerlo temprano y de una sola vez:
si T077 se escribe antes que T073, los tokens salen de un documento que todavía
dice otra cosa.

**T057 es la prueba más fácil de omitir y la más cara de omitir.** Sin la
cobertura del enum de `failureCode`, la tabla de errores se pudre en silencio la
primera vez que alguien añada un código al catálogo.

---

## Notes

- `[P]` significa archivo distinto y sin dependencias abiertas.
- `pnpm lint` **ejecuta** las reglas de capas. Si una bloquea una tarea, el
  diseño está mal: no se añade una excepción.
- Todos los comandos desde la raíz del repositorio.
- Ninguna prueba de vencimiento del plazo debe dormir cinco segundos reales:
  `ReplyRegistryOptions` acepta `setTimeoutFn`.
- Un `202` no es un éxito, ni en el Gateway ni en la interfaz.
- Confirmar tras cada tarea o grupo lógico; parar en cada checkpoint a validar.
