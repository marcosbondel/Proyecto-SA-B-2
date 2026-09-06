# Objetivos de Nivel de Servicio (SLO) — Bank USAC

Este documento establece los **Objetivos de Nivel de Servicio (Service Level
Objectives)** de Bank USAC, sus umbrales cuantitativos, ventanas de medición y
presupuesto de error (*Error Budget*).

> **Documentos relacionados:** [SLI](sli.md) · [SLA](sla.md) ·
> [RELIABILITY.md](../RELIABILITY.md)
>
> **SLO-1 a SLO-5 son la línea base aprobada en T-03.** Sus umbrales no se
> editan aquí. Los objetivos **SLO-6 en adelante son complementarios**: se
> apoyan en los indicadores SLI-7 a SLI-30 y amplían la cobertura sin relajar
> ningún compromiso previo.

---

## 1. Matriz de Objetivos Base (T-03)

| # | Objetivo | Umbral Mínimo | Ventana de Medición | Presupuesto de Error (*Error Budget*) | Indicador Base |
|---|---|---|---|---|---|
| **SLO-1** | Mensajes válidos que no terminan en DLQ durante la ejecución | **≥ 99.0 %** | Corrida de demostración | 1.0 % de mensajes válidos entregados | SLI-5 |
| **SLO-2** | Transferencias exitosas completadas en menos de 5.0 segundos | **≥ 95.0 %** | Corrida de demostración | 5.0 % de transferencias exitosas | SLI-3, SLI-2 |
| **SLO-3** | Comandos duplicados que producen exactamente un efecto contable | **100.0 %** | Todos los duplicados observados | **0 % (Invariante estricto)** | SLI-6 |
| **SLO-4** | Fallos posteriores al débito que culminan en compensación contable | **100.0 %** | Todos los fallos post-débito | **0 % (Invariante estricto)** | SLI-2, SLI-6 |
| **SLO-5** | Eventos del flujo principal que portan un `correlationId` visible | **100.0 %** | Todos los eventos emitidos | **0 % (Invariante estricto)** | SLI-4 |

---

## 2. Objetivos Complementarios

### 2.1 Objetivos con presupuesto de error (calidad de servicio)

Admiten degradación acotada. Su incumplimiento es una señal de que el sistema
va mal, no de que el dinero esté mal.

| # | Objetivo | Umbral Mínimo | Ventana de Medición | Presupuesto de Error | Indicador Base |
|---|---|---|---|---|---|
| **SLO-6** | Lecturas del Gateway (`GET`) respondidas en menos de 1.0 s (P95) | **≥ 95.0 %** | Corrida de demostración | 5.0 % de las lecturas | SLI-7 |
| **SLO-7** | Comandos del Gateway respondidos en menos de 3.0 s (P95) | **≥ 95.0 %** | Corrida de demostración | 5.0 % de los comandos | SLI-7 |
| **SLO-8** | Peticiones *request-reply* que **no** agotan el techo de 5 000 ms | **≥ 99.0 %** | Corrida de demostración | 1.0 % de las peticiones | SLI-8 |
| **SLO-9** | Sondeos de readiness satisfactorios por carga de trabajo | **≥ 99.0 %** | Corrida de demostración | 1.0 % de los sondeos | SLI-11 |
| **SLO-10** | Pods que alcanzan `1/1 Ready` en menos de 90 s desde su creación | **≥ 95.0 %** | Cada despliegue del chart | 5.0 % de los pods | SLI-12 |
| **SLO-11** | Retraso del barrido de reintentos por debajo de dos intervalos de sweep (P95) | **≥ 95.0 %** | Cada pago que entra a la escalera | 5.0 % de los intentos | SLI-24 |
| **SLO-12** | Notificaciones emitidas por cada evento notificable consumido | **≥ 99.0 %** | Corrida de demostración | 1.0 % de los eventos notificables | SLI-26 |
| **SLO-13** | Cargas de documento de identidad confirmadas por el almacén de objetos | **≥ 99.0 %** | Cada carga intentada | 1.0 % de las cargas | SLI-27 |
| **SLO-14** | Mensajes que reintenta el broker sin exceder la escalera declarada | **≥ 99.0 %** | Corrida de demostración | 1.0 % de las entregas | SLI-5, SLI-23 |

### 2.2 Invariantes sin presupuesto de error (corrección bancaria y seguridad)

No admiten grados. Una sola infracción invalida el objetivo por completo.

