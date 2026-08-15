# Phase 0 — Research: Dominio y límites de los cinco servicios (T-02)

**Feature**: [spec.md](spec.md) | **Fecha**: 2026-08-14

Catorce decisiones de enfoque. Las cuatro decisiones de dominio ya tomadas por el equipo
(D-01 a D-04) están en el spec y no se re-litigan aquí. Lo que sigue resuelve el resto: dónde
vive el entregable, y las reglas que el spec declara obligatorio *documentar* sin decir
todavía *cuáles son*.

Las decisiones marcadas **(requiere aprobación)** son reglas de dominio nuevas que el
enunciado no fija. Entran en el mismo registro de aprobación de los tres integrantes que
exige FR-055; no se implementan servicios sobre ellas antes de esa firma.

---

## R1 — Dónde vive el modelo y cómo se divide

**Decisión**: seis archivos bajo `docs/domain/`.

| Archivo | Contenido | Criterio de aceptación del ticket que cubre |
| --- | --- | --- |
| `README.md` | Índice, glosario del lenguaje ubicuo, decisiones D-01…D-06, regla de cambio, registro de aprobación | "El equipo aprueba el modelo antes de escribir código" |
| `bounded-contexts.md` | Los cinco contextos + Gateway, matriz de ownership de datos, datos que no cruzan | "Matriz de ownership"; "datos que no pueden cruzar límites" |
| `entities.md` | Catálogo: identidad, atributos, estados, transiciones legales, invariantes | "Cada entidad tiene identificador, ciclo de vida e invariantes" |
| `actors.md` | Los tres actores, permisos mínimos, matriz caso de uso × rol | "Los tres tipos de actor documentados con sus permisos mínimos" |
| `use-cases.md` | Los seis flujos con actor, entrada, resultado, fallos, Saga y compensación | "Los tres casos de uso principales tienen actor, entrada, resultado y fallos" |
| `message-catalog.md` | Comandos y eventos con productor y consumidores, sin payloads | "Matriz de comandos, eventos y consumidores" |

**Rationale**: va a `docs/` y no a `specs/003-…/` porque el modelo debe seguir siendo
verdadero cuando este ticket se archive — es la separación de dos altitudes que ya gobierna
el repositorio. Se divide en seis y no en uno solo porque cada archivo corresponde a un
criterio de aceptación distinto y a un lector distinto: quien implementa Account Service lee
`entities.md` y `bounded-contexts.md`; quien diseña los eventos (T-05) lee
`message-catalog.md`; quien construye la interfaz (T-08…T-13) lee `actors.md`.

Las invariantes **no** llevan archivo propio: van dentro de `entities.md`, junto a la entidad
que protegen, más una sección final para las transversales (idempotencia, no consulta
cruzada). Separarlas produciría dos documentos que se contradicen en cuanto uno cambie.

**Alternativas descartadas**: un solo `docs/DOMAIN.md` — se vuelve ilegible y obliga a leer
todo para responder una pregunta. Meter el modelo en `ARCHITECTURE.md` — ese archivo es el
mapa de alto nivel y debe seguir cabiendo en una lectura.

---

## R2 — Idioma del entregable

**Decisión**: `docs/domain/*` en **inglés**. Los literales de enumeración que el enunciado
nombra en español se conservan tal cual: `MONETARIA`, `AHORRO`, `ADMINISTRADOR`,
`CAJERO_RECEPTOR`, `CLIENTE`.

**Rationale**: FR-020 de T-01 obliga a que la documentación duradera del repositorio esté en
inglés, y `docs/` es documentación duradera. Los literales son identificadores que vienen del
enunciado (§4.1, p. 7) y traducirlos crearía dos vocabularios para lo mismo: el del PDF con
el que se califica y el del código. El lenguaje ubicuo se define una vez, en el glosario de
`docs/domain/README.md`, con la equivalencia español ↔ inglés de cada término.

**Alternativas descartadas**: todo en español, que rompe la homogeneidad que T-01 estableció
y dejaría `docs/` a medio traducir. Traducir los literales a `CHECKING`/`SAVINGS`, que aleja
el modelo del texto contra el que se califica.

