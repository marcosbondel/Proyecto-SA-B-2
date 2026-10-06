# T-41 — Evidencia: telemetría del ciclo de vida del cliente (Customer Service)

Registro manual, no regenerado por un script: la salida real de los comandos de
validación que pide `T-41.md`, capturada el día de la implementación. No se edita
a mano después de escrita; una revisión posterior debe volver a correr los
comandos y añadir una entrada nueva.

**Fecha**: 2026-10-04 · **Rama**: `feature/T-41` · **Alcance tocado**:
`apps/services/customer-service`, `pnpm-workspace.yaml`, `docs/`.

## Qué se implementó

El ciclo de vida del cliente (creación, verificación KYC, rechazo) se vuelve
observable: un span, una línea de log y, para una decisión KYC, dos métricas por
cada transición. Cubre el enunciado de la Fase 3 (§4.1, *Customer Service —
Trazabilidad de ciclo de vida del cliente*).

| Capa | Qué se agregó |
| --- | --- |
| Aplicación | Puerto `LifecycleTelemetry` y `CreationSpan` en `ports.ts`; `findCreationTrace` en `CustomerRepository`; instrumentación en `RegisterCustomerUseCase`, `SetKycStatusUseCase`, `SetIdentityVerdictUseCase` y `ValidateIdentityUseCase` |
| Infraestructura | `OtelLifecycleTelemetry` (solo `@opentelemetry/api`); migración `008_customers_creation_trace`; `creation_trace` en `PostgresCustomerRepository` |
| Interfaces | `LogFields` con `transition`, `path`, `traceId`, `spanId`; cableado por entrega en `main.ts` |
| Dependencias | `@opentelemetry/api` (producción); `sdk-trace-base` y `sdk-metrics` solo como devDependencies, para los exporters en memoria |
| Tests | `test/lifecycle-telemetry.spec.ts` (20 casos) y casos nuevos en `use-cases.spec.ts` y `repository.integration.spec.ts` |

**No se agregó** ninguna llamada HTTP entre servicios, ninguna ruta del Gateway ni
ningún cambio en `apps/web`: `test/isolation.spec.ts` sigue verde. La parte de
frontend de la Fase 3 (mostrar `correlationId` / `traceId` y la pantalla de
auditoría) pertenece a T-45.

## Catálogo de telemetría (lo que T-50 consolida)

### Spans (instrumentación `customer-service`)

| Span | Cuándo | Atributos |
| --- | --- | --- |
| `customer.lifecycle created` | Cliente creado | `bank.customer.transition`, `bank.customer.path`, `bank.customer.id`, `bank.correlation_id` |
| `customer.lifecycle verified` | KYC verificado | los mismos; **hijo** del span de creación (misma traza) |
| `customer.lifecycle rejected` | KYC rechazado | los mismos; **hijo** del span de creación (misma traza) |
| `customer.lifecycle refused` | Registro rechazado antes de existir el cliente | `bank.customer.transition`, `bank.customer.refusal`, `bank.customer.id`, `bank.correlation_id` |

`path` es `counter` (registrado por personal: se crea y verifica en el mismo
instante) o `review` (verificado o rechazado después).

### Métricas

| Métrica | Tipo | Unidad | Etiquetas |
| --- | --- | --- | --- |
| `bank.customer.kyc.decisions` | contador | `{decision}` | `result` (`verified` / `rejected`), `path` |
| `bank.customer.kyc.time_to_decision` | histograma | `s` | `path` |
| `bank.customer.registration.refusals` | contador | `{registration}` | `reason` (cuatro valores cerrados) |

El histograma solo registra verificaciones y sus fronteras van de 1 s a 7 días,
porque las del SDK por defecto terminan en 10 s y dejarían todo en el último
cubo. Ninguna etiqueta es un identificador.

### Logs (una línea JSON por cambio de estado)

`customer created`, `customer verified`, `customer rejected`,
`customer registration refused` y `customer <x> ignored`. Campos: `correlationId`,
`customerId`, `transition`, `path`, `outcome`, `reason` (cuando aplica) y
`traceId` / `spanId` (cuando hay SDK registrado).

## Decisiones de diseño

