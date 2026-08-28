# Feature Specification: API Gateway y shell de frontend (T-15)

**Feature Branch**: `feature/T-15`

**Created**: 2026-08-24

**Status**: Draft

**Input**: User description: "https://github.com/marcosbondel/Proyecto-SA-B-2/issues/20 — T-15 [CODE] Implementar el API Gateway"

**Ticket origen**: [T-15 [CODE] Implementar el API Gateway](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/20) — responsable Marcos Bonifasi, Tech Lead; entrega 2026-08-20. Depende de T-04, T-05 y T-06 (los tres cerrados). Bloquea T-16, T-17, T-18, T-19, T-20 y T-21.

**Enunciado**: `docs/references/780_Proyecto_1_2S2026.pdf`, revisión del 2026-08-13 (27 páginas). Secciones aplicables, **con la página verificada contra el PDF**: §4.1 "Customer Service" — "Para autenticar y validar al usuario debe de hacer uso de JWT" (**p. 5**); §4.1 NOTA — "Existe 3 tipos de usuarios en el sistema, Administrador, Cajero Receptor, Cliente" (**p. 7**); §4.2 "Alcance del proyecto" — "Uso de un API Gateway como punto de entrada al sistema" (**p. 8**); §4.2 "Restricciones arquitectónicas" — "El API Gateway debe actuar únicamente como punto de entrada al sistema" (**p. 13**); §4.4 "Entregables" — Frontend, "interfaz intuitiva, agradable y funcional para la validación de las funcionalidades de cada microservicio" (**p. 15**); §6 "Metodología", Paso 9 — "Implementación del API Gateway" (**p. 18**); §8.1 "Requisitos para optar a la calificación" — "API Gateway: se implementa un API Gateway funcional como punto de entrada al sistema" (**p. 19**); §8.2 criterio 2.4 — "Gateway como entrypoint, sin lógica de negocio" (**p. 24**).

> **Corrección de citas**: el ticket cita la nota de actores como "§4.2 … p. 8" (es **§4.1 NOTA, p. 7**, como ya registra [`docs/domain/actors.md`](../../docs/domain/actors.md)), "Uso de un API Gateway" en la p. 7 (es la **p. 8**), la restricción "únicamente como punto de entrada" en la p. 7 (es la **p. 13**, dentro de "Restricciones arquitectónicas"), el Paso 9 en la p. 17 (es la **p. 18**), el criterio 2.4 en la p. 23 (es la **p. 24**) y los entregables de Frontend en la p. 14 (es la **p. 15**). Solo §4.1 (p. 5) y §8.1 (p. 19) estaban correctas. Es el mismo desfase de una página ya corregido en las specs de T-05 y T-06, salvo la restricción arquitectónica, que el ticket desplaza seis páginas. Las páginas de esta especificación son las verificadas.

**Qué es este documento**: la especificación del **único punto de entrada HTTP del sistema** y de la **base compartida del frontend** sobre la que T-16 a T-20 construirán sus módulos. Fija las rutas, quién puede llamarlas, qué mensaje publica cada una, cómo se responde cuando la respuesta no llega, y qué piezas de interfaz existen una sola vez para que cinco desarrolladores no inventen cinco integraciones distintas.

### Referencia visual obligatoria

La implementación del shell debe importar y revisar el proyecto Claude Design
registrado en [`docs/DESIGN.md`](../../docs/DESIGN.md), con foco en
`bonking.dc.html` y `support.js`. Esa referencia guía la composición,
interacciones y comportamiento responsive de las pantallas. Los tokens y reglas
de producto de `docs/DESIGN.md` siguen siendo el contrato del repositorio; toda
diferencia intencional debe quedar documentada en la evidencia del ticket.

Esta feature **no redecide nada** ya fijado. Los nombres de mensajes, sus cargas y el techo de cinco segundos para una respuesta son los de [`@bank/contracts`](../../apps/packages/contracts) y [`docs/events/`](../../docs/events) (T-05). La emisión y validación del JWT — HS256, una hora, sin refresh, firmado y verificado **solo** en el Gateway — la fijó [ADR-010](../../docs/architecture/adr/ADR-010-authentication.md). La matriz de qué rol puede disparar qué caso de uso es la decisión **D-06** de [`docs/domain/actors.md`](../../docs/domain/actors.md). El almacenamiento de la foto fuera del broker lo ordena [ADR-012](../../docs/architecture/adr/ADR-012-object-storage.md) y el bucket lo provisiona T-06. Los tokens visuales son los de [`docs/DESIGN.md`](../../docs/DESIGN.md) (T-01). T-15 los **implementa**, no los diseña.

> **Diferencia entre el texto del ticket y el catálogo vigente**: el ticket nombra mensajes que no existen con ese nombre. T-05 se escribió después y fijó otros. Vinculan los del catálogo, porque el criterio de aceptación 5 del propio ticket exige consistencia con T-05. La tabla de FR-004 registra la correspondencia completa. La **única** enmienda que esta feature hace al catálogo es el campo opcional `paymentScenario` de FR-021b.

## Clarifications

### Sesión 2026-08-24

Las tres preguntas nacieron de que el texto del ticket contradice una decisión
ya aprobada. Ninguna era un detalle técnico: las tres cambian qué se construye.

- **Q: La ruta de verificación de correo, ¿acusa recibo o da veredicto?** El
  criterio 11 del ticket pide veredicto; T-02 y T-05 modelaron el resultado como
  evento de auditoría. → **A: veredicto.** El Gateway consume los dos eventos
  correlacionados con el mismo plazo de cinco segundos de las consultas y
  responde activada o rechazada; al vencer el plazo degrada a "no cancelada,
  consulte por correlación". Es un enlace que una persona abre en su navegador:
  una página en blanco no es una respuesta. Correlacionar no es decidir, así que
  la frontera del criterio 2.4 queda intacta (FR-015b a FR-015e).
- **Q: `paymentScenario` no existe en el catálogo de T-05. ¿Se enmienda aquí o
  se difiere a T-19?** → **A: se enmienda aquí**, como campo opcional aditivo y
  retrocompatible. El productor declarado de `transfer.requested.v1` es el
  propio Gateway, de modo que T-15 lo posee; diferirlo obligaría a T-19 a migrar
  un contrato que T-15 ya congeló para cinco tickets bloqueados, y dejaría el
  contrato del API con un campo que se acepta y se descarta en silencio
  (FR-021b a FR-021d).
