# Contracts — Interfaz del monorepo (T-04)

El monorepo es la interfaz entre el equipo y el código. Este contrato fija los comandos, las reglas de importación y el formato de configuración que las siete aplicaciones y los tres paquetes respetan. Las specs de servicios (T-08 a T-12) **reutilizan esta estructura, no inventan layouts incompatibles** (nota del ticket).

---

## 1. Comandos raíz (obligatorios, FR-011)

Desde la raíz del repositorio:

| Comando | Efecto | Verifica |
|---|---|---|
| `pnpm install` | Instala todo el workspace | SC-001 |
| `pnpm build` | Compila las 7 aplicaciones y los 3 paquetes | SC-001, SC-002 |
| `pnpm lint` | Lint de todo el monorepo, incluidas las reglas de aislamiento | SC-003 |
| `pnpm test` | Pruebas unitarias de todas las aplicaciones | SC-005 |
| `pnpm test:contract` | Prueba de contrato mínima sobre `packages/contracts` | SC-004 |
| `pnpm format` | Prettier sobre todo el repo | — |
| `pnpm dev` | Arranque local documentado en README (orden en §4) | — |

Todo comando raíz tiene su equivalente por aplicación vía `pnpm --filter <nombre> <comando>` (FR-004). Ejemplo: `pnpm --filter customer-service test`.

## 2. Reglas de importación (FR-006, FR-007, SC-003)

Implementadas con `no-restricted-imports` de ESLint por directorio, más `tsc --noEmit` estricto. Una violación **falla el lint**, no solo advierte.

| Desde | Puede importar | Prohibido importar |
|---|---|---|
| `services/<A>/src/domain/**` | nada fuera de `domain` | todo lo demás |
| `services/<A>/src/application/**` | `domain`, `@bank/contracts` | `infrastructure`, `interfaces`, otros servicios |
| `services/<A>/src/infrastructure/**` | `application`, `domain`, `@bank/contracts`, `@bank/messaging` | `interfaces`, otros servicios |
| `services/<A>/src/interfaces/**` | `application`, `@bank/contracts` | `infrastructure` (salvo wiring en `main.ts`), otros servicios |
| `apps/gateway/src/**` | `@bank/contracts`, `@bank/messaging` | `services/**` (cualquier capa) |
| `packages/contracts/**` | nada externo al paquete | dominio de cualquier servicio |
| `packages/messaging/**` | `@bank/contracts` (sobre base) | dominio de cualquier servicio |

**Ejemplo que debe fallar** (usado como prueba de SC-003 en quickstart):

```ts
// services/account-service/src/application/any.use-case.ts
import { CustomerEntity } from '../../../customer-service/src/domain/customer.entity';
// → error de lint: cross-service domain import
```

## 3. Contrato de configuración de entorno (FR-013)

- Cada aplicación tiene `.env.example` con **nombres y placeholders**, nunca valores reales (regla vigente de `docs/SECURITY.md`).
- El bootstrap (`main.ts`) valida las variables obligatorias antes de levantar el servidor; si falta una, el proceso sale con código distinto de cero y un mensaje que la nombra. Implementación de referencia: `class-validator` sobre un objeto de configuración tipado.
- Variables mínimas por servicio: `DATABASE_URL` (base propia), `RABBITMQ_URL`, `PORT` (solo health/readiness), `NODE_ENV`.
- Gateway: `PORT`, `RABBITMQ_URL`, `NODE_ENV`. **Sin** `DATABASE_URL` (constitución V: el Gateway no lee bases).

## 4. Orden de arranque local (README)

1. `pnpm install`
2. Copiar `.env.example` → `.env` por aplicación y rellenar valores locales.
3. Infraestructura local (RabbitMQ, PostgreSQL) — **bloqueado hasta T-06**; hasta entonces las aplicaciones arrancan en modo health-check sin conexión.
4. `pnpm --filter <app> dev` por aplicación, o `pnpm dev` para el conjunto documentado.

## 5. Archivos generados (no editables a mano, FR-014)

| Archivo | Generado por |
|---|---|
| `pnpm-lock.yaml` | `pnpm install` |
| `**/dist/**`, `**/.nuxt/**`, `**/.output/**` | builds |
| `**/coverage/**` | pruebas |
| `**/node_modules/**` | instalación |
| `apps/web/.nuxt/tsconfig*.json` | `nuxt prepare` (postinstall) |

## 6. Catálogo de versiones y regla de actualización (R8)

- Las versiones compartidas viven **solo** en el `catalog` de `pnpm-workspace.yaml`; los `package.json` referencian `catalog:`.
- Toda entrada del catálogo tiene vulnerabilidades conocidas en cero según OSV y línea de soporte vigente (tabla de [research.md](../research.md)).
- Al actualizar una dependencia: consultar OSV (`api.osv.dev/v1/query`) y correr `pnpm audit`; una dependencia con vulnerabilidad abierta no entra al catálogo.