---

## R3 — Frontera con T-05 (eventos) y T-07 (diagramas)

**Decisión**: `message-catalog.md` fija **nombre, productor, consumidores y flujo** de cada
mensaje. No fija payload, versionado, nombres de exchange/routing key, ni política de
reintentos del broker. `docs/events/README.md` deja de estar bloqueado en su totalidad: se
reescribe su nota para bloquear solo lo que sigue siendo de T-05 (forma del payload,
versionado, convención de topics) y enlaza al catálogo.

**Rationale**: FR-046 exige el catálogo ahora porque sin él no se puede diseñar nada; FR-051
prohíbe adelantarse a la forma del mensaje. El corte natural entre ambos es exactamente el
que separa "qué conversación existe" de "cómo se serializa". `docs/architecture/README.md`
promete registros escritos de casos de uso para el diagrama 7: T-02 los produce en
`use-cases.md` y el README de arquitectura pasa a enlazarlos en lugar de prometerlos.

---

## R4 — Identificador de acceso en el login (requiere aprobación)

**Decisión**: el identificador de login es el **correo electrónico**. El `username` es un
identificador público de referencia (se muestra, sirve para búsquedas en ventanilla) y no se
usa para autenticar. En consecuencia el correo es único (FR-018).

**Rationale**: el enunciado dice que el username se *genera* a partir del nombre del cliente
(§4.1, p. 5), así que el cliente no lo elige y no lo conoce hasta que el sistema se lo
comunica. Pedirle que se autentique con un dato que el sistema inventó es hostil y, sobre
todo, incoherente con D-04: el flujo de activación entra por el correo, y el primer login es
el que dispara ese correo. Si el login se hiciera por username, el sistema tendría dos
identificadores de entrada para el mismo cliente en el mismo flujo.

**Alternativas descartadas**: login por username, incoherente con lo anterior. Login por
cualquiera de los dos, que duplica el camino de autenticación y multiplica los casos de
fallo sin ganar nada en un sistema de demostración.

---

## R5 — Generación del username y colisión (requiere aprobación)

**Decisión**: el username se deriva del nombre completo por una regla determinista —
normalizar (minúsculas, sin acentos, sin espacios), tomar nombre y primer apellido. Ante
colisión se añade el menor sufijo numérico disponible a partir de `2`
(`juanperez`, `juanperez2`, `juanperez3`). La unicidad la garantiza Customer Service en la
misma operación que crea el `Customer`, no en un paso posterior.

**Rationale**: FR-017 exige declarar la regla porque el username es a la vez generado y
único, y dos homónimos son inevitables. La regla debe ser determinista para que sea
verificable, y la asignación debe ser atómica con la creación porque §4.1 (p. 5) exige
"protección contra condiciones de carrera" en Customer Service: dos registros simultáneos de
homónimos no pueden producir el mismo username.

**Alternativas descartadas**: sufijo aleatorio, que no es verificable y produce usernames
feos sin resolver nada. Rechazar el registro ante colisión, que castiga al cliente por un
dato que él no eligió.

---

## R6 — Qué cuenta como actividad y cómo corre la desactivación (requiere aprobación)

**Decisión**: `lastActivityAt` se actualiza cuando la cuenta es **origen o destino de un
movimiento de dinero confirmado** (débito aplicado, crédito aplicado, compensación
aplicada). Consultar el saldo **no** es actividad. El proceso de desactivación lo ejecuta
Account Service de forma periódica, y desactiva toda cuenta que cumpla **las dos**
condiciones a la vez: `balance < Q50.00` y `lastActivityAt` anterior a seis meses.

**Rationale**: §4.1 (p. 5) exige el proceso y fija ambas condiciones con "y", no con "o": una
cuenta con Q10.00 y actividad ayer sigue activa, y una cuenta con Q5 000.00 y dos años sin
mover no se desactiva. Que consultar el saldo no cuente como actividad es lo que hace que la
regla signifique algo: si mirar bastara, ninguna cuenta se desactivaría nunca. El proceso es
de Account Service porque `balance`, `status` y `lastActivityAt` son suyos, y consultarlos
desde fuera sería una lectura cruzada.