- **Q: ¿La sesión entra en el shell del frontend, y hasta dónde?** La lista de
  entregables del ticket no la menciona, pero sin ella ninguna ruta protegida se
  ejercita desde el navegador. → **A: entra, y con filtrado por rol.** Inicio de
  sesión, token guardado y adjuntado por el punto único de acceso, expulsión al
  caducar, y navegación y rutas filtradas por la matriz D-06. Quedan fuera la
  renovación del token, la persistencia entre cierres del navegador y el
  recordatorio de credenciales. El filtrado del frontend es comodidad, no
  defensa: el Gateway prohíbe igual (FR-041b a FR-041g).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Iniciar sesión y recibir una identidad verificable (Priority: P1)

Una persona con credenciales válidas y cuenta activada las envía al Gateway y recibe un token de sesión que la identifica en toda operación posterior. Quien se equivoca de contraseña, no existe, o no ha activado su cuenta por correo recibe **exactamente el mismo** rechazo, sin pista alguna de en cuál de los tres casos cayó.

**Why this priority**: sin sesión no hay ruta protegida que probar ni módulo de T-16 a T-20 que pueda operar. El enunciado exige JWT explícitamente (§4.1, p. 5) y es el primer eslabón de todo lo demás.

**Independent Test**: se entrega solo. Con Customer Service simulado respondiendo la solicitud de autenticación, un inicio de sesión válido devuelve un token verificable y los tres casos de rechazo devuelven respuestas idénticas byte a byte salvo su identificador de correlación.

**Acceptance Scenarios**:

1. **Given** credenciales válidas de una cuenta activada, **When** se envían a la ruta pública de inicio de sesión, **Then** se recibe un token de sesión que contiene el identificador del cliente, su nombre de usuario y su rol, y que caduca en una hora.
2. **Given** una contraseña incorrecta, **When** se intenta iniciar sesión, **Then** la respuesta es un rechazo genérico de credenciales, sin indicar si el correo existe.
3. **Given** un correo que no está registrado, **When** se intenta iniciar sesión, **Then** la respuesta es **indistinguible** de la del escenario 2.
4. **Given** credenciales correctas de una cuenta que aún no ha verificado su correo, **When** se intenta iniciar sesión, **Then** no se emite token y la respuesta es **indistinguible** de las de los escenarios 2 y 3.
5. **Given** cualquiera de los cuatro escenarios anteriores, **When** se revisan los registros del Gateway, **Then** la contraseña no aparece en ninguno de ellos, ni en claro ni truncada.
6. **Given** el servicio de clientes sin responder, **When** se intenta iniciar sesión, **Then** tras cinco segundos la respuesta es un error de tiempo de espera distinguible de un rechazo de credenciales.

---

### User Story 2 - Solo quien tiene el rol correcto atraviesa el Gateway (Priority: P1)

Cada ruta protegida declara qué roles pueden usarla. Una petición sin token válido no entra; una con token válido pero rol insuficiente entra y es rechazada por autorización. La identidad verificada viaja después dentro del sobre del mensaje, y ningún servicio vuelve a leer el token.

**Why this priority**: es la mitad de seguridad del ticket y la condición para que los cinco servicios puedan confiar en la identidad que reciben (ADR-010). Sin ella, cualquiera publica en el broker en nombre de cualquiera.

**Independent Test**: se entrega solo. Una tabla de casos recorre cada ruta protegida sin token, con token caducado, con token manipulado y con token válido de cada uno de los tres roles, y compara el resultado contra la matriz D-06.

**Acceptance Scenarios**:

1. **Given** cualquier ruta protegida, **When** se llama sin token, **Then** se rechaza por falta de autenticación y no se publica ningún mensaje al broker.
2. **Given** un token con firma alterada, **When** se llama una ruta protegida, **Then** se rechaza por falta de autenticación y no se publica ningún mensaje.
3. **Given** un token caducado hace un segundo, **When** se llama una ruta protegida, **Then** se rechaza por falta de autenticación.
4. **Given** un token válido de rol `CLIENTE`, **When** se llama una ruta que la matriz D-06 reserva a `ADMINISTRADOR`, **Then** se rechaza por autorización — un resultado distinto del anterior — y no se publica ningún mensaje.
5. **Given** un token válido cuyo rol sí está autorizado, **When** se llama la ruta, **Then** el mensaje publicado lleva en su sobre el identificador de cliente y el rol tomados del token, nunca del cuerpo de la petición.
6. **Given** un cuerpo de petición que intenta declarar un identificador de cliente distinto al del token, **When** se procesa, **Then** prevalece el del token.
7. **Given** las rutas públicas — inicio de sesión, registro, verificación de correo, salud y disponibilidad —, **When** se llaman sin token, **Then** funcionan con normalidad.

---

### User Story 3 - Un comando asíncrono se acepta y se puede seguir (Priority: P1)

Quien registra un cliente, actualiza sus datos, abre una cuenta o solicita una transferencia recibe de inmediato una confirmación de que la solicitud fue **aceptada**, junto con el identificador de correlación con el que podrá averiguar después cómo terminó. El Gateway no decide nada del negocio: valida la forma y publica.

**Why this priority**: son cuatro de las ocho rutas y el patrón que T-16 a T-20 replicarán. Es también donde se demuestra el criterio 2.4 del enunciado (p. 24): el Gateway acepta y enruta, no resuelve.

**Independent Test**: se entrega solo. Cada ruta se llama con carga válida y se observa en la administración de RabbitMQ el mensaje publicado en el exchange correcto, con la clave de enrutamiento correcta y el identificador de correlación que devolvió la respuesta HTTP.

**Acceptance Scenarios**:

1. **Given** una carga válida en cualquiera de las cuatro rutas de comando, **When** se envía, **Then** la respuesta indica aceptación y contiene el identificador de correlación.
2. **Given** una carga válida de transferencia, **When** se envía, **Then** la respuesta contiene además el identificador de transacción que el Gateway generó.
3. **Given** una carga que incumple la forma declarada — campo obligatorio ausente, tipo equivocado, monto no positivo, cuenta origen igual a la destino —, **When** se envía, **Then** se rechaza por validación, se nombra el campo culpable y **no se publica ningún mensaje**.
4. **Given** una petición sin identificador de correlación, **When** se procesa, **Then** el Gateway genera uno y lo devuelve; **Given** una petición que trae uno propio, **When** se procesa, **Then** el Gateway lo conserva.
5. **Given** dos peticiones de transferencia con la misma clave de idempotencia, **When** se envían, **Then** ambas viajan al broker con esa misma clave en el sobre, de modo que el servicio destinatario pueda reconocer la repetición.
6. **Given** un registro de cliente con foto del documento, **When** se envía, **Then** la imagen no viaja por el broker: el mensaje lleva únicamente su referencia — ubicación, tipo, tamaño y huella criptográfica.
7. **Given** una foto que supera los cinco megabytes o cuyo tipo no es JPEG ni PNG, **When** se envía, **Then** se rechaza por validación y no se publica ningún mensaje.
8. **Given** una transferencia que declara un escenario de pago de demostración válido, **When** se envía, **Then** el valor viaja intacto en el mensaje publicado y el Gateway se comporta igual que sin él.
9. **Given** una transferencia con un escenario de pago que no es uno de los tres valores admitidos, **When** se envía, **Then** se rechaza por validación y no se publica ningún mensaje; **Given** una transferencia que omite el campo, **When** se envía, **Then** se acepta con normalidad.

