# Feature Specification: Contratos de eventos y Saga de transferencias (T-05)

**Feature Branch**: `005-event-contracts-saga`

**Created**: 2026-08-19

**Status**: Draft

**Input**: User description: "especifiquemos el ticket T-05"

**Ticket origen**: [T-05 [CODE] Diseñar contratos de eventos y la Saga de transferencias](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/12) — responsables Marcos Bonifasi, Enner Mendizabal y David Barrios; entrega 2026-08-18. Depende de T-02, T-03 y T-04 (los tres cerrados). Bloquea T-06, T-07, T-13 y T-08 a T-12.

**Enunciado**: `docs/references/780_Proyecto_1_2S2026.pdf`, revisión del 2026-08-13 (27 páginas). Secciones aplicables, **con la página verificada contra el PDF**: §4.1 "Customer Service" — JWT obligatorio y activación por correo tras el primer login (p. 5); §4.1 "Reglas de diseño obligatorias" y "Patrones esperados" — comunicación solo por eventos, sin HTTP entre servicios, Saga obligatorio y choreography recomendada (**p. 7**); §4.1 NOTA — tres roles y dos tipos de cuenta, monetaria y de ahorro (p. 7); §4.1 "Consideraciones SRE (obligatorias)" — idempotencia, retries, manejo de errores, consistencia eventual y trazabilidad por `correlationId` (p. 7); §6 Metodología paso 4 "Diseño de eventos y contratos" (nombre, payload, `correlationId`, convenciones de topics) y paso 6 "Definición del flujo de negocio (Saga)" con flujo exitoso, manejo de fallos y eventos de compensación (**p. 17**); §8.1 Requisitos — "Eventos definidos (nombres, payloads, flujo)", "Uso de correlationId", "Idempotencia", "Manejo de errores" e "Implementación de Saga" (p. 20); §8.2 rúbrica — criterio 2.5 "Uso de broker" (5 puntos, 5 o 0), 2.6 "Desacoplamiento" (5 puntos), 2.7 "Flujo distribuido" (5 puntos, 5 o 0) y **2.8 "Manejo de fallos" — "Compensaciones y errores definidos" frente a "No se manejan fallos" (5 puntos, 5 o 0)** (**p. 25**).

> **Corrección de citas**: el ticket cita "Reglas de diseño obligatorias" en la p. 6, el paso 4/6 de la metodología en la p. 16 y los criterios 2.5/2.7 en las pp. 23-24. Las tres están desfasadas: son las pp. 7, 17 y 25. El ticket además no cita el criterio **2.8 "Manejo de fallos"**, que es el que esta feature satisface de forma más directa. Las páginas de esta especificación son las verificadas.

**Qué es este documento**: la especificación del **contrato de mensajería** del sistema. T-02 ya decidió *qué conversaciones existen* — 13 comandos con un único manejador y 22 eventos sin huérfanos, en [`docs/domain/message-catalog.md`](../../docs/domain/message-catalog.md) — y ya fijó los siete pasos de la transferencia, sus dos finales y sus fallos esperados en [`docs/domain/use-cases.md`](../../docs/domain/use-cases.md). T-03 ya eligió RabbitMQ (ADR-004), choreography con compensación explícita (ADR-009) y JWT firmado y validado solo en el Gateway con la identidad verificada viajando en el sobre (ADR-010).

Esta feature **no redecide nada de eso**. Define *cómo se serializa*: la forma del payload de cada mensaje, su versión y su regla de compatibilidad, la topología de exchanges/colas/routing keys, la política de reintentos y de cola de errores, la correlación entre una solicitud y su respuesta, y la evidencia de que un mensaje inválido se rechaza sin tocar el dominio. Es la última pieza de diseño antes de que tres personas puedan implementar servicios en paralelo sin inventar nombres ni payloads.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cada mensaje del catálogo tiene un contrato versionado y consumible (Priority: P1)

Un integrante que empieza Account Service necesita saber exactamente qué campos trae `account.debit.requested`, de qué tipo son, cuál es obligatorio y qué debe responder si el payload no cumple — sin leer el código de Transaction Service ni preguntar por chat. Hoy `apps/packages/contracts/src/events/` está vacío con una marca de bloqueo y `docs/events/` sólo describe lo que faltará.

