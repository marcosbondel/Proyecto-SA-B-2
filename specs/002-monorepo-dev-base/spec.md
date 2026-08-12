# Feature Specification: Monorepo y base de desarrollo (T-04)

**Feature Branch**: `feature/T-04`

**Created**: 2026-08-12

**Status**: Draft

**Input**: User description: "dado lo conversado, trabajemos el ticket T-04"

**Ticket origen**: [T-04 Crear el monorepo y la base de desarrollo](https://app.notion.com/p/3b84e0fc979681a9969ed173ce6394b5) — responsable Marcos Bonifasi, entrega 2026-08-16, depende de T-03, bloquea T-05, T-06, T-07 y la implementación de servicios.

**Dependencias no trabajadas**: T-02 (dominio) y T-03 (decisiones) están *In progress* al crear este spec. Las decisiones tecnológicas de T-03 ya están escritas y vigentes en su ticket de Notion, así que se citan como fuente autorizada; lo que T-03 aún no formaliza (ADRs, SLI/SLO/SLA aprobados) no bloquea el esqueleto del monorepo y queda registrado como pendiente con su ticket (FR-015).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clonar, instalar y levantar el monorepo (Priority: P1) 🎯 MVP

Un integrante del equipo clona el repositorio en una máquina limpia y, siguiendo solo el README, instala dependencias, compila todas las aplicaciones, corre lint y ejecuta las pruebas, todo en verde y sin preguntar nada por chat.

**Why this priority**: Es la condición de existencia del ticket. Si el monorepo no instala y construye desde un checkout limpio, ninguna otra historia tiene valor y T-05, T-06, T-07 y los cinco servicios quedan bloqueados.

**Independent Test**: Se entrega solo. En un checkout limpio se ejecutan los comandos documentados (instalar, build, lint, pruebas) y todos terminan con éxito.

**Acceptance Scenarios**:

1. **Given** un checkout limpio del repositorio, **When** se ejecuta el comando de instalación desde la raíz, **Then** todas las aplicaciones y paquetes quedan instalados sin pasos manuales adicionales.
2. **Given** el monorepo instalado, **When** se ejecuta el build global, **Then** las siete aplicaciones (Gateway, web, cinco servicios) y los paquetes compartidos compilan sin error.
3. **Given** el monorepo instalado, **When** se ejecutan lint y pruebas desde la raíz, **Then** corren sobre todas las aplicaciones y terminan en verde.
4. **Given** la aplicación web existente (`apps/web/`), **When** se integra al workspace del monorepo, **Then** su instalación y build siguen pasando igual que antes de la integración.

---

### User Story 2 - Desarrollar un servicio sin tocar a los demás (Priority: P2)

El responsable de un servicio trabaja dentro de su directorio con la estructura de Clean Architecture ya creada (domain, application, infrastructure, interfaces), ejecuta build, lint y pruebas solo de su servicio, y no necesita importar código de dominio de otro servicio para nada.

**Why this priority**: El propósito declarado del ticket es que los servicios se desarrollen en paralelo sin perder aislamiento. Es P2 porque primero el monorepo tiene que existir (US1), pero es lo que convierte la estructura en útil y no en decoración.

**Independent Test**: Se entrega solo. Se entra al directorio de un servicio, se ejecutan sus comandos de build, lint y prueba, y se verifica que ningún import cruza hacia el dominio de otro servicio.

**Acceptance Scenarios**:

1. **Given** un servicio cualquiera, **When** se inspecciona su estructura, **Then** contiene las cuatro capas de Clean Architecture: `domain`, `application`, `infrastructure` e `interfaces`, con las dependencias apuntando hacia el dominio.
2. **Given** un cambio dentro de un servicio, **When** se compila y prueba ese servicio, **Then** no se requiere importar ni compilar código de dominio de otro servicio.
3. **Given** un desarrollador que intenta importar el dominio de otro servicio, **When** corre lint o compilación, **Then** la regla de aislamiento lo rechaza de forma verificable.
4. **Given** los cinco servicios, **When** se listan, **Then** son exactamente Customer, Account, Transaction, Payment y Notification & Audit, ni más ni menos.

---

### User Story 3 - Compartir contratos sin acoplar dominio (Priority: P2)

El equipo del Gateway y los equipos de servicios consumen el paquete de contratos compartidos para conocer la forma de los mensajes, sin que ese paquete contenga ni arrastre lógica de negocio de ningún servicio.

**Why this priority**: Los contratos de eventos son la única interfaz entre servicios (regla de arquitectura de T-03). El paquete debe existir y compilar desde el inicio para que T-05 lo llene; su contenido de eventos reales llega con T-05.

**Independent Test**: Se entrega solo. El paquete de contratos compila, y un ejemplo importa un contrato desde el Gateway y desde un servicio sin importar dominio ajeno.

**Acceptance Scenarios**:

1. **Given** el paquete de contratos, **When** se compila, **Then** termina en verde y produce un artefacto consumible por las demás aplicaciones.
2. **Given** el Gateway o un servicio, **When** importa un contrato del paquete, **Then** no necesita importar ninguna entidad, repositorio, caso de uso ni regla de negocio de otro servicio.
3. **Given** el contenido del paquete de contratos, **When** se revisa, **Then** solo contiene schemas y DTOs de transporte, y los contratos de eventos del dominio quedan marcados como pendientes de T-05.

---

### User Story 4 - Configurar y entender el entorno local (Priority: P3)

Un integrante nuevo configura su entorno copiando los `.env.example` de cada aplicación, y al arrancar una aplicación con variables obligatorias faltantes recibe un error claro en lugar de un fallo silencioso. Sabe además qué archivos del repo son generados y no debe editar a mano.

**Why this priority**: Es calidad de vida y prevención de errores de entorno. Es P3 porque el monorepo ya funciona sin esto, pero su ausencia se paga cada vez que alguien configura su máquina.

**Independent Test**: Se entrega solo. Se arranca una aplicación sin una variable obligatoria y el arranque falla nombrando la variable; la lista de archivos generados está escrita.

**Acceptance Scenarios**:

1. **Given** una aplicación del monorepo, **When** se revisa su directorio, **Then** existe un `.env.example` con nombres y valores de muestra (sin secretos reales).
2. **Given** una aplicación con una variable obligatoria ausente, **When** se intenta arrancar, **Then** falla inmediatamente con un mensaje que nombra la variable faltante.
3. **Given** un archivo generado por herramientas (lockfiles, artefactos de build, código generado), **When** se consulta la documentación del monorepo, **Then** aparece listado como generado y no editable a mano.
4. **Given** el README de desarrollo local, **When** un integrante lo sigue, **Then** encuentra los comandos exactos y el orden de arranque local de las aplicaciones.

---

### Edge Cases

- **La aplicación web ya existe con su propio lockfile.** Integrarla al workspace no debe romper su instalación ni su build; si la integración rompe algo, el hallazgo se reporta y se ajusta la integración antes que forzar el cambio.
- **Los paquetes compartidos aún no tienen consumidores reales.** `apps/packages/contracts`, `apps/packages/messaging` y `apps/packages/tooling` deben compilar aunque su contenido sea mínimo; el contenido de eventos llega con T-05.
- **Las decisiones de T-03 no están formalizadas en ADRs.** El stack (TypeScript, NestJS, pnpm, RabbitMQ, PostgreSQL) está vigente en el ticket T-03 de Notion y se toma como fuente; la formalización en ADRs queda en T-03 y no bloquea este esqueleto.
- **El dominio no está definido (T-02 sin trabajar).** Las capas `domain` de los servicios quedan vacías de entidades: se crea la estructura de capas, no el modelo. Cualquier necesidad de modelo que aparezca se registra como tarea de T-02/T-05, no se inventa.
- **Variables de entorno con valores reales.** Los `.env.example` llevan solo nombres y placeholders; ningún secreto real se escribe en el repo (regla ya vigente en `docs/SECURITY.md`).
- **Los directorios `infra/` y los `docs/` nuevos no tienen contenido final.** `infra/docker` e `infra/k8s` dependen de T-06 y T-16; `docs/architecture`, `docs/events` y `docs/operations` dependen de T-07. Se crean con marca de bloqueo, no con contenido inventado.
- **Errores de compilación ocultos por configuración laxa.** La configuración compartida de TypeScript/ESLint no debe desactivar chequeos para hacer pasar el build; si el esqueleto no compila en estricto, se corrige el esqueleto.

## Requirements *(mandatory)*

### Functional Requirements

**Estructura del monorepo**

- **FR-001**: El repositorio MUST organizarse como monorepo con la estructura: `apps/gateway`, `apps/web`, `apps/services/customer-service`, `apps/services/account-service`, `apps/services/transaction-service`, `apps/services/payment-service`, `apps/services/notification-audit-service`, `apps/packages/contracts`, `apps/packages/messaging`, `apps/packages/tooling`, `infra/docker`, `infra/k8s`, `docs/architecture`, `docs/events`, `docs/operations`. Todo el código MUST vivir bajo `apps/`; la raíz del repositorio MUST contener solo configuración del workspace.
  > **Cambio de estructura, 2026-08-12.** La versión original de FR-001 ponía `services/*` y `packages/*` en la raíz, tal como los lista el ticket T-04. El responsable decidió durante la implementación que todo el código cuelgue de `apps/`. Los tres niveles del ticket se conservan, anidados: aplicaciones de cara al exterior en `apps/`, microservicios en `apps/services/`, paquetes compartidos en `apps/packages/`. Ningún otro requisito cambia — el conteo de servicios, el aislamiento y los comandos raíz son los mismos.
- **FR-002**: El monorepo MUST contener exactamente los cinco servicios del dominio (Customer, Account, Transaction, Payment, Notification & Audit), cada uno como aplicación independiente con su propio build.
- **FR-003**: La aplicación web existente (`apps/web/`, Nuxt 4.5) MUST integrarse al workspace del monorepo conservando su instalación y build funcionales.
- **FR-004**: El workspace MUST exponer comandos raíz que operan sobre todo el monorepo y comandos equivalentes por aplicación.

**Clean Architecture por servicio**

- **FR-005**: Cada servicio MUST contener las cuatro capas: `domain` (entidades, value objects, errores, invariantes), `application` (casos de uso, comandos, puertos, políticas), `infrastructure` (PostgreSQL, RabbitMQ, migraciones, configuración) e `interfaces` (consumers, handlers de mensajes, health checks, mapeadores).
- **FR-006**: Las dependencias entre capas MUST apuntar hacia el dominio; ningún adaptador de infraestructura o interfaces MUST ser importado por la capa de aplicación o de dominio.
- **FR-007**: Ningún servicio MUST importar código de dominio de otro servicio; el aislamiento MUST ser verificable de forma ejecutable (regla de lint o compilación).

**Paquetes compartidos**

- **FR-008**: `apps/packages/contracts` MUST contener únicamente schemas y DTOs de transporte, y MUST NOT contener entidades, repositorios, casos de uso ni reglas de negocio de ningún servicio.
- **FR-009**: `apps/packages/contracts` MUST compilar y ser consumible por el Gateway y por los servicios.
- **FR-010**: `apps/packages/messaging` MUST limitarse a adaptadores técnicos reutilizables; cada servicio conserva la decisión sobre sus casos de uso y políticas de dominio.

**Herramientas y scripts**

- **FR-011**: La raíz MUST ofrecer scripts para: instalar, desarrollar, lint, formato, pruebas unitarias, pruebas de contrato y build.
- **FR-012**: La configuración de TypeScript, ESLint y Prettier MUST ser común y compartida, y MUST NOT ocultar errores de compilación para hacer pasar el build.
- **FR-013**: Cada aplicación MUST tener un `.env.example` con nombres y placeholders (sin secretos reales) y MUST validar las variables obligatorias al arrancar, fallando con un mensaje que nombre la variable faltante.
  > **Cumplimiento parcial aceptado, 2026-08-12.** Las siete aplicaciones tienen `.env.example`. La validación al arrancar la implementan seis: Gateway y los cinco servicios. `apps/web` no la tiene — implementarla exige modificar el código de la aplicación Nuxt, que FR-018 prohíbe, y hoy la web no declara ninguna variable obligatoria al arrancar, así que no hay nada que validar. **El responsable aceptó la brecha como deuda** en lugar de romper FR-018 por una validación vacía. Queda como TD-011 y se cierra en el ticket que conecte el frontend con el Gateway, cuando `NUXT_PUBLIC_API_BASE_URL` pase a ser obligatoria de verdad.
- **FR-014**: MUST existir un README de desarrollo local con los comandos exactos y el orden de arranque, y MUST documentarse qué archivos son generados y no editables a mano.

**Trazabilidad de pendientes**

- **FR-015**: Todo entregable que dependa de un ticket no trabajado MUST marcarse como bloqueado indicando qué falta, quién lo entrega y en qué ticket llega: contratos de eventos (T-05), ADRs y formalización de decisiones (T-03), contenido de `docs/architecture`, `docs/events` y `docs/operations` (T-07), infraestructura local y manifiestos (T-06, T-16), modelo de secretos (T-03/T-06). Los pendientes que este ticket detecte y no resuelva MUST registrarse en `docs/TECH_DEBT.md`.

**Límites**

- **FR-016**: Este trabajo MUST NOT implementar lógica bancaria ni reglas de negocio de ningún servicio.
- **FR-017**: Este trabajo MUST NOT crear manifiestos finales de Kubernetes ni incorporar CI/CD o despliegues cloud.
- **FR-018**: Este trabajo MUST NOT modificar la aplicación web más allá de lo necesario para integrarla al workspace.

### Key Entities

- **Aplicación**: una unidad ejecutable del monorepo (Gateway, web, uno de los cinco servicios). Atributos: nombre, directorio, comandos propios, `.env.example`, prueba mínima.
- **Paquete compartido**: una unidad de código reutilizable sin ejecutable propio (`contracts`, `messaging`, `tooling`). Atributos: nombre, contenido permitido, consumidores.
- **Capa de servicio**: una de las cuatro divisiones de Clean Architecture dentro de un servicio. Atributos: nombre, responsabilidad, dependencias permitidas.
- **Pendiente bloqueado**: un entregable diferido a otro ticket. Atributos: qué falta, responsable, ticket destino.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Desde un checkout limpio, la instalación, el build global, lint y las pruebas completan en verde siguiendo solo el README, en menos de 15 minutos en una máquina de desarrollo típica.
- **SC-002**: Las siete aplicaciones (Gateway, web, cinco servicios) tienen cada una un comando de build y al menos una prueba mínima que pasa.
- **SC-003**: La verificación ejecutable de aislamiento demuestra que un servicio no puede importar el dominio de otro: el intento falla en lint o compilación.
- **SC-004**: El paquete de contratos compila y la evidencia incluye un ejemplo de importación desde el Gateway y desde un servicio sin importar dominio ajeno.
- **SC-005**: Los comandos de lint y pruebas funcionan tanto de forma global como por aplicación, con salida en verde adjunta como evidencia.
- **SC-006**: El 100% de los pendientes heredados de tickets no trabajados está marcado con responsable y ticket destino; cero pendientes sin marcar.
- **SC-007**: La aplicación web conserva instalación y build en verde tras la integración al workspace, con la salida adjunta como evidencia.
- **SC-008**: T-05, T-06 y T-07 pueden iniciarse usando solo el contenido del monorepo y su documentación, sin solicitar contexto adicional por chat.

## Assumptions

- El stack se toma de las decisiones vigentes del ticket T-03 en Notion (TypeScript, NestJS, pnpm workspaces, RabbitMQ, PostgreSQL, Docker, kind), escritas por el responsable de T-03 y T-04, que es la misma persona. La formalización de esas decisiones en ADRs queda en T-03 y no bloquea este esqueleto.
- T-02 (límites de dominio) no está trabajado; los servicios se crean con la estructura de capas pero sin entidades ni casos de uso de dominio. Los nombres de los cinco servicios sí están fijados por el enunciado y el ticket.
- El gestor de paquetes del workspace es pnpm, por ser el que ya usa `apps/web/`; no se introduce una segunda herramienta.
- Los contratos de eventos del dominio (contenido de `apps/packages/contracts`) llegan con T-05; este ticket entrega el paquete compilable con su estructura y un ejemplo mínimo de DTO de transporte.
- `infra/docker` e `infra/k8s` se crean como directorios con marca de bloqueo hacia T-06/T-16; no se escriben manifiestos finales.
- `docs/architecture`, `docs/events` y `docs/operations` se crean con marca de bloqueo hacia T-07; la documentación duradera existente (`docs/*.md`) se actualiza solo donde el estado del repo cambia (por ejemplo `docs/TECH_DEBT.md` y, si aplica, el índice de `AGENTS.md`).
- La validación de variables de entorno al arrancar usa el mecanismo estándar del framework de cada aplicación; el modelo de secretos completo llega con T-03/T-06.
- Este ticket no escribe la configuración de pruebas de contrato completa: deja el script y una prueba de contrato mínima de ejemplo que T-05 reemplazará con los contratos reales.
- Documentación duradera en inglés (convención del repo); los artefactos bajo `specs/` se redactan en español como documentos de trabajo.

## Dependencies

- El enunciado del proyecto: §4.4 (monorepo obligatorio, código separado por microservicio, p. 14), §4.3 (TypeScript y NestJS permitidos, p. 13), §8.1 (exactamente cinco microservicios, p. 19).
- Las decisiones tecnológicas vigentes registradas en el ticket T-03 de Notion.
- La aplicación web existente en `apps/web/` y su lockfile.
- La constitución del repositorio (ocho principios, v1.0.0), en particular: I (cinco servicios), II (aislamiento de datos), IV (comunicación asíncrona), V (Gateway sin lógica de negocio).
