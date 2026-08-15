# Feature Specification: Dominio y límites de los cinco servicios (T-02)

**Feature Branch**: `003-domain-service-boundaries`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "necesito que definamos la especificacion para el ticket T-02 que esta en mi proyecto de github (https://github.com/marcosbondel/Proyecto-SA-B-2/issues/9). Ademas, toma como base los requisitos especificados en el enunciado del proyecto docs/references/780_Proyecto_1_2S2026.pdf"

**Ticket origen**: [T-02 Definir el dominio y los límites de los cinco servicios](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/9) — responsable todo el equipo, coordina Marcos Bonifasi, entrega 2026-08-14. Depende de T-01. Bloquea T-03, T-05, T-06 y todos los servicios.

**Enunciado**: `docs/references/780_Proyecto_1_2S2026.pdf`, revisión del 2026-08-13. Secciones aplicables: §4.1 "Definición de Microservicios" (pp. 3-7), §4.2 "Alcance del proyecto" — reglas de diseño obligatorias, patrones esperados, consideraciones SRE y observaciones críticas (p. 7), §6 Metodología pasos 1 y 2 (p. 16), §8.1 Requisitos (p. 19), §8.2 criterios 2.1 y 2.2 (p. 23).

**Qué es este documento**: el modelo de dominio como **contrato funcional**. Define qué datos posee cada servicio, qué invariantes protege, qué comandos acepta y qué eventos publica o consume. No prescribe clases, tablas, esquemas de mensaje ni tecnologías: eso corresponde a T-03 (decisiones técnicas), T-05 (contratos de eventos) y al plan de cada servicio.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saber qué servicio puede modificar cada dato (Priority: P1)

Un integrante o un agente que va a implementar cualquier servicio necesita saber, sin preguntar en el chat, qué datos posee ese servicio, cuáles solo puede leer de un evento ajeno y cuáles no puede tocar nunca. Hoy esa frontera solo existe en la cabeza de quien estuvo en la reunión.

**Why this priority**: es lo que desbloquea T-03, T-05, T-06 y los cinco servicios. El enunciado penaliza con el **50 % de la nota** que un microservicio consulte una base que no es la suya (§4.2, restricciones arquitectónicas, p. 13) y con el **100 %** el uso de una sola base compartida (§8.3, p. 26). Sin la matriz escrita, la violación se descubre en la revisión final, cuando ya es cara.

**Independent Test**: se entrega solo. Se toma cualquier dato del modelo —`balance`, `documento`, `status` de una transferencia, la credencial de acceso— y la matriz responde en una lectura: qué servicio lo escribe, qué servicios lo leen y por qué medio lo reciben.

**Acceptance Scenarios**:

1. **Given** la matriz de ownership, **When** se elige cualquier atributo del modelo de dominio, **Then** aparece exactamente un servicio propietario con derecho de escritura, y cero atributos tienen dos propietarios.
2. **Given** un servicio que necesita un dato ajeno, **When** se consulta la matriz, **Then** el dato aparece con el evento o el request/reply asíncrono que se lo entrega, nunca con una consulta a la base de otro servicio.
3. **Given** la lista de datos que no pueden cruzar límites, **When** un implementador diseña un payload, **Then** sabe qué campos tiene prohibido incluir y por qué.
4. **Given** el API Gateway, **When** se busca su fila en la matriz, **Then** consta que no posee entidades de negocio ni base de datos, y que no toma decisiones de dominio.

---

### User Story 2 - Conocer el ciclo de vida y las invariantes de cada entidad (Priority: P1)

Quien implementa un servicio necesita saber qué estados puede tomar cada entidad, qué transiciones son legales y qué reglas no puede violar jamás, incluso ante eventos duplicados o mensajes fuera de orden.

**Why this priority**: el criterio 2.2 de la rúbrica (§8.2, p. 23) califica el modelo de dominio, y §4.1 exige idempotencia, protección contra condiciones de carrera y garantía de no duplicidad en los servicios de Customer, Account, Transaction y Payment. Una invariante que no está escrita antes del código se descubre cuando un balance queda negativo en la demostración.

**Independent Test**: se entrega solo. Se toma cada entidad y se verifica que tiene identificador, conjunto cerrado de estados, transiciones legales, y al menos una invariante con el fallo esperado cuando se intenta violarla.

**Acceptance Scenarios**:

