# Acuerdos de Nivel de Servicio (SLA) — Bank USAC

Este documento formaliza el **Acuerdo de Nivel de Servicio (Service Level
Agreement)** aplicable para el entorno del proyecto Bank USAC.

> **Documentos relacionados:** [SLI](sli.md) · [SLO](slo.md) ·
> [RELIABILITY.md](../RELIABILITY.md)
>
> Un SLA es la promesa **externa**; un [SLO](slo.md) es la meta **interna** que
> la sostiene, y un [SLI](sli.md) es la medición que la prueba. Este acuerdo no
> introduce umbrales propios: cada compromiso apunta al objetivo que lo respalda,
> de modo que no exista ninguna promesa sin un número que la verifique.

---

## 1. Alcance y Compromiso de Servicio

* **Ámbito de Aplicación**: Demostración y evaluación académica del sistema
  bancario local y orquestación con Kubernetes/Docker.
* **Partes**: el **equipo proveedor** (autores del sistema) y el **evaluador**
  como consumidor del servicio durante la sesión de sustentación.
* **Compromiso Principal**:
  1. Levantar la infraestructura completa de contenedores de forma reproducible
     y sana (`pnpm dev:infra` y `pnpm dev:host`), o el clúster local de
     Kubernetes según el procedimiento de
     [DEPLOYMENT.md](../operations/DEPLOYMENT.md).
  2. Ejecutar el flujo de negocio bancario integral: registro, activación,
     apertura de cuentas y transferencias interbancarias.
  3. Demostrar visual y contablemente la ejecución exitosa de la **Saga en sus
     tres variantes**:
     * Camino exitoso (`COMPLETED`).
     * Fallo inmediato y reversa contable (`COMPENSATED`).
     * Escalera de reintentos agotada con reversa contable (`COMPENSATED`).
  4. Garantizar la trazabilidad de extremo a extremo mediante el identificador
     `correlationId`.

---

## 2. Compromisos por Componente

Cada fila es una promesa que el evaluador puede exigir, y cada una está
respaldada por un objetivo medible. Un compromiso sin objetivo de respaldo sería
una declaración de intenciones, no un acuerdo.

| Componente | Compromiso ofrecido | Objetivo que lo respalda |
|---|---|---|
| **API Gateway** | Atiende las veinticinco rutas publicadas, autentica por JWT y aplica la matriz de roles D-06; responde toda petición o declara explícitamente por qué no pudo | SLO-6, SLO-7, SLO-8, SLO-24 |
| **Transferencias (Saga)** | Toda transferencia aceptada alcanza un estado final explícito; ninguna queda en vuelo indefinidamente | SLO-2, SLO-4, SLO-17, SLO-18 |
| **Integridad contable** | El dinero debitado coincide al centavo con el acreditado o compensado, y ninguna cuenta queda en negativo | SLO-3, SLO-15, SLO-16, SLO-19 |
| **Pagos de servicios** | La escalera de reintentos es observable mientras se recorre y su agotamiento cierra la Saga con compensación | SLO-11, SLO-14, SLO-17 |
| **Mensajería** | Los mensajes válidos no se pierden; los no interpretables se registran en lugar de descartarse | SLO-1, SLO-21, SLO-23 |
| **Auditoría y notificaciones** | Todo evento del flujo principal queda en bitácora, redactado antes de la inserción | SLO-12, SLO-20, SLO-22 |
| **Plataforma (Kubernetes / imágenes)** | Las siete cargas de trabajo arrancan sanas, se sondean por separado en vida y disponibilidad, y no llevan secretos horneados | SLO-9, SLO-10, SLO-25, SLO-26 |
| **Almacenamiento de documentos** | El documento de identidad cargado por el cajero queda persistido y recuperable | SLO-13 |

---

## 3. Ventana de Servicio

* **Ventana comprometida**: la **sesión de evaluación** — el stack levantado,
  los flujos bancarios ejecutados y la evidencia recolectada.
* **Fuera de la ventana**: el sistema no ofrece operación continua, guardias ni
  monitoreo permanente. Nada se mide ni se compromete fuera de la sesión.
* **No acumulación**: cada corrida se juzga por sus propios resultados. Ningún
  margen sobrante se transfiere a la siguiente sesión ni se amortiza extendiendo
  el período de medición.

---

## 4. Clasificación de Severidad de Incidentes

Durante la ventana comprometida, cualquier desviación se clasifica así. Los
tiempos son objetivos de atención dentro de la sesión, no plazos contractuales.

| Severidad | Definición | Ejemplo | Respuesta objetivo | Mitigación objetivo |
|---|---|---|---|---|
| **S1 — Crítica** | Se viola un invariante de integridad financiera o de seguridad | Dinero duplicado, débito sin compensación, saldo negativo, dato sensible en claro en la bitácora | Inmediata | Se detiene la demostración hasta corregir; la corrida no se declara válida |
| **S2 — Alta** | El flujo bancario principal no puede completarse | La Saga no alcanza estado final; el broker inalcanzable; un pod que no llega a `Ready` | ≤ 5 minutos | ≤ 20 minutos, o se documenta como bloqueo |
| **S3 — Media** | Degradación medible sin pérdida de corrección | Latencia sobre el umbral, expiraciones de respuesta, reintentos por encima de lo previsto | ≤ 15 minutos | Dentro de la corrida |
| **S4 — Baja** | Defecto cosmético o de conveniencia | Texto de interfaz, formato de un listado, desviación menor del prototipo | Registrada como deuda técnica | Fuera de la sesión |

