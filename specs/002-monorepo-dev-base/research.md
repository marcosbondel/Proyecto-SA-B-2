# Phase 0 — Research: Monorepo y base de desarrollo (T-04)

**Fecha**: 2026-08-12. Versiones verificadas contra el registro npm, nodejs.org, postgresql.org, rabbitmq.com y la base OSV en esa fecha.

---

## R1 — Runtime: Node.js

**Decisión.** Node.js **24.19.0 LTS (Krypton)**.

**Verificación.** `nodejs.org/download/release/index.json`: v24.19.0 publicado 2026-08-03, LTS activo. La línea 24 recibe soporte hasta abril 2028; la 22 (Jod) sigue en mantenimiento pero la 24 es la LTS de mayor vida restante.

**Alternativas consideradas.** Node 22.23.2 (Jod): válida pero con menos soporte restante. Node 25/26 (current): rechazadas, sin compromiso LTS.

---

## R2 — TypeScript: 6.x, no 7.x

**Decisión.** TypeScript **6.0.3** en todo el monorepo.

**Verificación.** `npm view typescript`: 7.0.2 es la última (2026-08-12). Pero `npm view ts-jest@29.4.12 peerDependencies` declara `"typescript": ">=4.3 <7"` — la línea 7 queda fuera del rango soportado por el runner de pruebas. Además `apps/web` ya declara `typescript: ^6.0.3`; fijar 6.0.3 mantiene una sola versión en todo el repo.

**Alternativas consideradas.** TypeScript 7.0.2: rechazada por el peer de ts-jest y por romper la uniformidad con `apps/web`. Migrar la línea a TS 7 se evaluará cuando ts-jest (o el runner que lo sustituya) declare soporte; se registra en `docs/TECH_DEBT.md`.

---

## R3 — Framework de servicios: NestJS 11

**Decisión.** `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/microservices`, `@nestjs/testing` en **11.1.29**; `@nestjs/cli` en **11.0.24**. Peers satisfechos: `rxjs` **7.8.2**, `reflect-metadata` **0.2.2**.

**Verificación.** `npm view @nestjs/core`: 11.1.29, publicado 2026-08-10 — línea activa. El enunciado (§4.3) permite Spring Boot 4 o NestJS; el equipo ya decidió NestJS (ticket T-03).

**Nota de paquete.** El transporte RabbitMQ de NestJS vive dentro de `@nestjs/microservices` — no existe `@nestjs/platform-rabbitmq` como paquete separado (404 en el registro). Para el adaptador de `apps/packages/messaging` se usa `amqplib` **2.0.1** con `amqp-connection-manager` **5.0.0** (reconexión y retries), sin framework encima.

---

## R4 — Testing: Jest 30 + ts-jest

**Decisión.** `jest` **30.4.2**, `ts-jest` **29.4.12**, `@types/jest` **30.0.0**.

**Verificación.** ts-jest 29.4.12 declara peers `jest: ^29 || ^30` y `@jest/transform: ^29 || ^30` — compatible con Jest 30. Una prueba mínima por aplicación (SC-002) más `test:contract` raíz con un ejemplo sobre `apps/packages/contracts`.

**Alternativas consideradas.** Vitest 4.1.10: activo y sin vulnerabilidades, pero introduciría un segundo runner distinto al estándar NestJS del equipo sin causa; rechazada por uniformidad.

---

## R5 — Lint y formato

**Decisión.** `eslint` **10.8.1**, `typescript-eslint` **8.67.0**, `eslint-config-prettier` **10.1.8**, `prettier` **3.9.6**.

**Verificación.** `apps/web` ya declara `eslint: ^10.8.1` — misma línea. El aislamiento de dominio (FR-007) se implementa con la regla `no-restricted-imports` de ESLint por directorio, ver [contracts/workspace-contracts.md](contracts/workspace-contracts.md).

---

## R6 — PostgreSQL: 18.4 (referencia para T-06)

**Decisión.** PostgreSQL **18.4** como versión de referencia para las imágenes que T-06 levantará.

**Verificación.** `postgresql.org/support/versioning`: la 18 se publicó 2025-09-25 y tiene soporte hasta **2030-11-14**. La 17.10 también está soportada (hasta 2029-11-08), pero la 18 ofrece mayor vida restante y ya pasó casi un año de maduración.