1. **Given** el catálogo de entidades, **When** se consulta cualquiera de ellas, **Then** tiene identificador único, atributos, estados posibles, transiciones legales e invariantes.
2. **Given** un estado de transferencia, **When** se busca desde qué estados se puede llegar a él, **Then** las transiciones legales están enumeradas y las ilegales están descartadas explícitamente.
3. **Given** un evento entregado dos veces, **When** se consulta el modelo, **Then** consta que no puede producir una segunda transición de estado ni una segunda compensación, y consta cuál es la clave que lo garantiza.
4. **Given** un intento de operación que violaría una invariante, **When** se consulta el modelo, **Then** el resultado esperado es un rechazo nombrado, no un comportamiento indefinido.

---

### User Story 3 - Ejecutar los flujos de negocio sin acoplar servicios (Priority: P2)

El equipo necesita que los cinco flujos de negocio —crear cliente, crear cuenta, consultar saldo, transferir, y los dos flujos nuevos de la revisión del enunciado: activación por correo y login— estén descritos con su actor, su entrada, su resultado y sus fallos esperados, para poder diseñar los eventos (T-05) y las secuencias (T-07) sin volver a discutir el dominio.

**Why this priority**: §4.2 exige diagramas de secuencia de al menos transferencia y creación de cuenta, y un diagrama de casos de uso con crear cuenta, consultar saldo y transferir dinero. La rúbrica califica el flujo distribuido (2.7) y el manejo de fallos (2.8), y la metodología recuerda validar escenarios de fallo, no solo casos exitosos (§6, p. 18). Es P2 porque depende de que las fronteras (US1) y las entidades (US2) ya estén fijadas.

**Independent Test**: se entrega solo. Se toma cada flujo y se verifica que nombra al actor, la entrada, el resultado observable, la secuencia de servicios que reaccionan y al menos un fallo con su compensación o su rechazo.

**Acceptance Scenarios**:

1. **Given** el flujo de transferencia, **When** se lee la descripción, **Then** el Transaction Service inicia la Saga y Account, Payment y Notification & Audit reaccionan a eventos, sin que ningún servicio llame a otro de forma síncrona.
2. **Given** una transferencia cuyo pago falla, **When** se lee el flujo, **Then** existe un paso de compensación definido que devuelve el sistema a un estado consistente y deja rastro auditable.
3. **Given** la consulta de saldo, **When** se lee el flujo, **Then** el Gateway obtiene el dato por request/reply asíncrono contra Account Service y nunca leyendo su base.
4. **Given** la creación de cuenta, **When** se lee el flujo, **Then** Account Service persiste la cuenta sin consultar la base de Customer Service, y el enunciado del comando incluye el tipo de cuenta.
5. **Given** el flujo de activación por correo, **When** se lee la descripción, **Then** consta que Customer Service genera y valida el enlace, que Notification & Audit lo entrega, y qué transición de estado deja al cliente en condición de operar.
6. **Given** el flujo de login, **When** se lee la descripción, **Then** consta que el Gateway publica un comando de autenticación, que Customer Service valida las credenciales y responde con los claims, y que la emisión del token queda fuera de este documento.
7. **Given** un cliente registrado que nunca verificó su correo, **When** intenta iniciar sesión con credenciales correctas, **Then** el modelo describe un solo resultado: se dispara el correo de activación y se niega el acceso con un motivo distinguible de "credenciales inválidas".

---

### User Story 4 - Saber quién puede hacer qué (Priority: P2)

Los tres tipos de actor que el enunciado introduce —Administrador, Cajero Receptor y Cliente— necesitan un conjunto mínimo de permisos escrito, para que quien implemente un flujo sepa qué actor lo puede disparar y quién queda fuera.

**Why this priority**: el enunciado nombra los tres actores pero no detalla sus permisos (§4.1, nota de la p. 7), y §4.2 exige un diagrama de casos de uso con actores claros. Sin un mínimo escrito, cada servicio inventa su propia noción de quién es quién. Es P2 porque los permisos granulares por endpoint pertenecen a T-13; aquí solo se fija el mínimo que el dominio necesita.

**Independent Test**: se entrega solo. Se toma cada caso de uso del sistema y la matriz de actores dice qué roles pueden ejecutarlo y cuáles no.

**Acceptance Scenarios**:

1. **Given** la matriz de actores, **When** se consulta cualquiera de los tres roles, **Then** tiene una lista de acciones permitidas y una frontera explícita de lo que no puede hacer.
2. **Given** un Cliente autenticado, **When** intenta operar sobre una cuenta que no le pertenece, **Then** el modelo declara el rechazo como resultado esperado.
3. **Given** un permiso que el enunciado no define, **When** se consulta el documento, **Then** aparece como propuesta del equipo con su aprobación registrada, no como hecho derivado del enunciado.

