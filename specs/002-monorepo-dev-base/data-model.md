# Phase 1 — Data Model: Monorepo y base de desarrollo (T-04)

Entidades del dominio del ticket (no del dominio bancario — eso es T-02). Cada una con sus reglas de validación ejecutables.

---

## Aplicación

Una unidad ejecutable del monorepo con build y prueba propios.

| Atributo | Regla |
|---|---|
| `name` | Uno de: `gateway`, `web`, `customer-service`, `account-service`, `transaction-service`, `payment-service`, `notification-audit-service` |
| `directory` | `apps/gateway`, `apps/web`, o `services/<name>` |
| `build` | Script `build` presente en su `package.json` y alcanzable desde la raíz |
| `test` | Al menos una prueba que pasa (SC-002) |
| `envExample` | `.env.example` con nombres y placeholders, sin valores reales |

**Invariantes**:

- Existen **exactamente siete** aplicaciones: las dos de `apps/` más los cinco servicios (constitución I).
- Toda aplicación compila con el TypeScript estricto compartido (FR-012).
- Toda aplicación valida sus variables obligatorias al arrancar y falla nombrando la faltante (FR-013).

---

## Paquete compartido

Una unidad de código reutilizable sin ejecutable propio.

| Atributo | Regla |
|---|---|
| `name` | Uno de: `contracts`, `messaging`, `tooling` |
| `directory` | `packages/<name>` |
| `contenidoPermitido` | Ver restricciones por paquete abajo |
| `consumidores` | Cualquier aplicación, salvo restricción explícita |

**Restricciones por paquete** (FR-008, FR-010):

- `contracts`: solo schemas y DTOs de transporte. **Prohibido**: entidades, repositorios, casos de uso, reglas de negocio. Debe compilar y ser consumible por Gateway y servicios (FR-009).
- `messaging`: solo adaptadores técnicos reutilizables (conexión, reconexión, publicación, consumo, sobre base). **Prohibido**: decisiones de dominio, nombres de eventos de negocio (esos llegan con T-05).
- `tooling`: configuración compartida de TypeScript, ESLint, Prettier y Jest. **Prohibido**: código de runtime.

---

## Capa de servicio

Una de las cuatro divisiones de Clean Architecture dentro de cada servicio (FR-005).

| Capa | Contiene | Puede depender de |
|---|---|---|
| `domain` | Entidades, value objects, errores, invariantes | Nada (vacía hasta T-02) |
| `application` | Casos de uso, comandos, puertos, políticas | `domain`, `contracts` |
| `infrastructure` | PostgreSQL, RabbitMQ, migraciones, configuración | `application`, `domain`, `messaging`, `contracts` |
| `interfaces` | Consumers, handlers de mensajes, health checks, mapeadores | `application`, `contracts` |

**Invariantes**:

- Las dependencias apuntan hacia el dominio; `domain` y `application` nunca importan de `infrastructure` ni de `interfaces` (FR-006).
- Ninguna capa importa de la capa de **otro servicio** (FR-007). La violación falla en lint.

---

## Pendiente bloqueado

Un entregable diferido a otro ticket (FR-015).

| Atributo | Regla |
|---|---|
| `ubicación` | Ruta concreta del archivo o directorio |
| `qué falta` | Descripción en una línea |
| `responsable` | Nombre del owner que lo entrega |
| `ticket destino` | T-XX que lo resuelve |

**Invariante**: ningún pendiente existe sin los cuatro atributos (SC-006). El formato escrito es `> **Blocked**: … Owner: … Arrives with: T-XX`.

---

## Versión fijada

Una dependencia del toolchain con su versión exacta y su evidencia de soporte.

| Atributo | Regla |
|---|---|
| `paquete` | Nombre en el registro npm (o imagen Docker para PostgreSQL/RabbitMQ) |
| `versión` | Fijada en el `catalog` de `pnpm-workspace.yaml`, sin rango |
| `soporte` | Fuente y fecha límite de soporte verificada |
| `vulnerabilidades` | Conteo OSV a la fecha de verificación; debe ser 0 para entrar al catálogo |

**Invariante**: toda dependencia compartida aparece en el catálogo con vulnerabilidades conocidas en cero y línea de soporte vigente (tabla completa en [research.md R8](research.md)). La re-verificación es obligatoria en cada actualización.

---

## Diagrama de dependencias permitidas

```text
apps/gateway ──────────────┐
                           ├──> apps/packages/contracts
apps/services/* ────────────────┤         ▲
                           ├──> apps/packages/messaging
                           └──> apps/packages/tooling (dev)

apps/services/<A> ──✗──> apps/services/<B>     (prohibido, lint lo rechaza)
application ──✗──> infrastructure    (prohibido, lint lo rechaza)
domain ──✗──> cualquier otra capa    (prohibido, lint lo rechaza)
```