| # | Objetivo | Umbral | Ventana de Medición | Presupuesto de Error | Indicador Base |
|---|---|---|---|---|---|
| **SLO-15** | Cuentas con saldo negativo al cierre de cualquier operación | **0 filas** | Cada operación contable | **0 (Invariante estricto)** | SLI-21 |
| **SLO-16** | Cuadre al centavo entre débitos y créditos más compensaciones | **100.0 %** | Cada transferencia finalizada | **0 % (Invariante estricto)** | SLI-21, SLI-6 |
| **SLO-17** | Pagos que agotan la escalera de reintentos y terminan en `COMPENSATED` | **100.0 %** | Cada escalera agotada | **0 % (Invariante estricto)** | SLI-23, SLI-2 |
| **SLO-18** | Transiciones fuera del diagrama de seis estados que el sistema acepta | **0 transiciones** | Cada transición solicitada | **0 (Invariante estricto)** | SLI-22 |
| **SLO-19** | Escrituras concurrentes sobre una misma cuenta que se serializan sin pérdida de actualización | **100.0 %** | Cada conflicto observado | **0 % (Invariante estricto)** | SLI-20 |
| **SLO-20** | Eventos del flujo principal presentes en la bitácora de auditoría | **100.0 %** | Cada evento del flujo principal | **0 % (Invariante estricto)** | SLI-16 |
| **SLO-21** | Mensajes no interpretables **registrados** como `INVALID` en lugar de descartados | **100.0 %** | Cada mensaje no interpretable | **0 % (Invariante estricto)** | SLI-17 |
| **SLO-22** | Filas de auditoría que almacenan documento, dirección o monto en texto plano | **0 filas** | Cada inserción en la bitácora | **0 (Invariante estricto)** | SLI-18 |
| **SLO-23** | Mensajes emitidos que validan contra la envolvente canónica | **100.0 %** | Cada mensaje emitido | **0 % (Invariante estricto)** | SLI-19 |
| **SLO-24** | Peticiones admitidas cuyo rol pertenece a la matriz de autorización D-06 | **100.0 %** | Cada petición autenticada | **0 % (Invariante estricto)** | SLI-28 |
| **SLO-25** | Capas de imagen que contienen un secreto en las siete imágenes | **0 capas** | Cada construcción de imágenes | **0 (Invariante estricto)** | SLI-30 |
| **SLO-26** | Reinicios de contenedor no provocados durante la corrida | **0 reinicios** | Corrida de demostración | **0 (Invariante estricto)** | SLI-13 |

---

## 3. Gestión del Presupuesto de Error (*Error Budget*)

### 3.1 Clasificación

* **Objetivos con presupuesto de calidad (SLO-1, SLO-2, SLO-6 a SLO-14)**:
  Admiten una degradación controlada durante picos de carga en el entorno de
  pruebas sin comprometer la evaluación técnica. Su presupuesto es
  deliberadamente pequeño en términos absolutos: una corrida mueve unos cientos
  de mensajes, de modo que una falla sistemática **agota el presupuesto de
  inmediato** en lugar de esconderse detrás de promedios largos.
* **Objetivos sin presupuesto (SLO-3, SLO-4, SLO-5, SLO-15 a SLO-26)**:
  Representan **invariantes de integridad financiera, de trazabilidad y de
  seguridad**. Mover dinero dos veces, dejar un saldo debitado sin compensar,
  perder un evento de la bitácora o admitir una petición fuera de la matriz de
  roles constituye un defecto crítico inaceptable en un sistema bancario. Un
  presupuesto de error es un permiso para fallar una fracción del tiempo, y en
  un banco no se tolera ninguna fracción de duplicación de dinero.

### 3.2 Consumo y agotamiento

El presupuesto se contabiliza **por corrida** y no se amortiza: nada sobrante
pasa a la siguiente sesión ni se compensa alargando la ventana.

| Consumo del presupuesto | Estado | Acción |
|---|---|---|
| < 50 % | **Verde** | Ninguna. El objetivo se reporta como cumplido. |
| 50 % – 99 % | **Ámbar** | Se documenta la causa en la evidencia de la corrida antes de declarar el objetivo cumplido. |
| ≥ 100 % | **Rojo** | El objetivo se declara **incumplido**. Se detiene la incorporación de alcance nuevo y se prioriza la causa raíz sobre cualquier otra tarea. |
| Cualquier infracción de un invariante | **Rojo inmediato** | Defecto crítico. La corrida no se presenta como válida hasta corregirlo y volver a ejecutar la evidencia. |

### 3.3 Velocidad de consumo (*burn rate*)

Para los objetivos con presupuesto, el ritmo importa tanto como el total:

`burn rate = (fracción del presupuesto consumida) / (fracción de la ventana transcurrida)`

* **Burn rate ≤ 1** — el consumo es proporcional al avance de la corrida y el
  objetivo terminará dentro del umbral.
* **Burn rate > 2 sostenido** — el objetivo se incumplirá antes de terminar la
  corrida aunque el porcentaje instantáneo todavía se vea sano. Es la señal para
  investigar **durante** la demostración y no después.

Un umbral instantáneo dice si el sistema está bien ahora; el *burn rate* dice si
va a seguir estándolo. Sin él, un 99.4 % a mitad de corrida y un 99.4 % en caída
libre se ven idénticos.

---

## 4. Reglas de Interpretación

1. **Un objetivo sin ventana es indemostrable.** Todo umbral de esta matriz es
   un ratio, y un ratio sin período no significa nada («¿99 % de qué, desde
   cuándo?»). Por eso cada fila declara la suya.
2. **Los rechazos de negocio no consumen presupuesto.** Fondos insuficientes,
   cuenta inactiva o credenciales inválidas son respuestas correctas del
   dominio (véanse las aclaraciones de [SLI](sli.md#3-aclaraciones-técnicas-de-medición)).
3. **`REPLY_TIMEOUT` consume SLO-8, no SLO-2.** Que nadie conteste a tiempo no
   significa que la transferencia haya fallado: la Saga puede seguir en vuelo y
   completarse después. Contarlo como transferencia fallida mediría el Gateway y
   lo reportaría como si fuera el libro contable.
4. **Entorno local estable.** En SLO-2, SLO-6 y SLO-7 significa que el clúster
   de Kubernetes y Docker están operativos, sin inyección artificial de fallas
   ni sobrecarga concurrente sintética.
5. **Los invariantes se reportan como recuentos.** «Cero filas» y «cero
   transiciones» no se convierten a porcentaje: un 99.9 % de cuadre contable es
   un descuadre.