---

### User Story 5 - Dejar constancia de que el equipo aprobó el modelo (Priority: P3)

El equipo necesita evidencia verificable de que los tres integrantes aprobaron el modelo antes de que exista código de dominio, porque el modelo es el contrato que todos van a implementar por separado.

**Why this priority**: el ticket lo exige como criterio de aceptación y como evidencia esperada, y el criterio 1.1 de la rúbrica (§8.2, p. 21) califica la evidencia de trabajo en equipo. Es P3 porque es el cierre del ticket, no una entrada para los demás.

**Independent Test**: se entrega solo. Un evaluador encuentra en el ticket la aprobación de los tres integrantes con fecha, referida a una versión concreta del modelo.

**Acceptance Scenarios**:

1. **Given** el ticket cerrado, **When** se busca la aprobación, **Then** constan los tres integrantes, la fecha y la versión del modelo aprobada.
2. **Given** un cambio posterior al modelo, **When** se consulta el procedimiento, **Then** consta que requiere una nueva aprobación y que los tickets dependientes deben revisarse.

---

### Edge Cases

- **Un dato parece pertenecer a dos servicios.** El `customerId` vive en Customer Service y aparece en `Account`. La matriz debe distinguir *propiedad* de *referencia*: Account Service guarda el identificador como referencia opaca y nunca los datos personales asociados. Ningún caso puede quedar como "lo escriben ambos".
- **Account Service necesita saber que el cliente existe.** No puede consultarlo. La cuenta se crea reaccionando a un comando y, si el cliente no existe, el fallo se detecta por ausencia del evento previo o por rechazo posterior con compensación, no por una lectura cruzada.
- **La foto del documento y la credencial de acceso.** Nunca salen de Customer Service. Un evento que las transporte hacia Notification & Audit o hacia el Gateway es una violación del modelo, aunque el broker lo permita técnicamente.
- **Notification & Audit necesita el correo del cliente para enviar el correo de activación.** Es una excepción deliberada y acotada: el dato viaja como destinatario de la notificación. El registro de auditoría, en cambio, no persiste credenciales ni el número de documento completo.
- **Desactivación automática de cuentas.** §4.1 (p. 5) exige un proceso automático que desactive cuentas inactivas con balance menor a Q50.00 tras seis meses de inactividad. El modelo debe definir qué cuenta como "actividad", cómo se compara el umbral y qué ocurre con una cuenta INACTIVE que recibe una transferencia entrante.
- **Transferencia hacia una cuenta inactiva o inexistente.** Es un fallo de la Saga, no un error de validación previa: el Transaction Service no puede saberlo sin preguntar. El modelo debe declarar la compensación.
- **Redondeo y moneda.** Un monto con más decimales de los admitidos, o un balance que resultaría negativo por redondeo, deben tener resultado definido. El sistema opera en quetzales.
- **La misma clave de idempotencia con distinto contenido.** No es un reintento: es un conflicto. El modelo debe declarar si se rechaza o si se responde con el resultado original.
- **Eventos fuera de orden.** Un evento de compensación que llega antes que el evento que compensa. El modelo debe declarar que la transición ilegal se descarta, no que se aplica.
- **Login antes de verificar el correo.** Resuelto en FR-037: el primer login con credenciales correctas dispara el correo y niega el acceso. El caso límite que queda vivo es el reintento —un cliente que intenta entrar cinco veces sin abrir el correo— y la distinción, visible para el Gateway, entre credenciales inválidas y cuenta pendiente de activación. Ambos estados, `emailVerifiedAt` y la validación de la foto del documento, siguen siendo independientes y no deben confundirse.
- **Un empleado sin cuentas bancarias.** Administrador y Cajero Receptor son `Customer` con rol elevado (FR-043) y pueden no tener ninguna `Account`. Todo recorrido que asuma "un cliente tiene al menos una cuenta" debe declarar que no aplica a esos roles.
- **Enlace de activación caducado o reutilizado.** Un enlace usado dos veces no puede activar dos veces ni producir un segundo registro de auditoría de activación.
- **Un mismo correo o documento registrado dos veces.** Es la invariante de unicidad; el resultado esperado es rechazo, no un segundo `Customer`.
- **El username se genera, no se pide.** §4.1 (p. 5) dice que el username se genera a partir del nombre del usuario. Dos personas con el mismo nombre producen colisión, y la unicidad de username es invariante obligatoria: el modelo debe declarar la estrategia de desambiguación como regla de dominio.
- **El alcance se desborda hacia el diseño de mensajes.** Este documento nombra comandos y eventos con su productor y sus consumidores. La forma del payload, el versionado y las convenciones de topics son T-05. Si aparece la tentación, se registra allí.