**Why this priority**: es lo que desbloquea T-06 y los seis tickets de implementación. §8.1 exige "Eventos definidos (nombres, payloads, flujo)" como requisito (p. 20), y el paso 4 de la metodología pide nombre, estructura del payload y convenciones (p. 17). Sin payloads, tres personas implementando en paralelo producen tres interpretaciones del mismo mensaje y la integración falla al final, cuando ya no hay tiempo.

**Independent Test**: se entrega solo. Se toma la lista de los 35 mensajes de `docs/domain/message-catalog.md`, más los 7 que esta feature añade, y se verifica que cada uno de los 42 tiene un contrato ejecutable con sus campos tipados, y una entrada documental con productor, consumidores, precondiciones, efectos y comportamiento ante error.

**Acceptance Scenarios**:

1. **Given** los 13 comandos y 22 eventos de T-02, **When** se audita el catálogo de contratos, **Then** cada uno tiene un contrato ejecutable y ninguno queda sin definir; los nombres son exactamente los de T-02 y no los del texto del ticket.
2. **Given** cualquier contrato, **When** se lee su documentación, **Then** consta si es comando, evento o respuesta, quién lo produce, quién lo consume, qué debe ser cierto antes de emitirlo, qué efecto produce en el consumidor y qué ocurre si el consumidor no puede procesarlo.
3. **Given** un servicio cualquiera, **When** consume el catálogo, **Then** obtiene únicamente formas de transporte y no accede a entidades, reglas ni invariantes del dominio de otro servicio.
4. **Given** la capa de dominio de cualquier servicio, **When** se ejecuta la verificación de aislamiento del repositorio, **Then** ningún archivo de dominio importa el catálogo de contratos.
5. **Given** `account.create` y `account.created`, **When** se revisa su payload, **Then** ambos incluyen `accountType` restringido a `MONETARIA` o `AHORRO`, y un valor fuera de ese conjunto se rechaza (§4.1 NOTA, p. 7).
6. **Given** el catálogo publicado, **When** se compara con `docs/domain/message-catalog.md`, **Then** los únicos mensajes contratados que el catálogo de dominio no lista son los **seis** de solicitud y respuesta que esta feature añade, y esa ampliación consta por escrito sobre el propio catálogo de dominio.
7. **Given** cualquier mensaje, **When** se lee su nombre, **Then** termina en su sufijo de versión (`account.debited.v1`) y ese sufijo coincide con el campo de versión de su sobre.

---

### User Story 2 - El sobre transporta trazabilidad, idempotencia e identidad verificada (Priority: P1)

Quien depure un flujo distribuido necesita reconstruir la cadena causal completa de una transferencia a partir de un solo identificador, y quien reciba un mensaje necesita saber si ya lo procesó y en nombre de qué usuario actúa — sin volver a validar el token, porque ADR-010 decidió que solo el Gateway firma y valida.

**Why this priority**: §8.1 califica "Uso de correlationId" e "Idempotencia" como requisitos independientes (p. 20), y las consideraciones SRE obligatorias los repiten (p. 7). Además, ADR-010 registró como consecuencia pendiente que **el sobre debe incorporar el campo de identidad verificada y que T-05 lo define**: mientras no exista, ningún servicio puede autorizar una operación por rol.

**Independent Test**: se entrega solo. Se toma un sobre de ejemplo y se verifica que contiene los identificadores de trazabilidad, la clave de idempotencia, la versión y el productor; y que la identidad verificada viaja en él con los claims que el Gateway ya validó.

**Acceptance Scenarios**:

1. **Given** un flujo iniciado en el Gateway, **When** se recorren todos los mensajes que produce, **Then** todos comparten el mismo `correlationId`, y ningún servicio intermedio lo regenera.
2. **Given** cualquier mensaje que no sea el primero de un flujo, **When** se inspecciona, **Then** su `causationId` es el identificador del mensaje que lo provocó, de modo que la cadena causal de la Saga se reconstruye sin ambigüedad.
3. **Given** un mensaje reentregado por el broker, **When** el consumidor lo recibe por segunda vez, **Then** lo reconoce por su clave de idempotencia y no produce un segundo efecto financiero (invariantes T-5 y X-4 de T-02).
4. **Given** el sobre vigente en `apps/packages/contracts`, **When** se compara con el que esta feature define, **Then** incorpora la **versión del mensaje**, el **servicio productor** y la **identidad verificada** (`customerId` y rol), que hoy no existen.
5. **Given** un mensaje que llega al broker, **When** se revisa su contenido, **Then** no transporta el token de sesión, ni la contraseña, ni el secreto de firma; sólo la identidad ya verificada.
6. **Given** el supuesto de confianza de ADR-010, **When** se documenta el sobre, **Then** consta explícitamente que la identidad del sobre es fiable únicamente porque ningún productor publica sin haber pasado por el Gateway.

