# Objetivos de Nivel de Servicio (SLO) — Bank USAC

Este documento establece los **Objetivos de Nivel de Servicio (Service Level Objectives)** de Bank USAC, sus umbrales cuantitativos, ventanas de medición y presupuesto de error (*Error Budget*).

---

## 1. Matriz de Objetivos (SLO)

| # | Objetivo | Umbral Mínimo | Ventana de Medición | Presupuesto de Error (*Error Budget*) | Indicador Base |
|---|---|---|---|---|---|
| **SLO-1** | Mensajes válidos que no terminan en DLQ durante la ejecución | **≥ 99.0 %** | Corrida de demostración | 1.0 % de mensajes válidos entregados | SLI-5 |
| **SLO-2** | Transferencias exitosas completadas en menos de 5.0 segundos | **≥ 95.0 %** | Corrida de demostración | 5.0 % de transferencias exitosas | SLI-3, SLI-2 |
| **SLO-3** | Comandos duplicados que producen exactamente un efecto contable | **100.0 %** | Todos los duplicados observados | **0 % (Invariante estricto)** | SLI-6 |
| **SLO-4** | Fallos posteriores al débito que culminan en compensación contable | **100.0 %** | Todos los fallos post-débito | **0 % (Invariante estricto)** | SLI-2, SLI-6 |
| **SLO-5** | Eventos del flujo principal que portan un `correlationId` visible | **100.0 %** | Todos los eventos emitidos | **0 % (Invariante estricto)** | SLI-4 |

---

## 2. Gestión del Presupuesto de Error (*Error Budget*)

* **Objetivos con Presupuesto de Calidad (SLO-1, SLO-2)**: Admiten una degradación controlada menor al 1% o 5% durante picos de carga en el entorno de pruebas sin comprometer la evaluación técnica.
* **Objetivos sin Presupuesto (SLO-3, SLO-4, SLO-5)**: Representan **invariantes de integridad financiera**. Mover dinero dos veces o dejar un saldo debitado sin compensar ante un fallo constituye un defecto crítico inaceptable en un sistema bancario.
