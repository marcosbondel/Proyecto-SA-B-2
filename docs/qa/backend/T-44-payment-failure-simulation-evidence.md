# T-44 — Evidencia: simulación avanzada de fallos (Payment Service y Gateway)

Registro manual, no regenerado por un script: la salida real de los comandos de
validación que pide `T-44.md`, capturada el día de la implementación. No se edita
a mano después de escrita; una revisión posterior debe volver a correr los
comandos y añadir una entrada nueva.

**Fecha**: 2026-10-05 · **Rama**: `feature/T-44` (apilada sobre `feature/T-43`) ·
**Alcance tocado**: `apps/packages/contracts`, `apps/services/payment-service`,
`apps/gateway`, `apps/web/test` (solo la prueba de paridad), `infra/`, `docs/`.

## Qué se implementó

Payment Service deja de ser un proveedor que solo responde lo que el `scenario` de
cada transferencia le dicta y gana uno que **falla solo**, a una tasa que un
administrador puede subir en caliente. Cubre el enunciado de la Fase 3 (§4.1,
*Payment Service — Simulación avanzada de fallos*) y la restricción de §4.2 (la
comunicación entre microservicios sigue siendo 100 % asíncrona por el broker).

| Capa | Qué se agregó |
| --- | --- |
| Contratos | `payment.simulation.update.v1`, `payment.simulation.query.v1` y `payment.simulation.replied.v1` (el catálogo pasa de 104 a 107). **Primer commit de la ficha**, con su test de contrato |
| Dominio | `domain/simulation.ts` (`answerFor`, `isValidSettings`): la tirada se reparte en un solo intervalo — timeout, luego fallo, luego éxito. `callProvider` y `decideAttempt` reciben la simulación como parámetro; nada lee `Math.random`, el reloj ni el entorno |
| Aplicación | `SimulationUseCase` (lee y cambia la simulación; solo `ADMINISTRADOR`); `ProcessPaymentUseCase` tira los dados y espera la latencia **antes** del `FOR UPDATE`; puertos `Randomness`, `Sleeper`, `ProviderTelemetry`, `SimulationSource` |
| Infraestructura | migración `005_payment_simulation_settings` (una fila, `id = 1`); `OtelProviderTelemetry`; `PAYMENT_SIM_*` en el entorno |
| Interfaces | `SimulationUpdateHandler` y `SimulationQueryHandler` sobre `payment.commands` (que ya enlazaba `payment.#`: sin topología nueva) |
| Gateway | `GET` y `PUT /api/payments/simulation`, solo `ADMINISTRADOR`; el contrato OpenAPI pasa de 27 a 28 rutas |
| Infra | `PAYMENT_SIM_*` en el ConfigMap del chart, en `values.yaml` y en los dos Compose; el Deployment de payment lleva el checksum del ConfigMap |

**No se tocó** `domain/payment.ts` más allá de pasar `simulation` a `callProvider`: la
escalera de reintentos (1 s / 5 s / 30 s) y la decisión `RETRY` / `EXHAUSTED` son las
mismas, y `test/isolation.spec.ts` sigue verde. El publicador sigue sin tener `send`.

## Catálogo de telemetría (lo que T-50 consolida)

### Métricas

| Métrica | Tipo | Unidad | Etiquetas |
| --- | --- | --- | --- |
| `bank.payment.provider.calls` | contador | `{call}` | `result` (`success` / `failure` / `timeout`), `source` (`scenario` / `configuration`) |
| `bank.payment.provider.duration` | histograma | `s` | `result` |
| `bank.payment.simulation.changes` | contador | `{change}` | `action` (`update` / `reset` / `denied`) |

- **Tasa de fallos externos** = `sum(calls{result!="success"}) / sum(calls)`: una sola
  métrica, así el numerador y el denominador no pueden desincronizarse.
- **Latencia del sistema externo simulado (p95)**: histograma, no promedio. Fronteras
  `0.005 … 30` s: el máximo es el techo de 30 s que admite el contrato, y las del medio son
  densas por debajo de 5 s, donde un proveedor lento empieza a costarle a la transferencia su
  presupuesto de SLO-2. Es la espera **medida** con el reloj inyectado, no la configurada.
- `source` separa los fallos que alguien guionó en la transferencia de los que produjo la
  perilla. Ninguna etiqueta es un identificador: el `paymentId` y el `transactionId` van
  en logs y atributos de span.