El proceso **debe ser idempotente**: correr dos veces el mismo día no produce dos eventos
`account.deactivated` para la misma cuenta, porque una cuenta ya `INACTIVE` no vuelve a
transicionar.

**Alternativas descartadas**: contar la consulta de saldo como actividad, que vacía la regla.
Aplicar el umbral con "o", que contradice el enunciado.

---

## R7 — Efecto de `INACTIVE` sobre las operaciones (requiere aprobación)

**Decisión**: una cuenta `INACTIVE` **no puede ser origen** de una transferencia — el débito
se rechaza. **Sí puede ser destino**: un crédito entrante se aplica y **reactiva** la cuenta,
llevándola a `ACTIVE` y actualizando `lastActivityAt`. Además, un `ADMINISTRADOR` puede
reactivarla manualmente.

**Rationale**: la desactivación existe para dejar de mantener cuentas abandonadas, no para
atrapar dinero. Rechazar un crédito entrante crearía un caso peor: una transferencia que
falla en el último paso y obliga a compensar por una razón que el emisor no puede conocer ni
corregir. Reactivar al recibir dinero es la interpretación que menos fallos genera y la que
un banco real aplica. Rechazar el débito, en cambio, es lo que da sentido al estado.

**Alternativas descartadas**: `INACTIVE` bloquea todo, que dispara compensaciones evitables.
`INACTIVE` es puramente informativo, que vacía el estado de significado.

---

## R8 — Idempotencia: clave, alcance y conflicto (requiere aprobación)

**Decisión**: tres mecanismos distintos, y hay que no confundirlos.

1. **Clave de idempotencia de la transferencia** (`idempotencyKey`): la aporta el cliente del
   Gateway al solicitar la transferencia. Es única dentro de Transaction Service. Repetirla
   con **el mismo contenido** devuelve la transacción original sin crear una nueva ni mover
   balances. Repetirla con **contenido distinto** se **rechaza** con un fallo nombrado; no se
   crea una transacción ni se responde con la original.
2. **Deduplicación de eventos en los consumidores**: cada consumidor registra el `eventId`
   procesado y descarta el repetido. Es lo que impide una segunda transición de estado o una
   segunda compensación (FR-023).
3. **`correlationId`**: solo trazabilidad. No deduplica nada, porque todos los mensajes de un
   mismo flujo lo comparten.

**Rationale**: responder con el resultado original ante contenido distinto sería mentir —el
solicitante creería que se ejecutó lo que pidió. Rechazar es lo único honesto. Los tres
mecanismos se separan porque el enunciado exige idempotencia y trazabilidad por separado
(§4.2, consideraciones SRE, p. 7) y confundirlos es el error clásico: usar `correlationId`
como clave de deduplicación deduplica el flujo entero.

---

## R9 — Dinero: representación y redondeo

**Decisión**: todos los montos y balances son quetzales con **exactamente dos decimales** y
aritmética exacta (nunca coma flotante binaria). Un monto con más de dos decimales se
**rechaza**; no se redondea. No existe conversión de moneda.

**Rationale**: FR-026 exige declarar el comportamiento. Redondear en silencio un monto de
transferencia es inaceptable en un dominio bancario: el cliente pidió mover una cantidad y el
sistema movería otra. El rechazo es visible y corregible. La aritmética exacta es lo que hace
cumplible la invariante "el balance nunca queda negativo" (FR-019): con coma flotante, la
comparación de saldo contra monto no es fiable en los bordes. El repositorio ya expone un
`money.dto` en `@bank/contracts`, coherente con esta decisión.

---

## R10 — Ciclo de vida del enlace de activación (requiere aprobación)

**Decisión**: el enlace es un token firmado por Customer Service con **caducidad de 24
horas** y **un solo uso**. Un reintento de login antes de verificar **invalida el token
anterior y emite uno nuevo**. Un token caducado, ya usado o invalidado se rechaza con un
motivo distinguible, y el rechazo no cambia el estado del `Customer`.