- **La creación y la decisión comparten una sola traza, por padre.** El enunciado
  (§4.1, Customer Service) pide la traza del "flujo completo desde creación hasta
  verificación", y dos trazas unidas por un *link* no lo muestran en Jaeger ni en
  Tempo: buscar la de creación no traía la verificación. El contexto del span de
  creación se guarda en `customers.creation_trace` **dentro de la misma
  transacción** que la fila (el span se abre antes del insert), y la decisión
  posterior abre su span como **hijo** de ese contexto remoto. Primera versión de
  este ticket: *link*; se cambió al contrastarla con el texto del enunciado.
  **Costo asumido:** una traza que puede abarcar horas o días (la verificación
  humana puede tardar); Tempo la admite. La petición que provocó la decisión
  (p. ej. la del Gateway cuando T-48 propague el contexto) queda alcanzable como
  *link* del span de decisión. Sin SDK el contexto no es válido y la columna queda
  en `NULL`; una decisión sobre un cliente sin contexto, o con uno malformado, se
  registra igual, sin padre.
- **El `customerId` va en spans y logs, nunca como etiqueta de métrica.**
- **Una repetición cuenta de nuevo.** Rechazar a un cliente que ya está `REJECTED`
  es legal en el dominio (`REJECTED → REJECTED`), así que el contador suma otra vez.
  `VERIFIED` es terminal, de modo que una verificación repetida no cuenta: queda en
  el log como `ignored`.
- **Un cliente registrado por personal cuenta como verificado con tiempo ~0.** Se
  separa con `path=counter` para que no distorsione el p95 de las revisiones.
- **La revalidación de identidad también decide KYC.** `recordIdentityVerdict`
  mueve `kycStatus` junto con `identityStatus`, así que `ValidateIdentityUseCase`
  está instrumentado igual que los otros caminos. (Esa ruta publica eventos de
  identidad pero no `customer.kyc.*`; es una inconsistencia previa que este ticket
  no toca.)

## Comandos ejecutados y resultado real

Todos con `--force` (sin caché de Turbo), salvo lo indicado.

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | 11 / 11 tareas correctas |
| `pnpm typecheck --force` | 11 / 11 tareas correctas |
| `pnpm build --force` | 9 / 9 tareas correctas |
| `pnpm test:contract --force` | 775 casos correctos |
| `customer-service` con PostgreSQL 18.4 real (`DATABASE_URL`, `--runInBand`) | 12 / 12 suites, **200 / 200 casos**, ninguno saltado |
| `pnpm test` (sin base de datos) | `customer-service`: 158 correctos y 42 saltados por falta de `DATABASE_URL`; el resto de los paquetes, sin cambios |
| `pnpm test:pyramid` | Unitarias 71,6 % (objetivo 70 %) y E2E 7,7 % (objetivo 10 %): las mismas dos desviaciones previas, sin tocar |

**Mutaciones** (se quitó una pieza y se comprobó que los tests la echan de menos,
y luego se restauró): sin `telemetry.record` en `set-kyc-status`, fallan 3 casos;
sin el padre (volver a abrir la decisión en el contexto activo), fallan 3; sin el contador de rechazos, falla 1.

**Contra el stack real** (siete imágenes con `pnpm images:build --allow-dirty`,
Gateway en `:3100`): la migración `008_customers_creation_trace` se aplicó al
arrancar; los logs de `customer-service` mostraron `customer created`,
`customer verified`, `customer rejected`, `customer verified ignored`
(`ILLEGAL_TRANSITION`), la rama `path: counter` de un cliente registrado por el
cajero y `customer registration refused` (`DOCUMENT_ALREADY_REGISTERED`) para un
DPI duplicado. Ninguna de esas líneas contiene correo, documento, nombre,
dirección, contraseña ni JWT (búsqueda por esos patrones: 0 coincidencias).

## Lo que no se verificó

- **Spans y métricas en ejecución real.** Sin SDK registrado la API de
  OpenTelemetry es no-op: solo los comprueban los exporters en memoria. Aparecerán
  en Grafana / Jaeger cuando T-48 registre el SDK y el Collector, sin tocar este
  servicio. Por la misma razón `creation_trace` queda en `NULL` en el stack real; el
  guardado y la lectura sí están probados contra PostgreSQL real.
- **`pnpm images:flow` completo.** El script no es portable a Git Bash (usa
  `mktemp -t` y `uuidgen`) y, ya salvado eso, se detiene en el paso 2: la
  activación sale por otro canal y no deja el enlace en el log. No tiene que ver con
  T-41; el ciclo de vida se ejercitó directamente por el Gateway con el cajero demo.
- **Suites de `account-service` y `customer-service` en paralelo.** Fallan a veces
  cuando corren a la vez sobre la misma base; con `--runInBand` pasan todas. Es un
  defecto previo de aislamiento entre suites, ajeno a este ticket.
- **`apps/web`.** Ocho pruebas de `session-guard` fallan en esta máquina porque no
  está instalado el navegador de Playwright; no se tocó `apps/web`.