---

### User Story 4 - Una consulta espera respuesta, y el silencio también es una respuesta (Priority: P1)

Quien consulta un saldo, el estado de una transacción o el rastro de auditoría de una correlación obtiene el dato. Si el servicio dueño no contesta en cinco segundos, quien consultó recibe un error de tiempo de espera que dice explícitamente que la operación **no fue cancelada** y que puede volver a preguntar.

**Why this priority**: es la única vía por la que el frontend puede mostrar un resultado, y la consulta de auditoría por correlación es lo que cierra el ciclo de todos los comandos de la historia 3.

**Independent Test**: se entrega solo. Con un respondedor simulado se prueba el camino feliz; deteniéndolo se prueba el vencimiento del plazo sin esperar cinco segundos reales.

**Acceptance Scenarios**:

1. **Given** el servicio dueño respondiendo, **When** se consulta un saldo, **Then** se devuelve el saldo con el mismo identificador de correlación de la pregunta.
2. **Given** el servicio dueño sin responder, **When** se consulta, **Then** a los cinco segundos se devuelve un error de tiempo de espera que conserva el identificador de correlación y advierte que la operación sigue su curso.
3. **Given** dos consultas concurrentes, **When** ambas reciben respuesta, **Then** cada una recibe la suya: las respuestas se emparejan por identificador de correlación y jamás se cruzan.
4. **Given** una respuesta que llega después de vencido el plazo, **When** el Gateway la recibe, **Then** la descarta sin fallar y sin dejar la espera colgada.
5. **Given** un identificador de correlación de un comando ya ejecutado, **When** se consulta la auditoría con él, **Then** se devuelven los eventos registrados para esa correlación.
6. **Given** cualquier consulta, **When** se revisa el estado interno del Gateway tras miles de peticiones, **Then** no quedan esperas acumuladas: toda espera termina, resuelta o vencida.

---

### User Story 5 - Los cinco modos de fallo se distinguen entre sí y no filtran nada (Priority: P1)

Quien llama al Gateway puede saber, por la forma de la respuesta, si se equivocó al escribir la petición, si el negocio la rechazó, si nadie contestó a tiempo, si el broker está caído o si algo se rompió dentro. Ninguna de las cinco respuestas revela una credencial, una ruta interna ni un rastro de pila.

**Why this priority**: el criterio de aceptación 8 del ticket lo exige explícitamente y el frontend compartido depende de esta distinción para decidir qué mostrar. Sin ella, cinco módulos inventarán cinco taxonomías de error.

**Independent Test**: se entrega solo. Cinco pruebas provocan cada condición y verifican que la respuesta la identifica sin ambigüedad. Con el broker detenido se verifica además que existe un registro correlacionado del incidente.

**Acceptance Scenarios**:

1. **Given** cada una de las cinco condiciones de fallo, **When** se provoca, **Then** la respuesta la identifica con un tipo distinto y estable, y las cinco comparten una única forma común.
2. **Given** el broker detenido, **When** se llama cualquier ruta que publique, **Then** la respuesta indica indisponibilidad del broker — no un fallo interno genérico — y queda un registro que incluye el identificador de correlación.
3. **Given** cualquier fallo, **When** se inspecciona la respuesta, **Then** no contiene rastro de pila, ni cadena de conexión, ni credencial, ni nombre de servicio interno.
4. **Given** un rechazo de negocio devuelto por un servicio, **When** el Gateway lo traduce, **Then** conserva el código de fallo del catálogo de T-05 sin reinterpretarlo ni decidir sobre él.
5. **Given** cualquier respuesta de error, **When** se inspecciona, **Then** incluye el identificador de correlación, de modo que quien la reciba pueda consultar la auditoría con él.

---

### User Story 6 - Activar la cuenta desde el enlace del correo (Priority: P2)

Quien recibe el correo de activación abre el enlace y el sistema procesa el token sin que la persona tenga que iniciar sesión antes. Un token válido activa la cuenta y la página lo dice; uno usado, caducado o inventado no la activa, no cambia nada y la página lo dice también, sin revelar cuál de los tres casos fue. Es un enlace que se abre en un navegador: la respuesta es para una persona, no para un programa que consultará después.

**Why this priority**: cierra el ciclo de registro y es precondición del inicio de sesión (historia 1, escenario 4), pero el resto del Gateway se puede probar sin ella activando cuentas por otra vía.

**Independent Test**: se entrega solo, contra Customer Service simulado, con las tres variantes de token y con un simulador que además no contesta, para provocar el vencimiento del plazo.

**Acceptance Scenarios**:

1. **Given** un token de activación válido, **When** se abre la ruta pública de verificación, **Then** el Gateway publica el comando de verificación, espera el resultado correlacionado y responde, en esa misma respuesta, que la cuenta quedó activada, junto con su identificador de correlación.
2. **Given** un token ya usado, caducado o inventado, **When** se abre la ruta, **Then** el estado de la cuenta no cambia, la respuesta declara que la activación fue rechazada y no revela en cuál de los tres casos se cayó.
3. **Given** un token válido cuyo resultado no llega dentro de los cinco segundos, **When** vence el plazo, **Then** la respuesta declara vencimiento del plazo, dice explícitamente que la activación **no fue cancelada** e indica que su resultado se puede consultar por identificador de correlación.
4. **Given** una activación cualquiera, **When** se revisa el rastro de auditoría, **Then** el evento de verificación o de rechazo está registrado igual que antes: consumirlo para responder no lo quita de la auditoría.
5. **Given** cualquier llamada a esta ruta, **When** se revisan los registros del Gateway, **Then** el token de activación no aparece en ninguno.
6. **Given** un token ausente o de longitud fuera del rango admitido, **When** se llama la ruta, **Then** se rechaza por validación y no se publica ningún mensaje.
7. **Given** una cuenta recién activada por esta ruta, **When** su dueño inicia sesión, **Then** el inicio de sesión ya no se rechaza por cuenta sin activar (historia 1, escenario 4).