**Alcance en este ticket.** Ninguna base se levanta aquí. La versión queda fijada para que T-06 no la rediscuta, y los `.env.example` de los servicios llevan el placeholder `DATABASE_URL` con el nombre de base propio de cada servicio.

---

## R7 — RabbitMQ: 4.3.4, no 4.2.x

**Decisión.** RabbitMQ **4.3.4-management** como versión de referencia para T-06.

**Verificación.** `rabbitmq.com/release-information`: la serie **4.2 perdió soporte comunitario el 2026-07-31** — doce días antes de esta decisión. La serie con soporte vigente es **4.3.x** (comunidad hasta 2026-11-30, comercial hasta 2028-04). El patch más reciente es 4.3.4 (2026-07-23).

**Consecuencia.** Cualquier compose o manifiesto que T-06 escriba con `rabbitmq:4.2` queda en deuda desde el día uno; la fijación aquí lo evita.

---

## R8 — Fijación de versiones: pnpm catalog + verificación OSV

**Decisión.** Las versiones compartidas se fijan una sola vez en el `catalog` de `pnpm-workspace.yaml` (soportado por pnpm 11); cada `package.json` referencia `catalog:` en lugar de repetir rangos. El lockfile raíz queda como fuente de verdad ejecutable.

**Verificación de vulnerabilidades.** Cada versión fijada se consultó contra la base OSV (`api.osv.dev/v1/query`, ecosistema npm) el 2026-08-12:

| Paquete | Versión | Vulnerabilidades conocidas |
|---|---|---|
| typescript | 6.0.3 | 0 |
| @nestjs/core | 11.1.29 | 0 |
| @nestjs/microservices | 11.1.29 | 0 |
| jest | 30.4.2 | 0 |
| ts-jest | 29.4.12 | 0 |
| eslint | 10.8.1 | 0 |
| pnpm | 11.21.0 | 0 |
| rxjs | 7.8.2 | 0 |
| class-validator | 0.15.1 | 0 |
| class-transformer | 0.5.1 | 0 |
| amqplib | 2.0.1 | 0 |
| amqp-connection-manager | 5.0.0 | 0 |
| reflect-metadata | 0.2.2 | 0 |
| prettier | 3.9.6 | 0 |
| nuxt (apps/web, ya existente) | 4.5.2 | 0 |

**Regla permanente que este ticket deja escrita** (en `contracts/workspace-contracts.md`): al actualizar una dependencia se vuelve a correr la consulta OSV y `pnpm audit`; una dependencia con vulnerabilidad conocida no entra al catálogo.

**Alternativas consideradas.** (a) Rangos `^` por paquete sin catálogo: rechazada, dispersa las versiones y dificulta la verificación. (b) Renovate/Dependabot desde ya: rechazada, CI/CD está fuera de alcance (FR-017); la verificación manual documentada es suficiente para el hito H1.

---

## R9 — Estrategia de marcas de bloqueo

**Decisión.** Cada directorio o sección cuyo contenido llega con otro ticket se crea con un `README.md` mínimo que sigue el formato ya usado en `docs/SECURITY.md` y `docs/RELIABILITY.md`:

```text
> **Blocked**: <qué falta>. Owner: <responsable>. Arrives with: <ticket>.
```

Los pendientes detectados y no resueltos se registran además en `docs/TECH_DEBT.md` (FR-015, SC-006).

**Marcas que este ticket crea:**

| Ubicación | Falta | Llega con |
|---|---|---|
| `apps/packages/contracts/src/events/` | Contratos de eventos del dominio y la Saga | T-05 |
| `infra/docker/` | Compose/local stack con PostgreSQL 18.4 y RabbitMQ 4.3.4 | T-06 |
| `infra/k8s/` | Manifiestos para kind | T-16 |
| `docs/architecture/` | Diagramas y ADRs | T-07 / T-03 |
| `docs/events/` | Catálogo de eventos | T-07 |
| `docs/operations/` | Runbooks | T-07 |
| Validación de secretos completa | Modelo de secretos y rotación | T-03/T-06 |
| Migraciones por servicio | Esquema de cada base | T-08 a T-12 |
