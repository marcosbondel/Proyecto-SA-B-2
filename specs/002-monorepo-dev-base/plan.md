# Implementation Plan: Monorepo y base de desarrollo (T-04)

**Branch**: `feature/T-04` | **Date**: 2026-08-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-monorepo-dev-base/spec.md`

## Summary

Convertir el repositorio en un monorepo pnpm ejecutable con siete aplicaciones (Gateway, web existente, cinco servicios NestJS) y tres paquetes compartidos (`contracts`, `messaging`, `tooling`), con Clean Architecture por servicio, aislamiento de dominio verificable por lint, scripts raíz y por aplicación, validación de variables de entorno al arrancar, y toolchain con **versiones fijadas, con soporte vigente y cero vulnerabilidades conocidas** (verificado contra OSV el 2026-08-12, ver [research.md](research.md)).

Todo entregable que depende de tickets no trabajados (T-02, T-03, T-05, T-06, T-07, T-16) se crea con marca de bloqueo explícita y se registra en `docs/TECH_DEBT.md`, conforme a FR-015.

## Technical Context

**Language/Version**: TypeScript **6.0.3** sobre Node.js **24.19.0 LTS (Krypton)**. TypeScript 7.x existe (7.0.2) pero se rechaza: `ts-jest@29.4.12` declara peer `typescript >=4.3 <7`, y `apps/web` ya usa 6.0.3 — una sola versión en todo el monorepo.

**Primary Dependencies**:

| Componente | Versión fijada | Soporte verificado | Vulns (OSV, 2026-08-12) |
|---|---|---|---|
| Node.js | 24.19.0 (LTS Krypton) | LTS activo | n/a (runtime) |
| pnpm | 11.21.0 | línea activa (release 2026-08-12) | 0 |
| TypeScript | 6.0.3 | línea activa | 0 |
| @nestjs/core, common, platform-express, microservices, testing | 11.1.29 | línea activa (2026-08-10) | 0 |
| @nestjs/cli | 11.0.24 | línea activa | 0 |
| rxjs / reflect-metadata | 7.8.2 / 0.2.2 | peers de NestJS 11 | 0 |
| jest / ts-jest / @types/jest | 30.4.2 / 29.4.12 / 30.0.0 | línea activa | 0 |
| eslint / typescript-eslint / eslint-config-prettier | 10.8.1 / 8.67.0 / 10.1.8 | línea activa | 0 |
| prettier | 3.9.6 | línea activa | 0 |
| amqplib / amqp-connection-manager | 2.0.1 / 5.0.0 | línea activa | 0 |
| class-validator / class-transformer | 0.15.1 / 0.5.1 | línea activa | 0 |
| @types/node | 24.13.3 | alineado a Node 24 | 0 |
| PostgreSQL (referencia para T-06) | 18.4 | soportado hasta 2030-11-14 | n/a (imagen) |
| RabbitMQ (referencia para T-06) | 4.3.4-management | comunidad hasta 2026-11-30, comercial hasta 2028-04 | n/a (imagen) |

La versión de RabbitMQ **no puede ser 4.2.x**: su soporte comunitario terminó el 2026-07-31. La serie con soporte vigente es 4.3.x.

**Storage**: Ninguna en este ticket. Las bases PostgreSQL (una por servicio, fuera del cluster) se levantan en T-06; aquí solo se fija la versión de referencia (18.4) y los placeholders de conexión en los `.env.example`.

**Testing**: Jest 30.4.2 + ts-jest por aplicación (prueba mínima por app) y un script raíz `test:contract` con una prueba de contrato mínima de ejemplo sobre `packages/contracts`, que T-05 reemplazará con los contratos de eventos reales.

**Target Platform**: Máquinas de desarrollo (macOS/Linux) con Node 24 y pnpm 11. Despliegue local en kind llega con T-06/T-16 y no se anticipa aquí.

**Project Type**: Monorepo de plataforma interna (workspace pnpm). La única app con contenido real es `apps/web` (Nuxt 4.5, ya existente); las demás son esqueletos compilables y testeables.

**Performance Goals**: SC-001 del spec: install + build + lint + test desde checkout limpio en menos de 15 minutos.

**Constraints**: Regla de No Invención y marcas de bloqueo (FR-015); exactamente cinco servicios (constitución I); aislamiento de dominio ejecutable (constitución II/IV); Gateway sin lógica de negocio (constitución V); ninguna dependencia con vulnerabilidad conocida ni sin soporte; configuración estricta de TypeScript sin ocultar errores (FR-012).

**Scale/Scope**: 7 aplicaciones + 3 paquetes + 3 directorios de docs nuevos + 2 directorios de infra con marca de bloqueo. Cero lógica bancaria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Veredicto | Justificación |
|---|---|---|
| I. Exactly Five Microservices | **Conforming** | El árbol crea exactamente Customer, Account, Transaction, Payment y Notification & Audit. Gateway no es un servicio de negocio. |
| II. One Database Per Service, No Cross-Access | **Conforming** | No hay código de base de datos en este ticket. El aislamiento se garantiza por construcción: cada servicio tiene su propio `.env.example` con su propia base, y la regla de lint de FR-007 prohíbe importar dominio ajeno. |
| III. Databases Outside The Cluster | **Conforming** | No se escriben manifiestos Kubernetes en este ticket (T-16). Las bases serán contenedores Docker locales (T-06), fuera del cluster por definición. |
| IV. Asynchronous Service Communication Only | **Conforming** | Los esqueletos de servicios no exponen endpoints HTTP de negocio; solo health/readiness (permitido explícitamente por T-03). El transporte RabbitMQ vive en `packages/messaging` como adaptador técnico. Ningún servicio importa código de otro. |
| V. Gateway-Only Entry With No Business Logic | **Conforming** | `apps/gateway` es la única aplicación HTTP de entrada; su esqueleto contiene validación de forma y publicación, sin reglas bancarias. |
| VI. Saga For Distributed Operations | **N/A en este ticket** | No hay operaciones distribuidas todavía. La Saga de transferencias se diseña en T-05; `packages/contracts` queda listo para recibirla. |
| VII. Local Kubernetes Deployment | **N/A en este ticket** | `infra/k8s` se crea con marca de bloqueo hacia T-16; no se despliega nada aquí. |
| VIII. SRE From Design | **Conforming (nivel esqueleto)** | Cada esqueleto incluye health check, validación de variables de entorno al arrancar y el sobre base de mensaje con `correlationId`, `causationId` e `idempotencyKey` (regla de T-03). La definición formal de SLI/SLO/SLA llega con T-03; la instrumentación con T-08 a T-12. |

**Estado del gate**: pasa. Sin violaciones que justificar.

## Project Structure

### Documentation (this feature)

```text
specs/002-monorepo-dev-base/
├── plan.md              # Este archivo
├── spec.md              # Especificación (ya existe)
├── research.md          # Fase 0: decisiones de versión y estructura
├── data-model.md        # Fase 1: entidades del monorepo
├── quickstart.md        # Fase 1: verificación ejecutable
├── contracts/
│   └── workspace-contracts.md   # Fase 1: interfaz de comandos y reglas de importación
└── tasks.md             # Fase 2 (/speckit-tasks — no lo crea este comando)
```

### Source Code (repository root)

```text
.
├── apps/
│   ├── gateway/                     # CREAR — esqueleto NestJS, entrada HTTP única
│   └── web/                         # EXISTENTE — se integra al workspace, sin tocar su código
├── services/
│   ├── customer-service/            # CREAR — esqueleto NestJS + 4 capas
│   ├── account-service/             # CREAR
│   ├── transaction-service/         # CREAR
│   ├── payment-service/             # CREAR
│   └── notification-audit-service/  # CREAR
├── packages/
│   ├── contracts/                   # CREAR — DTOs/schemas de transporte; eventos llegan con T-05
│   ├── messaging/                   # CREAR — adaptador técnico RabbitMQ (amqplib)
│   └── tooling/                     # CREAR — configs compartidas TS/ESLint/Prettier/jest
├── infra/
│   ├── docker/                      # CREAR con marca de bloqueo → T-06
│   └── k8s/                         # CREAR con marca de bloqueo → T-16
├── docs/
│   ├── architecture/                # CREAR con marca de bloqueo → T-07
│   ├── events/                      # CREAR con marca de bloqueo → T-07
│   └── operations/                  # CREAR con marca de bloqueo → T-07
├── package.json                     # CREAR — raíz del workspace, scripts globales
├── pnpm-workspace.yaml              # CREAR — workspace + catálogo de versiones fijadas
└── README.md                        # EDITAR — comandos reales del monorepo
```

Estructura interna de cada servicio (las cuatro capas de FR-005):

```text
services/<name>/
├── src/
│   ├── domain/          # entidades, value objects, errores, invariantes (vacío: T-02)
│   ├── application/     # casos de uso, comandos, puertos, políticas (vacío: T-02/T-05)
│   ├── infrastructure/  # PostgreSQL, RabbitMQ, migraciones, configuración
│   ├── interfaces/      # consumers, handlers, health checks, mapeadores
│   └── main.ts          # bootstrap con validación de env (FR-013)
├── test/                # prueba mínima (SC-002)
├── .env.example         # placeholders, sin secretos
├── package.json
├── tsconfig.json        # extiende packages/tooling
└── nest-cli.json
```

**Structure Decision**: la estructura es la literal del ticket T-04 (fuente autorizada). `services/` y `apps/` se mantienen separados como manda el ticket: `apps/` contiene las aplicaciones de cara al exterior (Gateway, web) y `services/` los cinco microservicios de dominio. La regla de aislamiento FR-007 se implementa con `no-restricted-imports` de ESLint por directorio más `tsc --noEmit` estricto; el detalle queda en [contracts/workspace-contracts.md](contracts/workspace-contracts.md).

## Complexity Tracking

Sin violaciones que justificar: el gate de constitución pasa completo (ver tabla). No hay Complexity Tracking.

## Phase 0 Output

Ver [research.md](research.md): ocho decisiones resueltas — gestor y versión de Node, versión de TypeScript (6.x vs 7.x), versiones NestJS/Jest/ESLint, versión de PostgreSQL, versión de RabbitMQ (4.3.x, no 4.2.x), mecanismo de fijación de versiones (pnpm catalog), mecanismo de aislamiento de dominio, y estrategia de marcas de bloqueo. Incluye la tabla de verificación OSV de vulnerabilidades.

## Phase 1 Output

- [data-model.md](data-model.md) — entidades Aplicación, Paquete compartido, Capa, Pendiente bloqueado y Versión fijada, con sus reglas de validación.
- [contracts/workspace-contracts.md](contracts/workspace-contracts.md) — la interfaz del monorepo: comandos raíz y por app, reglas de importación entre capas y entre servicios, contrato de `.env.example`, lista de archivos generados.
- [quickstart.md](quickstart.md) — la guía de verificación ejecutable: un comando por criterio de éxito del spec.

## Constitution Re-Check (post-Phase 1)

Reevaluado tras el diseño: las decisiones de research.md no introducen servicios, bases compartidas, llamadas HTTP entre servicios ni despliegues. La fijación de versiones reduce riesgo (ninguna dependencia sin soporte o con vulnerabilidad conocida) sin afectar ningún principio. **Veredicto: conforming, sin cambios respecto al gate inicial.**