## Requirements *(mandatory)*

### Functional Requirements

**Límites de contexto y propiedad de datos**

- **FR-001**: El modelo MUST asignar a cada uno de los cinco servicios un bounded context con una responsabilidad única, sin solapamiento: Customer Service (identidad y datos del cliente), Account Service (cuentas y balances), Transaction Service (orquestación de transacciones financieras), Payment Service (procesamiento de pagos) y Notification & Audit Service (notificaciones y registro de eventos).
- **FR-002**: MUST existir una matriz que, para cada dato del modelo, indique el servicio propietario con derecho exclusivo de escritura, los servicios que lo consumen y el medio por el que lo reciben (evento o request/reply asíncrono).
- **FR-003**: Cada dato del modelo MUST tener exactamente un servicio propietario. Cero datos con propiedad compartida.
- **FR-004**: El modelo MUST distinguir *propiedad* de *referencia*: un servicio puede guardar un identificador ajeno como referencia opaca sin adquirir propiedad sobre la entidad referida ni sobre sus atributos.
- **FR-005**: MUST enumerarse explícitamente los datos que **no pueden cruzar** límites de servicio, con el motivo. Como mínimo: credencial de acceso, referencia y contenido de la foto del documento de identidad, y número de documento completo hacia el registro de auditoría.
- **FR-006**: El API Gateway MUST quedar registrado sin entidades de negocio, sin base de datos y sin decisiones de dominio.
- **FR-007**: El modelo MUST declarar que ningún servicio consulta las tablas de otro servicio, y que todo dato ajeno llega por mensajería asíncrona.

**Catálogo de entidades**

- **FR-008**: MUST documentarse las entidades `Customer`, `Account`, `Transaction`, `Payment`, `AuditEvent` y `Notification`, cada una con identificador, atributos, servicio propietario, estados posibles, transiciones legales e invariantes.
- **FR-009**: `Customer` MUST incluir `customerId`, nombre completo, documento, correo, fecha de nacimiento, dirección, `username`, referencia al documento de identidad, credencial de acceso, `role`, `identityStatus` y `emailVerifiedAt`.
- **FR-010**: `emailVerifiedAt` e `identityStatus` MUST modelarse como estados independientes: la verificación del correo (activación de la cuenta de acceso) y la validación de la foto del documento son flujos distintos y no se implican mutuamente.
- **FR-011**: `Account` MUST incluir `accountId`, `customerId`, `balance`, `status`, `accountType` y `lastActivityAt`. Los estados mínimos de `status` son `ACTIVE` e `INACTIVE`. Los valores de `accountType` son `MONETARIA` y `AHORRO`.
- **FR-012**: `Transaction` MUST incluir `transactionId`, `sourceAccount`, `targetAccount`, `amount`, `status`, `correlationId`, clave de idempotencia y marcas de tiempo. Los estados mínimos son `PENDING`, `DEBITING`, `PAYMENT_PENDING`, `COMPLETED`, `FAILED` y `COMPENSATED`.
- **FR-013**: `Payment` MUST incluir `paymentId`, `transactionId`, `status`, número de intento y motivo de fallo.
- **FR-014**: `AuditEvent` MUST incluir `eventId`, tipo de evento, `timestamp`, `payload`, `correlationId` y servicio de origen, y MUST ser inmutable: se agrega, nunca se modifica ni se borra.
- **FR-015**: Cada entidad MUST declarar sus transiciones de estado legales como conjunto cerrado; toda transición no enumerada MUST tratarse como ilegal y descartarse.

**Invariantes obligatorias**

- **FR-016**: Un documento de identidad MUST NOT registrarse dos veces dentro de Customer Service.
- **FR-017**: Un `username` MUST NOT registrarse dos veces dentro de Customer Service. Como el username se genera a partir del nombre del cliente, el modelo MUST declarar la regla de desambiguación ante colisión.
- **FR-018**: Un correo electrónico MUST NOT registrarse dos veces dentro de Customer Service, porque identifica al cliente durante el login y la activación.
- **FR-019**: Un balance MUST NOT quedar negativo después de una operación aprobada.
- **FR-020**: El monto de una transferencia MUST ser mayor que cero.
- **FR-021**: La cuenta origen y la cuenta destino de una transferencia MUST NOT ser la misma.
- **FR-022**: Una transferencia con la misma clave de idempotencia MUST NOT modificar dos veces los balances. El modelo MUST declarar el resultado cuando la misma clave llega con contenido distinto.
- **FR-023**: Un evento repetido MUST NOT producir una segunda transición de estado ni una segunda compensación, y el modelo MUST nombrar el campo que garantiza esa detección.
- **FR-024**: Ningún servicio MUST consultar tablas de otro servicio.
- **FR-025**: Cada invariante MUST declarar el servicio que la protege y el resultado esperado cuando se intenta violarla, expresado como rechazo o compensación nombrada, nunca como comportamiento indefinido.
- **FR-026**: Los montos y balances MUST expresarse en quetzales con precisión fija de dos decimales, y el modelo MUST declarar el comportamiento ante un monto con más decimales de los admitidos.