**Rationale**: FR-035 y FR-037a exigen que ni la caducidad ni la reutilización produzcan una
segunda activación. Invalidar el anterior al emitir uno nuevo —en lugar de reenviar el
mismo— evita que queden varios enlaces vivos en la bandeja del cliente, que es la fuente
habitual de "activé con el correo viejo y no funcionó". El motivo distinguible es lo que
permite a la interfaz decir "tu enlace venció, intenta iniciar sesión otra vez" en lugar de
un error genérico.

---

## R11 — Descomposición de la Saga de transferencia

**Decisión**: coreografía en cinco pasos, con una distinción explícita entre `FAILED` y
`COMPENSATED`.

| # | Quién | Reacciona a | Hace | Publica |
| --- | --- | --- | --- | --- |
| 1 | Transaction | `transfer.requested` (cmd del Gateway) | Valida monto > 0, origen ≠ destino, idempotencia. Crea `Transaction` en `PENDING`, pasa a `DEBITING` | `account.debit.requested` |
| 2 | Account | `account.debit.requested` | Verifica que existe, está `ACTIVE` y tiene fondos. Debita, actualiza `lastActivityAt` | `account.debited` \| `account.debit.rejected` |
| 3 | Transaction | `account.debited` | Pasa a `PAYMENT_PENDING` | `payment.requested` |
| 4 | Payment | `payment.requested` | Procesa con reintentos, contando `attempt` | `payment.succeeded` \| `payment.failed` |
| 5 | Transaction | `payment.succeeded` | Ordena el abono | `account.credit.requested` |
| 6 | Account | `account.credit.requested` | Acredita el destino, reactiva si estaba `INACTIVE` (R7) | `account.credited` \| `account.credit.rejected` |
| 7 | Transaction | `account.credited` | Cierra en `COMPLETED` | `transaction.completed` |

Compensación: `account.debit.rejected` en el paso 2 lleva la transacción a **`FAILED`** —no
se movió nada, no hay nada que deshacer. `payment.failed` o `account.credit.rejected` llevan
a publicar `account.debit.compensation.requested`; Account devuelve el dinero al origen y
publica `account.debit.compensated`; la transacción cierra en **`COMPENSATED`**.

Notification & Audit consume todos estos eventos para el registro auditable, y notifica al
cliente en los tres cierres (`transaction.completed`, `transaction.failed`,
`transaction.compensated`).

**Rationale**: los seis estados que el ticket exige solo tienen sentido si cada uno
corresponde a un paso real; esta descomposición los produce sin inventar estados extra.
Separar `FAILED` de `COMPENSATED` no es cosmético: son dos situaciones operativas distintas
—en una nunca salió dinero, en la otra salió y volvió— y la auditoría tiene que poder
distinguirlas. La coreografía es el estilo que el enunciado recomienda (§4.2, patrones
esperados, p. 7).

---

## R12 — Tensión: ¿puede Notification & Audit enviar el correo de activación?

**Decisión**: sí, y no contradice el enunciado. Se documenta explícitamente la razón en
`bounded-contexts.md` para que un revisor no lo lea como una violación.

**Rationale**: §4.1 (p. 7) describe Notification & Audit como "altamente desacoplado" y "no
afecta lógica de negocio". Enviar un correo es un **efecto**, no una decisión: el servicio no
decide si el cliente se activa, no genera el token, no lo valida y no publica ningún evento
que otro servicio consuma para decidir algo (FR-050). La activación la decide Customer
Service cuando el token vuelve por el Gateway. El acoplamiento que el enunciado prohíbe —que
la lógica de negocio dependa de este servicio— no se produce: si el envío del correo falla,
el `Customer` sigue exactamente en el estado en que estaba.

Lo que sí exige esta decisión es la excepción acotada de FR-041a: el correo del cliente cruza
el límite como dato de entrega. Se documenta como excepción nombrada, no como precedente
para mover más datos de perfil.

---

## R13 — Cómo se verifica un entregable documental

**Decisión**: tres capas. (a) Comprobaciones mecánicas con `grep`/`find` para cobertura y
ausencia de marcadores pendientes; (b) una tabla de trazabilidad requisito → sección, que
hace falsable la afirmación "el modelo cubre el spec"; (c) revisión humana de los tres
integrantes, que es la única capaz de juzgar coherencia de dominio y es además el criterio de
aceptación del ticket.