### Spans

| Span | Cuándo | Atributos |
| --- | --- | --- |
| `payment.provider call` | Cada intento **registrado** (uno superado por otra réplica no cuenta dos veces) | `bank.payment.id`, `bank.transfer.id`, `bank.payment.attempt`, `bank.payment.provider.result`, `bank.payment.provider.source`, `bank.payment.provider.latency_ms`, `bank.payment.will_retry`, `bank.payment.error_type`, `bank.correlation_id` |

Si el intento no fue un éxito, el span lleva el evento `simulated_failure`. **La compensación
visible como span ya existía**: es `saga.compensation ordered` / `completed` de
Transaction Service (T-43); lo nuevo es que ahora se puede provocar con la perilla. Los dos
servicios aún no comparten traza: el `traceparent` cruzará el broker en T-48.

### Logs

`provider answered` (info) y `simulated provider failure` (warn), con `correlationId`,
`transactionId`, `paymentId`, `attempt`, `providerResult`, `errorType`, `source`, `latencyMs`,
`outcome` (`retrying` / `exhausted` / `success`), **`simulated: true`** y, cuando hay SDK,
`traceId` y `spanId`. `provider simulation update|reset|denied` deja constancia de cada
cambio con los números que quedaron vigentes.

## Decisiones de diseño

- **El estado vive en la base de datos, en una sola fila.** El HPA puede llegar a cinco
  réplicas y un valor en memoria sería el de la réplica que recibió el comando. Cada intento
  lee la fila; el cambio rige para todas a la vez y sobrevive a un reinicio. Sin fila rigen
  los valores del ConfigMap, y un `reset` la borra. `id = 1` con un `CHECK` impide una segunda.
- **El `scenario` explícito manda.** La simulación solo aplica a un pago cuya transferencia
  no indicó ninguno: un ensayo tiene que ser repetible, y así `images:flow` y los tests no
  cambian de comportamiento aunque el administrador suba la tasa al 100 %.
- **La espera ocurre antes del lock.** Un proveedor que tarda dos segundos no puede retener
  dos segundos la fila del pago: el manejador y el sweeper harían cola detrás y el «proveedor
  lento» se volvería una base de datos lenta. Un *timeout* sigue devolviéndose de inmediato:
  esperar a que «no responda» solo retendría el presupuesto de la Saga.
- **Un fallo intermitente es transitorio**, no un rechazo permanente: un proveedor inestable
  puede responder en el siguiente intento, así que sube por la escalera. Con 100 % de fallo
  agota los cuatro intentos y la Saga compensa (`PAYMENT_RETRIES_EXHAUSTED`).
- **Todo o `reset`, nunca un conjunto parcial.** Un `PATCH` obligaría a Payment Service a
  mezclar con los valores vigentes y a rechazar una suma mayor a 100 % con una respuesta que
  el contrato no tiene forma de expresar. El esquema del comando lo prohíbe y el Gateway lo
  repite en español.
- **Dos candados para el rol.** El Gateway rechaza con 403 sin publicar nada; Payment Service
  vuelve a comprobar la identidad del sobre, porque es alcanzable por el broker y no confía en
  quien le habla. Un comando de otro rol no cambia nada y se contesta con lo vigente
  (la respuesta no tiene forma para un rechazo: inventar una convertiría al rechazado en un 500).
- **Los dados y la espera son puertos.** `Randomness` y `Sleeper` se inyectan, así «el 30 %
  falla» se prueba como «0,29 falla y 0,31 no», sin semilla ni tolerancia estadística, y la
  latencia se prueba sin dormir.

## Validación

### Pruebas unitarias y de contrato

| Paquete | Resultado |
| --- | --- |
| `@bank/contracts` | 18 suites, 846 casos (los 3 contratos: identidad, catálogo, enrutamiento a `payment.commands`, 13 payloads rechazados) |
| `payment-service` | 14 suites, 195 casos; nuevos en `simulation.spec.ts` (dominio puro), `simulation-use-case.spec.ts`, `provider-telemetry.spec.ts` (SDK real de OpenTelemetry con exporters en memoria), `simulation-handlers.spec.ts`, `environment.spec.ts` y las dos suites de integración de abajo |
| `gateway` | `payment-simulation-routes.spec.ts`: 28 casos (rol, nada publicado si se rechaza, 16 cuerpos rechazados, 504, respuesta que no cumple el contrato) |
| `apps/web` | `navigation-parity.test.mjs`: la prueba que cuenta los `@Roles(` de `payments.controller.ts` falló (3 ≠ 1) y es exactamente lo que debía hacer; ahora fija las dos rutas nuevas como solo-`ADMINISTRADOR` |