Un incidente **S1 no tiene presupuesto de error**: una sola ocurrencia invalida
el compromiso, porque un banco que mueve dinero dos veces una de cada mil veces
sigue siendo un banco que mueve dinero dos veces.

---

## 5. Exclusiones

Los siguientes eventos **no cuentan** contra el cumplimiento de este acuerdo:

1. **Rechazos de negocio**: fondos insuficientes, cuenta inactiva, credenciales
   inválidas o rol no autorizado. Son respuestas correctas del dominio.
2. **Fallas del entorno del evaluador**: Docker detenido, ausencia de Node
   24.19.0 o pnpm 11.21.0, puertos ocupados por otro proceso, o falta de espacio
   en disco.
3. **Inyección artificial de fallas** o sobrecarga concurrente sintética no
   acordada previamente, en los objetivos que declaran «entorno local estable».
4. **Indisponibilidad de infraestructura externa al clúster**: PostgreSQL,
   RabbitMQ o MinIO detenidos deliberadamente por el evaluador durante una
   prueba de degradación. En ese caso lo comprometido es el **comportamiento
   degradado correcto** (`/ready` en 503 y `/health` en 200), no la
   disponibilidad del flujo.
5. **Escalado horizontal de `account-service`**: el chart lo fija en una réplica
   porque también ejecuta el barrido de cuentas inactivas sin elección de líder.
   Operarlo con más réplicas queda fuera del acuerdo.

---

## 6. Responsabilidades

### 6.1 Del equipo proveedor

* Mantener reproducible el procedimiento de despliegue y la evidencia asociada.
* Instrumentar cada servicio con lo que los indicadores exigen: marcas de tiempo
  en la envolvente, `correlationId` propagado, conteo de reintentos y estados
  finales inmutables.
* Reportar los incumplimientos con su evidencia, aun cuando no se pregunte por
  ellos. Un objetivo incumplido y silenciado es peor que un objetivo incumplido.

### 6.2 Del consumidor (evaluador)

* Ejecutar los comandos documentados desde la **raíz del repositorio**.
* Disponer del entorno base: Docker operativo, Node 24.19.0 y pnpm 11.21.0.
* Comunicar cualquier prueba de degradación que induzca deliberadamente, para
  distinguirla de una falla real.

---

## 7. Verificación de Cumplimiento

* **Naturaleza Académica**: El presente SLA delimita el comportamiento funcional
  durante la ventana de evaluación y pruebas automatizadas.
* **Evidencia aceptada**: la salida real de los comandos, no su descripción.

| Comando | Compromiso que verifica |
|---|---|
| `pnpm lint` | Reglas arquitectónicas ejecutables: sin imports entre servicios, sin framework en `domain`, sin `infrastructure` en `application` |
| `pnpm typecheck` · `pnpm build` | Los once paquetes y las siete aplicaciones compilan |
| `pnpm test` · `pnpm test:contract` | Pruebas unitarias, suites de aislamiento por servicio y contratos de eventos en `@bank/contracts` |
| `pnpm images:smoke` | Usuario no-root, puerto expuesto, ausencia de secretos y separación de `/health` y `/ready` (SLO-25, SLO-26) |
| `pnpm images:flow` | La Saga en sus tres variantes, con verificación contable de saldos antes y después (SLO-2, SLO-4, SLO-16, SLO-17) |
| `pnpm test:e2e` | Suite de validación de QA de extremo a extremo |
| `pnpm k8s:status` · `pnpm k8s:evidence` | Estado del clúster y captura reproducible de la evidencia de plataforma (SLO-9, SLO-10) |

La verificación documentada se conserva en
[`docs/qa/validation-report.md`](../qa/validation-report.md) y en los logs
estructurados con niveles `INFO`, `WARN` y `ERROR`.

---

## 8. Régimen de Remedios

Este es un **SLA de ámbito académico**: no conlleva penalizaciones financieras,
créditos de servicio ni medición continua en producción fuera de la sesión de
sustentación. El remedio ante un incumplimiento es procedimental:

1. **Declararlo** en la propia sesión, con el indicador y el valor medido.
2. **Documentar la causa raíz** junto a la evidencia de la corrida.
3. **Reejecutar** el flujo afectado una vez corregido, generando evidencia nueva
   en lugar de reinterpretar la anterior.

---

## 9. Vigencia y Enmienda

* Los indicadores y objetivos base (SLI-1 a SLI-6, SLO-1 a SLO-5) fueron
  aprobados en **T-03, antes de la implementación**. **T-24 los mide; no los
  crea.**
* Los indicadores y objetivos complementarios amplían la cobertura sin alterar
  ningún umbral base.
* Cualquier modificación de un umbral existente requiere **enmienda formal del
  equipo** y no una edición silenciosa de estos documentos.