---

### User Story 7 - El shell del frontend existe una sola vez (Priority: P2)

Un desarrollador de T-16 a T-20 clona el repositorio, levanta el frontend con un comando y encuentra ya hechos el layout, la navegación a los cuatro módulos, el tema visual del sistema de diseño **y la sesión**: la pantalla de inicio de sesión, el token adjuntado a cada llamada, la expulsión cuando caduca y la navegación filtrada por rol. Solo tiene que añadir sus páginas dentro de la convención establecida.

**Why this priority**: es el desbloqueo de cinco tickets. Si cada quien construye su propio armazón, la interfaz que el enunciado pide "intuitiva, agradable y funcional" (§4.4, p. 15) sale incoherente — y sin sesión resuelta aquí, ninguno de los cinco puede siquiera llamar una ruta protegida desde el navegador, de modo que los cinco resolverían lo mismo de cinco formas.

**Independent Test**: se entrega solo. Un comando levanta el frontend, la navegación lleva a las cuatro páginas esqueleto, la inspección visual confirma los colores, la tipografía y los radios de `docs/DESIGN.md`, y una sesión de cada uno de los tres roles comprueba qué módulos ve cada uno.

**Acceptance Scenarios**:

1. **Given** un clone limpio, **When** se levanta el frontend en modo desarrollo, **Then** arranca sin errores y muestra el layout con su navegación.
2. **Given** el frontend levantado, **When** se navega a cada uno de los cuatro módulos — Clientes, Cuentas, Transferencias y Auditoría —, **Then** cada uno muestra una página propia con su título, aunque su contenido sea un esqueleto.
3. **Given** cualquier pantalla, **When** se comparan colores, tipografía, radios y rejilla contra `docs/DESIGN.md`, **Then** coinciden con los tokens declarados allí.
4. **Given** los importes mostrados en cualquier pantalla, **When** se inspeccionan, **Then** usan cifras tabulares, dos decimales, separador de miles y el prefijo de quetzales, con formato `es-GT`.
5. **Given** el repositorio, **When** se revisa la estructura, **Then** existe y está documentada la convención de dónde pone cada módulo sus páginas y sus componentes.
6. **Given** la dirección del Gateway, **When** se cambia por configuración de entorno, **Then** el frontend la usa sin recompilarse con la dirección incrustada.
7. **Given** un navegador sin sesión, **When** se intenta abrir cualquier módulo, **Then** el frontend lleva a la pantalla de inicio de sesión; las de inicio de sesión, registro y verificación de correo siguen siendo alcanzables.
8. **Given** credenciales válidas, **When** se inicia sesión, **Then** el frontend guarda el token y toda llamada posterior a una ruta protegida lo lleva adjunto, sin que la pantalla del módulo haga nada al respecto.
9. **Given** una sesión cuyo token caducó, **When** se llama una ruta protegida, **Then** el frontend descarta la sesión y lleva a la pantalla de inicio de sesión, y ese caso se presenta distinto de un rechazo de negocio.
10. **Given** una sesión de cada uno de los tres roles, **When** se compara la navegación visible con la matriz D-06, **Then** coinciden; **Given** la dirección de un módulo que ese rol no puede usar, **When** se escribe directamente, **Then** el módulo no se renderiza.
11. **Given** un frontend que ya ocultó una ruta por rol, **When** se llama esa misma ruta del Gateway con ese token, **Then** el Gateway la rechaza por autorización de todos modos.

---

### User Story 8 - Las cuatro piezas compartidas de interfaz asíncrona (Priority: P2)

Quien construye un módulo encuentra ya resueltas las cuatro cosas que toda pantalla de este sistema necesita: mostrar el identificador de correlación para diagnosticar, representar los cinco estados asíncronos, capturar un importe en quetzales y mantener estable una clave de idempotencia mientras la persona reintenta.

**Why this priority**: sin ellas los cinco módulos reimplementarían lo mismo de cinco formas. Depende de la historia 7, que aporta el armazón donde viven.

**Independent Test**: se entrega solo. Las cuatro piezas y los cinco estados de error se ejercitan por prueba automatizada sobre `app/lib/` contra respuestas simuladas del Gateway, sin necesitar el broker.

**Acceptance Scenarios**:

1. **Given** una respuesta cualquiera del Gateway, **When** se consume desde el envoltorio de acceso a la API, **Then** los cinco tipos de error llegan ya normalizados y distinguibles, sin que cada pantalla los interprete a mano.
2. **Given** una operación en curso, **When** se muestra su estado, **Then** el componente de estado asíncrono distingue pendiente, éxito, rechazo de negocio, tiempo de espera agotado e indisponibilidad del broker.
3. **Given** un identificador de correlación, **When** se muestra, **Then** es visible y se puede copiar con una acción.
4. **Given** el campo de importe, **When** se intenta escribir un valor menor que un centavo o con más de dos decimales, **Then** el campo lo impide.
5. **Given** una persona que reintenta una operación fallida, **When** reenvía sin recargar la página, **Then** la clave de idempotencia es la misma que la del primer intento.
6. **Given** una respuesta de aceptación del Gateway, **When** el frontend la recibe, **Then** **no** declara éxito: muestra estado pendiente hasta que una consulta de estado o de auditoría lo confirme.

---

### User Story 9 - El contrato está escrito y la frontera está probada (Priority: P3)

Quien va a construir un módulo lee un contrato versionado en el repositorio en lugar de leer el código del Gateway. Quien evalúa el proyecto comprueba, sin ejecutar nada, que el Gateway no tiene credenciales de base de datos ni habla por HTTP con ningún servicio interno.

**Why this priority**: es la evidencia del criterio 2.4 del enunciado (p. 24) y el insumo de los cinco tickets bloqueados, pero llega después de que exista lo que documenta.

**Independent Test**: se entrega solo. El contrato se valida contra su propio esquema y se compara ruta por ruta con el catálogo de T-05; una búsqueda estática recorre el código y la configuración del Gateway.

**Acceptance Scenarios**:

1. **Given** el repositorio, **When** se busca el contrato del API, **Then** existe, está versionado y declara todas las rutas con sus cargas, sus respuestas y sus cinco tipos de error.
2. **Given** el contrato, **When** se compara cada ruta con el catálogo de mensajes de T-05, **Then** cada una nombra un mensaje que existe en el catálogo con ese nombre exacto.
3. **Given** el contrato, **When** se revisa cada ruta protegida, **Then** declara qué roles la pueden usar, y esa declaración coincide con la matriz D-06.
4. **Given** el código y la configuración del Gateway, **When** se busca estáticamente, **Then** no aparece ninguna credencial ni cadena de conexión de base de datos.
5. **Given** el código del Gateway, **When** se busca estáticamente, **Then** no aparece ningún cliente HTTP dirigido a un servicio interno del sistema.
6. **Given** la imagen del Gateway, **When** se inspecciona su configuración de entorno, **Then** no declara ninguna variable de base de datos.

---

### Edge Cases

- **Un token válido de un cliente que ya fue dado de baja.** No hay revocación (ADR-010 la deja fuera de alcance): el token sigue siendo válido hasta una hora. El rechazo lo aplica el servicio dueño cuando recibe el mensaje, no el Gateway.
- **Una respuesta llega después del vencimiento del plazo.** Se descarta silenciosamente. Nadie la espera ya y no existe mensaje de cancelación en el catálogo.
- **El broker cae entre la validación y la publicación.** La petición se responde como indisponibilidad del broker. No hay reintento automático desde el Gateway: quien llamó decide si reintenta, y su clave de idempotencia hace inocuo el reintento.
- **El almacenamiento de objetos no responde al subir la foto.** El registro no puede continuar sin referencia; se responde con un fallo distinguible y no se publica el comando a medias.
- **Dos peticiones idénticas con la misma clave de idempotencia y distinto identificador de correlación.** Ambas se publican; reconocer la repetición es del servicio destinatario, no del Gateway (constitución V).
- **Un `multipart` sin la parte de la foto.** El catálogo admite la referencia nula: el registro procede sin foto y la validación de identidad ocurre por separado.
- **Un cliente que consulta el saldo de una cuenta ajena.** El Gateway **no** lo puede saber: no tiene base de datos y no conoce la propiedad de las cuentas. Autoriza por rol y deja la decisión de propiedad al servicio dueño, que responde con su rechazo nombrado.
- **Varias réplicas del Gateway.** Cada instancia espera sus respuestas en su propia cola exclusiva; una respuesta no puede aterrizar en la réplica que no preguntó.
- **El token de sesión caduca mientras se llena un formulario largo.** El frontend recibe el fallo de autenticación, lo distingue de un rechazo de negocio, descarta la sesión y lleva a la pantalla de inicio de sesión. Lo escrito en el formulario se pierde: no hay renovación de token en esta fase (ADR-010).
- **Customer Service no contesta la verificación de correo dentro del plazo.** La respuesta declara vencimiento del plazo, no un rechazo. La activación pudo ocurrir de todos modos: el evento sigue publicado y auditado, y quien abrió el enlace puede reintentar o consultar por correlación. Confundir silencio con rechazo dejaría cuentas activas cuyo dueño cree que no lo están.
- **El resultado de la verificación llega después del vencimiento.** Se descarta como cualquier respuesta tardía; el evento ya quedó en auditoría y el estado de la cuenta ya cambió en su servicio dueño.
- **Alguien abre dos veces el enlace del correo.** La segunda vez el token ya está usado y se responde con el mismo rechazo genérico que un token inventado, sin revelar que la primera vez sí funcionó.
- **El rol de una persona cambia mientras su sesión está viva.** El token lleva el rol de cuando se emitió y vale hasta una hora: la navegación sigue mostrando lo de antes. No hay revocación (ADR-010); el Gateway autoriza por lo que dice el token.

## Requirements *(mandatory)*

### Functional Requirements

**Frontera del Gateway**

- **FR-001**: El Gateway MUST ser el único componente del sistema que acepte peticiones HTTP desde fuera.
- **FR-002**: El Gateway MUST NOT declarar, contener ni usar credenciales de ninguna base de datos.
- **FR-003**: El Gateway MUST NOT invocar ningún servicio interno por HTTP. Toda comunicación con los cinco servicios ocurre por el broker.
- **FR-004**: Cada ruta MUST publicar el mensaje que le corresponde del catálogo de T-05, con su nombre exacto:

  | Ruta | Mensaje que publica | Respuesta que espera | Nombre usado en el texto del ticket |
  | --- | --- | --- | --- |
  | Inicio de sesión | `customer.authenticate.v1` | `customer.authenticate.replied.v1` | `customer.login.requested` / `.approved` / `.rejected` |
  | Verificación de correo | `customer.verify-email.v1` | `customer.email.verified.v1` / `customer.email.verification.rejected.v1`, consumidos correlacionados (FR-015b) | `customer.email.verification.requested` |
  | Registro de cliente | `customer.register.v1` | — (asíncrono) | `customer.register.requested` |
  | Actualización de cliente | `customer.update.v1` | — (asíncrono) | `customer.update.requested` |
  | Apertura de cuenta | `account.create.v1` | — (asíncrono) | `account.create.requested` |
  | Consulta de saldo | `account.balance.query.v1` | `account.balance.replied.v1` | `account.balance.requested` |
  | Solicitud de transferencia | `transfer.requested.v1` (enmendado por FR-021b) | — (asíncrono) | `transfer.requested` |
  | Estado de transacción | `transaction.status.requested.v1` | `transaction.status.replied.v1` | igual |
  | Consulta de auditoría | `audit.query.requested.v1` | `audit.query.replied.v1` | igual |

- **FR-005**: El Gateway MUST NOT tomar ninguna decisión de negocio: no calcula saldos, no aprueba ni rechaza operaciones, no orquesta la Saga y no interpreta los códigos de fallo que recibe más allá de traducirlos a una forma HTTP.
- **FR-006**: El Gateway MUST exponer rutas técnicas de salud y de disponibilidad, públicas y sin token.

**Autenticación y autorización**