**Reglas de cuenta**

- **FR-027**: El modelo MUST documentar el proceso automático de desactivación exigido por el enunciado: una cuenta con balance menor a Q50.00 y sin actividad durante seis meses pasa a `INACTIVE`. MUST definirse qué operaciones cuentan como actividad y actualizan `lastActivityAt`.
- **FR-028**: El modelo MUST declarar el efecto de `status = INACTIVE` sobre las operaciones de la cuenta —como mínimo, si puede ser origen o destino de una transferencia— y si existe reactivación y bajo qué condición.
- **FR-029**: El modelo MUST documentar `accountType` como **clasificación sin reglas diferenciadas en Fase 1**: los valores `MONETARIA` y `AHORRO` se persisten, se informan al crear la cuenta y se muestran, pero no alteran ninguna invariante, ningún estado ni ningún flujo. Ambos tipos quedan sujetos por igual al proceso automático de desactivación de FR-027. El modelo MUST declararlo como decisión del equipo del 2026-08-14 —el enunciado exige que los dos tipos existan, no que se comporten distinto— y MUST dejar constancia de que introducir reglas diferenciadas más adelante es un cambio de modelo que requiere nueva aprobación (FR-056).

**Flujos de negocio**

- **FR-030**: MUST documentarse el flujo de **crear cliente**: el Gateway publica un comando y Customer Service confirma mediante evento.
- **FR-031**: MUST documentarse el flujo de **crear cuenta**: el Gateway publica un comando que incluye `accountType`, y Account Service persiste la cuenta sin consultar la base de Customer Service.
- **FR-032**: MUST documentarse el flujo de **consultar saldo**: el Gateway usa request/reply asíncrono con Account Service.
- **FR-033**: MUST documentarse el flujo de **transferir**: Transaction Service inicia la Saga y Account, Payment y Notification & Audit reaccionan a eventos, con compensación definida para cada paso que puede fallar.
- **FR-034**: MUST documentarse el flujo de **activación por correo**: Customer Service genera el enlace firmado y publica el evento de activación, Notification & Audit entrega el correo, el cliente abre el enlace, el Gateway recibe el token y publica un comando de verificación, y Customer Service valida el token y marca `emailVerifiedAt`, dejando al cliente en condición de operar.
- **FR-035**: El flujo de activación MUST declarar qué ocurre con un enlace caducado y con un enlace ya utilizado, sin producir una segunda activación ni un segundo registro de auditoría de activación.
- **FR-036**: MUST documentarse el flujo de **login**: el Gateway recibe credenciales y publica un comando de autenticación; Customer Service valida y responde con los claims necesarios. La emisión concreta del token JWT MUST quedar fuera de este documento y corresponde a T-03.
- **FR-037**: El modelo MUST declarar la relación entre el primer login y la activación por correo así: **el primer intento de login es el disparador**. El cliente envía credenciales, Customer Service las valida, y si son correctas pero `emailVerifiedAt` es nulo, MUST ocurrir todo lo siguiente en un solo resultado: se dispara el flujo de activación de FR-034, se **niega el acceso**, y la respuesta al Gateway distingue "credenciales inválidas" de "cuenta pendiente de activación". Una vez verificado el correo, los logins posteriores conceden acceso normalmente.
- **FR-037a**: Reintentar el login antes de verificar el correo MUST NOT generar un segundo enlace válido en paralelo ni una segunda cuenta de auditoría de activación. El modelo MUST declarar si el reintento reenvía el mismo enlace o invalida el anterior al emitir uno nuevo.
- **FR-038**: Cada flujo MUST declarar actor, entrada, resultado observable y al menos un fallo esperado con su rechazo o compensación.
- **FR-039**: Todo flujo que abarque dos o más servicios MUST modelarse como Saga con compensación explícita, en estilo de coreografía.
- **FR-040**: Todo flujo MUST propagar un `correlationId` de extremo a extremo.
- **FR-041**: El envío del correo de activación MUST repartirse así: **Customer Service genera y firma el enlace de activación y valida el token** cuando vuelve, porque el token es una decisión de identidad y la identidad es su contexto; **Notification & Audit Service ejecuta la entrega del correo** al reaccionar al evento de activación, porque el enunciado le asigna el envío de notificaciones (§4.1, p. 6). Notification & Audit MUST NOT generar, interpretar ni validar el token: solo lo transporta.
- **FR-041a**: El evento que dispara la activación MUST transportar el correo del destinatario y el enlace firmado, y nada más del cliente. Es la excepción acotada de FR-005: el correo cruza el límite como dato de entrega, no como dato de perfil, y no se persiste en el registro de auditoría junto al resto del expediente del cliente.

