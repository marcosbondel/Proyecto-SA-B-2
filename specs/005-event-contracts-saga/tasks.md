---
description: "Task list for T-05 — Contratos de eventos y Saga de transferencias"
---

# Tasks: Contratos de eventos y Saga de transferencias (T-05)

**Input**: Design documents from `/specs/005-event-contracts-saga/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **sí, y son entregable.** FR-027 exige evidencia de la ejecución real de la validación sobre un mensaje válido y uno inválido, y la sección "Evidencia esperada" del ticket la pide por escrito. `pnpm test:contract` deja de ser una prueba del sobre y pasa a ejercitar los 42 contratos.

**Organization**: las tareas se agrupan por historia de usuario. Cada fase entrega un bloque verificable por sí solo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: a qué historia del spec pertenece (US1…US6)
- Todas las rutas son relativas a la raíz del repositorio

## Nota sobre el orden de las historias

Las historias **no son independientes entre sí**, y fingir que lo son produciría un plan falso. El sobre (US2) envuelve a los 42 contratos (US1); las routing keys de la topología (US4) **son** los `messageType` de esos contratos. Por eso US2 va antes que US1 pese a estar ambas en P1, y las fases siguen el orden de dependencia real, no el orden de numeración del spec. Cada fase sigue siendo verificable por sí sola una vez completadas las anteriores.

---

## Phase 1: Setup

**Purpose**: dejar el paquete de contratos listo para recibir esquemas.

- [X] T001 Consultar OSV (ecosistema npm) para `zod`, ejecutar `pnpm audit`, y registrar la tabla de evidencia en la sección R1 de `specs/005-event-contracts-saga/research.md`
- [X] T002 Añadir `zod` al `catalog:` de `pnpm-workspace.yaml`, con la fecha de comprobación en el comentario, siguiendo el formato de las entradas existentes
- [X] T003 Declarar `zod` como `dependencies` en `apps/packages/contracts/package.json` y añadir el script `schema:emit`. **`zod-to-json-schema` no se instala**: Zod 4.4.3 trae `z.toJSONSchema()` nativo, verificado sobre la versión instalada
- [X] T004 [P] Crear el esqueleto de directorios en `apps/packages/contracts/src/events/{customer,account,transaction,payment,audit}/`, `src/routing/`, `src/validation/` y `scripts/`
- [X] T005 [P] Crear el esqueleto de pruebas en `apps/packages/contracts/test/{envelope,events,validation}/`
- [X] T006 Ejecutar `pnpm install && pnpm build` y confirmar que el workspace sigue construyendo antes de escribir un solo contrato

**⚠️ Puerta de T001**: si `zod` tiene una vulnerabilidad abierta, **no entra al catálogo**. Se vuelve a R1 de `research.md` y se implementa con `class-validator`, que ya está en el catálogo y en los cinco servicios. Esa decisión cambia la forma de los 42 archivos, así que no puede tomarse después. **Resultado 2026-08-19: la puerta se pasa.**

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: lo que toda historia necesita y ninguna puede inventarse por su cuenta.

**⚠️ CRITICAL**: ninguna historia empieza hasta que esta fase esté completa.

- [X] T007 Escribir `docs/architecture/adr/ADR-012-object-storage.md` con la decisión de MinIO como búfer de la foto del documento, las alternativas descartadas con razón técnica, y la frontera que lo mantiene conforme al principio II de la constitución
- [X] T008 [P] Registrar ADR-012 en `docs/architecture/adr/README.md` y añadir su fila a `docs/architecture/decision-matrix.md`
- [X] T009 Escribir los primitivos compartidos en `apps/packages/contracts/src/schemas/primitives.ts`: UUID v4, ISO-8601 UTC, importe en unidades menores, código de moneda ISO-4217, rol del enunciado y clave de idempotencia
- [X] T010 [P] Escribir las pruebas de los primitivos en `apps/packages/contracts/test/schemas/primitives.spec.ts`, con un caso válido y uno inválido por primitivo

**Checkpoint**: los primitivos existen y están probados; ADR-012 está registrado, así que el contrato de la foto ya no depende de una decisión sin escribir.

---

## Phase 3: User Story 2 — El sobre transporta trazabilidad, idempotencia e identidad (Priority: P1) 🎯 MVP

**Goal**: que exista una envoltura común con los tres campos que hoy le faltan, y que un flujo sea reconstruible de punta a punta desde un solo identificador.

**Independent Test**: tomar un sobre de ejemplo y verificar que lleva identificadores de trazabilidad, clave de idempotencia, versión, productor e identidad verificada; y que encadenar por `causationId` reconstruye el flujo sin huecos.

### Tests for User Story 2

- [X] T011 [P] [US2] Reescribir `apps/packages/contracts/test/envelope.spec.ts` contra el sobre nuevo: un sobre válido, uno sin `messageVersion`, uno con `producer` fuera del conjunto y uno con rol inválido
- [X] T012 [P] [US2] Añadir en `apps/packages/contracts/test/envelope/version-coherence.spec.ts` la prueba de que un sufijo `.v1` con `messageVersion: 2` se rechaza (FR-005a)
- [X] T013 [P] [US2] Añadir en `apps/packages/contracts/test/envelope/causation.spec.ts` la prueba de que `followUpEnvelope` copia `correlationId` e `identity` y fija `causationId`

### Implementation for User Story 2

- [X] T014 [US2] Extender la interfaz `MessageEnvelope` en `apps/packages/contracts/src/envelope.ts` con `messageVersion`, `producer` e `identity`, documentando cada campo con su razón
- [X] T015 [US2] Actualizar `createEnvelope` y `followUpEnvelope` en el mismo archivo para exigir `producer`, derivar `messageVersion` del sufijo de `messageType` y propagar `identity` sin modificarla
- [X] T016 [US2] Escribir el esquema Zod del sobre en `apps/packages/contracts/src/schemas/envelope.schema.ts`, incluida la comprobación cruzada entre sufijo y `messageVersion`
- [X] T017 [US2] Escribir `docs/events/envelope.md` con la forma del sobre, las reglas por campo, las prohibiciones y el supuesto de confianza de ADR-010, siguiendo `specs/005-event-contracts-saga/contracts/envelope-contract.md`

**Checkpoint**: el sobre está definido, probado y documentado. Todo lo demás puede envolverse en él.

---

## Phase 4: User Story 1 — Cada mensaje tiene un contrato versionado y consumible (Priority: P1)

**Goal**: los 42 contratos existen, están tipados, versionados y documentados, y se consumen sin importar el dominio de ningún servicio.

**Independent Test**: tomar la lista de los 35 mensajes de `docs/domain/message-catalog.md` más los 7 de R11 y verificar que cada uno tiene contrato ejecutable y entrada documental con productor, consumidores, precondiciones, efectos y comportamiento ante error.

### Tests for User Story 1

- [X] T018 [P] [US1] Escribir en `apps/packages/contracts/test/events/catalog-completeness.spec.ts` la prueba de que el catálogo exporta exactamente 42 contratos, que los 35 nombres de T-02 están todos, que los 7 añadidos son exactamente los declarados, y que todo nombre termina en sufijo de versión

### Implementation for User Story 1

- [X] T019 [P] [US1] Escribir los **15** contratos de la familia `customer.*` en `apps/packages/contracts/src/events/customer/`, un archivo `<nombre>.v1.ts` por mensaje, con esquema Zod y tipo derivado por `z.infer`
- [X] T020 [P] [US1] Escribir los **15** contratos de la familia `account.*` en `apps/packages/contracts/src/events/account/`, incluido `accountType` restringido a `MONETARIA` y `AHORRO` en `account.create.v1` y `account.opened.v1` (FR-010)
- [X] T021 [P] [US1] Escribir los **7** contratos de las familias `transfer.*` y `transaction.*` en `apps/packages/contracts/src/events/transaction/`
- [X] T022 [P] [US1] Escribir los **3** contratos de la familia `payment.*` en `apps/packages/contracts/src/events/payment/`
- [X] T023 [P] [US1] Escribir los **2** contratos de la familia `audit.*` en `apps/packages/contracts/src/events/audit/`
- [X] T024 [US1] Escribir la referencia a la foto del documento en `apps/packages/contracts/src/dto/photo-reference.dto.ts` con `objectKey`, `contentType`, `sizeBytes` ≤ 5 MB y `sha256`, y consumirla desde los contratos de `customer.register` y `customer.validate-identity` (depende de T007)
- [X] T025 [US1] Construir la unión discriminada por `messageType` en `apps/packages/contracts/src/events/index.ts` (depende de T019–T023)
- [X] T026 [US1] Retirar `AmountQuotedDto` y su marca `Blocked` de `apps/packages/contracts/src/dto/money.dto.ts`, conservando `MoneyDto`
- [X] T027 [US1] Reexportar el catálogo, los primitivos y la validación desde `apps/packages/contracts/src/index.ts`
- [X] T028 [US1] Escribir el generador de JSON Schema en `apps/packages/contracts/scripts/emit-json-schema.ts` y comprobar que produce un archivo por contrato
- [X] T029 [US1] Escribir `docs/events/catalog.md` con las 42 entradas, cada una siguiendo `specs/005-event-contracts-saga/contracts/message-contract-template.md` sin dejar secciones vacías
- [X] T030 [US1] Añadir a `docs/domain/message-catalog.md` la nota de ampliación que declara `reply` como tercera categoría, lista los 7 mensajes añadidos y explica por qué una respuesta no es un evento huérfano (FR-001b)

**Checkpoint**: los 42 contratos existen y están documentados. Un integrante puede implementar un consumidor sin preguntar.

---

## Phase 5: User Story 3 — La Saga queda especificada con sus dos finales (Priority: P1)

**Goal**: un documento único describe la transferencia paso a paso, con el mensaje concreto de cada transición, los dos finales y los seis escenarios.

**Independent Test**: leer el documento y comprobar que cubre camino feliz, fondos insuficientes, vencimiento, fallo de pago, duplicado y compensación, cada uno con su secuencia y su estado final.

### Tests for User Story 3

- [X] T031 [P] [US3] Escribir en `apps/packages/contracts/test/events/saga-chain.spec.ts` la prueba de que el ejemplo de camino feliz encadena siete mensajes por `causationId` sin huecos y con un único `correlationId`

### Implementation for User Story 3

- [X] T032 [US3] Escribir `docs/events/saga-transfer.md` con los siete pasos, comprobados uno a uno contra la tabla de `docs/domain/use-cases.md` §6 — en particular que Payment reacciona a `payment.requested.v1` y **no** a `account.debited.v1`
- [X] T033 [US3] Documentar en el mismo archivo los dos finales: `FAILED` sin compensación porque el dinero nunca salió, y `COMPENSATED` por la ruta única que comparten `payment.failed.v1` y `account.credit.rejected.v1`, con la invariante T-7
- [X] T034 [US3] Documentar en el mismo archivo los seis escenarios, incluidos el duplicado, la transición ilegal por llegada fuera de orden, y el vencimiento que **no cancela** la operación de negocio
- [X] T035 [P] [US3] Escribir `docs/events/examples/happy-path.json` con los siete mensajes completos, sobre incluido
- [X] T036 [P] [US3] Escribir `docs/events/examples/rejected.json` con el cierre en `FAILED`
- [X] T037 [P] [US3] Escribir `docs/events/examples/compensated.json` con la ruta completa de compensación
- [X] T038 [US3] Añadir a `docs/events/saga-transfer.md` el diagrama de estados de la transacción en Mermaid, coherente con `docs/architecture/README.md`, y anotar que el diagrama de secuencia formal es **T-13**

**Checkpoint**: la Saga se puede implementar, demostrar y defender desde un solo documento.

---

## Phase 6: User Story 4 — La topología deja de ser decisión de cada implementador (Priority: P2)

**Goal**: exchanges, colas, claves, reintentos y cola de errores fijados como datos, no como convención.

**Independent Test**: comprobar que cada consumidor lógico tiene su cola, que existen los cuatro exchanges y que la política de reintentos y DLQ está fijada con números concretos.

### Tests for User Story 4

- [X] T039 [P] [US4] Escribir en `apps/packages/messaging/test/retry-policy.spec.ts` la prueba de que la política produce 1 s, 5 s y 30 s y se detiene en el tercer reintento
- [X] T040 [P] [US4] Escribir en `apps/packages/contracts/test/routing/topology.spec.ts` la prueba de que el descriptor declara 4 exchanges, 6 colas de trabajo y 4 auxiliares por cada una, sin colas compartidas. **Movida desde `@bank/messaging`**: el descriptor vive donde están los nombres, y el adaptador no los conoce (R10). **6 y no 7**: la séptima cola, la de respuestas del Gateway, es exclusiva por instancia y se declara en runtime, no en el descriptor

### Implementation for User Story 4

- [X] T041 [US4] Escribir `apps/packages/contracts/src/routing/routing-keys.ts` con la regla de que la routing key es el `messageType` literal, y la comprobación de que ningún mensaje se desvía de ella
- [X] T042 [US4] Escribir el descriptor de topología en `apps/packages/contracts/src/routing/topology.ts`: los cuatro exchanges, las siete colas de trabajo con sus bindings y las colas de reintento y error derivadas
- [X] T043 [US4] Escribir `apps/packages/messaging/src/retry-policy.ts` con el máximo de tres reintentos, las esperas configurables y la cabecera `x-attempt`
- [X] T044 [US4] Escribir `apps/packages/messaging/src/dead-letter.ts` con las cabeceras `x-attempt`, `x-failure-reason`, `x-failed-at` y `x-original-routing-key`
- [X] T045 [US4] Extender `apps/packages/messaging/src/broker.ts` para declarar la topología desde el descriptor recibido, **sin escribir un solo nombre de negocio dentro del adaptador** (R10)
- [X] T046 [US4] Cambiar el manejo de fallo de `broker.ts` para distinguir mensaje inválido (DLQ directa) de fallo de proceso (colas de reintento), sustituyendo el `nack(false, false)` incondicional actual
- [X] T047 [US4] Escribir `docs/events/topology.md` siguiendo `specs/005-event-contracts-saga/contracts/topology-contract.md`
- [X] T048 [US4] Corregir `infra/docker/README.md`: hoy afirma que hay un solo exchange `bank.events`; pasan a ser cuatro, y `bank.events` conserva el nombre con su significado estrechado a "el exchange de eventos" (R4)

**Checkpoint**: T-06 puede escribir el Compose sin decidir nada de topología.

---

## Phase 7: User Story 5 — Una respuesta se correlaciona con su solicitud (Priority: P2)

**Goal**: las cuatro interacciones de pregunta y respuesta funcionan sin bloquear y sin HTTP entre servicios.

**Independent Test**: comprobar que cada respuesta declara con qué campo se empareja con su solicitud y qué ocurre cuando no llega a tiempo.

### Tests for User Story 5

- [X] T049 [P] [US5] Escribir en `apps/packages/messaging/test/request-reply.spec.ts` la prueba de que una respuesta se empareja por `correlationId` y de que la espera vence a los 5 s sin lanzar cancelación de negocio

### Implementation for User Story 5

- [X] T050 [US5] Escribir `apps/packages/messaging/src/request-reply.ts` con cola exclusiva y autoborrable por instancia, propiedad `replyTo`, emparejamiento por `correlationId` y vencimiento configurable de 5 s
- [X] T051 [US5] Documentar en `docs/events/catalog.md` las cuatro respuestas con su campo de correlación y su comportamiento al vencer, y en `docs/events/topology.md` por qué la cola es exclusiva por instancia y no compartida (R7)
- [X] T052 [US5] Verificar en los contratos escritos en T019 y T021 que `customer.authenticate.replied.v1` devuelve claims y no token, y que su rechazo usa una razón segura que no revela si el usuario existe (FR-019)
- [X] T053 [US5] Verificar en los contratos de T019 que la activación por correo define la expiración del enlace y distingue token expirado de token inválido, sin exponer el token (FR-020)

**Checkpoint**: el Gateway puede preguntar y esperar sin bloquear el sistema.

---

## Phase 8: User Story 6 — Un mensaje inválido se rechaza sin tocar el dominio (Priority: P2)

**Goal**: la validación ocurre antes de la lógica de negocio y un mensaje no conforme no cambia ningún dato.

**Independent Test**: enviar un mensaje conforme y uno no conforme al mismo consumidor; el primero produce su efecto, el segundo no produce ninguno.

### Tests for User Story 6

- [X] T054 [P] [US6] Escribir en `apps/packages/contracts/test/validation/valid-and-invalid.spec.ts` un caso válido y uno inválido **por cada uno de los 42 contratos**, generados desde el catálogo para que un contrato nuevo sin prueba haga fallar la suite
- [X] T055 [P] [US6] Escribir en `apps/packages/contracts/test/validation/unsupported-version.spec.ts` la prueba de que una versión no soportada se rechaza explícitamente en vez de interpretarse a medias
- [X] T056 [P] [US6] Escribir en `apps/packages/contracts/test/validation/unknown-fields.spec.ts` la prueba de que un campo desconocido **se tolera**, porque sin esa regla toda ampliación compatible obligaría a desplegar los siete aplicativos a la vez

### Implementation for User Story 6

- [X] T057 [US6] Escribir `apps/packages/contracts/src/validation/validate-message.ts` que valide sobre y payload en una sola llamada, con la unión discriminada por `messageType`, y devuelva un resultado distinguible entre "tipo desconocido", "versión no soportada" y "payload no conforme"
- [X] T058 [US6] Conectar la validación al camino de consumo de `apps/packages/messaging/src/broker.ts` de modo que ocurra **antes** de invocar el manejador
- [X] T059 [US6] Capturar la evidencia de FR-027: ejecutar `pnpm test:contract`, guardar la salida real y adjuntarla al ticket T-05

**Checkpoint**: un mensaje malformado no puede mover dinero.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T060 [P] Retirar la marca `Blocked` de `apps/packages/contracts/src/events/README.md` y reescribir el README describiendo lo que ahora contiene
- [X] T061 [P] Retirar la marca `Blocked` de `docs/events/README.md` y convertirlo en índice de los cinco documentos nuevos
- [X] T062 [P] Retirar de `docs/operations/README.md` **sólo** la parte de política de retry, timeout y dead-letter por consumidor, conservando las marcas de T-06 y T-23
- [X] T063 Cerrar **TD-013** en `docs/TECH_DEBT.md` y dejar **TD-014 abierta** con su razón: exige un broker en ejecución, que llega con T-06
- [X] T064 [P] Añadir la prueba de tamaño en `apps/packages/contracts/test/events/payload-size.spec.ts`: ningún ejemplo serializado supera 64 KB (SC-009a)
- [X] T065 [P] Añadir la prueba de secretos en `apps/packages/contracts/test/events/no-secrets.spec.ts`: ningún contrato declara campo de contraseña, token, firma ni bytes de imagen (SC-009)
- [X] T066 Actualizar `docs/DOC_INVENTORY.md` con los cinco documentos nuevos de `docs/events/` y el ADR-012
- [X] T067 Ejecutar la guía completa de [quickstart.md](quickstart.md) y registrar el resultado de cada criterio SC-001 a SC-010
- [X] T068 Ejecutar `pnpm build && pnpm lint && pnpm test && pnpm test:contract && pnpm format:check` y confirmar los cinco en código de salida 0
- [X] T069 **La premisa era falsa y la tarea cambia.** `apps/gateway` y los cinco servicios **sí** se tocan: el sobre ganó `producer` e `identity` y el adaptador pasó de un exchange a cuatro, y esas firmas las consumen el Gateway y las pruebas de los servicios. Lo verificado es lo correcto: el cambio en `apps/` se limita a **adaptar consumidores existentes a las firmas nuevas**, sin añadir lógica de dominio ni tocar las capas `domain` y `application`, que siguen vacías
- [X] T070 Añadir el script `typecheck` a la raíz (`pnpm -r typecheck`). Descubierto durante la implementación: `pnpm test` pasa con errores de tipos en archivos de prueba porque jest no comprueba tipos, y eso escondió cinco pruebas obsoletas en los servicios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: sin dependencias. **T001 es una puerta**: su resultado puede invalidar R1 y con él la forma de los 42 contratos.
- **Phase 2 (Foundational)**: depende de Phase 1. Bloquea todo lo demás.
- **Phase 3 (US2, sobre)**: depende de Phase 2. **Bloquea a US1**, porque los 42 contratos se envuelven en él.
- **Phase 4 (US1, catálogo)**: depende de US2. **Bloquea a US4 y US6**.
- **Phase 5 (US3, Saga)**: depende de US1 — los ejemplos usan contratos reales.
- **Phase 6 (US4, topología)**: depende de US1, porque las routing keys **son** los `messageType`.
- **Phase 7 (US5, respuestas)**: depende de US1 y US4.
- **Phase 8 (US6, validación)**: depende de US1; se integra con US4 en T058.
- **Phase 9 (Polish)**: depende de todo lo anterior.

### Dependencias concretas entre tareas

| Tarea | Depende de | Por qué |
| --- | --- | --- |
| T002 | T001 | No entra al catálogo una dependencia sin comprobar |
| T019–T023 | T016 | Los contratos usan el esquema del sobre |
| T024 | T007 | El contrato de la foto depende de la decisión registrada en ADR-012 |
| T025 | T019–T023 | La unión discriminada necesita todos los contratos |
| T035–T037 | T025 | Los ejemplos se construyen con contratos reales |
| T041–T042 | T025 | La routing key se deriva del `messageType` de cada contrato |
| T046 | T043, T044 | El manejo de fallo necesita la política y las cabeceras |
| T054 | T025 | Las pruebas se generan desde el catálogo |
| T058 | T057, T045 | La validación se conecta al camino de consumo |

### Parallel Opportunities

- **Phase 1**: T004 y T005 en paralelo.
- **Phase 2**: T008 y T010 en paralelo con T009 y T007 respectivamente.
- **Phase 3**: T011, T012 y T013 en paralelo — tres archivos de prueba distintos.
- **Phase 4**: **T019 a T023 en paralelo** — cinco familias, cinco directorios, cero solapamiento. Es el mayor bloque paralelizable de la feature y encaja con los tres integrantes.
- **Phase 5**: T035, T036 y T037 en paralelo — tres archivos de ejemplo.
- **Phase 6**: T039 y T040 en paralelo.
- **Phase 8**: T054, T055 y T056 en paralelo.
- **Phase 9**: T060, T061, T062, T064 y T065 en paralelo.

### Reparto sugerido entre los tres integrantes

Tras la Phase 3, el bloque de Phase 4 se reparte por familia sin conflicto de archivos:

| Integrante | Tareas |
| --- | --- |
| Marcos Bonifasi | T019 (`customer.*`, 14) y T024 (foto) |
| Enner Mendizabal | T020 (`account.*`, 15) |
| David Barrios | T021, T022, T023 (`transaction.*`, `payment.*`, `audit.*`, 12) |

T025 los une y la hace una sola persona, después.

---

## Implementation Strategy

### MVP

**Phase 1 + Phase 2 + Phase 3 (US2)**. El sobre con trazabilidad, idempotencia e identidad, probado y documentado. Es lo mínimo que desbloquea algo real: sin él ningún contrato puede escribirse, y con él ADR-010 deja de tener una consecuencia pendiente.

### Entrega incremental

1. **Sobre** (Phase 3) — todo lo demás se envuelve en él.
2. **Catálogo** (Phase 4) — aquí T-06 y los tickets de servicio dejan de estar bloqueados por contratos que no existen.
3. **Saga** (Phase 5) — aquí se cubren los criterios 2.7 y 2.8 de la rúbrica, que valen 5 o 0 sin punteo intermedio.
4. **Topología** (Phase 6) — aquí T-06 puede escribir el Compose.
5. **Respuestas y validación** (Phases 7 y 8) — aquí aparece la evidencia que el ticket exige.
6. **Cierre** (Phase 9) — marcas de bloqueo retiradas y TD-013 cerrada.

### Lo que este ticket no puede declarar aprobado

Las comprobaciones que exigen un broker en ejecución —que el reintento espere de verdad 1 s, 5 s y 30 s; que la DLQ reciba sus cabeceras; que una respuesta vuelva a la cola exclusiva correcta; que el objeto de la foto se recupere con su huella intacta— **no se verifican aquí**. Son de T-06 y T-23, y están listadas en [quickstart.md](quickstart.md) §6. Declararlas aprobadas en T-05 sería falso.
