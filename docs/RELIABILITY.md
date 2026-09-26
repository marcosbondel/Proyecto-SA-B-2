# Confiabilidad y SRE — Bank USAC

> **La definición completa vive en [`sre/sli-slo-sla.md`](sre/sli-slo-sla.md).** Este documento fija
> las preocupaciones de diseño que el enunciado exige resolver y la línea base de
> métricas aprobada en T-03. Los indicadores, objetivos y compromisos en su
> versión extendida —30 SLI, 26 SLO, severidades y exclusiones— están en
> [SLI](sre/sli-slo-sla.md#4-indicadores-de-nivel-de-servicio-sli) · [SLO](sre/sli-slo-sla.md#5-objetivos-de-nivel-de-servicio-slo) · [SLA](sre/sli-slo-sla.md#7-acuerdo-de-nivel-de-servicio-sla), encadenados de modo
> que ninguna promesa carece de un número que la verifique. Donde ambos hablen
> del mismo indicador, `sre/` es el que se mantiene.

## Preocupaciones de Diseño Obligatorias

El enunciado del proyecto exige que cada microservicio resuelva de forma explícita las siguientes preocupaciones de ingeniería de confiabilidad:

- **Idempotencia** ante comandos repetidos y entregas duplicadas de eventos.
- **Reintentos acotados** con comportamiento determinista y clasificación segura de errores reintentables vs. no reintentables.
- **Manejo explícito de errores**, distinguiendo fallos de negocio (ej. fondos insuficientes) de fallos de infraestructura (ej. base de datos o broker caído).
- **Consistencia eventual** entre bases de datos independientes mediante eventos de dominio.
- **Trazabilidad de extremo a extremo** mediante la propagación de un `correlationId` en cada sobre de mensaje.

Los flujos distribuidos de transferencia y pago implementan el patrón **Saga por coreografía** con eventos de compensación. Una solicitud aceptada por el sistema no se considera completada hasta que el flujo propietario confirma su finalización.

---

## SLI, SLO y SLA

Definidos y aprobados en la tarea **T-03**, *antes de la implementación*, debido a que la metodología oficial del proyecto sitúa las métricas SRE en el paso 7 (§6, página 17), previo al paso 8 de desarrollo. **T-24 mide estas definiciones; no las crea.** Cualquier cambio en los valores aquí descritos requiere una enmienda formal del equipo y no una edición silenciosa.

Las columnas de ventana de medición y presupuesto de error (*error budget*) en la tabla de objetivos complementan la definición de T-03 sin alterar ningún umbral: aportan las dos dimensiones indispensables para que un umbral sea verificable (sobre qué período se contabiliza y cuánto margen de fallo se admite antes de incumplirlo).

---

### Indicadores de Nivel de Servicio (SLI — Service Level Indicators)

Cada indicador define su fórmula matemática y la fuente de datos que lo produce. Un indicador sin fuente de datos verificable no es medible, sin importar cuán precisa parezca su fórmula.

| # | Indicador | Fórmula Matemática | Fuente de Datos |
| :--- | :--- | :--- | :--- |
| **SLI-1** | **Disponibilidad del Gateway** | $\frac{\text{Peticiones atendidas sin error técnico}}{\text{Total de peticiones HTTP válidas recibidas}}$ | Logs del API Gateway |
| **SLI-2** | **Tasa de finalización de transferencias** | $\frac{\text{Transferencias en estado final COMPLETED}}{\text{Total de transferencias aceptadas}}$ | Base de datos de `Transaction Service` |
| **SLI-3** | **Duración de la Saga (P50 / P95)** | $\text{Timestamp de estado final} - \text{Timestamp de emisión (transfer.requested)}$ | Marcas de tiempo en el `Envelope` del mensaje |
| **SLI-4** | **Latencia de procesamiento de eventos** | $\text{Timestamp de consumo exitoso} - \text{Timestamp de origen (occurredAt)}$ | Sobre canónico (`Envelope`) |
| **SLI-5** | **Tasa de reintentos y mensajes en cola muerta (DLQ)** | $\frac{\text{Total de reintentos}}{\text{Total de entregas}}$ y conteo absoluto en cada cola DLQ | Métricas de colas en RabbitMQ |
| **SLI-6** | **Consistencia funcional de saldos** | $\frac{\text{Transferencias cuyo estado final coincide con saldos y auditoría}}{\text{Total de transferencias finalizadas}}$ | Conciliación cruzada entre `Transaction`, `Account` y `Audit` |

> [!IMPORTANT]
> **Definición de "Error técnico" en SLI-1:**  
> Significa que la petición falló a nivel de infraestructura o código: errores HTTP 5xx, timeout de respuesta o conexión rechazada.  
> Un rechazo por regla de negocio —fondos insuficientes, cuenta inactiva o credenciales inválidas (códigos 4xx)— constituye una respuesta **correcta y esperada** del sistema, y **NO** resta disponibilidad. Contabilizar rechazos de negocio como indisponibilidad mediría la solvencia financiera de los usuarios en lugar de la salud del servicio.

---

### Objetivos de Nivel de Servicio (SLO — Service Level Objectives)

| # | Objetivo | Umbral Objetivo | Ventana de Medición | Presupuesto de Error (*Error Budget*) | Indicador Asociado |
| :--- | :--- | :---: | :--- | :---: | :---: |
| **SLO-1** | **Mensajes válidos que no terminan en cola de mensajes muertos (DLQ)** durante la prueba final | **$\ge 99\%$** | Una corrida de demostración | **$1\%$** de los mensajes válidos entregados | **SLI-5** |
| **SLO-2** | **Transferencias exitosas que completan en menos de 5 segundos** en entorno local estable | **$\ge 95\%$** | Una corrida de demostración | **$5\%$** de las transferencias exitosas en la corrida | **SLI-3**, **SLI-2** |
| **SLO-3** | **Comandos duplicados que producen exactamente un único efecto financiero** | **$100\%$** | Cada comando duplicado en la corrida | **$0\%$ — Invariante estricto** | **SLI-6** |
| **SLO-4** | **Fallos posteriores al débito que culminan en compensación o estado pendiente explícito** | **$100\%$** | Cada fallo post-débito observado | **$0\%$ — Invariante estricto** | **SLI-2**, **SLI-6** |
| **SLO-5** | **Eventos del flujo principal que transportan un `correlationId` visible** | **$100\%$** | Cada evento del flujo principal | **$0\%$ — Invariante estricto** | **SLI-4** |

#### Justificación de la Ventana de Medición
La ventana corresponde a **una corrida de demostración**. Nombrarla no es una formalidad: todo objetivo es un ratio, y un ratio sin ventana de tiempo es indemostrable (¿99% de qué, medido desde cuándo?). La ventana es la sesión misma de ejecución —el stack levantado, los flujos bancarios ejecutados y la evidencia recolectada—, ya que es el único período en el que este sistema es evaluado en vivo. Cada corrida se juzga por sus propios resultados: nada se acumula para la siguiente ni se amortiza extendiendo el tiempo.

#### Justificación de los Presupuestos de Error (*Error Budget*)
1. **Dos objetivos admiten presupuesto de error:** **SLO-1** y **SLO-2** son metas de calidad de servicio, por lo que sus umbrales definen un margen de tolerancia:
   * Al **99%**, 1 de cada 100 mensajes válidos puede caer temporalmente a la DLQ antes de considerar no alcanzado el objetivo.
   * Al **95%**, 1 de cada 20 transferencias exitosas puede demorar más de 5 segundos.  
   En términos absolutos estos presupuestos son pequeños a propósito: una demostración mueve unos cientos de mensajes y un grupo de transferencias, por lo que una falla sistemática agota el presupuesto de inmediato en lugar de ocultarse tras promedios largos.
2. **Tres objetivos tienen presupuesto de error cero (100%):** **SLO-3**, **SLO-4** y **SLO-5** no admiten grados de tolerancia. Un comando duplicado que mueve dinero dos veces o un débito sin compensación ante fallo del proveedor es un **defecto de corrección bancaria**, no una degradación temporal. Un presupuesto de error es un permiso para fallar una fracción del tiempo, y en un banco no se tolera ninguna fracción de duplicación de dinero: una sola infracción invalida el objetivo por completo.

> **Entorno local estable:** En **SLO-2**, significa que el clúster de Kubernetes y Docker están operativos, sin inyección artificial de fallas ni sobrecarga concurrente sintética.

---

### Acuerdo de Nivel de Servicio (SLA — Service Level Agreement)

El compromiso es **observable durante la sesión de evaluación**:
1. Levantar el clúster local de Kubernetes (`kind`) y la infraestructura de soporte.
2. Ejecutar el flujo bancario principal de transferencias.
3. Demostrar la ejecución de la Saga en sus tres formas (flujo exitoso y flujos de compensación por fallo de proveedor o reintentos agotados).
4. Presentar la evidencia de los indicadores y la consistencia matemática de los saldos antes y después de cada operación.

Este es un **SLA de ámbito académico**. No conlleva penalizaciones financieras contractuales ni medición continua en producción fuera de la sesión de sustentación. Establece el compromiso formal de entrega y defensa del sistema ante los evaluadores.

---

### Obligaciones de Instrumentación para Cada Microservicio

Estos indicadores solo pueden medirse si el código incluye la instrumentación requerida desde el inicio. Cada microservicio implementa:

1. **Marcas de tiempo de emisión y consumo** dentro del sobre canónico del mensaje (`Envelope`) para alimentar **SLI-3** y **SLI-4**.
2. **Logs estructurados con propagación de `correlationId`** a lo largo de toda la cadena de llamadas asíncronas para **SLI-5** y **SLO-5**.
3. **Conteo de reintentos y visibilidad de colas de error** en RabbitMQ para **SLI-5**.
4. **Estados finales de transacción inmutables** contrastables contra los saldos de cuentas y registros de bitácora para **SLI-6**.

---

## Observabilidad y Bitácora Distribuida

`Notification & Audit Service` es la base del dominio para la auditoría distribuida:
* Dispone de **5 colas dedicadas en RabbitMQ**: `audit.customer`, `audit.account`, `audit.transaction`, `audit.payment` y `audit.query`.
* **Deduplicación estricta** mediante la clave primaria `(event_id, consumer)`.
* **Redacción previa a la inserción (*Pre-insert Redaction*):** Ningún número de documento (DPI), dirección física o saldo sensible se almacena en texto plano dentro de la bitácora de auditoría.
* **Captura de errores:** Los mensajes no procesables se canalizan desde el exchange `bank.errors` y se registran bajo el estado `INVALID` en lugar de ser descartados silenciosamente (resolviendo la deuda técnica **TD-048**).

Cada microservicio dispone de un logger contextualizado que preserva el `correlationId` generado inicialmente en el API Gateway.

---

## Verificación y Comandos de Ejecución

Los siguientes comandos, ejecutados desde la raíz del repositorio, validan automáticamente las reglas y contratos del sistema:

| Comando | Qué Demuestra |
| :--- | :--- |
| `pnpm lint` | Valida estilo y reglas arquitectónicas ejecutables: prohíbe imports directos entre microservicios, imports de frameworks en la capa de `domain`, o imports de `infrastructure` en `application` ([`eslint.base.mjs`](../apps/packages/tooling/eslint.base.mjs)). |
| `pnpm typecheck` | Comprobación estricta de tipos de TypeScript en los 11 paquetes del monorepo. |
| `pnpm build` | Compilación de paquetes compartidos y construcción de las 7 aplicaciones. |
| `pnpm test` | Suites de pruebas unitarias y de aislamiento (`test/isolation.spec.ts` en cada servicio, asegurando que ninguno consulte bases de datos ajenas ni invoque endpoints HTTP internos). |
| `pnpm test:contract` | Verificación de los contratos de eventos tipados en `@bank/contracts` con esquemas Zod (737 pruebas automáticas). |
| `pnpm images:smoke` | Verificación de contenedores Docker: usuario no-root (`node:1000`), puertos expuestos, ausencia de secretos y desacoplamiento de sondas `/health` y `/ready`. |
| `pnpm images:flow` | Ejecución integral de la Saga bancaria a través de las imágenes construidas: registro, activación, apertura de cuentas, transferencia completada y transferencias compensadas con verificación contable de saldos. |
| `pnpm test:e2e` | Ejecución de pruebas End-to-End con Playwright sobre la aplicación web (`apps/web`). |

---

## Registro de Incidentes y Deudas Técnicas Resueltas

Durante el ciclo de desarrollo y pruebas de confiabilidad se detectaron y resolvieron formalmente las siguientes deudas técnicas críticas:

* **TD-049:** Inicialización del volumen de RabbitMQ sin usuario administrador predeterminado (resuelto asegurando credenciales automáticas en el arranque).
* **TD-048:** El exchange `bank.errors` carecía de colas vinculadas, lo que provocaba la pérdida de mensajes inválidos (resuelto vinculando la cola de auditoría con registro `INVALID`).
* **TD-031 y TD-047:** Ventana de riesgo entre el commit de base de datos y la publicación en el broker en Transaction y Payment Service (resuelto con persistencia transaccional y garantía de reintentos).
* **TD-030 y TD-045:** Corrección de condiciones de carrera y estabilización de pruebas bajo concurrencia.