**Actores y permisos mínimos**

- **FR-042**: El modelo MUST documentar los tres tipos de actor del enunciado —`ADMINISTRADOR`, `CAJERO_RECEPTOR` y `CLIENTE`— con sus permisos mínimos y con la frontera explícita de lo que cada uno no puede hacer.
- **FR-043**: El Administrador y el Cajero Receptor MUST modelarse como registros de **`Customer` con un `role` elevado**, dentro del mismo agregado y el mismo servicio. No existe una entidad de personal separada. Decisión del equipo del 2026-08-14: mantiene un solo flujo de autenticación y conserva el significado de `customerId` en `Account`.
- **FR-043a**: Como consecuencia de FR-043, el modelo MUST declarar qué invariantes de `Customer` aplican **solo cuando `role = CLIENTE`** —como mínimo la validación de la foto del documento de identidad y la posesión de cuentas bancarias— y cuáles aplican a todo `Customer` sin importar el rol —como mínimo la unicidad de documento, correo y username, y la verificación del correo antes de operar.
- **FR-043b**: El modelo MUST declarar que un `Customer` con rol `ADMINISTRADOR` o `CAJERO_RECEPTOR` puede existir sin ninguna `Account` asociada, y que `Account.customerId` MUST referirse siempre a un `Customer` con rol `CLIENTE`.
- **FR-044**: Un Cliente MUST NOT poder operar sobre cuentas que no le pertenecen; el resultado esperado es un rechazo nombrado.
- **FR-045**: Los permisos que el enunciado no define MUST aparecer marcados como propuesta del equipo con aprobación registrada, no como hecho derivado del enunciado.

**Comandos, eventos y consumidores**

- **FR-046**: MUST existir un catálogo inicial que, por cada comando y cada evento, nombre el servicio productor, los servicios consumidores y el flujo al que pertenece.
- **FR-047**: Cada evento del catálogo MUST tener al menos un consumidor identificado. Cero eventos huérfanos.
- **FR-048**: Cada comando del catálogo MUST tener exactamente un servicio que lo atiende.
- **FR-049**: El catálogo MUST cubrir la Saga de transferencia completa, incluyendo los eventos de compensación.
- **FR-050**: Notification & Audit Service MUST quedar registrado como consumidor de los eventos que requieren rastro auditable, y MUST NOT emitir eventos que otro servicio consuma para tomar decisiones de negocio; el enunciado lo define como altamente desacoplado y sin afectar la lógica de negocio (§4.1, p. 7).
- **FR-051**: La forma del payload, el versionado y las convenciones de nombres de topics MUST NOT definirse aquí; corresponden a T-05.

**Trazabilidad y proceso**

- **FR-052**: Toda decisión del modelo MUST ser rastreable a una de estas tres fuentes: una sección del enunciado, una decisión ya registrada por el equipo, o una aprobación nombrada de los tres integrantes.
- **FR-053**: Cuando el enunciado no defina una regla, el modelo MUST marcarla como decisión del equipo con su justificación, en lugar de presentarla como requisito del enunciado.
- **FR-054**: El modelo MUST poder evaluarse contra los ocho principios de `.specify/memory/constitution.md` y recibir un veredicto de conformidad por cada uno.
- **FR-055**: MUST quedar registro de la aprobación de los tres integrantes, con fecha y referencia a la versión del modelo aprobada, antes de escribir código de dominio.
- **FR-056**: Un cambio posterior al modelo MUST requerir nueva aprobación y revisión de los tickets dependientes.

**Límites de este trabajo**

- **FR-057**: Este trabajo MUST NOT crear código de dominio, esquemas de base de datos, contratos de mensaje ni clases concretas.
- **FR-058**: Este trabajo MUST NOT definir autorización granular por endpoint; eso es T-13.
- **FR-059**: Este trabajo MUST NOT incorporar OCR ni validación externa de documentos, productos bancarios adicionales como préstamos o tarjetas, ni integraciones reales con bancos externos.

