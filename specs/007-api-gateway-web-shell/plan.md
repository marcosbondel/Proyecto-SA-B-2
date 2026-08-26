# Implementation Plan: API Gateway y shell de frontend (T-15)

**Branch**: `feature/T-15` | **Date**: 2026-08-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-api-gateway-web-shell/spec.md`

## Summary

Convertir el esqueleto de `apps/gateway/` en el único punto HTTP del sistema —
nueve rutas funcionales más salud y disponibilidad, autenticación por JWT,
autorización por la matriz D-06, publicación al broker con los contratos de
T-05, request/reply con techo de cinco segundos, cinco tipos de error y la foto
del documento depositada en MinIO— y convertir `apps/web/` de la pantalla de
bienvenida de Nuxt en el shell que T-16 a T-20 heredan: layout, navegación
filtrada por rol, tema, sesión, `useGatewayApi` y cuatro componentes
compartidos.

El enfoque técnico se apoya en que **casi toda la mecánica difícil ya existe**.
`@bank/messaging` ya trae `ReplyRegistry` con el plazo de cinco segundos,
`ReplyTimeoutError` con el mensaje de "no fue cancelada", la escalera de
reintentos y el dead-lettering. `@bank/contracts` ya trae los 42 contratos, el
sobre, la topología y `defineContract`, que rechaza en tiempo de carga un
catálogo mal formado. El Gateway no inventa nada de eso: lo consume.

Quedan tres piezas que hoy **no** existen y que este plan añade:

1. Una **cola de respuestas exclusiva** por instancia. `MessageBroker.subscribe`
   declara siempre una cola durable con escalera de reintentos y DLQ, que es lo
   correcto para trabajo y lo incorrecto para respuestas. Se añade a
   `@bank/messaging` la capacidad de suscribirse a una cola exclusiva y
   efímera, sin escalera.
2. El campo opcional **`paymentScenario`** en `transfer.requested.v1`
   (FR-021b), aditivo y retrocompatible.
3. El **depósito de la foto** en el almacenamiento de objetos, que ADR-012 le
   asigna al Gateway y que ningún código del repositorio hace todavía.

## Visual Design Check

**Fuente inspeccionada.** Proyecto Claude Design
`4a48d652-297f-4351-9170-d8049427e897` — "bonking | AI-native banking
platform". Archivos leídos: `bonking.dc.html` (215 KB, 2 259 líneas),
`support.js` y `uploads/DESIGN.md`.

**`support.js` no es una fuente visual.** Es el runtime generado de Claude
Design (`dc-runtime`), un artefacto de compilación. No contiene ninguna decisión
de diseño y no se porta.

**Qué informa `bonking.dc.html`.** El prototipo enumera cada pantalla y cada
estado transversal como una entrada independiente. Las que caen dentro de T-15:

| Entrada del prototipo | Qué informa en T-15 |
| --- | --- |
| `show.login`, `v.loginError`, `v.loginInactive` | Pantalla de inicio de sesión y sus rechazos |
| `show.activate`, `v.activateOk`, `v.activateExpired` | Veredicto de verificación de correo (FR-015b) |
| `show.dash`, `show.cashierDash`, `show.adminDash` | Tres inicios por rol — confirman la navegación filtrada de FR-041e |
| `show.app`, `show.public`, `show.notFound` | Armazón, zona pública y ruta inexistente |
| `v.txPending`, `v.txDone`, `v.txFailed`, `v.txTimeout` | Los cuatro estados de `SharedAsyncStateAlert` que el prototipo sí define |
| `up.idle`, `up.loading`, `up.done`, `up.error` | Estados de la carga de la foto del documento |
| Bloque `correlationId` con acción de copiar | `SharedCorrelationIdBadge` |
| `show.reg1`–`show.reg3`, `show.regSent` | Registro por pasos — esqueleto en T-15, pantallas en T-16 |

El prototipo trae la **copia literal** de los estados asíncronos, incluida la
del vencimiento del plazo: *"La operación sigue en el sistema pero no recibimos
confirmación en el tiempo esperado. No asumas que falló: guarda el
transactionId y actualiza el estado. Reintentar es seguro, la operación es
idempotente y no se duplica."* Es exactamente FR-026 escrito para una persona,
y se porta tal cual.

### Tres discrepancias, y qué se hace con cada una

**1. La paleta — resuelta, y cambia un documento.** `docs/DESIGN.md` del
repositorio declara `Bank USAC Core` con primario `#002db5` y superficie
`#fbf8ff`; el proyecto de diseño declara `bonking. Core` con primario `#0b0c10`
y superficie `#f6f6f7`. El resto de los dos documentos —tipografía, rejilla de
8 px, radios, cifras tabulares, formato `es-GT`— es idéntico palabra por
palabra: solo cambiaron las secciones de color. `#2A53FD` no aparece ni una vez
en los 215 KB del prototipo.