---

### User Story 3 - La Saga de transferencia queda especificada con sus dos finales y todos sus fallos (Priority: P1)

El equipo necesita un documento único que describa la transferencia paso a paso, con el mensaje concreto de cada transición, los dos finales posibles y qué ocurre en cada modo de fallo, para poder implementarla, demostrarla y defenderla.

**Why this priority**: la rúbrica premia esto dos veces y sin punteo intermedio: 2.7 "Flujo distribuido" da 5 o 0 según el flujo esté "correctamente modelado" o "incompleto o incorrecto", y **2.8 "Manejo de fallos" da 5 o 0 según haya "compensaciones y errores definidos" o "no se manejan fallos"** (p. 25). El paso 6 de la metodología exige exactamente flujo exitoso, manejo de fallos y eventos de compensación (p. 17).

**Independent Test**: se entrega solo. Se lee el documento de la Saga y se comprueba que cubre los seis escenarios exigidos por el ticket — happy path, fondos insuficientes, timeout, fallo de pago, duplicado y compensación — cada uno con la secuencia de mensajes y el estado final de la transacción.

**Acceptance Scenarios**:

1. **Given** los siete pasos de `docs/domain/use-cases.md`, **When** se compara con la Saga documentada aquí, **Then** coinciden paso a paso, incluido que **Payment reacciona a `payment.requested` de Transaction y no directamente a `account.debited`**, tal como T-02 lo fijó.
2. **Given** una transferencia exitosa, **When** se sigue el flujo, **Then** existe un ejemplo de mensaje real para cada una de las siete transiciones y la transacción cierra en `COMPLETED`.
3. **Given** un rechazo de débito por fondos insuficientes, **When** se sigue el flujo, **Then** la transacción cierra en `FAILED`, **no se ejecuta compensación alguna** y consta la razón por la que no la hay: el dinero nunca salió.
4. **Given** `payment.failed` en el paso 4 o `account.credit.rejected` en el paso 6, **When** se sigue el flujo, **Then** ambos desembocan en la misma ruta de compensación y la transacción cierra en `COMPENSATED`, nunca en `FAILED` (invariante T-7).
5. **Given** un mensaje duplicado en cualquier paso, **When** se sigue el flujo, **Then** se descarta sin producir una segunda transición ni una segunda compensación.
6. **Given** un mensaje que provoca una transición ilegal por llegar fuera de orden, **When** el consumidor lo recibe, **Then** no lo aplica y lo registra como transición ilegal.
7. **Given** una respuesta que no llega dentro del tiempo de espera del Gateway, **When** se documenta el caso, **Then** consta que el vencimiento **no cancela la operación de negocio** y que el usuario puede consultar el resultado después por identificador de transacción o de correlación.
8. **Given** el conjunto de ejemplos, **When** se revisan, **Then** existe al menos un ejemplo completo de camino feliz, uno de rechazo y uno de compensación, con los identificadores de correlación y causalidad coherentes entre todos los mensajes de cada ejemplo.

---

### User Story 4 - La topología del broker deja de ser una decisión de cada implementador (Priority: P2)

Quien levante la infraestructura local (T-06) y quien implemente el primer consumidor necesitan saber qué exchanges existen, cómo se llama la cola de cada consumidor, con qué patrón se enlaza, cuántas veces se reintenta un mensaje y a dónde va cuando se agotan los intentos.

**Why this priority**: el criterio 2.5 "Uso de broker" da 5 o 0 según el uso sea "correcto y consistente" o "incorrecto o superficial" (p. 25); una cola compartida por todos los servicios es exactamente el uso superficial que se penaliza. Es P2 y no P1 porque los payloads (US1) se pueden diseñar antes que el enrutamiento, pero T-06 no arranca sin esto.

**Independent Test**: se entrega solo. Se toma la topología documentada y se verifica que cada consumidor lógico tiene su cola, que existen los exchanges de comandos, eventos y errores, y que la política de reintentos y de cola de errores está fijada con números concretos.

**Acceptance Scenarios**:

1. **Given** la topología, **When** se revisan las colas, **Then** existe **una cola por consumidor lógico** y ninguna cola es compartida por servicios distintos.
2. **Given** la topología, **When** se revisan los exchanges, **Then** están definidos el de comandos, el de eventos y el de errores, con el criterio que decide en cuál se publica cada mensaje.
3. **Given** cualquier mensaje del catálogo, **When** se busca su routing key, **Then** es estable, está documentada y se deriva del nombre del mensaje por una regla explícita, no caso por caso.
4. **Given** un mensaje que falla al procesarse, **When** se agotan los reintentos, **Then** se han producido **como máximo tres reintentos automáticos después del primer intento**, con esperas de **1 s, 5 s y 30 s**, configurables y documentadas.
5. **Given** un mensaje que agota sus reintentos, **When** llega a la cola de errores, **Then** llega acompañado de la causa, el último intento y su `correlationId`.
6. **Given** un consumidor, **When** procesa un mensaje, **Then** el reconocimiento es explícito y posterior al efecto, de modo que una caída antes de terminar provoca reentrega y no pérdida.
7. **Given** el sistema completo, **When** se revisa la política de consumo, **Then** ningún consumidor depende del orden global de entrega; la corrección se apoya en el estado y en la idempotencia.

---

### User Story 5 - Una respuesta se puede correlacionar con su solicitud (Priority: P2)

El Gateway hace preguntas cuya respuesta necesita para contestarle a un usuario que está esperando: validar credenciales, consultar un saldo, consultar el estado de una transferencia, consultar la traza de auditoría. Necesita emparejar cada respuesta con la pregunta que la originó sin bloquear el sistema y sin abrir una llamada HTTP a un servicio.

**Why this priority**: sin esto, el login y la consulta de saldo no se pueden implementar, y el vencimiento de 5 s del ticket no tiene a qué aplicarse. Es P2 porque afecta a un subconjunto de los mensajes, no a la Saga.

**Independent Test**: se entrega solo. Se toma cada interacción de solicitud/respuesta y se verifica que la respuesta declara con qué campo se empareja con su solicitud y qué ocurre cuando no llega a tiempo.

**Acceptance Scenarios**:

1. **Given** cualquier respuesta, **When** el Gateway la recibe, **Then** puede emparejarla con su solicitud original por un campo declarado en el contrato, sin adivinar y sin depender del orden de llegada.
2. **Given** una solicitud sin respuesta dentro de **5 segundos**, **When** vence la espera, **Then** el Gateway deja de esperar, la operación de negocio **no se cancela**, y el contrato documenta cómo consultar el resultado más tarde.
3. **Given** una autenticación válida, **When** Customer Service responde, **Then** devuelve los claims (`customerId`, rol, username) y **no un token**, coherente con ADR-010 y con T-02.
4. **Given** una autenticación fallida, **When** Customer Service responde, **Then** la razón es segura y **no permite distinguir si el nombre de usuario existe**.
5. **Given** una consulta de estado de transacción, **When** se responde, **Then** la respuesta trae el estado, una razón segura y las marcas de tiempo.
6. **Given** una consulta de auditoría por `correlationId`, **When** se responde, **Then** devuelve los eventos ordenados y las notificaciones asociadas a ese flujo.

---

### User Story 6 - Un mensaje inválido se rechaza sin tocar el dominio (Priority: P2)

Un consumidor que recibe un mensaje malformado, de una versión que no entiende o con un payload que no cumple su contrato debe rechazarlo de forma observable, sin ejecutar lógica de negocio y sin dejar el sistema en un estado intermedio.

**Why this priority**: es la evidencia que el ticket exige explícitamente ("prueba de validación de un mensaje válido y uno inválido") y lo que impide que un defecto de serialización se convierta en un movimiento de dinero. Es P2 porque depende de que los contratos de US1 existan.

**Independent Test**: se entrega solo. Se envía un mensaje conforme y uno no conforme al mismo consumidor y se comprueba que el primero produce su efecto y el segundo no produce ninguno.

**Acceptance Scenarios**:

1. **Given** un mensaje bien formado, **When** un consumidor lo recibe, **Then** la validación pasa y el efecto de dominio ocurre exactamente una vez.
2. **Given** un mensaje con un campo obligatorio ausente, de tipo incorrecto o con un valor fuera del conjunto permitido, **When** un consumidor lo recibe, **Then** se rechaza **antes** de ejecutar lógica de dominio y **ningún dato cambia**.
3. **Given** un mensaje de una versión que el consumidor no soporta, **When** lo recibe, **Then** lo rechaza de forma explícita en vez de interpretarlo parcialmente.
4. **Given** un mensaje rechazado por inválido, **When** se revisa su destino, **Then** terminó en la cola de errores y **no fue reintentado indefinidamente**, porque reintentar un mensaje malformado nunca lo arregla.
5. **Given** la evidencia de la feature, **When** se revisa, **Then** incluye la salida real de la ejecución de la validación sobre un caso válido y uno inválido.

---

### Edge Cases

- **La misma clave de idempotencia con contenido distinto.** T-02 ya decidió que es un conflicto y no una repetición; el contrato debe transportar esa distinción, porque responder con el resultado original sería mentir.
- **Un pago que se aprueba después de que el Gateway dejó de esperar.** El vencimiento es del que espera, no del negocio: la Saga continúa y cierra sola.
- **Un evento que llega antes que el evento que lo precede.** Se descarta como transición ilegal; el contrato no puede asumir orden global.
- **Un consumidor que recibe un campo que no conoce.** Debe tolerarlo. Si revienta, un cambio compatible se vuelve incompatible y se pierde la evolución independiente de los servicios.
- **La referencia a una foto que ya no existe.** El objeto pudo expirar o no haberse subido nunca; el contrato debe decir qué responde Customer Service ante una referencia irrecuperable, y no puede confundirlo con una foto válida pero ilegítima.
- **Una foto cuya huella no coincide al recuperarla.** Se rechaza y no se persiste: una referencia manipulada no debe convertirse en un documento de identidad aceptado.
- **Un consumidor detenido durante el cambio de versión.** Al reanudarse encuentra mensajes `.v2` en una cola a la que sigue enlazado por `.v1`; el contrato debe decir si esos mensajes se le entregan o no.
- **Un mensaje que ya no cabe en su versión.** El contrato debe decir si se amplía la versión vigente o nace una nueva, y cuánto tiempo conviven ambas.
- **La cola de errores se llena durante la demostración.** Debe existir una forma documentada de inspeccionarla que no requiera adivinar el nombre de la cola.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada uno de los 13 comandos y 22 eventos de `docs/domain/message-catalog.md` MUST tener un contrato con sus campos, tipos, obligatoriedad y valores permitidos, publicado en el paquete de contratos compartido.
- **FR-001a**: La feature MUST contratar además los **siete mensajes que T-02 no lista** y que el ticket exige: dos solicitudes nuevas (`transaction.status.requested`, `audit.query.requested`), cuatro respuestas (a `customer.authenticate`, a `account.balance.query`, a `transaction.status.requested` y a `audit.query.requested`) y un evento de rechazo (`customer.email.verification.rejected`), sin el cual FR-020 no se puede satisfacer porque no habría dónde distinguir token expirado de token inválido. El total contratado es de **42 mensajes**.
- **FR-001b**: La ampliación de FR-001a MUST quedar registrada como nota explícita sobre `docs/domain/message-catalog.md`, declarando que **respuesta** es una tercera categoría que T-02 no contempló y que no invalida sus comprobaciones de coherencia: una respuesta no es un evento huérfano porque su único destinatario es quien preguntó.
- **FR-002**: Los nombres de los mensajes MUST ser los de `docs/domain/message-catalog.md`. Donde el texto del ticket use otro nombre, prevalece T-02, y la divergencia MUST quedar registrada por escrito.
- **FR-003**: Cada mensaje MUST declarar si es **comando**, **evento** o **respuesta**, con la regla que los distingue: un comando tiene exactamente un manejador, un evento puede tener varios consumidores, una respuesta se empareja con una solicitud.
- **FR-004**: Cada mensaje MUST documentar productor, consumidores, precondiciones, efectos en el consumidor y comportamiento ante error.
- **FR-005**: Cada mensaje MUST llevar su versión **en dos lugares a la vez**: en el **nombre del mensaje**, y por tanto en su routing key (`account.debited.v1`), y en un **campo del sobre**. El nombre enruta; el campo permite al consumidor rechazar explícitamente una versión que no soporta en vez de interpretarla a medias.
- **FR-005a**: Las dos versiones MUST ser coherentes entre sí en todo mensaje emitido, y una discrepancia entre el sufijo del nombre y el campo del sobre MUST tratarse como mensaje inválido (FR-016).
- **FR-005b**: MUST existir una regla escrita que diga qué cambio es compatible —y por tanto se hace dentro de la versión vigente— y qué cambio obliga a una versión nueva, junto con la política de convivencia: durante cuánto tiempo un productor publica ambas versiones y quién decide retirar la antigua.
- **FR-006**: El sobre MUST transportar identificador de mensaje, tipo, versión, productor, `correlationId`, `causationId`, clave de idempotencia y marca temporal de emisión.
- **FR-007**: El sobre MUST transportar la **identidad verificada** (`customerId` y rol) que el Gateway ya validó, y MUST NOT transportar el token de sesión, la contraseña ni el secreto de firma.
- **FR-008**: `correlationId` MUST fijarse una sola vez al inicio del flujo y propagarse sin regenerarse; `causationId` MUST identificar el mensaje que provocó al actual.
- **FR-009**: Todo consumidor MUST poder reconocer una reentrega por la clave de idempotencia y MUST producir a lo sumo un efecto de dominio por intención.
- **FR-010**: `account.create` y `account.created` MUST incluir y validar `accountType` restringido a `MONETARIA` y `AHORRO`.
- **FR-011**: El sistema MUST definir exchanges separados para comandos, eventos y errores, y el criterio que decide dónde se publica cada mensaje.
- **FR-012**: MUST existir **una cola por consumidor lógico**; ninguna cola MUST ser compartida entre servicios distintos.
- **FR-013**: Las routing keys MUST ser estables, documentadas y derivadas del nombre del mensaje por una regla explícita.
- **FR-014**: El consumo MUST usar reconocimiento explícito posterior al efecto, un máximo de **tres reintentos** tras el primer intento, y esperas iniciales de **1 s, 5 s y 30 s**, configurables.
- **FR-015**: Al agotarse los reintentos, el mensaje MUST llegar a la cola de errores con la causa, el número del último intento y su `correlationId`.
- **FR-016**: Un mensaje **inválido** MUST ir a la cola de errores sin reintentos sucesivos, porque reintentar un mensaje malformado no lo corrige.
- **FR-017**: Ningún consumidor MUST depender del orden global de entrega; la corrección MUST apoyarse en el estado y en la idempotencia.
- **FR-018**: Cada respuesta MUST declarar el campo por el que se empareja con su solicitud; la espera del Gateway MUST vencer a los **5 segundos** sin cancelar la operación de negocio, y MUST existir una vía documentada de consulta posterior por identificador de transacción o de correlación.
- **FR-019**: La respuesta de autenticación MUST devolver claims y no un token; la respuesta de autenticación fallida MUST usar una razón segura que **no revele si el nombre de usuario existe**.
- **FR-020**: Los contratos de activación por correo MUST definir la expiración del enlace y MUST distinguir en el rechazo entre **token expirado** y **token inválido**, sin exponer el token fuera de su mensaje directo.
- **FR-021**: El contrato de la foto del documento MUST definir el tipo de contenido admitido, el tamaño máximo de **5 MB**, la huella **SHA-256** y el estado de validación.
- **FR-021a**: Los bytes de la foto MUST NOT viajar por el broker. El Gateway los deposita en un **almacenamiento de objetos** y el comando transporta únicamente la **referencia al objeto**, el tipo de contenido, el tamaño y la huella SHA-256. Ningún mensaje del sistema transporta bytes de imagen.
- **FR-021b**: Customer Service MUST verificar la huella al recuperar el objeto antes de persistirlo, de modo que una referencia alterada o un objeto corrupto se detecten y no lleguen a la base.
- **FR-021c**: El almacenamiento de objetos MUST tratarse como **búfer de transferencia y no como base de datos de ningún servicio**: nadie consulta el estado del negocio allí, y el objeto MUST tener una política de retención documentada tras la cual se elimina. La fuente de verdad de la foto sigue siendo la base de Customer Service.
- **FR-022**: El formato de serialización del mensaje MUST quedar fijado y versionado antes de que empiece la implementación de los servicios.
- **FR-023**: La validación de un mensaje MUST ocurrir **antes** de ejecutar lógica de dominio y MUST rechazar tipo desconocido, versión no soportada y payload no conforme sin modificar ningún dato.
- **FR-024**: El catálogo MUST ser consumible sin importar el dominio interno de ningún servicio, y la capa de dominio de cada servicio MUST NOT depender de él.
- **FR-025**: La Saga de transferencia MUST documentarse con sus siete pasos, sus dos finales (`FAILED` sin compensación, `COMPENSATED` con ella) y los seis escenarios exigidos: camino feliz, fondos insuficientes, vencimiento de espera, fallo de pago, mensaje duplicado y compensación.
- **FR-026**: MUST existir ejemplos completos de mensajes reales para camino feliz, rechazo y compensación, con identificadores de correlación y causalidad coherentes dentro de cada ejemplo.
- **FR-027**: La feature MUST dejar evidencia de la ejecución real de la validación sobre un mensaje válido y uno inválido.
- **FR-028**: Al cerrarse la feature, las marcas de bloqueo que dependen de ella MUST retirarse de los documentos y archivos afectados, y la deuda técnica **TD-013** MUST quedar cerrada. **TD-014** MUST permanecer abierta: exige un broker en ejecución, que llega con T-06.