**Rationale**: es el mismo enfoque que T-01 usó y que funcionó. La capa mecánica es lo que
impide que "está documentado" sea una opinión. Ninguna de las tres sustituye a las otras: un
`grep` no detecta un modelo incoherente, y una revisión humana no garantiza que no falte una
entidad. Los detalles están en [quickstart.md](quickstart.md), con una comprobación por cada
criterio de éxito del spec.

**Alternativas descartadas**: validar el modelo con esquemas ejecutables (JSON Schema de los
eventos), que es exactamente el trabajo de T-05 y que FR-051 prohíbe adelantar aquí.

---

## R14 — Qué se toca fuera de `docs/domain/`

**Decisión**: cinco archivos existentes se editan, ninguno se reescribe, y **no se toca
código**.

| Archivo | Cambio |
| --- | --- |
| `ARCHITECTURE.md` | La tabla de servicios gana los atributos nuevos (`accountType`, `role`, `emailVerifiedAt`, `lastActivityAt`) y un enlace a `docs/domain/`. Las ocho restricciones no se tocan. |
| `AGENTS.md` | El índice de documentación del proyecto gana la entrada de `docs/domain/`. |
| `docs/DOC_INVENTORY.md` | Los seis archivos nuevos se clasifican con responsable. |
| `docs/events/README.md` | La nota de bloqueo se acota a payload/versionado/topics (T-05) y enlaza al catálogo. |
| `docs/architecture/README.md` | Los registros de casos de uso dejan de estar prometidos y pasan a enlazar `docs/domain/use-cases.md`. |

**Rationale**: FR-057 prohíbe código, esquemas y contratos de mensaje. Lo que queda es
documentación, y los cinco archivos anteriores harían afirmaciones falsas o incompletas si el
modelo apareciera sin ellos — un índice que no indexa el documento más importante del
proyecto es peor que no tener índice. `apps/packages/contracts/` **no se toca**: la carpeta
`src/events/` que `docs/events/README.md` menciona es de T-05.

---

## Las dos decisiones nuevas, numeradas

Las decisiones marcadas **(requiere aprobación)** son reglas de dominio que el enunciado no
fija. Se agrupan en dos entradas para que entren en el mismo registro que D-01 a D-04 del spec
y se aprueben como bloque:

| # | Decisión | Cubre |
| --- | --- | --- |
| **D-05** | Reglas de dominio derivadas: el correo es el identificador de login; el username se genera con sufijo numérico ante colisión; solo el movimiento de dinero confirmado cuenta como actividad y la desactivación exige balance **y** antigüedad; `INACTIVE` bloquea el débito pero admite el crédito y reactiva; la clave de idempotencia con contenido distinto se rechaza; los montos son quetzales de dos decimales exactos y no se redondean; el token de activación dura 24 horas, es de un solo uso y el reintento invalida el anterior | R4, R5, R6, R7, R8, R9, R10 |
| **D-06** | Matriz de permisos mínimos por actor, con la frontera explícita de lo no permitido | [data-model.md §5](data-model.md) |

Ninguna de las dos se implementa antes de la firma de los tres integrantes (FR-055). D-06 lleva
además la marca de FR-045: es propuesta del equipo, no requisito del enunciado.

## Decisiones que quedan abiertas

Ninguna bloquea la implementación de este ticket. Se registran para que no se pierdan:

- **Reglas diferenciadas por `accountType`.** D-02 las descarta para Fase 1. Si el equipo las
  quiere después, es un cambio de modelo con nueva aprobación (FR-056).
- **Depósito y retiro en ventanilla.** El enunciado nombra al Cajero Receptor pero no describe
  ninguna operación de efectivo. `actors.md` le asigna las operaciones que sí existen; si el
  equipo decide añadir depósito y retiro, son casos de uso nuevos y afectan a Account Service.
- **Autorización granular por endpoint.** Es T-13 y consume `actors.md` como entrada.