- **FR-007**: El Gateway MUST emitir el token de sesión a partir de las reclamaciones que devuelve Customer Service, y MUST ser el único componente que lo firme y lo verifique.
- **FR-008**: El token MUST contener el identificador del cliente, el nombre de usuario y el rol, y MUST caducar en una hora sin mecanismo de renovación.
- **FR-009**: El Gateway MUST rechazar por falta de autenticación toda petición a una ruta protegida cuyo token esté ausente, mal firmado o caducado, y MUST NOT publicar mensaje alguno en ese caso.
- **FR-010**: El Gateway MUST rechazar por autorización, con un resultado distinto del anterior, toda petición cuyo rol no figure entre los autorizados para esa ruta según la matriz D-06.
- **FR-011**: El Gateway MUST declarar explícitamente, para cada ruta, si es pública y qué roles la pueden usar; esa declaración MUST derivarse de D-06 y MUST vivir en el contrato del API.
- **FR-012**: El Gateway MUST tomar la identidad que viaja en el sobre del mensaje del token verificado, nunca del cuerpo de la petición.
- **FR-013**: El Gateway MUST responder con un rechazo genérico e idéntico ante credenciales inválidas, correo no registrado y cuenta sin activar; MUST NOT permitir distinguir los tres casos por el cuerpo, el código, las cabeceras ni el tiempo de respuesta.
- **FR-014**: Las rutas de inicio de sesión, registro de cliente, verificación de correo, salud y disponibilidad MUST ser públicas. Todas las demás MUST requerir token.
- **FR-015**: El Gateway MUST NOT registrar en ningún log la contraseña ni el token de activación de correo.
- **FR-015b**: La ruta de verificación de correo MUST esperar el resultado correlacionado del comando de verificación durante cinco segundos como máximo y MUST devolver un veredicto —cuenta activada, o activación rechazada— en esa misma respuesta. La espera MUST usar el mismo mecanismo de correlación y el mismo plazo que las consultas con respuesta (FR-023 a FR-026), suscribiéndose a `customer.email.verified.v1` y `customer.email.verification.rejected.v1` y emparejándolos por identificador de correlación.
- **FR-015c**: Esa espera MUST NOT convertir al Gateway en decisor: quién activa y quién rechaza sigue siendo Customer Service, y el Gateway solo traslada su veredicto a una forma HTTP (FR-005). Los dos eventos MUST seguir publicándose para auditoría exactamente como los fijó T-05; consumirlos correlacionados MUST NOT alterar su contrato ni su enrutamiento.
- **FR-015d**: Cuando el resultado no llegue dentro del plazo, la ruta MUST responder con el tipo de fallo de vencimiento del plazo, MUST declarar que la activación **no fue cancelada** y MUST indicar que su resultado se puede consultar por identificador de correlación.
- **FR-015e**: El rechazo de activación MUST ser idéntico para token inventado, token ya usado y token caducado, y MUST NOT permitir distinguir los tres casos.
- **FR-016**: El secreto de firma MUST provenir del entorno y MUST NOT estar en el repositorio, en una imagen ni en un archivo de valores.

**Validación, correlación e idempotencia**

- **FR-017**: El Gateway MUST validar forma, tipos, campos obligatorios y límites de cada carga antes de publicar, y MUST NOT publicar nada cuando la validación falla.
- **FR-018**: El Gateway MUST generar un identificador de correlación cuando la petición no traiga uno, y MUST conservar el que traiga cuando lo traiga.
- **FR-019**: El Gateway MUST devolver el identificador de correlación en toda respuesta, incluidas las de error.
- **FR-020**: El Gateway MUST aceptar una clave de idempotencia del cliente y trasladarla al sobre del mensaje sin reinterpretarla.
- **FR-021**: El Gateway MUST generar el identificador de la transacción al solicitar una transferencia y devolverlo junto con la aceptación.
- **FR-021b**: El catálogo de T-05 MUST admitir el escenario de pago de demostración: `transfer.requested.v1` MUST incorporar un campo **opcional** `paymentScenario` que solo acepte `APPROVE`, `REJECT` o `TRANSIENT_FAILURE`. La enmienda MUST ser aditiva y retrocompatible —un mensaje que omita el campo MUST seguir siendo válido, sin cambio de versión— y MUST quedar registrada en `docs/events/` junto al resto del catálogo.
- **FR-021c**: El Gateway MUST aceptar `paymentScenario` en la ruta de transferencia, MUST rechazarlo por validación cuando su valor no sea uno de los tres, y MUST trasladarlo al mensaje sin interpretarlo. El Gateway MUST NOT alterar su propio comportamiento en función del valor: obedecerlo es de Transaction Service (FR-005).
- **FR-021d**: `paymentScenario` MUST estar declarado en el contrato del API como opcional y como recurso **de demostración**, de modo que su ausencia sea el camino normal.
- **FR-022**: El Gateway MUST responder con aceptación —sin resultado de negocio— a toda ruta cuyo resultado sea asíncrono.

**Consultas con respuesta**

- **FR-023**: El Gateway MUST esperar la respuesta de una consulta durante cinco segundos como máximo.
- **FR-024**: El Gateway MUST emparejar cada respuesta con su pregunta por identificador de correlación, y MUST NOT entregar la respuesta de una pregunta a otra.
- **FR-025**: El Gateway MUST descartar sin fallar cualquier respuesta que llegue después de vencido el plazo, y MUST NOT dejar esperas sin resolver.
- **FR-026**: El error de tiempo de espera MUST declarar que la operación no fue cancelada y MUST indicar que su resultado se puede consultar por identificador de correlación.

**Contrato de errores**

- **FR-027**: El Gateway MUST distinguir cinco tipos de fallo con una forma común: error de validación, rechazo de negocio, vencimiento del plazo de respuesta, broker no disponible y fallo interno.
- **FR-028**: Ninguna respuesta de error MUST revelar rastro de pila, cadena de conexión, credencial ni nombre de servicio interno.
- **FR-029**: Ante un broker inalcanzable, el Gateway MUST responder con el tipo de fallo correspondiente y MUST dejar un registro que incluya el identificador de correlación.
- **FR-030**: Un rechazo de negocio MUST conservar el código de fallo del catálogo de T-05 tal como lo emitió el servicio dueño.

**Foto del documento de identidad**

- **FR-031**: El Gateway MUST aceptar la foto del documento junto con los datos del cliente en una sola petición.
- **FR-032**: El Gateway MUST rechazar por validación toda foto que supere los cinco megabytes o cuyo tipo no sea JPEG ni PNG.
- **FR-033**: El Gateway MUST depositar la foto en el almacenamiento de objetos y publicar únicamente su referencia —ubicación, tipo, tamaño y huella SHA-256—, nunca los bytes.
- **FR-034**: El Gateway MUST NOT conservar la imagen en ningún almacenamiento propio ni persistente más allá del depósito de transferencia.
- **FR-035**: El Gateway MUST admitir un registro sin foto, publicando la referencia como ausente.

**Shell del frontend**