**Decisión del responsable (2026-08-24): se implementa únicamente la paleta de
Claude Design y `docs/DESIGN.md` se actualiza a la revisión `bonking. Core`.**
Sin esto, ninguna captura de T-15 a T-20 podría coincidir con la referencia que
el propio repositorio declara obligatoria. La actualización del documento es una
tarea de esta feature (T-15 no rediseña: transcribe la revisión ya aprobada por
el dueño del producto).

**2. El rechazo de inicio de sesión — el prototipo pierde.** `v.loginInactive`
muestra "Tu cuenta aún no está activa" como estado distinto de "Usuario o
contraseña incorrectos". FR-013, SC-002 y el criterio 9 del propio ticket exigen
que los tres rechazos sean **indistinguibles**. Se implementa el rechazo
genérico y se registra la discrepancia en la evidencia, como manda
`docs/DESIGN.md`.

Vale decir por qué el prototipo es defendible y aun así no se adopta: para
llegar a `activationPending` hay que haber acertado la contraseña, de modo que
decírselo a quien ya la sabe no es un oráculo de enumeración. Pero el ticket lo
pide explícitamente y la spec está aprobada; cambiarlo es una decisión del
equipo, no de esta implementación.

**3. El quinto estado no existe en el prototipo.** `bonking.dc.html` define
cuatro estados asíncronos —pendiente, éxito, rechazo, vencimiento— y ninguno
para **broker no disponible**, que FR-027 sí exige. Se compone en el mismo
idioma: la familia ámbar `#B4740A` / `#7A4F06` del vencimiento, con copia propia
que diga que el sistema no pudo aceptar la solicitud y que reintentar es seguro.
Queda registrado como adición intencional.

**Cómo se produce la evidencia visual.** Capturas del shell levantado con
`pnpm --filter web dev`: la navegación con una sesión de cada uno de los tres
roles, la pantalla de inicio de sesión con su rechazo genérico, las dos
resoluciones de la verificación de correo, y la página de demostración con las
cuatro piezas compartidas y los cinco estados. Cada captura se compara con la
entrada correspondiente de `bonking.dc.html` y la nota de revisión la nombra.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node 24.19.0 (`.nvmrc`), pnpm 11.21.0

**Primary Dependencies**: NestJS 11 (`@nestjs/common`, `@nestjs/core`,
`@nestjs/platform-express`), `@nestjs/jwt` y `passport-jwt` (ADR-010),
`@nestjs/swagger` para emitir el contrato OpenAPI, `@aws-sdk/client-s3` para el
depósito de la foto (ADR-012), `class-validator`/`class-transformer` y `zod`
vía `@bank/contracts`, `amqp-connection-manager` vía `@bank/messaging`. En el
frontend: Nuxt 4.5, `@nuxt/ui` 4.10, Tailwind 4, `vue-router` 5.

**Storage**: **Ninguno propio.** El Gateway no declara `DATABASE_URL` y no
tiene cliente de base de datos (constitución II y V, FR-002). Su única escritura
persistente es el depósito de la foto en el bucket
`customer-identity-documents` de MinIO, que ADR-012 define como *búfer de
transferencia*, no como estado de negocio.