Las pruebas de integración de `payment-service` corren contra un PostgreSQL 18.4 desechable
(`docker run … postgres:18.4`): **45 casos pasan** (195 en total en el servicio), 28 de ellos nuevos, en
tres archivos:

- `repository.integration.spec.ts` (7 nuevos): fila ausente → `null`, fracciones exactas, una sola fila aunque
  se cambie varias veces, visible desde otra conexión, `clear` idempotente, los `CHECK` de rango y de fila única.
- `simulation.integration.spec.ts` (7): los casos de uso por el repositorio real. La escalera completa al 100 % de
  fallo deja el pago `FAILED` con sus cinco eventos en el outbox; un timeout se registra como `TIMEOUT`; **un cambio
  hecho desde una réplica lo ve el siguiente intento de otra**; el `reset` vale para todas; un `scenario` explícito
  sigue mandando; y, sobre todo, **mientras el proveedor simulado «piensa», otra conexión puede tomar la fila del
  pago con `FOR UPDATE NOWAIT`**, que es la razón de esperar antes del lock.
- `simulation-handlers.integration.spec.ts` (14): desde la puerta del broker hasta la fila. Un cambio del
  administrador se persiste y se contesta con lo vigente; un cliente, un cajero o un mensaje sin identidad **no
  escriben ninguna fila** (ni siquiera un `reset`, que borraría el override real); cuatro cargas que el contrato
  rechazaría nunca llegan al repositorio; el `reset` borra la fila; la consulta ve primero los valores por defecto y
  luego el override; dos administradores cambiando la perilla a la vez dejan **una fila coherente** (una de las dos
  enteras, nunca la tasa de una con la latencia de la otra); y dos réplicas que se disputan el mismo intento con el
  proveedor lento lo registran **una sola vez**.

### Pirámide de pruebas

El CI corre `pnpm test:pyramid --require-executed --without-e2e` y **falla** si la integración de un servicio
se aparta más de 1,5 puntos de su objetivo (22,2 % de lo propio). Reproducido localmente con una base `*_pyramid`
por servicio (y el parche de `npx.cmd`, ver abajo):

- Con las suites de integración del primer intento (31 casos), `payment-service` quedaba en **17,1 %** y el script
  terminaba con `exit=1`: ese push habría roto el CI. La lógica de la ficha es casi toda pura (dominio y casos de
  uso con dobles), que es lo que se pidió, así que la proporción no salía sola.
- Se agregó `simulation-handlers.integration.spec.ts` (14 casos, todos sobre un riesgo real de la base de datos,
  no relleno): `payment-service` pasa a 45 de integración sobre 195 y el script termina con `exit=0`
  («la pirámide está dentro de la tolerancia»).
- Sin `--without-e2e`, el sistema sigue con las dos desviaciones que ya existían antes de T-41
  (`unit` ≈ 73 % frente a 70 %, `e2e` ≈ 6,7 % frente a 10 %); el CI no las mide porque pasa `--without-e2e`.

### Mutaciones

Se rompió una pieza a la vez y se corrió la suite; cada mutante debía matar al menos una prueba.

| Mutación | Resultado |
| --- | --- |
| `<` → `<=` en la frontera del timeout | muerta (4 fallos) |
| el `scenario` explícito deja de ganar | muerta |
| el fallo intermitente pasa a permanente | muerta (13 fallos) |
| un timeout espera su latencia | muerta |
| cualquiera puede cambiar la simulación | muerta (5 fallos) |
| `reset` no borra el override | muerta |
| el fallo no se marca `simulated` | muerta |
| la latencia se registra en ms y no en s | muerta |
| la espera se mueve después del intento | muerta |
| se reporta un intento superado por otra réplica | **sobrevive**: es un mutante equivalente — `outcome` solo se asigna dentro de `decide`, que un intento superado nunca alcanza, así que la guarda `recorded.kind === 'RECORDED'` es redundante a propósito |

### Contra las imágenes reales

