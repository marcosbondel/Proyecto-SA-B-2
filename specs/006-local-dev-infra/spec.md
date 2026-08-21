# Feature Specification: Infraestructura local de desarrollo (T-06)

**Feature Branch**: `006-local-dev-infra`

**Created**: 2026-08-20

**Status**: Draft

**Input**: User description: "https://github.com/marcosbondel/Proyecto-SA-B-2/issues/13 — T-06 [CODE] Preparar la infraestructura local de desarrollo"

**Ticket origen**: [T-06 [CODE] Preparar la infraestructura local de desarrollo](https://github.com/marcosbondel/Proyecto-SA-B-2/issues/13) — responsable Enner Mendizabal; entrega 2026-08-19. Depende de T-03, T-04 y T-05 (los tres cerrados). Bloquea T-08, T-09, T-10, T-11, T-12, T-13, T-15 y T-16.

**Enunciado**: `docs/references/780_Proyecto_1_2S2026.pdf`, revisión del 2026-08-13 (27 páginas). Secciones aplicables, **con la página verificada contra el PDF**: §4.2 "Alcance del proyecto" — "Uso de bases de datos externas al cluster (contenedores Docker o servicios locales)" (**p. 8**); §4.2 "Restricciones arquitectónicas" — "Cada microservicio debe de poseer su base de datos" y la prohibición del antipatrón de un servicio conectado a varias bases, con penalización del 50 % (**p. 13**); §4.3 "Recursos y herramientas a utilizar" — mensajería (Kafka, RabbitMQ, NATS o gRPC async) y "Base de datos: Externa al cluster" (**p. 14**); §8.1 "Requisitos para optar a la calificación" — "Base de datos por servicio" y "Bases de datos externas" (la sección abre en la p. 19; las filas de base de datos están en la **p. 20**); §8.3 "Comentarios Generales" — "Uso de una sola base de datos compartida: −100 % de la nota" (**p. 27**).

> **Corrección de citas**: el ticket cita §4.2 en las pp. 6-7, §4.3 en la p. 13 y §8.3 en la p. 26. Están desfasadas una página —son las pp. 8, 14 y 27—, el mismo desfase de una página que ya se corrigió en la spec de T-05. La cita de §8.1 (pp. 19-20) sí es correcta. Las páginas de esta especificación son las verificadas.

**Qué es este documento**: la especificación del **entorno local de desarrollo** — el stack de Docker Compose que levanta las cinco bases PostgreSQL, el broker RabbitMQ y el almacenamiento de objetos, con sus nombres, credenciales, puertos, volúmenes, red y health checks, más la guía de arranque, limpieza y troubleshooting y el paquete de evidencia.

Esta feature **no redecide nada** ya fijado: los nombres de exchanges, colas, bindings y argumentos de reintento son los de [`docs/events/topology.md`](../../docs/events/topology.md) (T-05), vinculantes para T-06; las versiones `postgres:18.4` y `rabbitmq:4.3.4-management` están fijadas en [`infra/docker/README.md`](../../infra/docker/README.md); la conectividad desde el cluster la fijó ADR-007 (red Docker compartida como mecanismo principal, `host.docker.internal` como fallback documentado); y el almacenamiento de objetos lo ordena ADR-012. T-06 los **provisiona**, no los diseña.

> **Ampliación respecto al texto del ticket**: el texto de T-06 no menciona MinIO. ADR-012 (decidido durante T-05, después de escrito el ticket) obliga explícitamente a T-06 a provisionar el almacenamiento de objetos fuera del cluster y a definir su ventana de retención. Esta spec lo incluye por esa obligación registrada, no por el texto del ticket.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un comando levanta el entorno completo y sano (Priority: P1)

Un integrante con un clone limpio copia `.env.example`, rellena valores locales y ejecuta **un** comando de arranque. Minutos después tiene RabbitMQ con su management UI, las cinco bases PostgreSQL y MinIO corriendo y sanos, sin instalar nada más que Docker. Ninguna base vive dentro de Kubernetes.

**Why this priority**: es lo que desbloquea los ocho tickets bloqueados. Sin el entorno levantado no hay aislamiento que probar (US2), ni broker que verificar (US3), ni desarrollo de servicios contra algo real. §8.1 exige "Base de datos por servicio" y "Bases de datos externas" como requisitos para optar a calificación (p. 20).

**Independent Test**: se entrega solo. Desde un clone limpio: `docker compose config` sale con código 0, el comando de arranque levanta los siete componentes y `docker compose ps` los muestra healthy. No requiere ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un clone limpio del repositorio, **When** se ejecuta `docker compose config` sobre el archivo de `infra/docker/`, **Then** valida sin errores y su salida queda guardada como evidencia.
2. **Given** el `.env` rellenado a partir de `.env.example`, **When** se ejecuta el comando de arranque documentado, **Then** se levantan RabbitMQ, las cinco bases y MinIO, y todos reportan healthy mediante su health check.
3. **Given** el stack levantado, **When** se revisa el orden de dependencias, **Then** ninguna base depende de otra base: cada una arranca de forma independiente.
4. **Given** el broker healthy, **When** se abre el puerto de management, **Then** la UI permite inspeccionar exchanges, colas, acknowledgements y dead-letter queues.
5. **Given** el contenido del repositorio, **When** se revisa `infra/k8s/`, **Then** no contiene ningún archivo de base de datos, broker ni almacenamiento de objetos (constitución III).

---

### User Story 2 - Cada servicio se autentica únicamente contra su propia base (Priority: P1)

Quien configure el `DATABASE_URL` de un servicio encuentra credenciales que abren **una** base y ninguna otra. La prueba de aislamiento intenta las veinticinco combinaciones de cinco usuarios contra cinco bases: cinco entran, veinte son rechazadas.

**Why this priority**: es el guardián contra las dos penalizaciones más graves del enunciado — base compartida (−100 %, §8.3 p. 27) y servicio conectado a varias bases (−50 %, §4.2 p. 13) — y contra el riesgo que el propio ticket señala: una misma instancia física que oculta una base lógica compartida. El aislamiento se exige por credenciales, no por disciplina (ADR-005).

**Independent Test**: se entrega solo. Con el stack levantado se ejecuta la prueba de aislamiento: cada usuario autentica contra su base y es rechazado por las otras cuatro, y la salida queda guardada como evidencia.

**Acceptance Scenarios**:

1. **Given** las cinco bases corriendo, **When** el usuario de Customer se conecta a la base de Customer, **Then** autentica y opera; **When** el mismo usuario intenta conectarse a las bases de Account, Transaction, Payment y Notification & Audit, **Then** las cuatro conexiones son rechazadas.
2. **Given** cualquier par (usuario, base) de servicios distintos, **When** se intenta la autenticación cruzada, **Then** es rechazada — veinte combinaciones rechazadas de veinte.
3. **Given** la configuración de cada base, **When** se inspeccionan usuarios y permisos, **Then** ningún usuario tiene privilegios sobre una base que no sea la suya y no existe ningún usuario compartido entre servicios.
4. **Given** los cinco servicios Compose de base de datos, **When** se comparan sus nombres de servicio, bases, usuarios, puertos y volúmenes, **Then** los cinco valores de cada tipo son distintos entre sí.

---

### User Story 3 - El broker declara la topología de T-05 y demuestra un mensaje con `correlationId` (Priority: P1)

Levantado el broker, los cuatro exchanges (`bank.commands`, `bank.events`, `bank.replies`, `bank.errors`), las seis colas de trabajo con sus escaleras de reintento (1 s, 5 s, 30 s) y sus DLQ **ya existen** — declarados según `docs/events/topology.md`, no creados a mano. Sobre ese broker se publica y consume un mensaje de prueba cuyo `correlationId` se ve en la management UI, y un mensaje que agota sus reintentos termina en la DLQ con sus cabeceras.

**Why this priority**: el criterio 2.5 "Uso de broker" se califica 5 o 0 según el uso sea "correcto y consistente" (§8.2, p. 25), y la topología completa declarada desde la infraestructura es la mitad de esa evidencia. Además cierra la deuda **TD-014**: el adaptador `@bank/messaging` nunca se ha probado contra un RabbitMQ real.

**Independent Test**: se entrega solo. Con el stack levantado y sin ningún servicio de aplicación, se exporta la configuración del broker y se verifican los cuatro exchanges y las colas con sus argumentos; luego se ejecuta la prueba ejecutable de publicación/consumo con `correlationId`.

**Acceptance Scenarios**:

1. **Given** el broker recién levantado, **When** se exporta su configuración, **Then** constan los cuatro exchanges `topic` durables y las seis colas de trabajo durables, cada una con sus colas de reintento y su DLQ con los argumentos exactos de `docs/events/topology.md`.
2. **Given** la configuración exportada, **When** se compara con la topología de T-05, **Then** no hay ningún exchange, cola o argumento de más ni de menos, y la cola de respuestas del Gateway **no** está declarada (es exclusiva por instancia y nace en runtime).
3. **Given** el broker configurado, **When** se publica y consume un mensaje de prueba, **Then** el mensaje viaja con su `correlationId` visible y la prueba deja evidencia ejecutable.
4. **Given** un mensaje que agota sus reintentos, **When** se inspecciona la DLQ, **Then** el mensaje está allí con las cabeceras `x-attempt`, `x-failure-reason`, `x-failed-at` y `x-original-routing-key`.
5. **Given** los dos usuarios del broker, **When** se comparan, **Then** el usuario de aplicación es distinto del de administración y no tiene permisos de administrador.
6. **Given** el broker detenido con mensajes persistentes en una cola durable, **When** el broker vuelve a arrancar, **Then** los mensajes siguen allí.

---

### User Story 4 - Los datos sobreviven reinicios y los cuatro fallos exigidos están probados (Priority: P2)

El entorno no es desechable por accidente: cada base tiene su volumen nombrado y un reinicio de contenedores conserva los datos de desarrollo. Y los cuatro fallos que el ticket manda probar tienen evidencia ejecutable, no una afirmación en un párrafo.

**Why this priority**: sin volúmenes, cada `down` destruye el trabajo de desarrollo y el ciclo de demostración se alarga (ADR-005 ya cuenta con que los datos sobrevivan a `kind delete cluster`). Los fallos probados son la diferencia entre "debería aguantar" y "aguanta": son la evidencia de resiliencia que T-23 reutilizará.

**Independent Test**: se entrega solo. Se escribe un dato en cada base, se reinicia el stack, se verifica que los cinco datos siguen; luego se ejecutan las cuatro pruebas de fallo y se guarda su salida.

**Acceptance Scenarios**:

1. **Given** un dato escrito en cada una de las cinco bases, **When** los contenedores se detienen y vuelven a arrancar (`stop`/`start` o `down`/`up` sin `-v`), **Then** los cinco datos siguen presentes.
2. **Given** el stack completo sano, **When** se apaga una de las cinco bases, **Then** las otras cuatro siguen aceptando conexiones y RabbitMQ no se ve afectado.
3. **Given** una aplicación conectada al broker mediante `@bank/messaging`, **When** RabbitMQ deja de estar disponible, **Then** se observa un reintento controlado y un error visible — no un cuelgue silencioso ni un ciclo de crashes — y al volver el broker la conexión se restablece.
4. **Given** una cola con un consumidor detenido, **When** se publican mensajes dirigidos a ella, **Then** se conservan según la política definida (cola durable, mensajes persistentes) y se entregan cuando el consumidor vuelve.

---

### User Story 5 - La configuración es reproducible y los secretos nunca entran al repositorio (Priority: P2)

Cualquier integrante reproduce el entorno desde `.env.example` sin pedirle una contraseña a nadie por chat, y ninguna credencial real está committeada. La conexión está documentada desde los dos lugares desde los que se consume: procesos locales en el host y pods del cluster kind.

**Why this priority**: `docs/SECURITY.md` tiene dos marcas de bloqueo que esta feature cierra — la política de acceso entre servicios y el mecanismo local de carga de secretos — y ADR-007 obliga a T-06 a dejar la red en la que los nodos kind se puedan unir. Sin esta historia, cada máquina improvisa sus credenciales y la conexión desde el cluster se redescubre bajo presión en T-16.

**Independent Test**: se entrega solo. Se audita el repositorio en busca de credenciales reales (cero), se verifica que toda variable del stack está en `.env.example` con placeholder, y se sigue la guía para conectar desde el host y desde un pod de kind.

**Acceptance Scenarios**:

1. **Given** el archivo `.env.example`, **When** se compara con el Compose, **Then** toda variable referenciada existe en él con un placeholder — nunca un valor real — y toda variable del `.env.example` está documentada en la guía.
2. **Given** un arranque con una variable obligatoria ausente o vacía (host, puerto, usuario, contraseña, base o nombre de exchange), **When** se ejecuta la validación de inicio, **Then** falla rápido con un mensaje que nombra la variable que falta.
3. **Given** el stack corriendo, **When** un proceso local se conecta, **Then** usa `localhost` y el puerto publicado; **When** un pod del cluster kind se conecta, **Then** usa el mecanismo principal de ADR-007 (la red Docker compartida) o el fallback documentado `host.docker.internal`.
4. **Given** la red Docker del stack, **When** se inspecciona, **Then** es una red privada con nombre fijo y documentado a la que los nodos de kind pueden unirse.
5. **Given** `docs/SECURITY.md`, **When** se revisan sus marcas de bloqueo, **Then** la política de acceso entre servicios y el mecanismo local de carga de secretos quedan definidos (la parte de cluster sigue asignada a T-22).
6. **Given** el historial del repositorio tras el cambio, **When** se audita, **Then** no contiene ninguna credencial real nueva.

---

### User Story 6 - La limpieza del entorno está documentada y es segura (Priority: P3)

El entorno se puede detener, reiniciar y destruir con comandos documentados, y la destrucción de datos exige una acción explícita. Ningún paso de limpieza borra archivos del host por accidente.

**Why this priority**: el volumen que guarda los datos de desarrollo es valioso precisamente porque sobrevive a los reinicios; un comando de limpieza ambiguo lo destruye sin querer. Es P3 porque no bloquea el desarrollo, pero el ticket lo exige como criterio de aceptación.

**Independent Test**: se entrega solo. Se siguen los comandos de la guía en orden — arranque, parada, limpieza — y se verifica que los volúmenes solo desaparecen con la variante explícitamente destructiva.

**Acceptance Scenarios**:

1. **Given** la guía, **When** se ejecutan los comandos de parada y limpieza estándar, **Then** contenedores y red se eliminan y los volúmenes de datos se conservan.
2. **Given** la intención de empezar de cero, **When** se busca en la guía, **Then** existe una variante explícita y marcada como destructiva que además elimina los volúmenes.
3. **Given** cualquier comando de la guía, **When** se revisa, **Then** ninguno borra archivos del host fuera de los volúmenes Docker ni requiere `sudo`.
4. **Given** un fallo común (puerto ocupado, credenciales erróneas, contenedor unhealthy), **When** se consulta la guía, **Then** existe una sección de troubleshooting que lo cubre.

---

### Edge Cases

- **Un PostgreSQL local del desarrollador ya ocupa el 5432.** Los puertos publicados del stack son no estándar por defecto (5433 en adelante) y configurables por `.env`, de modo que el stack conviva con instalaciones previas sin pelear por el puerto.
- **`docker compose down -v` borra todos los datos de desarrollo.** Es deliberado y documentado como destructivo; la limpieza estándar nunca lo incluye.
- **Una base apagada a propósito para probar un fallo.** Las otras cuatro y el broker siguen sanos; la guía explica cómo levantar una sola base de vuelta sin tocar el resto.
- **`host.docker.internal` no resuelve igual en todos los sistemas operativos del equipo.** Por eso el mecanismo principal de ADR-007 es la red Docker compartida; `host.docker.internal` queda como fallback documentado con su configuración.
- **Un mensaje llega a una cola cuyo consumidor está detenido durante la demostración.** La cola es durable y el mensaje persistente: se conserva y se entrega al volver, visible en la management UI.
- **Un objeto subido a MinIO que nadie consume.** La ventana de retención definida (por defecto 24 horas) lo elimina; el almacenamiento es un búfer de transferencia, no un archivo permanente (ADR-012).
- **Volúmenes huérfanos tras varias limpiezas.** La guía incluye cómo listarlos y eliminarlos sin tocar los de otros proyectos.
- **El puerto de management de RabbitMQ o la consola de MinIO quedan expuestos.** Son puertos de desarrollo local sobre una red privada; sus credenciales son las de administración del stack, distintas de las de aplicación, y la guía dice cómo cambiarlas.

## Requirements *(mandatory)*

### Functional Requirements

**Stack y arranque**

- **FR-001**: El stack de desarrollo MUST vivir en `infra/docker/docker-compose.yml`, y `docker compose config` MUST validarlo con código de salida 0. MUST NOT existir ningún manifiesto de base de datos, broker o almacenamiento de objetos dentro de `infra/k8s/`.
- **FR-002**: Un único comando documentado MUST levantar el stack completo: RabbitMQ, las cinco bases PostgreSQL y MinIO. El stack MUST NOT incluir contenedores de aplicación (los construye el ticket de despliegue).
- **FR-003**: Cada componente MUST tener un health check: `pg_isready` con el usuario y la base propios en cada PostgreSQL, `rabbitmq-diagnostics ping` (o equivalente del contenedor) en RabbitMQ, y el endpoint de salud de MinIO. `docker compose ps` MUST mostrar el estado sano de los siete.

**Bases de datos aisladas**

- **FR-004**: MUST existir cinco servicios PostgreSQL independientes, imagen `postgres:18.4`, con esta tabla de nombres (valores por defecto, configurables por `.env`):

| Servicio Compose | Puerto host | Base | Usuario | Volumen |
| --- | --- | --- | --- | --- |
| `postgres-customer` | 5433 | `customer` | `customer_app` | `pgdata-customer` |
| `postgres-account` | 5434 | `account` | `account_app` | `pgdata-account` |
| `postgres-transaction` | 5435 | `transaction` | `transaction_app` | `pgdata-transaction` |
| `postgres-payment` | 5436 | `payment` | `payment_app` | `pgdata-payment` |
| `postgres-notification-audit` | 5437 | `notification_audit` | `notification_audit_app` | `pgdata-notification-audit` |

- **FR-005**: Cada usuario MUST autenticar únicamente contra su propia base, y ningún usuario MUST tener privilegios sobre otra base. MUST existir una prueba ejecutable de aislamiento: cinco autenticaciones propias exitosas y veinte cruzadas rechazadas, con su salida guardada como evidencia.
- **FR-006**: Cada base MUST usar un volumen nombrado propio; los datos MUST sobrevivir a `stop`/`start` y a `down`/`up` sin `-v`. Ningún dato de desarrollo MUST vivir en un bind mount del host ni dentro del contenedor sin volumen.

**Broker**

- **FR-007**: El broker MUST ser `rabbitmq:4.3.4-management` — nunca 4.2.x, cuyo soporte comunitario terminó el 2026-07-31 — con volumen persistente propio (`rabbitmq-data`) y puertos 5672 (AMQP) y 15672 (management UI).
- **FR-008**: MUST existir un usuario de administración y un usuario de aplicación **distintos**; el usuario de aplicación MUST NOT tener permisos de administrador, y su acceso MUST limitarse al vhost del sistema. Las aplicaciones se conectan siempre con el usuario de aplicación.
- **FR-009**: El broker MUST declarar la topología de [`docs/events/topology.md`](../../docs/events/topology.md) de forma reproducible al arrancar: los cuatro exchanges `topic` durables (`bank.commands`, `bank.events`, `bank.replies`, `bank.errors`), las seis colas de trabajo durables con sus colas de reintento (`Q.retry.1s`, `Q.retry.5s`, `Q.retry.30s` con `x-message-ttl` y dead-letter de vuelta a `Q`) y sus DLQ terminales. Los argumentos declarados MUST ser idénticos a los de la topología, de modo que las declaraciones que `@bank/messaging` hace al arrancar cada aplicación sean idempotentes contra ellos. La cola de respuestas del Gateway MUST NOT declararse: es exclusiva por instancia y nace en runtime.
- **FR-010**: MUST existir una prueba ejecutable contra el broker en ejecución que publique y consuma un mensaje de prueba con `correlationId`, y que demuestre el comportamiento ante broker no disponible: reintento controlado y error visible. Esta prueba cierra la deuda **TD-014**.
- **FR-011**: MUST existir evidencia de la topología declarada: exportación de la configuración del broker (o capturas de la management UI) donde se vean exchanges, colas, bindings, acknowledgements y DLQ.

**Almacenamiento de objetos (ADR-012)**

- **FR-012**: MUST existir un servicio MinIO fuera del cluster, con volumen persistente propio, el bucket `customer-identity-documents` creado al arrancar, credenciales de aplicación distintas de las de administración, y una ventana de retención definida y configurada — por defecto **24 horas** — tras la cual el objeto se elimina. La imagen de MinIO MUST quedar fijada con versión concreta en el plan, igual que las demás.

**Configuración y secretos**

- **FR-013**: MUST existir `.env.example` con todas las variables del stack como placeholders: por cada base, nombre, usuario, contraseña y puerto (`CUSTOMER_POSTGRES_DB`, `CUSTOMER_POSTGRES_USER`, `CUSTOMER_POSTGRES_PASSWORD`, `CUSTOMER_POSTGRES_PORT` y análogas para los otros cuatro); para el broker, usuario y contraseña de administración, usuario y contraseña de aplicación y puertos (`RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, `RABBITMQ_APP_USER`, `RABBITMQ_APP_PASSWORD`, puertos AMQP y de management); y para MinIO, credenciales de administración y de aplicación, puertos y nombre del bucket. MUST NOT contener credenciales reales.
- **FR-014**: MUST existir validación al inicio de host, puerto, usuario, contraseña, base y nombre de exchange: una variable obligatoria ausente o vacía MUST fallar rápido con un mensaje que la nombre.
- **FR-015**: MUST existir una red Docker privada con nombre fijo y documentado a la que los nodos de kind puedan unirse (mecanismo principal de ADR-007). La guía MUST documentar el acceso desde procesos locales (`localhost` y puerto publicado) y desde pods de kind, incluido el fallback `host.docker.internal` con su configuración. La verificación extremo a extremo desde Kubernetes se repite en T-16.
- **FR-016**: La guía MUST documentar los valores que cada aplicación consume — `DATABASE_URL` por servicio apuntando a su puerto y su base, `RABBITMQ_URL` con el usuario de aplicación, y el endpoint y bucket de MinIO — sin escribir valores reales.
- **FR-017**: La feature MUST definir en `docs/SECURITY.md` la política de acceso entre servicios y el mecanismo local de carga de secretos, cerrando sus dos marcas de bloqueo asignadas a T-06; la parte de cluster permanece asignada a T-22.

**Fallos y evidencia**

- **FR-018**: MUST existir evidencia ejecutable de los cuatro fallos del ticket: (a) una base apagada no impide que las otras cuatro arranquen y sirvan; (b) un servicio no puede autenticarse con credenciales de otro; (c) RabbitMQ no disponible produce reintento controlado y error visible; (d) una cola con consumidor detenido conserva los mensajes según la política definida.
- **FR-019**: La limpieza MUST estar documentada: parada, limpieza estándar que conserva volúmenes, y variante destructiva explícita que los elimina — sin que ningún comando borre archivos del host fuera de los volúmenes Docker — más una sección de troubleshooting.
- **FR-020**: El paquete de evidencia MUST incluir: salida de `docker compose config`, salida de los contenedores healthy, exportación o capturas de la configuración de RabbitMQ, y la salida de la prueba de aislamiento de credenciales y bases.
- **FR-021**: Al cerrarse la feature, las deudas **TD-014** y **TD-015** MUST quedar cerradas, la marca de bloqueo de `infra/docker/README.md` MUST retirarse, y `AGENTS.md` (estado del repositorio) y `docs/METHODOLOGY.md` (estado del ticket) MUST actualizarse en el mismo cambio.

### Key Entities

- **Stack de desarrollo**: el conjunto de los siete componentes Compose (cinco bases, broker, almacenamiento de objetos) con su red privada y sus volúmenes. Se levanta con un comando y se valida con `docker compose config`.
- **Base por servicio**: una instancia PostgreSQL con nombre, usuario, contraseña, puerto y volumen propios; la frontera que las penalizaciones del enunciado protegen.
- **Par de credenciales del broker**: usuario de administración (gestión y UI) y usuario de aplicación (publicar y consumir), con permisos distintos.
- **Topología declarada**: los exchanges, colas, escaleras de reintento y DLQ que el broker materializa al arrancar, fijados por T-05.
- **Búfer de objetos**: el bucket de MinIO con su ventana de retención; transferencia, no estado de negocio.
- **Superficie de configuración**: `.env.example`, la validación de inicio y los valores documentados que las aplicaciones consumen desde el host o desde kind.
- **Paquete de evidencia**: las salidas y exportaciones que demuestran los criterios de aceptación sin tener que repetirlos en vivo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `docker compose config` valida el archivo con código de salida **0**, desde un clone limpio.
- **SC-002**: Desde un clone limpio, un integrante levanta el stack completo con **dos pasos** (copiar y rellenar `.env`, un comando de arranque) y tiene los **siete** componentes healthy en **menos de 5 minutos** en una máquina de desarrollo.
- **SC-003**: La prueba de aislamiento muestra **5 de 5** autenticaciones propias exitosas y **20 de 20** cruzadas rechazadas.
- **SC-004**: Tras detener y rearrancar los contenedores, **5 de 5** bases conservan el dato escrito antes del reinicio.
- **SC-005**: El mensaje de prueba publicado y consumido muestra su `correlationId` en la evidencia, y un mensaje que agota sus reintentos aparece en la DLQ con sus cuatro cabeceras en **1 de 1** ejecuciones.
- **SC-006**: Los cuatro fallos exigidos tienen evidencia ejecutable guardada; **ninguno** queda descrito solo en prosa.
- **SC-007**: La auditoría del repositorio encuentra **cero** credenciales reales y **cero** variables del Compose ausentes de `.env.example`.
- **SC-008**: La limpieza estándar elimina contenedores y red conservando el **100 %** de los volúmenes de datos; solo la variante explícitamente destructiva los elimina, y **cero** comandos de la guía tocan archivos del host.

## Assumptions

- **MinIO está en el alcance aunque el texto del ticket no lo mencione.** ADR-012 lo ordena explícitamente para T-06 y la spec de T-05 lo registró como trabajo que le corresponde. Excluirlo dejaría el registro de cliente con foto sin infraestructura que lo demuestre.
- **"Una configuración de desarrollo reproducible y una configuración de cluster separada"** se interpreta como dos **formas documentadas de alcanzar el mismo stack**: procesos locales (`localhost` y puertos publicados) y pods del cluster kind (red compartida o `host.docker.internal`). No se interpreta como un cluster RabbitMQ de varios nodos: ADR-004 decidió un solo broker que corre en una laptop durante la demostración, y nada en el enunciado exige clustering del broker.
- **Los puertos 5433-5437, 5672, 15672, 9000 y 9001 son valores por defecto, no constantes.** Cualquiera puede sobreescribirlos en `.env` para resolver una colisión local sin editar el Compose.
- **El mecanismo concreto de declaración de la topología** (archivo de definiciones cargado al arranque u otro) se decide en el plan; lo que esta spec fija es el resultado: la topología existe tras el arranque, es reproducible, y sus argumentos son idénticos a los de `docs/events/topology.md` para que las declaraciones del adaptador sean idempotentes.
- **La forma de la prueba ejecutable del broker** (script o test de integración sobre `@bank/messaging`) se decide en el plan; TD-014 exige que sea ejecutable contra el broker real, no un mock.
- **Sin TLS en el entorno local.** Es un entorno de desarrollo en una red Docker privada; la política de secretos y la superficie expuesta quedan escritas en `docs/SECURITY.md`.
- **La ventana de retención por defecto de los objetos es 24 horas**, configurable. Es un búfer de transferencia: una foto que nadie consumió en un día no se va a consumir.
- **Los `.env.example` de cada aplicación** (el `DATABASE_URL` de cada servicio, el `RABBITMQ_URL`) se actualizan en los tickets de esos servicios; esta feature documenta los valores en su guía, que es de donde se copian.
- **La verificación de conectividad desde Kubernetes se repite en T-16**, como dice el propio ticket: aquí se documenta y se deja la red preparada, no se despliega nada en el cluster.
- **Esta feature no implementa servicios ni migra esquemas.** Produce el entorno, la configuración, la documentación y la evidencia. Las migraciones llegan con los tickets de servicio (T-16 a T-20 según el tablero).

## Dependencies

- **T-03** (cerrado) — ADR-004 (RabbitMQ y su versión mínima), ADR-005 (una base PostgreSQL por servicio, fuera del cluster, en `infra/docker/`), ADR-007 (red compartida con kind como mecanismo principal y `host.docker.internal` como fallback).
- **T-04** (cerrado) — el espacio de trabajo, el adaptador `@bank/messaging` cuya reconexión y política de reintentos se ejercitan aquí por primera vez contra un broker real (TD-014), y las versiones fijadas en `infra/docker/README.md`.
- **T-05** (cerrado) — [`docs/events/topology.md`](../../docs/events/topology.md), vinculante para los nombres y argumentos que el broker declara, y ADR-012, que añade MinIO al alcance de esta feature.
- **Bloquea** — T-08 a T-13 (diagramas y contrato del Gateway), T-15 y T-16, según el ticket.

### Trabajo que esta feature genera fuera de su alcance

| Destino | Qué queda pendiente | Por qué |
| --- | --- | --- |
| T-16 | Verificar extremo a extremo la conexión desde pods de kind | El ticket lo reserva explícitamente; aquí solo se prepara y documenta la red |
| T-22 | Cargar los secretos en el cluster (chart values, `--set-file`) | La marca de `docs/SECURITY.md` reparte el trabajo: local a T-06, cluster a T-22 |
| Tickets de servicio (T-16 a T-20) | Rellenar el `.env.example` de cada aplicación con los valores documentados en la guía | Las aplicaciones aún no existen; esta feature no las toca |
| T-24 | Medir SLI-5 desde las colas y DLQ que este stack hace visibles | Las métricas se miden sobre el sistema implementado |