- **FR-036**: El frontend MUST ofrecer un layout único con navegación a los cuatro módulos: Clientes, Cuentas, Transferencias y Auditoría.
- **FR-037**: Cada uno de los cuatro módulos MUST tener su propia página con su título, aunque su contenido sea un esqueleto.
- **FR-038**: El frontend MUST aplicar los tokens de color, tipografía, radios y espaciado declarados en `docs/DESIGN.md`.
- **FR-039**: Los importes MUST mostrarse con cifras tabulares, dos decimales, separador de miles, prefijo de quetzales y formato `es-GT`.
- **FR-040**: El frontend MUST tomar la dirección del Gateway de la configuración de entorno, sin incrustarla en el código.
- **FR-041**: El frontend MUST ofrecer un único punto de acceso al Gateway que normalice los cinco tipos de error, de modo que ninguna pantalla los interprete por su cuenta.
- **FR-041b**: El frontend MUST ofrecer una pantalla de inicio de sesión, y esa pantalla MUST ser —junto con las de registro y verificación de correo— lo único alcanzable sin sesión activa.
- **FR-041c**: El frontend MUST conservar el token de la sesión activa en el navegador, y su punto único de acceso al Gateway (FR-041) MUST adjuntarlo a toda llamada a ruta protegida. Ninguna pantalla de módulo MUST manipular el token por su cuenta.
- **FR-041d**: Ante un fallo de autenticación —token ausente, caducado o rechazado— el frontend MUST descartar la sesión, MUST llevar a la pantalla de inicio de sesión y MUST presentar ese caso de forma distinguible de un rechazo de negocio.
- **FR-041e**: La navegación MUST mostrar únicamente los módulos que el rol de la sesión puede usar según la matriz D-06, y una ruta no autorizada para ese rol MUST NOT renderizarse aunque se alcance escribiendo su dirección.
- **FR-041f**: El filtrado por rol del frontend MUST derivarse de la misma matriz D-06 que aplica el Gateway y MUST NOT ser tratado como defensa: el Gateway MUST rechazar por autorización igual, aunque el frontend ya haya ocultado la ruta. El frontend oculta por comodidad; el Gateway prohíbe.
- **FR-041g**: El shell MUST resolver la sesión una sola vez y MUST NOT requerir que T-16 a T-20 la reimplementen. Quedan **fuera** de esta feature la renovación del token, la persistencia entre cierres del navegador y cualquier recordatorio de credenciales.
- **FR-042**: El frontend MUST ofrecer cuatro piezas compartidas: identificador de correlación visible y copiable, estado asíncrono con los cinco resultados, campo de importe en quetzales con mínimo de un centavo y dos decimales, y clave de idempotencia estable entre reintentos.
- **FR-043**: El frontend MUST NOT declarar éxito ante una respuesta de aceptación; MUST mostrar estado pendiente hasta confirmarlo por consulta de estado o de auditoría.
- **FR-044**: El repositorio MUST cubrir con prueba automatizada sobre `app/lib/` la lógica de las cuatro piezas compartidas y los cinco estados de error, sin necesitar el broker.
- **FR-045**: El repositorio MUST documentar la convención de dónde coloca cada módulo sus páginas y sus componentes.

**Contrato y evidencia**

- **FR-046**: El repositorio MUST contener un contrato del API versionado que declare todas las rutas, sus cargas, sus respuestas, sus cinco tipos de error y, por ruta protegida, los roles autorizados.
- **FR-047**: Cada ruta del contrato MUST nombrar un mensaje que exista con ese nombre exacto en el catálogo de T-05.
- **FR-048**: El paquete de evidencia MUST incluir pruebas de cada ruta, del vencimiento del plazo, de la correlación, del broker caído, de las rutas protegidas sin token y con rol insuficiente, de los cuatro desenlaces de la verificación de correo y de los tres valores del escenario de pago de demostración; mensajes observados en la administración de RabbitMQ; capturas del shell con sus módulos y con la navegación de cada uno de los tres roles; y el resultado de la búsqueda estática de FR-002 y FR-003.

### Key Entities

- **Sesión**: lo que el Gateway emite tras un inicio de sesión aprobado. Contiene identificador de cliente, nombre de usuario, rol y momento de caducidad. No se guarda en ninguna parte: existe únicamente en el token.
- **Identidad verificada**: el par identificador de cliente y rol que el Gateway extrae del token y coloca en el sobre de cada mensaje. Es lo único que los servicios ven de la autenticación.
- **Solicitud correlacionada**: una petición HTTP en curso, identificada por su identificador de correlación, que puede estar esperando una respuesta o haber sido ya aceptada. Toda espera termina.
- **Error del Gateway**: la forma común de las cinco maneras de fallar. Lleva tipo, mensaje apto para mostrar, identificador de correlación y, cuando existe, el código de fallo del catálogo de T-05.
- **Referencia de foto**: ubicación, tipo, tamaño y huella criptográfica de la imagen depositada en el almacenamiento de objetos. Es lo que viaja por el broker en lugar de los bytes.
- **Módulo del shell**: una de las cuatro áreas de navegación del frontend, con su ruta, su título, los roles que la pueden ver según D-06 y el lugar convenido donde su ticket dueño añadirá páginas y componentes.
- **Sesión del navegador**: el token vivo que el frontend guarda tras un inicio de sesión, con el rol que determina qué módulos se muestran. Se descarta al caducar o al ser rechazado, y no sobrevive al cierre del navegador.
- **Escenario de pago de demostración**: el valor opcional `APPROVE`, `REJECT` o `TRANSIENT_FAILURE` que acompaña una solicitud de transferencia para forzar un desenlace de la Saga durante la demostración. El Gateway lo valida y lo traslada; quien lo obedece es Transaction Service.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Las nueve rutas funcionales publican el mensaje correcto del catálogo de T-05: nueve de nueve verificadas contra la administración del broker.
- **SC-002**: Los tres modos de rechazo de inicio de sesión —contraseña incorrecta, correo inexistente, cuenta sin activar— producen respuestas indistinguibles entre sí en cuerpo, código y cabeceras.
- **SC-003**: Toda ruta protegida rechaza sin token y rechaza con rol no autorizado, con dos resultados distintos: cero rutas protegidas atravesables sin token.
- **SC-004**: Ninguna petición rechazada por validación, autenticación o autorización publica un mensaje: cero mensajes espurios en el broker en toda la batería de pruebas negativas.
- **SC-005**: Una consulta sin respuesta se resuelve en cinco segundos y devuelve un error de tiempo de espera identificable, sin dejar esperas acumuladas tras mil consultas vencidas.
- **SC-006**: Los cinco tipos de error son distinguibles por la respuesta y ninguno revela credenciales, rutas internas ni rastros de pila: cinco de cinco provocados y verificados.
- **SC-007**: Una búsqueda estática sobre el código y la configuración del Gateway encuentra cero credenciales de base de datos y cero clientes HTTP hacia servicios internos.
- **SC-008**: Un integrante con un clone limpio levanta el frontend con un comando y alcanza los cuatro módulos desde la navegación, sin editar código.
- **SC-009**: Las cuatro piezas compartidas y los cinco estados de error se ejercitan por prueba automatizada sobre `app/lib/` sin necesidad de broker.
- **SC-010**: Cada ruta del contrato versionado corresponde a un mensaje existente del catálogo de T-05: cero rutas huérfanas.
- **SC-011**: Un desarrollador de T-16 a T-20 puede construir su módulo leyendo únicamente el contrato del API y la convención de módulos, sin leer el código del Gateway.
- **SC-012**: La ruta de verificación de correo devuelve un veredicto en cinco segundos o menos: token válido activa y lo dice, token usado, caducado e inventado producen un rechazo idéntico entre los tres, y el silencio del servicio produce vencimiento del plazo y no un rechazo — cuatro de cuatro desenlaces provocados y verificados.
- **SC-013**: El escenario de pago de demostración viaja intacto al broker con los tres valores admitidos, un cuarto valor se rechaza por validación sin publicar, y un mensaje que omite el campo sigue validando contra el catálogo — la enmienda no rompe ningún contrato existente.
- **SC-014**: Para cada uno de los tres roles, los módulos visibles en la navegación coinciden exactamente con la matriz D-06, y ninguna ruta no autorizada se renderiza al escribir su dirección: tres de tres roles verificados.
- **SC-015**: Ninguno de los cinco módulos de T-16 a T-20 necesita escribir código de sesión: cero pantallas de inicio de sesión, cero manipulaciones del token y cero manejos de caducidad fuera del shell.