Stack de `docker-compose.images.yml` con `payment-service` y `gateway` reconstruidos
(`--allow-dirty`), y un script que habla con el Gateway como lo haría un cliente. **22 de 22**:

- `GET` y `PUT`: 401 sin token, 403 para `CLIENTE` y `CAJERO_RECEPTOR`, 200 para `ADMINISTRADOR`.
- Cinco cuerpos inválidos devuelven 400 con mensaje en español y la simulación **no** cambia.
- Con 100 % de fallo, `PUT` responde 200 `source: RUNTIME`, `GET` lo ve **sin reiniciar nada**, y una
  transferencia sin `scenario` termina `COMPENSATED` en ~8 s con el saldo intacto
  (`502800` antes y después). Transaction Service registra
  `PAYMENT_FAILED … PAYMENT_RETRIES_EXHAUSTED → DEBIT_COMPENSATED`, fase `FAILED`.
- Con 100 % de fallo, una transferencia `paymentScenario: APPROVE` sigue `COMPLETED`.
- `{"reset": true}` devuelve `DEFAULTS` y la siguiente transferencia se completa en ~1,2 s.
- Con `latencyMs: 3000`, la transferencia tarda 4,2 s frente a 1,1 s sin latencia.
- Con 40 % de fallo y 12 transferencias concurrentes, todas llegan a un estado final; el log
  de Payment cuenta fallos y éxitos con `simulated: true`.
- Reiniciar el contenedor de Payment con una simulación activa: `GET` sigue devolviendo
  `RUNTIME` 25 / 5 / 120, y la fila está en `payment_simulation_settings`.

### Contra el RabbitMQ real (Gateway)

Con `RABBITMQ_URL` apuntando al broker del stack local, las tres suites de integración del
Gateway que recorren las rutas contra el broker de verdad:

| Suite | Resultado |
| --- | --- |
| `publish-routing.integration.spec.ts` | pasa (39 casos): `GET` y `PUT /api/payments/simulation` publican su comando con la routing key y el exchange correctos |
| `envelope-and-replies.integration.spec.ts` | pasa (36 casos) |
| `reply-correlation.integration.spec.ts` | pasa (**24 casos**: los 22 de antes y **2 nuevos** para las rutas de T-44, que faltaban en su tabla): la respuesta `payment.simulation.replied.v1`, entregada por `bank.replies` desde otro proceso, cierra la espera en la cola exclusiva del Gateway |

**`reply-correlation` solo es fiable con los consumidores de negocio detenidos.** Con el stack
completo levantado, la primera corrida falló 7 casos de 22: los servicios reales (customer,
account, transaction, payment y audit) consumen las mismas colas y contestan antes que el doble, con
datos reales (404, los tres billers reales, `total: 653` en la auditoría). Con
`docker stop customer-service account-service transaction-service payment-service notification-audit-service`
pasan los 24. Es el hallazgo ambiental que el propio comentario de la suite ya documenta; no es un
defecto del Gateway ni de T-44, y en el CI esas colas no tienen otro consumidor.

### E2E contra el stack (suites de `test/e2e`)

`node test/e2e/run-all.mjs` con `GATEWAY_URL=http://localhost:3100`, el broker sano y
`NOTIFICATION_CHANNEL=simulated` (con `resend` el enlace de activación no sale por el log y no se puede
aprovisionar ningún cliente nuevo: 39 casos quedan omitidos). Resultado: **132 de 135**, sin casos
omitidos por activación.

| Suite | Resultado |
| --- | --- |
| accounts-deposits, notifications-audit, payments, rbac-matrix, registration-activation, resilience | 18, 13, 13, 26, 20 y 6 casos: todos pasan |
| transfers-saga | 16 de 16, incluidos los cuatro desenlaces de la Saga (éxito, rechazo, fallo transitorio, timeout) con compensación y saldo exacto |
| auth-session | 11 de 12: `SEC-02` |
| kyc-identity | 9 de 11: `PENDING-01` y `PENDING-02` |

Los tres fallos **ya estaban en el reporte versionado en `HEAD`** (`docs/qa/pyramid-e2e.json`), con el mismo
síntoma (`SEC-02`: se queda en `/login` sin mostrar error; `PENDING-*`: el cliente recién registrado no
aparece en la lista, `presente=false`, `total=100`). No son de T-41 a T-44 y no se tocaron.

Para que `transfers-saga` pudiera correr hubo que corregir dos cosas **de las pruebas**, no del sistema:

- `test/e2e/support/seed.mjs` abría la cuenta de ahorro sin depósito inicial. Desde T-27 una cuenta de ahorro
  exige Q100.00 al abrirse, así que se rechazaba y luego el saldo daba 404. Ahora abre con
  `initialDeposit` de Q100.00 (como ya hace `accounts-deposits`), y `TX-NOFUNDS-01` usa un monto (Q500.00) que
  sigue superando ese saldo.
- `TX-IDEMPOTENT-01` exigía el mismo `transactionId` en la respuesta del `POST`. El Gateway acuña un id por
  solicitud y Transaction Service lo resuelve con su tabla de alias: el reintento recibe su propio id, que
  resuelve a la transferencia que ya existe. Comprobado a mano con dos `POST` de la misma clave: ambos ids
  resuelven a la misma transferencia y el débito ocurre una sola vez. La prueba ahora comprueba eso, y espera
  a que termine antes de leer el saldo (antes dejaba el débito en vuelo y contaminaba `TX-OWNACCOUNTS-01`).

### Riesgos de correr las suites de integración contra un stack vivo

Tres cosas que se aprendieron al correrlas contra el broker del stack local, y que conviene saber:

- **`broker.integration.spec.ts` borraba el exchange real `bank.events`** y con él todos los enlaces de las
  colas de los servicios y de la cola de respuestas del Gateway: las activaciones de correo daban 504 hasta
  reiniciar cada servicio. Ahora usa un exchange privado con sufijo aleatorio.
- **Las rutas de la simulación se publican de verdad.** Los fixtures de `route-fixtures.ts` se envían al
  broker real, y `payment.commands` es durable: con el stack arriba (o arrancado después) el Payment Service real
  aplica el comando. El `PUT` del fixture mandaba 30 % de fallo, 10 % de timeout y 250 ms, y dejó la
  simulación así hasta que se hizo un `reset`. Ahora el fixture envía `{"reset": true}`, que solo devuelve la
  simulación a los valores del ConfigMap.
- `reply-correlation` solo es fiable con los consumidores de negocio detenidos (ver arriba).

### Chart

`helm lint` sin fallos y `helm template` renderiza las tres variables en el ConfigMap, el
Deployment de payment las toma de ahí y lleva `checksum/config`.

## Lo que no se verificó

### Depende de tickets posteriores (T-48, T-49, T-50)

La ficha no tiene dependencias y está completa: su propia sección «Convenciones mínimas de
telemetría (Fase A)» dice que la plataforma llega después y pide verificar con exporters en
memoria. Estas dos cosas solo se pueden ver cuando esa plataforma exista.

- **Nada de esto se ha visto en Prometheus, Jaeger o Grafana**: no hay SDK registrado hasta
  T-48. Las métricas, los spans y los logs se comprobaron con exporters en memoria y con las
  líneas JSON del contenedor, y las consultas del anexo de `docs/sre/sli-slo-sla.md` **no se han
  ejecutado**.
- **La compensación como span, de punta a punta, no se vio**: se vio el log
  `transfer step … DEBIT_COMPENSATED` y el estado `COMPENSATED`; los spans `saga.compensation *`
  los comprobó T-43 con exporters en memoria. Payment y Transaction aún no están en la misma
  traza: el `traceparent` cruza el broker en T-48.

### No ejecutado por decisión o por límite del entorno

- **La tasa efectiva no se midió estadísticamente** con tráfico real: los límites se prueban con
  tiradas fijas, y las demostraciones (12 transferencias al 40 %, y cuatro al 50 % + 20 %) solo
  prueban que la perilla muerde.
- **No hay pantalla** para la perilla: la ficha no la pide. Se usa por `PUT /api/payments/simulation`.
- `pnpm test:pyramid` no corre en Windows sin el parche local de `npx.cmd` (`execFileSync('npx', …)`
  sin shell); se corrió con una copia temporal que se borró, y los informes `docs/qa/pyramid.*` se
  restauraron.
- `web#build` falló una vez dentro de `turbo run … test build` con `NUXT_B7021` (manifiesto del cliente
  no emitido) porque `web:test` y `web:build` comparten la caché de Nuxt cuando corren en paralelo; solo,
  `turbo run build --filter=web --force` pasa. No se tocó código de `apps/web`, solo una prueba.