### Key Entities

- **Customer** *(Customer Service)*: una persona registrada en el sistema, sea cuentahabiente o personal del banco. Identidad `customerId`. Atributos: nombre completo, documento, correo, fecha de nacimiento, dirección, username generado, referencia al documento de identidad, credencial de acceso, rol, estado de validación de identidad, momento de verificación del correo. Ciclo de vida: registrado → correo verificado (habilitado para operar), con la validación de la foto del documento como eje independiente y aplicable solo al rol `CLIENTE`.
- **Account** *(Account Service)*: una cuenta bancaria perteneciente a un cliente. Identidad `accountId`. Referencia opaca a `customerId`, siempre de un `Customer` con rol `CLIENTE`. Atributos: balance, estado, tipo de cuenta (clasificación sin efecto en las reglas de Fase 1), última actividad. Ciclo de vida: `ACTIVE` → `INACTIVE` por el proceso automático de inactividad.
- **Transaction** *(Transaction Service)*: el intento de mover dinero entre dos cuentas y el estado de su Saga. Identidad `transactionId`. Referencias opacas a cuenta origen y destino. Ciclo de vida a través de `PENDING`, `DEBITING`, `PAYMENT_PENDING` y los estados terminales `COMPLETED`, `FAILED` y `COMPENSATED`.
- **Payment** *(Payment Service)*: el procesamiento del pago asociado a una transacción, con sus reintentos. Identidad `paymentId`. Referencia opaca a `transactionId`.
- **AuditEvent** *(Notification & Audit Service)*: el registro inmutable de algo que ocurrió en el sistema. Identidad `eventId`. Atributos: tipo, momento, payload, identificador de correlación y servicio de origen.
- **Notification** *(Notification & Audit Service)*: el aviso enviado a una persona. Atributos: destinatario, canal, tipo, estado de envío e intentos.
- **Actor**: quien opera el sistema. Tres tipos: Administrador, Cajero Receptor y Cliente, cada uno con un conjunto mínimo de acciones permitidas.
- **Bounded context**: el ámbito de un servicio. Atributos: responsabilidad única, datos propios, comandos que atiende, eventos que publica, eventos que consume, datos que tiene prohibido recibir.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona que no estuvo en la reunión responde correctamente, en menos de diez minutos y usando solo el modelo, qué servicio puede modificar cada dato del sistema.
- **SC-002**: El 100 % de los atributos del modelo tiene exactamente un servicio propietario. Cero atributos con dos propietarios.
- **SC-003**: El 100 % de las entidades tiene identificador, conjunto cerrado de estados, transiciones legales y al menos una invariante documentada.
- **SC-004**: Las invariantes obligatorias están enunciadas con el servicio que las protege y el resultado esperado ante su violación. Cero invariantes sin fallo definido.
- **SC-005**: Los tres casos de uso principales del enunciado —crear cuenta, consultar saldo y transferir dinero— más los flujos de crear cliente, activación por correo y login tienen actor, entrada, resultado y al menos un fallo esperado.
- **SC-006**: Cada comando del catálogo tiene exactamente un servicio que lo atiende y cada evento tiene al menos un consumidor. Cero eventos huérfanos.
- **SC-007**: Cero flujos que abarquen dos servicios quedan sin compensación definida.
- **SC-008**: El 100 % de los datos prohibidos de cruzar límites está enumerado con su motivo, y cualquier revisor puede detectar una violación leyendo solo esa lista.
- **SC-009**: Los tres tipos de actor tienen permisos mínimos documentados y frontera explícita de lo no permitido.
- **SC-010**: El 100 % de las decisiones del modelo es rastreable al enunciado, a una decisión registrada o a una aprobación nombrada. Cero decisiones sin origen.
- **SC-011**: Un revisor puede emitir un veredicto de conformidad para cada uno de los ocho principios de la constitución leyendo únicamente el modelo.
- **SC-012**: Los tres integrantes registran su aprobación, con fecha y versión, antes de que exista código de dominio.
- **SC-013**: T-03, T-05 y T-06 pueden iniciarse sin solicitar contexto de dominio adicional por chat.
- **SC-014**: Cero elementos del modelo describen consultas de un servicio a la base de otro.

## Decisiones del equipo (2026-08-14)

Cuatro puntos que el enunciado deja abiertos y que el ticket prohíbe inventar fueron
decididos por el equipo, con Marcos Bonifasi coordinando. Se registran aquí como
decisiones, no como requisitos del enunciado, conforme a FR-053. Cambiarlas requiere
nueva aprobación (FR-056).