### Key Entities

- **Sobre de mensaje**: la envoltura común a todo mensaje. Transporta identidad del mensaje, tipo, versión, productor, trazabilidad (`correlationId`, `causationId`), clave de idempotencia, marca temporal e identidad verificada del usuario. No conoce el contenido que transporta.
- **Contrato de mensaje**: la forma del payload de un mensaje concreto, con su versión y su regla de compatibilidad. Es una forma de transporte, no un modelo de dominio.
- **Catálogo de contratos**: el conjunto completo de contratos, consumible por los siete aplicativos como única fuente de la forma de los mensajes.
- **Topología del broker**: exchanges, colas por consumidor lógico, routing keys y sus reglas de enlace.
- **Política de entrega**: reintentos, esperas, reconocimiento explícito, destino de los mensajes agotados o inválidos.
- **Correlación de solicitud y respuesta**: la regla que empareja una respuesta con su solicitud y el comportamiento al vencer la espera.
- **Guion de la Saga**: la secuencia de mensajes de la transferencia, sus transiciones de estado, sus dos finales y sus modos de fallo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Los **42** mensajes tienen contrato —los 35 del catálogo de dominio más los 7 que esta feature añade—; ninguno queda sin definir.
- **SC-002**: Un integrante que no participó en el diseño implementa un consumidor cualquiera **sin hacer una sola pregunta** que no esté contestada en el catálogo.
- **SC-003**: Dado un `correlationId` tomado de cualquier mensaje, la cadena causal completa de su flujo se reconstruye **sin ambigüedad y sin consultar código**.
- **SC-004**: Los **seis** escenarios de la Saga están documentados con la secuencia de mensajes y el estado final de la transacción; ninguno queda descrito sólo en prosa general.
- **SC-005**: Un mensaje reentregado produce **exactamente un** efecto financiero, verificado sobre al menos un paso que mueve dinero.
- **SC-006**: Un mensaje inválido produce **cero** cambios de datos, con evidencia de ejecución real.
- **SC-007**: **Cero** colas compartidas entre servicios distintos y **cero** routing keys sin documentar.
- **SC-008**: Un mensaje que falla persistentemente llega a la cola de errores tras **como máximo cuatro entregas** (el intento inicial más tres reintentos), y su causa se identifica sin leer código.
- **SC-009**: **Cero** mensajes transportan contraseña, token de sesión, secreto de firma o bytes de imagen.
- **SC-009a**: Ningún contrato admite un payload que supere **64 KB**, de modo que el mensaje más grande del sistema siga siendo de un orden de magnitud manejable por el broker y por la cola de errores.
- **SC-010**: **Cero** archivos de la capa de dominio de cualquier servicio dependen del catálogo de contratos, verificado por la comprobación de aislamiento del repositorio.