## Assumptions

- **La identidad no se re-verifica aguas abajo.** Los cinco servicios confían en la identidad del sobre. Es lo que ADR-010 decidió y descansa en que nadie publica al broker sin pasar por el Gateway.
- **No hay revocación de tokens.** ADR-010 la deja explícitamente fuera de alcance para esta fase; un token comprometido vale hasta una hora.
- **El Gateway sí escribe en el almacenamiento de objetos.** "Nunca persiste la imagen" del ticket significa que no la guarda en un almacenamiento propio: el depósito en el bucket de transferencia que provisiona T-06 es exactamente lo que ADR-012 le manda hacer, y su credencial solo permite escribir y leer ese bucket.
- **La propiedad de una cuenta la decide su servicio dueño.** El Gateway autoriza por rol; que un `CLIENTE` opere sobre una cuenta ajena lo rechaza Account Service con su código nombrado, porque el Gateway no tiene base de datos con la que saberlo.
- **`activationPending` en la respuesta aprobada de autenticación se traduce en rechazo de sesión.** Decidir si se emite un token es autenticación, no negocio: el Gateway no evalúa la credencial, solo se niega a emitir sesión para una cuenta que el servicio dueño marcó como pendiente.
- **El estado de una transferencia se consulta, no se espera.** El vencimiento del plazo no cancela nada; el catálogo de T-05 no tiene mensaje de cancelación.
- **Los servicios que consumen estos mensajes aún no existen.** Las pruebas de esta feature usan respondedores simulados sobre el broker real de T-06.
- **El frontend no tiene marco de pruebas de componentes** (TD-010). La evidencia de las historias 7 y 8 es la prueba automatizada sobre `app/lib/` y la captura, no una suite de componentes.
- **El plazo de cinco segundos es el mismo para las cuatro consultas**, tal como lo fijó T-05; esta feature no lo ajusta por ruta, y la verificación de correo lo reutiliza tal cual en lugar de inventar uno propio.
- **La verificación de correo no añade un mensaje al catálogo.** El Gateway consume los dos eventos que T-05 ya definió, emparejados por identificador de correlación. Que un evento se consuma para responder no lo convierte en respuesta: se sigue publicando y auditando igual, y cualquier otro consumidor lo sigue recibiendo.
- **`paymentScenario` es la única enmienda al catálogo de T-05 en esta feature.** Es aditiva, opcional y retrocompatible, de modo que no cambia la versión del mensaje ni obliga a T-16 a T-20 a nada. Existe para la demostración de la Saga y su ausencia es el camino normal.
- **La sesión del frontend no sobrevive al navegador.** Sin renovación de token (ADR-010), una sesión dura como mucho una hora; guardarla más allá del cierre solo alargaría la ventana de un token que ya no se puede revocar.
- **El filtrado por rol del frontend no es un control de seguridad.** Duplica la matriz D-06 para no ofrecer botones que fallarán; la autorización real la aplica el Gateway y las pruebas de la historia 2 la comprueban sin pasar por el navegador.

## Dependencies

| Depende de | Qué aporta | Estado |
| --- | --- | --- |
| T-04 | El monorepo, el aislamiento por capas y las siete aplicaciones que construyen | Cerrado |
| T-05 | Los 42 contratos de mensaje, el sobre, la topología y el plazo de cinco segundos | Cerrado |
| T-06 | El broker local, el bucket de transferencia y sus credenciales | Cerrado |
| T-01 | Los tokens visuales de `docs/DESIGN.md` | Cerrado |
| T-02 | La matriz de actores D-06 y el ciclo de vida del token de activación | Cerrado |
| T-03 | ADR-010 (sesión JWT) y ADR-012 (almacenamiento de objetos) | Cerrado |

Bloquea a T-16, T-17, T-18, T-19 y T-20 —cada uno construye su módulo contra este contrato— y a T-21.

### Trabajo que esta feature genera fuera de su alcance

- **Corregir el destino de la autorización por endpoint.** [`docs/domain/actors.md`](../../docs/domain/actors.md) y [`docs/domain/README.md`](../../docs/domain/README.md) apuntan la autorización a nivel de endpoint a **T-13**, que es el ticket del diagrama UML de secuencia. [ADR-010](../../docs/architecture/adr/ADR-010-authentication.md), decidido después, la asigna a **T-15**. Las dos referencias a T-13 deben corregirse.
- **El despliegue del Gateway** (imagen, manifiestos, secreto de firma en el cluster) es T-16 y siguientes según el plan de despliegue, no esta feature.
- **Las pantallas de cada módulo** son T-16 a T-20. Esta feature entrega el armazón y los esqueletos.