**Testing**: Jest en `apps/gateway/`, con RabbitMQ real de T-06 y servicios
simulados que responden sobre el broker. `node --test` en `apps/web/` para la
lógica pura —normalización de errores, formato de moneda, filtrado por rol—
porque el frontend no tiene marco de pruebas de componentes (TD-010).
`pnpm test:contract` cubre la enmienda de `transfer.requested.v1`.

**Target Platform**: contenedores Linux; Kubernetes local llega en T-16 y
siguientes. Para T-15, `pnpm dev` contra la infraestructura de T-06.

**Project Type**: servicio web (NestJS) más aplicación web (Nuxt), dentro del
monorepo pnpm existente.

**Performance Goals**: no hay objetivo de rendimiento en el ticket. El único
número duro es el **techo de cinco segundos** para una respuesta esperada
(FR-023), que ya está fijado en `DEFAULT_REPLY_TIMEOUT_MS`.

**Constraints**: sin base de datos, sin cliente HTTP hacia servicios internos,
sin lógica de negocio, sin credenciales en el repositorio. La foto no supera
5 MB y nunca viaja por el broker. El JWT es HS256, una hora, sin renovación, y
se firma y verifica solo en el Gateway.

**Scale/Scope**: nueve rutas funcionales más dos técnicas; tres roles; cuatro
módulos de navegación; cuatro componentes compartidos; cinco tipos de error.
Los cinco servicios que consumen estos mensajes todavía no existen.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Verdicto | Fundamento |
| --- | --- | --- |
| **I. Exactamente cinco microservicios** | **Conforma** | No se añade ningún desplegable. El Gateway y el frontend ya existen en el monorepo y no son microservicios de dominio. |
| **II. Una base por servicio, sin acceso cruzado** | **Conforma** | El Gateway no tiene base de datos ni la declara. El bucket de MinIO no es una base: no se consulta para decidir nada y el dueño de la foto sigue siendo Customer Service (ADR-012). |
| **III. Bases fuera del clúster** | **N/A** | Esta feature no despliega ninguna base. |
| **IV. Comunicación asíncrona únicamente** | **Conforma** | Toda salida del Gateway hacia un servicio es una publicación al broker. Request/reply asíncrono sobre el broker está explícitamente permitido. Cero clientes HTTP internos, verificado por búsqueda estática (FR-003, SC-007). |
| **V. Entrada solo por el Gateway, sin lógica de negocio** | **Conforma, y es el principio que esta feature materializa** | El Gateway valida forma, autentica, autoriza por rol y enruta. No calcula saldos, no aprueba operaciones, no orquesta la Saga y no reinterpreta códigos de fallo. Firmar un token sobre reclamaciones que decidió Customer Service es autenticación, no dominio (ADR-010). Esperar un evento correlacionado para responder la verificación de correo es correlación, no decisión (FR-015c). |
| **VI. Saga para operaciones distribuidas** | **Conforma** | El Gateway inicia la Saga publicando `transfer.requested.v1` y no participa en ella. `paymentScenario` fuerza un desenlace de demostración, y quien lo obedece es Transaction Service, no el Gateway (FR-021c). |
| **VII. Despliegue local en Kubernetes** | **N/A en esta feature** | El despliegue es T-16 y siguientes. El Dockerfile del Gateway es un entregable de T-15 y no contradice el principio. |
| **VIII. SRE desde el diseño** | **Conforma** | Idempotencia: clave del cliente trasladada al sobre sin reinterpretar (FR-020). Reintentos: la escalera 1s/5s/30s de `@bank/messaging`, más el hecho de que el Gateway **no** reintenta por su cuenta y deja la decisión a quien llamó. Errores: cinco tipos con forma común, sin filtración (FR-027, FR-028). Consistencia eventual: ninguna ruta asíncrona declara éxito, y el frontend tampoco (FR-043). `correlationId`: generado o conservado, devuelto en toda respuesta incluidas las de error, y propagado en el sobre (FR-018, FR-019). |