## Assumptions

- **T-02 es la autoridad sobre qué mensajes existen.** Donde el texto del ticket T-05 y `docs/domain/message-catalog.md` difieren en el nombre —`customer.login.requested` frente a `customer.authenticate`, `payment.process.requested` frente a `payment.requested`, `customer.register.requested` frente a `customer.register`—, se toma T-02. Cambiarlo exigiría enmendar un ticket cerrado sin ganancia técnica.
- **La secuencia de la Saga es la de `docs/domain/use-cases.md`.** El texto del ticket describe a Payment reaccionando directamente a `account.debited`; T-02 fijó que Transaction publica `payment.requested` y Payment reacciona a eso. Se toma T-02, que además es lo que el diagrama de T-13 tendrá que reflejar.
- **RabbitMQ, choreography con compensación explícita y JWT firmado y validado solo en el Gateway son restricciones dadas**, no decisiones de esta feature: ADR-004, ADR-009 y ADR-010.
- **La serialización por defecto es texto JSON en UTF-8**, salvo decisión contraria registrada: es lo que el adaptador de mensajería vigente ya asume y lo que hace legible la evidencia de la entrega.
- **El almacenamiento de objetos es infraestructura nueva que esta feature introduce** (decisión del equipo, 2026-08-19). Consecuencias que esta especificación asume y que otros tickets deben absorber: **T-06** provisiona el servicio y sus credenciales en la infraestructura local, **T-11** lo dibuja en el diagrama de despliegue, y la decisión **necesita su propio ADR** porque ningún ADR de T-03 la contempla. El enunciado no lo exige ni lo prohíbe; la justificación es mantener todos los mensajes por debajo de 64 KB.
- **El almacenamiento de objetos no viola la independencia de datos.** Es un búfer de transferencia entre el Gateway y Customer Service, no la base de datos de un servicio: no guarda estado del negocio, nadie lo consulta para decidir, y la fuente de verdad de la foto sigue siendo la base de Customer Service. Si algún diseño posterior empieza a consultarlo para tomar decisiones, contradice este supuesto y el criterio 2.3 de la rúbrica.
- **La versión de un mensaje empieza en 1** y el sistema arranca sin mensajes heredados que mantener, por lo que la convivencia de versiones se diseña pero no se ejercita en esta fase.
- **El envejecimiento del catálogo se gestiona con versiones de mensaje, no con versiones del paquete**: en un monorepo con dependencias de espacio de trabajo todos los aplicativos resuelven la misma copia del paquete a la vez.
- **Los consumidores toleran campos desconocidos.** Sin esta regla, cualquier ampliación compatible obligaría a desplegar los siete aplicativos a la vez.
- **Esta feature no implementa servicios.** Produce contratos, documentación, topología, ejemplos y la prueba de validación. Los consumidores reales llegan con T-15 a T-20, y la verificación contra un broker en ejecución con T-06.
- **Los diagramas formales UML de la Saga son T-13.** Aquí se produce el guion textual y el diagrama de flujo/estados que T-13 necesita como insumo, no el diagrama de secuencia entregable.
- **TD-014 no se cierra con esta feature**, porque exige un broker en ejecución y ningún aplicativo se conecta a uno todavía.

