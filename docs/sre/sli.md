# Indicadores de Nivel de Servicio (SLI) — Bank USAC

Este documento define los **Indicadores de Nivel de Servicio (Service Level Indicators)** adoptados por Bank USAC, especificando su fórmula matemática, fuente de datos y método de recolección.

---

## 1. Tabla de Indicadores (SLI)

| # | Indicador | Fórmula de Medición | Fuente de Datos |
|---|---|---|---|
| **SLI-1** | Disponibilidad del API Gateway | `peticiones HTTP exitosas (sin error técnico 5xx) / total peticiones recibidas` | Logs del API Gateway y métricas HTTP |
| **SLI-2** | Tasa de completitud de transferencias | `transferencias que alcanzan estado COMPLETED / total transferencias aceptadas` | Base de datos de Transaction Service |
| **SLI-3** | Duración de la Saga (P50 / P95) | `timestamp de estado final (COMPLETED/COMPENSATED) - timestamp de inicio` | Metadatos de la envolvente del mensaje |
| **SLI-4** | Latencia de propagación de eventos | `timestamp de consumo exitoso en suscriptor - occurredAt del emisor` | Envolvente estándar de RabbitMQ |
| **SLI-5** | Tasa de reintentos y mensajes en DLQ por cola | `reintentos ejecutados / entregas totales`; recuento absoluto en Dead-Letter Queues | API de gestión de RabbitMQ |
| **SLI-6** | Consistencia contable eventual | `transferencias cuyo estado final coincide con saldos y auditoría / total finalizadas` | Comparación cruzada Transaction, Account y Audit DB |

---

## 2. Aclaraciones Técnicas de Medición

* **Error Técnico (SLI-1)**: Refiere a fallos 5xx, timeouts o caídas de conexión. Un rechazo funcional del negocio (por ejemplo, fondos insuficientes `400` o acceso no autorizado `403`) es una **respuesta correcta de la lógica de dominio** y no cuenta como indisponibilidad técnica.
* **Consistencia Contable (SLI-6)**: Valida la ausencia de discrepancias o saldos negativos, garantizando que el dinero debitado coincida al centavo con el acreditado o compensado.
