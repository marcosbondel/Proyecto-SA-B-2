---
description: "Task list for T-04 — Monorepo y base de desarrollo"
---

# Tasks: Monorepo y base de desarrollo (T-04)

**Input**: Design documents from `/specs/002-monorepo-dev-base/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/workspace-contracts.md](contracts/workspace-contracts.md), [quickstart.md](quickstart.md)

**Tests**: no hay TDD. Cada aplicación nace con una **prueba mínima** como parte de su esqueleto (SC-002) y cada historia cierra con tareas de **verificación** tomadas de [quickstart.md](quickstart.md).

**Organization**: las tareas se agrupan por historia de usuario para entregar y verificar cada una por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: a qué historia pertenece (US1, US2, US3, US4)
- Toda tarea nombra su archivo o directorio

## Path Conventions

Monorepo pnpm. Rutas relativas a la raíz. `apps/web/` ya existe y solo se integra al workspace (FR-018: no modificar su código). Los cinco servicios viven en `apps/services/`, el Gateway en `apps/gateway/`, los paquetes en `apps/packages/`.

Versiones fijadas en el `catalog` de `pnpm-workspace.yaml` — tabla completa y evidencia OSV en [research.md](research.md): Node 24.19.0, pnpm 11.21.0, TypeScript 6.0.3, NestJS 11.1.29, Jest 30.4.2, ts-jest 29.4.12, ESLint 10.8.1, typescript-eslint 8.67.0, Prettier 3.9.6, rxjs 7.8.2, reflect-metadata 0.2.2, amqplib 2.0.1, amqp-connection-manager 5.0.0, class-validator 0.15.1, class-transformer 0.5.1, @types/node 24.13.3, @types/jest 30.0.0.

---

## Phase 1: Setup

**Purpose**: crear la raíz del workspace y la configuración compartida de la que todo depende.

- [X] T001 Crear `package.json` raíz con `packageManager: pnpm@11.21.0`, `engines.node: >=24.19.0`, y los scripts de [contracts/workspace-contracts.md §1](contracts/workspace-contracts.md): `build`, `lint`, `test`, `test:contract`, `format`, `dev`
- [X] T002 Crear `pnpm-workspace.yaml` con los globs `apps/*`, `apps/services/*`, `packages/*` y el `catalog` con las versiones fijadas de [research.md](research.md) — cada dependencia compartida con versión exacta, sin rangos
- [X] T003 [P] Crear `apps/packages/tooling/` con la configuración compartida: `tsconfig.base.json` (strict, sin ocultar errores — FR-012), `eslint.base.mjs` (eslint 10.8.1 + typescript-eslint 8.67.0 + eslint-config-prettier 10.1.8), `prettier.config.mjs` (3.9.6) y `jest.base.mjs` (jest 30.4.2 + ts-jest 29.4.12). Sin código de runtime
- [X] T004 [P] Crear `.nvmrc` con `24.19.0` en la raíz
- [X] T005 [P] Actualizar `.gitignore` raíz para el monorepo: `dist/`, `coverage/`, `node_modules/`, `.env` (conservando las reglas existentes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: las dos cosas que pueden romper algo existente o invalidar el patrón: integrar `apps/web` y probar el esqueleto de referencia. Todo lo demás replica el patrón.

**⚠️ CRITICAL**: si `apps/web` deja de instalar o construir al integrarla, se ajusta la integración antes de seguir — no se fuerza (edge case del spec).

- [X] T006 Integrar `apps/web/` al workspace (queda cubierta por el glob `apps/*` de T002), ejecutar `pnpm install` en la raíz y verificar que `pnpm --filter web build` pasa igual que antes (FR-003, SC-007). Adjuntar salida
- [X] T007 Crear `apps/gateway/` como **esqueleto de referencia** con el patrón que todo servicio replica: `nest-cli.json`, `package.json` (deps vía `catalog:`), `tsconfig.json` extendiendo `apps/packages/tooling/tsconfig.base.json`, `src/{domain,application,infrastructure,interfaces}/`, `src/main.ts` con bootstrap NestJS, health check en `src/interfaces/health.controller.ts`, prueba mínima en `test/`, `.env.example` con placeholders (`PORT`, `RABBITMQ_URL`, `NODE_ENV` — **sin** `DATABASE_URL`, constitución V)
- [X] T008 Verificar el esqueleto de referencia: `pnpm --filter gateway build`, `pnpm --filter gateway test` y `pnpm --filter gateway lint` en verde desde la raíz. Este patrón queda fijo antes de replicarlo

**Checkpoint**: el workspace instala, la web existente sigue viva, y el patrón de esqueleto está probado. La replicación puede empezar.

---

## Phase 3: User Story 1 - Clonar, instalar y levantar el monorepo (Priority: P1) 🎯 MVP

**Goal**: que un checkout limpio instale, compile, linte y pruebe las siete aplicaciones en menos de 15 minutos siguiendo solo el README.

**Independent Test**: los comandos de [quickstart.md SC-001/SC-002](quickstart.md) terminan en verde en un clon nuevo.

### Implementation for User Story 1

- [X] T009 [P] [US1] Crear `apps/services/customer-service/` replicando el patrón de T007: cuatro capas, health check, prueba mínima, `.env.example` con `DATABASE_URL` (base propia), `RABBITMQ_URL`, `PORT`, `NODE_ENV`
- [X] T010 [P] [US1] Crear `apps/services/account-service/` con el mismo patrón
- [X] T011 [P] [US1] Crear `apps/services/transaction-service/` con el mismo patrón
- [X] T012 [P] [US1] Crear `apps/services/payment-service/` con el mismo patrón
- [X] T013 [P] [US1] Crear `apps/services/notification-audit-service/` con el mismo patrón
- [X] T014 [US1] Cablear los scripts raíz de `package.json` para que operen sobre todo el workspace (`pnpm -r`) y por aplicación (`pnpm --filter <app>`), según [contracts/workspace-contracts.md §1](contracts/workspace-contracts.md)
- [X] T015 [US1] Verificar SC-001/SC-002 con los comandos de [quickstart.md](quickstart.md): clon limpio → `pnpm install && pnpm build && pnpm lint && pnpm test` en verde y < 15 minutos; luego el loop de las 7 apps con build y test propios. Adjuntar salida real al ticket

**Checkpoint**: T-05, T-06 y T-07 ya tienen dónde trabajar. Este es el MVP del ticket.

---

## Phase 4: User Story 2 - Desarrollar un servicio sin tocar a los demás (Priority: P2)

**Goal**: que el aislamiento de dominio y de capas sea ejecutable — que falle el lint, no la memoria del equipo.

**Independent Test**: el intento de importar dominio ajeno de [quickstart.md SC-003](quickstart.md) falla en lint; los grep de dirección de dependencias no tienen salida.

### Implementation for User Story 2

- [X] T016 [US2] Agregar a `apps/packages/tooling/eslint.base.mjs` las reglas `no-restricted-imports` por directorio según la tabla de [contracts/workspace-contracts.md §2](contracts/workspace-contracts.md): `domain` no importa nada externo; `application` no importa `infrastructure` ni `interfaces`; ningún servicio importa de `apps/services/**` ajeno; `apps/gateway` no importa de `apps/services/**`
- [X] T017 [US2] Verificar SC-003 con el escape-hatch de [quickstart.md](quickstart.md): crear el import prohibido, correr lint, comprobar el error, borrar el archivo. Adjuntar salida
- [X] T018 [US2] Verificar los grep de dirección de dependencias de [quickstart.md SC-003](quickstart.md) (`infrastructure` no aparece en `domain`/`application`) y correr lint + test por aplicación para las 7 apps (SC-005). Adjuntar salida

**Checkpoint**: el aislamiento es una regla ejecutable, no una convención escrita.

---

## Phase 5: User Story 3 - Compartir contratos sin acoplar dominio (Priority: P2)

**Goal**: que `apps/packages/contracts` exista, compile y sea consumible, sin una línea de lógica de negocio.

**Independent Test**: `pnpm --filter @bank/contracts build && pnpm test:contract` en verde; el grep de lógica de negocio en contratos no tiene salida.

### Implementation for User Story 3

- [X] T019 [US3] Crear `apps/packages/contracts/` con `package.json` (`@bank/contracts`, build tsc), y el sobre base de mensaje en `src/envelope.ts` con `correlationId`, `causationId` e `idempotencyKey` (regla de T-03) más un DTO de ejemplo en `src/dto/`
- [X] T020 [P] [US3] Crear `apps/packages/contracts/src/events/README.md` con la marca de bloqueo: contratos de eventos del dominio y de la Saga — Owner: Marcos Bonifasi, llega con T-05
- [X] T021 [US3] Crear `apps/packages/messaging/` (`@bank/messaging`) con el adaptador técnico sobre `amqplib` 2.0.1 + `amqp-connection-manager` 5.0.0: conexión, reconexión, publicación y consumo con el sobre base. Sin nombres de eventos de negocio
- [X] T022 [US3] Cablear la prueba de contrato de ejemplo y el script raíz `test:contract`; agregar el consumo del sobre desde `apps/gateway` y desde un servicio como ejemplo de importación sin dominio ajeno (evidencia SC-004)
- [X] T023 [US3] Verificar SC-004 con los comandos de [quickstart.md](quickstart.md): build del paquete, prueba de contrato, y grep de `entity|repository|use-?case` en `apps/packages/contracts/src/` sin salida. Adjuntar salida

**Checkpoint**: T-05 puede empezar a escribir eventos en un paquete que ya compila.

---

## Phase 6: User Story 4 - Configurar y entender el entorno local (Priority: P3)

**Goal**: que el entorno se configure sin adivinar y que todo lo pendiente tenga marca, responsable y ticket.

**Independent Test**: arrancar un servicio sin `DATABASE_URL` falla nombrando la variable; toda marca de bloqueo tiene owner y ticket (SC-006).

### Implementation for User Story 4

- [X] T024 [US4] Implementar la validación de variables obligatorias al arrancar en el `src/main.ts` de las 7 aplicaciones, con `class-validator` sobre un objeto de configuración tipado según [contracts/workspace-contracts.md §3](contracts/workspace-contracts.md): si falta una variable, el proceso sale con código ≠ 0 nombrándola
- [X] T025 [P] [US4] Completar los `.env.example` de las 7 aplicaciones con las variables mínimas del contrato §3 — nombres y placeholders, sin valores reales (regla de `docs/SECURITY.md`)
- [X] T026 [P] [US4] Crear los `README.md` con marca de bloqueo en `infra/docker/` (→ T-06, con versiones fijadas PostgreSQL 18.4 y RabbitMQ 4.3.4), `infra/k8s/` (→ T-16), `docs/architecture/` (→ T-07/T-03), `docs/events/` (→ T-07) y `docs/operations/` (→ T-07), siguiendo el formato de `docs/SECURITY.md`
- [X] T027 [US4] Actualizar `README.md` raíz: comandos exactos del monorepo, orden de arranque local del contrato §4, y la lista de archivos generados no editables del contrato §5 (FR-014)
- [X] T028 [US4] Actualizar la sección **Commands** de `AGENTS.md` (hoy dice "Run from `apps/web/`", queda obsoleta con el workspace) y el bloque equivalente de `CLAUDE.md` — misma regla de siempre: el doc obsoleto se actualiza en el mismo cambio que lo vuelve obsoleto
- [X] T029 [US4] Registrar en `docs/TECH_DEBT.md` los pendientes que este ticket crea: migración a TypeScript 7 cuando ts-jest lo soporte (R2), contenido de contratos (T-05), consumidores reales de `messaging` (T-05+), stack local de `infra/docker` (T-06)
- [X] T030 [US4] Verificar FR-013 con el comando de [quickstart.md](quickstart.md): arrancar `customer-service` sin `DATABASE_URL` falla nombrando la variable. Adjuntar salida

**Checkpoint**: el monorepo se explica solo y ningún pendiente está suelto.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T031 [P] Correr completo el [quickstart.md](quickstart.md) en un clon limpio y recolectar la evidencia de SC-001 a SC-008
- [X] T032 [P] Ejecutar `pnpm audit` (esperado: 0 vulnerabilidades) y adjuntar salida — es la verificación continua de la regla de versiones de R8
- [X] T033 [P] Verificar SC-006 con el grep de marcas de bloqueo de [quickstart.md](quickstart.md): toda marca tiene `Owner:` y `Arrives with: T-`; conteo de coincidencias sin formato = 0
- [X] T034 Generar el árbol del monorepo (`find apps services packages infra docs/architecture docs/events docs/operations -type d | sort`) y adjuntarlo como evidencia de estructura
- [ ] T035 **Requiere al responsable.** Adjuntar toda la evidencia al ticket T-04 en Notion —salidas de install/build/lint/test, árbol, escape-hatch, audit— y mover el estado a Done. Un criterio verificado sin evidencia enlazada no cuenta como verificado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias
- **Foundational (Fase 2)**: depende de Setup. **Bloquea todas las historias** — si `apps/web` rompe o el patrón de esqueleto no compila, replicarlo multiplica el error
- **US1 (Fase 3)**: depende de Foundational. Es el MVP
- **US2 (Fase 4)**: depende de US1 (las reglas de lint se aplican sobre servicios que ya existen)
- **US3 (Fase 5)**: depende de Foundational; **independiente de US1/US2** en archivos (vive en `apps/packages/`), pero el ejemplo de consumo de T022 necesita al menos un servicio de US1
- **US4 (Fase 6)**: depende de US1 (valida el arranque de las apps); T026/T029 son independientes
- **Polish (Fase 7)**: depende de todo lo anterior

### Dentro de cada historia

- El patrón de T007/T008 se fija **antes** de replicar en T009–T013: corregir el patrón cuesta 1 archivo, corregir la réplica cuesta 5
- Las reglas de aislamiento (T016) después de crear los servicios: aplicarlas antes no tendría nada que verificar
- Los `.env.example` finales (T025) después de la validación (T024): la lista de variables obligatorias la define el validador

### Conflictos de archivo a vigilar

| Archivo | Tareas | Regla |
|---|---|---|
| `package.json` raíz | T001, T014 | T001 crea, T014 cablea scripts. Nunca en paralelo |
| `apps/packages/tooling/eslint.base.mjs` | T003, T016 | T003 crea la base, T016 agrega aislamiento |
| `README.md` raíz | T027 | Un solo escritor |
| `docs/TECH_DEBT.md` | T029 | Un solo escritor |

### Parallel Opportunities

- T003, T004 y T005 en paralelo (archivos distintos)
- **T009 a T013 en paralelo**: los cinco servicios son réplicas independientes del patrón
- T020 y T026 en paralelo con cualquier cosa (marcas de bloqueo, archivos nuevos)
- T031, T032 y T033 en paralelo (verificaciones de solo lectura)

---

## Parallel Example: Fase 3

```bash
# Los cinco servicios se crean a la vez, son directorios distintos con el mismo patrón:
Task: "Crear apps/services/customer-service/ con el patrón de referencia"
Task: "Crear apps/services/account-service/ con el patrón de referencia"
Task: "Crear apps/services/transaction-service/ con el patrón de referencia"
Task: "Crear apps/services/payment-service/ con el patrón de referencia"
Task: "Crear apps/services/notification-audit-service/ con el patrón de referencia"
```

---

## Implementation Strategy

### MVP primero (US1)

1. Fase 1 y Fase 2 completas: el workspace instala, `apps/web` sigue viva, el patrón de esqueleto está probado
2. Fase 3: los cinco servicios replicados, scripts raíz, verificación en clon limpio
3. **PARAR Y VALIDAR**: T015
4. Con esto, **T-05, T-06 y T-07 ya pueden arrancar** aunque el resto del ticket siga abierto

### Entrega incremental

1. Foundational → base cierta
2. US1 → monorepo ejecutable (MVP), desbloquea T-05/T-06/T-07
3. US2 → aislamiento ejecutable, protege la constitución II/IV
4. US3 → contratos compilables, prepara a T-05
5. US4 → entorno documentado y pendientes marcados, cierra SC-006

### Reparto entre los tres

US1 es la crítica y la más paralelizable internamente (cinco servicios a la vez). US3 (`apps/packages/`) puede llevarla otra persona en cuanto termine Foundational. US4 es mayormente documental y puede ir último o repartirse.

---

## Notes

- Toda marca de bloqueo sigue el formato `> **Blocked**: … Owner: … Arrives with: T-XX` (FR-015); ningún pendiente se deja en lenguaje libre
- Ninguna versión entra al `catalog` sin verificación OSV en cero (R8); `pnpm audit` se corre en T032 como evidencia
- Commit por tarea o por grupo lógico; los commits son evidencia de distribución de la rúbrica
- Se puede parar en cualquier checkpoint y validar la historia por separado
- `apps/web/` no se modifica más allá de la integración al workspace (FR-018); si T006 rompe su build, se ajusta la integración, no la web

---

## Desviaciones registradas durante la implementación (2026-08-12)

Lo que se hizo distinto de lo escrito, y por qué. Nada de esto se decidió en silencio.

1. **Todo el código bajo `apps/`.** Decisión del responsable a mitad de la implementación. `services/*` y `packages/*` pasaron a `apps/services/*` y `apps/packages/*`; la configuración del workspace se queda en la raíz. `spec.md` (FR-001), `plan.md`, `contracts/`, `quickstart.md`, `research.md` y `data-model.md` se actualizaron en el mismo cambio.

2. **`apps/web` recibió scripts `lint` y `test`.** Sin ellos, `pnpm -r lint` y `pnpm -r test` la saltaban en silencio y SC-002/SC-005 quedaban sin verificar para una de las siete aplicaciones. `lint` usa el `@nuxt/eslint` que ya estaba instalado; `test` usa el runner integrado de Node, sin agregar un segundo framework de pruebas (R4). Registrado en `AGENTS.md` y `CLAUDE.md` como pide la regla del repo, y la cobertura real de componentes queda como TD-010.

3. **La validación de entorno al arrancar cubre 6 de 7 aplicaciones.** Gateway y los cinco servicios la tienen. `apps/web` no: implementarla exige tocar el código de la aplicación Nuxt, que FR-018 prohíbe, y hoy no tiene ninguna variable obligatoria al arrancar. Tiene su `.env.example`. La brecha es **TD-011** y se cierra cuando el frontend consuma el Gateway. FR-013 no está completo al 100%.

4. **Override de `esbuild`.** `pnpm audit` no daba cero: `@nuxt/ui > @nuxt/fonts > fontless` arrastraba esbuild 0.27.x con GHSA-g7r4-m6w7-qqqr. Se forzó `>=0.28.1` en `pnpm-workspace.yaml`. Después: cero vulnerabilidades y el build de la web intacto.

5. **`incremental` desactivado en el TypeScript compartido.** Con `incremental: true`, `nest build` borra `dist/` pero no el `.tsbuildinfo` que queda junto al tsconfig: la siguiente compilación se cree al día y no emite nada. Falla en silencio, en las seis aplicaciones NestJS.

6. **T031 se verificó sobre una copia limpia del árbol, no sobre un `git clone`.** Los cambios no están commiteados, así que un clon no los tendría. La copia excluye todo artefacto generado (`node_modules`, `dist`, `.nuxt`, `.output`, `coverage`, `*.tsbuildinfo`). Con el store de pnpm caliente: install 6.4 s, build 10.3 s, lint 4.1 s, test 3.9 s — unos 25 s contra el presupuesto de 15 minutos de SC-001. Un store frío tarda más y sigue sobrando margen.