## Dependencies

- **T-02** (cerrado) — `docs/domain/message-catalog.md`, `docs/domain/use-cases.md`, `docs/domain/entities.md`: qué mensajes existen, los siete pasos de la transferencia, los estados y los códigos de error del dominio.
- **T-03** (cerrado) — ADR-003 (comunicación), ADR-004 (RabbitMQ), ADR-009 (Saga por choreography), ADR-010 (JWT y propagación de identidad en el sobre).
- **T-04** (cerrado) — el espacio de trabajo, el paquete de contratos con su sobre, el adaptador de mensajería y las reglas ejecutables de aislamiento.
- **Bloquea** — T-06 (infraestructura local), T-07 a T-12 (diagramas de arquitectura), T-13 (secuencia de la Saga) y T-15 a T-20 (implementación de los servicios y el Gateway).

### Trabajo que esta feature genera fuera de su alcance

| Destino | Qué queda pendiente | Por qué |
| --- | --- | --- |
| Nuevo ADR (T-03 ampliado) | Registrar la elección de almacenamiento de objetos para la foto del documento, con sus alternativas descartadas | Ningún ADR vigente la contempla; sin ADR, la decisión lee como preferencia y arriesga el criterio 1.3 de la rúbrica |
| T-06 | Provisionar el almacenamiento de objetos y sus credenciales en la infraestructura local | Sin él, el registro de cliente con foto no se puede demostrar |
| T-11 | Incluir el almacenamiento de objetos en el diagrama de despliegue | Un componente desplegado que no aparece en el diagrama rompe la consistencia entre diagramas que exige el paso 5 de la metodología (p. 17) |
| `docs/domain/message-catalog.md` | Nota de ampliación: la categoría **respuesta** y los siete mensajes que esta feature añade | El catálogo de T-02 declara 13 comandos y 22 eventos sin huérfanos; la ampliación debe constar para que esa afirmación siga siendo verificable |