**Resultado del gate: pasa, sin violaciones que justificar.** La sección
Complexity Tracking queda vacía a propósito.

Una nota sobre el principio V, porque es donde esta feature se juega su
calificación (criterio 2.4 del enunciado): el riesgo real no es añadir una regla
de negocio a propósito, sino añadirla sin darse cuenta al mapear un código de
fallo a un estado HTTP. La mitigación está en el diseño: el mapeo es una tabla
de datos, no una cadena de condicionales, y el código de fallo del catálogo
viaja intacto al cuerpo de la respuesta (FR-030).

## Project Structure

### Documentation (this feature)

```text
specs/007-api-gateway-web-shell/
├── plan.md              # Este archivo
├── spec.md              # La especificación aprobada
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/           # Fase 1
│   ├── http-routes.md          # Las once rutas, sus cargas y sus respuestas
│   ├── error-contract.md       # Los siete códigos y su mapeo a HTTP
│   ├── authorization-matrix.md # D-06 proyectada sobre rutas y navegación
│   └── shell-contract.md       # Lo que T-16 a T-20 heredan del shell
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 — la crea /speckit-tasks, no este comando
```

### Source Code (repository root)

```text
apps/gateway/
├── openapi/
│   └── gateway.v1.yaml              # NUEVO — el contrato versionado (FR-046)
├── src/
│   ├── domain/                      # Se queda vacío. El Gateway no tiene dominio.
│   │   └── README.md
│   ├── application/                 # Puertos y casos de uso sin framework
│   │   ├── request-envelope.ts      # Existe
│   │   ├── ports/
│   │   │   ├── message-publisher.port.ts
│   │   │   ├── reply-waiter.port.ts
│   │   │   └── object-storage.port.ts
│   │   ├── errors/
│   │   │   └── gateway-error.ts     # Los siete tipos, sin dependencia de HTTP
│   │   └── routes/                  # Un caso de uso por ruta
│   ├── infrastructure/
│   │   ├── config/environment.ts    # Existe — se amplía
│   │   ├── messaging/
│   │   │   ├── broker.provider.ts   # Existe
│   │   │   ├── broker-publisher.adapter.ts
│   │   │   └── reply-queue.adapter.ts
│   │   ├── storage/
│   │   │   └── s3-object-storage.adapter.ts
│   │   └── auth/
│   │       └── jwt.service.ts
│   ├── interfaces/                  # Controladores, guardas, filtros
│   │   ├── health.controller.ts     # Existe
│   │   ├── auth.controller.ts
│   │   ├── customers.controller.ts
│   │   ├── accounts.controller.ts
│   │   ├── transfers.controller.ts
│   │   ├── audit.controller.ts
│   │   ├── guards/{jwt.guard.ts,roles.guard.ts}
│   │   ├── filters/gateway-exception.filter.ts
│   │   └── dto/
│   ├── app.module.ts                # Existe — aquí se cablea todo
│   └── main.ts                      # Existe — bootstrap y emisión de OpenAPI
├── test/                            # Jest
└── Dockerfile                       # NUEVO

apps/web/
├── app/
│   ├── app.vue                      # Existe — pasa a montar NuxtLayout
│   ├── app.config.ts                # NUEVO — tokens de bonking. Core
│   ├── layouts/{default.vue,public.vue}
│   ├── middleware/auth.global.ts
│   ├── composables/{useGatewayApi.ts,useSession.ts,useMoneyFormat.ts}
│   ├── lib/                         # Lógica pura, la que sí se puede probar
│   │   ├── gateway-error.ts
│   │   ├── money.ts
│   │   └── navigation.ts            # D-06 → módulos visibles
│   ├── components/shared/
│   │   ├── SharedCorrelationIdBadge.vue
│   │   ├── SharedAsyncStateAlert.vue
│   │   ├── SharedMoneyInput.vue
│   │   └── SharedIdempotencyKeyField.vue
│   └── pages/
│       ├── login.vue
│       ├── activar.vue              # Veredicto de verificación de correo
│       ├── demo.vue                 # La página de demostración (FR-044)
│       ├── clientes/index.vue
│       ├── cuentas/index.vue
│       ├── transferencias/index.vue
│       └── auditoria/index.vue
└── test/                            # node --test sobre app/lib/

apps/packages/
├── contracts/src/events/transaction/transfer.requested.v1.ts   # + paymentScenario
├── contracts/src/routing/topology.ts                           # + bindings del Gateway
└── messaging/src/broker.ts                                     # + cola exclusiva

docs/
└── DESIGN.md            # Se actualiza a la revisión bonking. Core
```