| # | Decisión | Requisito | Alternativa descartada |
| --- | --- | --- | --- |
| D-01 | Administrador y Cajero Receptor son `Customer` con `role` elevado, no una entidad de personal separada. Las invariantes de cuentahabiente aplican solo a `role = CLIENTE`. | FR-043, FR-043a, FR-043b | Un agregado `StaffUser` aparte, que habría duplicado el flujo de autenticación. |
| D-02 | `accountType` es clasificación pura en Fase 1: `MONETARIA` y `AHORRO` no cambian ninguna invariante ni flujo. | FR-029 | Diferenciar por reglas (exención de desactivación, saldo mínimo), que habría añadido reglas que el enunciado no pide. |
| D-03 | Customer Service genera, firma y valida el enlace de activación; Notification & Audit ejecuta la entrega del correo. | FR-041, FR-041a | Que Customer Service enviara el correo directamente, o que Notification & Audit generara el token, que habría sacado una decisión de identidad de su contexto. |
| D-04 | El primer login con credenciales correctas y correo sin verificar dispara el correo de activación y niega el acceso, con motivo distinguible de credenciales inválidas. | FR-037, FR-037a | Enviar el correo al registrar y rechazar el login sin más, que se aleja de la frase "por medio del primer logging" del enunciado. |

## Assumptions

- El enunciado vigente es la revisión del PDF del 2026-08-13, ya presente en el repositorio. Si el docente publica otra revisión, el modelo se revisa y se vuelve a aprobar (FR-056).
- El modelo se documenta bajo `docs/` como conocimiento duradero del proyecto, no dentro del directorio del spec, porque debe seguir siendo verdadero después de que este ticket se archive. La ubicación exacta y la relación con `docs/events/` y `docs/architecture/` se resuelven en el plan.
- La documentación duradera del repositorio se redacta en inglés según FR-020 de T-01. Este spec está en español por ser artefacto de trabajo bajo `specs/`, igual que el spec de T-01.
- El enunciado autoriza explícitamente completar lo que falta: "El estudiante deberá complementar cualquier funcionalidad faltante el enunciado para cumplir con el flujo del mismo" (§4.1, p. 7). Toda decisión tomada bajo esa autorización se marca como decisión del equipo, no como requisito del enunciado (FR-053).
- La mensajería es RabbitMQ y la persistencia es una base PostgreSQL por servicio, según lo ya registrado en `ARCHITECTURE.md`. Este documento no revisa esas decisiones y no depende de ellas: el modelo es válido con cualquier broker asíncrono.
- La propiedad de los servicios ya está asignada en `docs/OWNERSHIP.md` y no se altera aquí. La aprobación del modelo es de los tres integrantes porque el modelo cruza todas las fronteras.
- Los estados enumerados para cada entidad son un mínimo. Un servicio puede añadir estados internos siempre que no contradiga las transiciones legales declaradas ni exponga estados nuevos en sus eventos sin volver a aprobar el modelo.
- El sistema opera en una sola moneda, el quetzal guatemalteco, coherente con el umbral de Q50.00 del enunciado y con los formatos ya fijados en `docs/DESIGN.md`.
- El enunciado no define retención de datos ni volúmenes esperados. Se asume el uso académico de demostración y no se fijan metas de rendimiento en este documento; los SLI, SLO y SLA son entregable de otro ticket.

## Dependencies

- **T-01** — completado: identidad del proyecto, ocho restricciones no negociables en `ARCHITECTURE.md` y en la constitución, ownership por componente y metodología de trabajo.
- El enunciado del proyecto, disponible en `docs/references/780_Proyecto_1_2S2026.pdf`.
- La constitución en `.specify/memory/constitution.md`, contra la que este modelo debe resultar conforme.
- La disponibilidad de los tres integrantes para aprobar el modelo dentro de la fecha de entrega del ticket.

## Out of Scope

- Autorización granular por endpoint y su aplicación en el Gateway (T-13).
- Emisión, firma, expiración y renovación del token JWT (T-03).
- Forma de los payloads, versionado de eventos y convenciones de topics (T-05).
- Esquemas de base de datos, migraciones y elección de índices (plan de cada servicio).
- OCR o validación externa de documentos de identidad.
- Productos bancarios adicionales: préstamos, tarjetas, inversiones.
- Integraciones reales con bancos o procesadores de pago externos; el Payment Service simula sistemas externos según §4.1 (p. 6).
- Definición de SLI, SLO y SLA.