**Structure Decision**: se conserva la disposición por capas que
`apps/packages/tooling/eslint.base.mjs` **ejecuta**, no sugiere. Tres reglas
mandan sobre este diseño y ninguna admite excepción:

- `src/domain/` no importa nada de otra capa y no toca frameworks. En el
  Gateway se queda vacío, que es la forma más honesta de decir que no tiene
  dominio.
- `src/application/` no importa `infrastructure` ni `interfaces`. Por eso los
  puertos viven en `application` y los adaptadores en `infrastructure`.
- `src/interfaces/` no importa `infrastructure`. Los controladores dependen de
  puertos; el cableado ocurre en `app.module.ts`, que está en la raíz de `src/`
  y por tanto fuera de las tres zonas.

Hay una cuarta regla específica del Gateway: `bank/gateway-no-service-imports`
prohíbe importar código de cualquier servicio. Si algo de este plan necesitara
saltarse una de estas reglas, el diseño estaría mal y la regla tendría razón.

En el frontend, la lógica que se puede probar sin marco de componentes vive en
`app/lib/` como funciones puras, y los componentes la consumen. Es lo que
permite tener pruebas reales pese a TD-010, en vez de declarar el frontend no
verificable.

## Constitution Re-Check (post-Fase 1)

*Repetido después de producir `research.md`, `data-model.md`, `contracts/` y
`quickstart.md`, sobre el diseño concreto y no sobre la intención.*

El diseño introdujo cuatro cosas que no existían cuando se evaluó el gate. Las
cuatro se revisan de nuevo:

| Novedad del diseño | Principio en riesgo | Verdicto |
| --- | --- | --- |
| Cola exclusiva del Gateway ligada a `bank.replies` y a dos eventos (R1, R2) | IV | **Conforma.** Sigue siendo transporte asíncrono sobre el broker. No añade un servicio ni un salto síncrono. Ligar una cola a un exchange topic no altera el contrato de los eventos ni los quita de `audit.all`. |
| Tabla `failureCode → HTTP` con veinte entradas (R5) | V | **Conforma, y es la mitigación.** El riesgo era decidir dominio al mapear; una tabla de datos no decide, traduce. La prueba que falla si el enum crece sin que la tabla crezca es lo que lo mantiene cierto. |
| Depósito de la foto en MinIO antes de publicar (R7) | II, V | **Conforma.** ADR-012 lo asigna al Gateway y define el bucket como búfer de transferencia: no se consulta para decidir nada y el dueño de la foto sigue siendo Customer Service. El Gateway no gana persistencia de negocio. |
| Enmienda aditiva de `transfer.requested.v1` (R3) | VI | **Conforma.** El Gateway valida el valor y lo traslada sin interpretarlo; quien lo obedece es Transaction Service. No participa en la Saga ni la orquesta. |

Un quinto punto que conviene dejar por escrito porque es el más fácil de leer
mal: **la distinción actor/sujeto de R4 no es una regla de negocio en el
Gateway**. El Gateway no comprueba que un `CLIENTE` opere solo sobre lo suyo —no
puede, no tiene datos—, sino que reenvía y deja que el servicio dueño rechace con
su código nombrado. Comprobarlo sería exactamente la violación del principio V
que este diseño evita.

**Resultado: pasa de nuevo, sin violaciones.**

## Complexity Tracking

Sin violaciones. La tabla queda vacía a propósito.
