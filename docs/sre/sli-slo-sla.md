# Marco Integral de Confiabilidad SRE: SLI, SLO y SLA — Bank USAC

Este documento consolida y unifica el marco completo de **Ingeniería de Confiabilidad de Sitios (SRE - Site Reliability Engineering)** para la plataforma bancaria **Bank USAC**. Integra en un único estándar normativo los **Indicadores de Nivel de Servicio (SLI)**, los **Objetivos de Nivel de Servicio (SLO)** y los **Acuerdos de Nivel de Servicio (SLA)**, respaldados por métricas cuantitativas, fórmulas matemáticas, tiempos exactos de respuesta y protocolos de gestión de incidentes adaptados a la criticidad del sector financiero.

---

## Índice
1. [Fundamentos y Relación de la Tríada SRE](#1-fundamentos-y-relación-de-la-tríada-sre)
2. [Métricas Cuantitativas Maestras de Disponibilidad](#2-métricas-cuantitativas-maestras-de-disponibilidad)
3. [Métricas de Latencia, Rendimiento y Percentiles](#3-métricas-de-latencia-rendimiento-y-percentiles)
4. [Indicadores de Nivel de Servicio (SLI)](#4-indicadores-de-nivel-de-servicio-sli)
   - [4.1 Indicadores Base (Línea Base T-03)](#41-indicadores-base-línea-base-t-03)
   - [4.2 Indicadores Complementarios por Dominio (SLI-7 a SLI-30)](#42-indicadores-complementarios-por-dominio-sli-7-a-sli-30)
5. [Objetivos de Nivel de Servicio (SLO)](#5-objetivos-de-nivel-de-servicio-slo)
   - [5.1 Objetivos de Calidad con Presupuesto de Error](#51-objetivos-de-calidad-con-presupuesto-de-error)
   - [5.2 Invariantes Financieros y de Seguridad (Sin Presupuesto de Error)](#52-invariantes-financieros-y-de-seguridad-sin-presupuesto-de-error)
6. [Gestión y Dinámica del Presupuesto de Error (*Error Budget & Burn Rate*)](#6-gestión-y-dinámica-del-presupuesto-de-error-error-budget--burn-rate)
7. [Acuerdo de Nivel de Servicio (SLA)](#7-acuerdo-de-nivel-de-servicio-sla)
   - [7.1 Alcance y Compromiso Externo](#71-alcance-y-compromiso-externo)
   - [7.2 Clasificación de Incidentes Bancarios (SEV-1 a SEV-4)](#72-clasificación-de-incidentes-bancarios-sev-1-a-sev-4)
   - [7.3 Compensaciones Financieras por Incumplimiento](#73-compensaciones-financieras-por-incumplimiento)
   - [7.4 Exclusiones Formales](#74-exclusiones-formales)
8. [Métricas de Infraestructura, Capacidad y Saturación](#8-métricas-de-infraestructura-capacidad-y-saturación)
9. [Matriz Cruzada de Trazabilidad SLI ↔ SLO ↔ SLA](#9-matriz-cruzada-de-trazabilidad-sli--slo--sla)

---

## 1. Fundamentos y Relación de la Tríada SRE

En Bank USAC, la confiabilidad se gobierna bajo una jerarquía técnica inmutable:

```
+-------------------------------------------------------------------------+
|                  SLA (Service Level Agreement)                          |
|  Compromiso contractual externo y consecuencias de negocio ante fallas. |
+-------------------------------------------------------------------------+
                                    ▲
                                    │ Respaldado por
+-------------------------------------------------------------------------+
|                  SLO (Service Level Objective)                          |
|  Meta numérica interna del equipo de ingeniería (incluye Error Budget).  |
+-------------------------------------------------------------------------+
                                    ▲
                                    │ Medido por
+-------------------------------------------------------------------------+
|                  SLI (Service Level Indicator)                          |
|  Métrica cuantitativa real recolectada directamente del sistema.        |
+-------------------------------------------------------------------------+
```

* **SLI (*¿Qué medimos?*)**: Ratios y percentiles derivados de eventos del broker, logs del API Gateway, sondas de Kubernetes y restricciones de base de datos.
* **SLO (*¿A qué aspiramos internamente?*)**: Umbrales estrictos que delimitan la zona saludable de operación.
* **SLA (*¿Qué garantizamos externamente?*)**: Compromiso formal hacia el cuentahabiente o evaluador, respaldado por penalizaciones y exclusiones explícitas.

---

## 2. Métricas Cuantitativas Maestras de Disponibilidad

Para una entidad bancaria, la disponibilidad global se define en el estándar de **Alta Disponibilidad de Grado Financiero: 99.99 % ("Cuatro Nueves")**.

$$\text{Disponibilidad (\%)} = \left( \frac{\text{Tiempo Total de Operación} - \text{Tiempo de Indisponibilidad No Programada}}{\text{Tiempo Total de Operación}} \right) \times 100$$

### 2.1 Presupuesto de Inactividad Permitida (*Downtime Budget*)

| Ventana de Tiempo | Duración Total (minutos) | Disponibilidad Mínima | Inactividad Máxima Permitida (Downtime) | Error Budget de Peticiones (Tasa) |
|---|---|---|---|---|
| **Diaria (24 horas)** | 1,440 min | 99.99 % | **8.64 segundos** | 0.01 % (1 de cada 10,000 reqs) |
| **Semanal (7 días)** | 10,080 min | 99.99 % | **1.01 minutos** (60.48 s) | 0.01 % |
| **Mensual (30 días)** | 43,200 min | 99.99 % | **4.32 minutos** (259.2 s) | 0.01 % |
| **Trimestral (90 días)**| 129,600 min | 99.99 % | **12.96 minutos** (777.6 s)| 0.01 % |
| **Anual (365 días)** | 525,600 min | 99.99 % | **52.56 minutos** (3,153.6 s)| 0.01 % |

### 2.2 Objetivos de Recuperación ante Desastres

* **RPO (Recovery Point Objective) = 0 segundos (Cero Pérdida de Datos)**:
  Ninguna transacción financiera confirmada puede perderse. Se garantiza mediante escritura síncrona en el Write-Ahead Log (WAL) de PostgreSQL, transacciones ACID y persistencia durable de mensajes en colas de RabbitMQ (`durable: true`).
* **RTO (Recovery Time Objective) < 15 minutos (900 segundos)**:
  Tiempo límite para restaurar la totalidad de la plataforma ante un desastre mayor en el clúster o la infraestructura en la nube.
* **MTTD (Mean Time to Detect) < 2 minutos (120 segundos)**:
  Tiempo medio para que las alertas automáticas detecten anomalías críticas.
* **MTTR (Mean Time to Recover) < 15 minutos**:
  Tiempo medio de remediación de incidencias operativas.

---

## 3. Métricas de Latencia, Rendimiento y Percentiles

El sistema procesa peticiones sincrónicas en el API Gateway y transacciones asíncronas distribuidas mediante la Saga. A continuación se detallan los límites numéricos de latencia por percentil medidos en milisegundos (ms):

| Tipo de Operación / Endpoint | Throughput Nominal (RPS) | P50 (Mediana) | P90 | P95 (Umbral SLO) | P99 (Cola Crítica) | Techo Técnico (Timeout) |
|---|---|---|---|---|---|---|
| **Consultas de Saldo / Dashboard** (`GET /api/dashboard`, `/api/accounts`) | 1,200 req/s | **≤ 30 ms** | **≤ 65 ms** | **≤ 95 ms** | **≤ 180 ms** | 5,000 ms |
| **Detalle de Cliente / Cuentas** (`GET /api/accounts/:id`, `/api/customers/:id`) | 800 req/s | **≤ 25 ms** | **≤ 50 ms** | **≤ 80 ms** | **≤ 150 ms** | 5,000 ms |
| **Depósito en Ventanilla** (`POST /api/accounts/:id/deposits`) | 300 req/s | **≤ 55 ms** | **≤ 110 ms** | **≤ 180 ms** | **≤ 320 ms** | 5,000 ms |
| **Inicio de Transferencia** (`POST /api/transfers`) | 450 req/s | **≤ 80 ms** | **≤ 170 ms** | **≤ 240 ms** | **≤ 450 ms** | 5,000 ms |
| **Pago de Servicios** (`POST /api/payments`) | 250 req/s | **≤ 75 ms** | **≤ 160 ms** | **≤ 230 ms** | **≤ 420 ms** | 5,000 ms |
| **Orquestación Saga Completa** (Débito + Broker + Crédito/Compensación) | 200 saga/s | **≤ 420 ms** | **≤ 800 ms** | **≤ 1,200 ms** | **≤ 2,400 ms** | 5,000 ms |
| **Carga de Fotografía DPI** (`POST /api/customers` multipart MinIO/S3) | 50 req/s | **≤ 150 ms** | **≤ 280 ms** | **≤ 400 ms** | **≤ 800 ms** | 10,000 ms |

---

## 4. Indicadores de Nivel de Servicio (SLI)

### 4.1 Indicadores Base (Línea Base T-03)

| # | Indicador | Fórmula Matemática | Fuente de Datos Primaria | Unidad |
|---|---|---|---|---|
| **SLI-1** | **Disponibilidad del API Gateway** | $$\frac{\sum \text{Peticiones HTTP Exitosas (código } < 500\text{)}}{\sum \text{Peticiones HTTP Totales Recibidas}}$$ | Logs estructurados del Gateway y métricas HTTP | Ratio (%) |
| **SLI-2** | **Tasa de Completitud de Transferencias** | $$\frac{\sum \text{Transferencias en Estado } COMPLETED}{\sum \text{Transferencias Aceptadas Totales}}$$ | Base de datos de Transaction Service (`transactions`) | Ratio (%) |
| **SLI-3** | **Duración de la Saga (P50 / P95)** | $$T_{\text{final}} (COMPLETED / COMPENSATED) - T_{\text{inicio}} (occurredAt)$$ | Metadatos de la envolvente canónica del mensaje | Milisegundos (ms) |
| **SLI-4** | **Latencia de Propagación de Eventos** | $$T_{\text{consumo exitoso en suscriptor}} - T_{\text{emisión (occurredAt)}}$$ | Envolvente estándar de RabbitMQ | Milisegundos (ms) |
| **SLI-5** | **Tasa de Reintentos y Mensajes en DLQ** | $$\frac{\sum \text{Reintentos Ejecutados}}{\sum \text{Entregas Totales}} \quad \text{y recuento absoluto en colas DLQ}$$ | API de administración de RabbitMQ (`/api/queues`) | Ratio (%) y Conteo |
| **SLI-6** | **Consistencia Contable Eventual** | $$\frac{\sum \text{Transferencias con cuadre exacto entre Transaction, Account y Audit}}{\sum \text{Transferencias Finalizadas}}$$ | Comparación cruzada de bases de datos PostgreSQL | Ratio (%) |

---

### 4.2 Indicadores Complementarios por Dominio (SLI-7 a SLI-30)

#### Grupo A — Borde: API Gateway y Experiencia del Cliente

| # | Indicador | Fórmula Matemática | Fuente de Datos | Unidad |
|---|---|---|---|---|
| **SLI-7** | **Latencia del API Gateway** | $$T_{\text{respuesta HTTP}} - T_{\text{recepción HTTP}}$$ (segmentado por ruta `GET` vs `POST`) | Logs del Gateway con `correlationId` | ms (P50/P95/P99) |
| **SLI-8** | **Tasa de Expiración de Respuesta** | $$\frac{\sum \text{Respuestas con error } REPLY\_TIMEOUT}{\sum \text{Peticiones request-reply emitidas}}$$ | Filtro de excepciones `gateway-exception.filter.ts` | Ratio (%) |
| **SLI-9** | **Tasa de Indisponibilidad del Broker** | $$\frac{\sum \text{Fallos con error } BROKER\_UNAVAILABLE}{\sum \text{Peticiones que intentaron publicar en el broker}}$$ | Adaptador RabbitMQ del Gateway (`isConnected()`) | Ratio (%) |
| **SLI-10**| **Distribución de Fallos del Catálogo** | Recuento desagregado por cada uno de los 7 códigos del catálogo cerrado (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `BUSINESS_REJECTION`, `REPLY_TIMEOUT`, `BROKER_UNAVAILABLE`, `INTERNAL_ERROR`) | `apps/gateway/src/application/errors/` | Conteo entero |

#### Grupo B — Plataforma: Contenedores y Kubernetes

| # | Indicador | Fórmula Matemática | Fuente de Datos | Unidad |
|---|---|---|---|---|
| **SLI-11**| **Disponibilidad de Réplicas Listas** | $$\frac{\sum \text{Sondeos de } /ready \text{ que responden 200 OK}}{\sum \text{Sondeos de } /ready \text{ ejecutados por kubelet}}$$ | `readinessProbe` del Chart Helm (`periodSeconds: 10`) | Ratio (%) |
| **SLI-12**| **Tiempo de Arranque hasta Listo (TTR)** | $$T_{\text{primer } /ready = 200} - T_{\text{creación del contenedor}}$$ | Eventos de Pods en `kubectl get pods` | Segundos (s) |
| **SLI-13**| **Tasa de Reinicios de Contenedor** | $$\frac{\sum \text{restartCount acumulado}}{\text{Número total de Pods}}$$ | Campo `restartCount` de Kubelet | Conteo / Pod |
| **SLI-14**| **Separación Efectiva de Sondas** | Casos donde `/health` responde `200` y `/ready` responde `503` ante desconexión de BD | Script de pruebas de humo `pnpm images:smoke` | Porcentaje (%) |

#### Grupo C — Mensajería, Idempotencia y Auditoría

| # | Indicador | Fórmula Matemática | Fuente de Datos | Unidad |
|---|---|---|---|---|
| **SLI-15**| **Efectividad de Idempotencia** | $$\frac{\sum \text{Comandos duplicados absorbidos con idéntico resultado sin duplicar saldo}}{\sum \text{Comandos duplicados recibidos}}$$ | Restricción única de `idempotencyKey` en BD | Ratio (100.0 %) |
| **SLI-16**| **Cobertura de Auditoría** | $$\frac{\sum \text{Eventos del flujo principal registrados en la bitácora}}{\sum \text{Eventos del flujo principal publicados en RabbitMQ}}$$ | Cinco colas `audit.*` contra publicaciones | Ratio (%) |
| **SLI-17**| **Tasa de Mensajes No Interpretables** | $$\frac{\sum \text{Filas registradas con } processingStatus = INVALID}{\sum \text{Filas totales registradas en auditoría}}$$ | Tabla de auditoría (`audit_events`) | Ratio (%) |
| **SLI-18**| **Integridad de Redacción Previa** | Recuento de filas de auditoría que contienen documento DPI, dirección o monto en texto plano (debe ser estrictamente **0**) | Verificación contra `domain/redaction.ts` | Conteo absoluto |
| **SLI-19**| **Completitud de Envolvente Canónica** | $$\frac{\sum \text{Mensajes con envolvente válida según } envelopeSchema}{\sum \text{Mensajes emitidos}}$$ | Validación de esquemas Zod en `@bank/contracts` | Ratio (%) |

#### Grupo D — Dominio Bancario: Cuentas, Transferencias y Pagos

| # | Indicador | Fórmula Matemática | Fuente de Datos | Unidad |
|---|---|---|---|---|
| **SLI-20**| **Tasa de Conflicto Optimista** | $$\frac{\sum \text{Escrituras rechazadas por desajuste de columna } version}{\sum \text{Escrituras de saldo intentadas}}$$ | Columna `version` en tabla `accounts` | Ratio (%) |
| **SLI-21**| **Integridad del Libro Contable** | $$\sum \text{Cuentas con } balance < 0 \quad \mathbf{y} \quad \left| \sum \text{Débitos} - (\sum \text{Créditos} + \sum \text{Compensaciones}) \right|$$ | `CHECK (balance >= 0)` y sumatoria en centavos | Conteo = 0; Dif = Q 0.00 |
| **SLI-22**| **Tasa de Transiciones Ilegales** | $$\frac{\sum \text{Transiciones rechazadas con error } ILLEGAL\_TRANSITION}{\sum \text{Transiciones de estado solicitadas}}$$ | Máquina de estados de `Transaction Service` | Ratio (%) |
| **SLI-23**| **Profundidad de Escalera de Reintentos** | Histograma del número de intento (1, 2, 3 o 4) con el que cada pago finaliza | Tabla `payment_attempts` y eventos emitidos | Conteo por escalón |
| **SLI-24**| **Puntualidad del Barrido (*Sweeper*)** | $$T_{\text{ejecución real del intento}} - nextAttemptAt$$ | Columna `nextAttemptAt` vs logs del sweeper | ms (P95) |
| **SLI-25**| **Exactitud de Desactivación Automática** | $$\frac{\sum \text{Cuentas desactivadas que tenían } > 6 \text{ meses sin movimientos y } < \text{Q } 50.00}{\sum \text{Cuentas desactivadas por el job programado}}$$ | Proceso batch con reloj inyectado en Account | Ratio (100.0 %) |

#### Grupo E — Soporte, Identidad y Seguridad

| # | Indicador | Fórmula Matemática | Fuente de Datos | Unidad |
|---|---|---|---|---|
| **SLI-26**| **Tasa de Emisión de Notificaciones**| $$\frac{\sum \text{Notificaciones emitidas exitosamente}}{\sum \text{Eventos notificables consumidos}}$$ | Canal de Notification Service | Ratio (%) |
| **SLI-27**| **Éxito de Almacenamiento de DPI** | $$\frac{\sum \text{Cargas de imagen confirmadas por MinIO/S3}}{\sum \text{Cargas de imagen solicitadas en registro}}$$ | Adaptador de almacenamiento de objetos | Ratio (%) |
| **SLI-28**| **Corrección de Control de Acceso (D-06)**| $$\frac{\sum \text{Peticiones admitidas cuyo rol coincide con la matriz D-06}}{\sum \text{Peticiones autenticadas admitidas}}$$ | Guardas de roles en API Gateway | Ratio (100.0 %) |
| **SLI-29**| **Higiene de Sesión JWT** | $$\frac{\sum \text{Rechazos por token expirado}}{\sum \text{Rechazos } UNAUTHENTICATED \text{ totales}}$$ | Validador JWT del Gateway | Ratio (%) |
| **SLI-30**| **Ausencia de Secretos en Imágenes** | Recuento de capas de contenedor Docker que contienen contraseñas o llaves privadas horneadas (debe ser estrictamente **0**) | `pnpm images:smoke` | Conteo = 0 |

---

## 5. Objetivos de Nivel de Servicio (SLO)

### 5.1 Objetivos de Calidad con Presupuesto de Error

Admiten una degradación controlada durante picos de carga. Su incumplimiento indica degradación de servicio pero **no** pérdida de fondos monetarios.

| # | Objetivo | Umbral Mínimo Numérico | Ventana de Medición | Presupuesto de Error (*Error Budget*) | Indicador Asociado |
|---|---|---|---|---|---|
| **SLO-1** | Mensajes válidos que no van a Dead-Letter Queue (DLQ) | **≥ 99.00 %** | Ventana mensual / Corrida | 1.00 % de mensajes procesados | SLI-5 |
| **SLO-2** | Transferencias completadas en menos de 5.0 segundos | **≥ 95.00 %** | Ventana mensual / Corrida | 5.00 % de transferencias | SLI-2, SLI-3 |
| **SLO-6** | Lecturas en Gateway (`GET`) en menos de 1,000 ms (P95) | **≥ 95.00 %** | Ventana mensual / Corrida | 5.00 % de lecturas HTTP | SLI-7 |
| **SLO-7** | Comandos en Gateway (`POST`) en menos de 3,000 ms (P95) | **≥ 95.00 %** | Ventana mensual / Corrida | 5.00 % de comandos HTTP | SLI-7 |
| **SLO-8** | Peticiones que no agotan el techo de timeout (5,000 ms) | **≥ 99.90 %** | Ventana mensual / Corrida | 0.10 % de peticiones | SLI-8 |
| **SLO-9** | Sondeos de `/ready` exitosos por contenedor | **≥ 99.00 %** | Ventana mensual / Corrida | 1.00 % de sondeos ejecutados | SLI-11 |
| **SLO-10**| Pods que alcanzan estado `Ready` en menos de 90 segundos | **≥ 95.00 %** | Por despliegue en clúster | 5.00 % de pods arrancados | SLI-12 |
| **SLO-11**| Puntualidad de barrido de reintentos P95 (< 1,000 ms) | **≥ 95.00 %** | Por lote de pagos | 5.00 % de ejecuciones | SLI-24 |
| **SLO-12**| Notificaciones emitidas por evento notificable | **≥ 99.00 %** | Ventana mensual / Corrida | 1.00 % de notificaciones | SLI-26 |
| **SLO-13**| Documentos de identidad persistidos exitosamente en S3 | **≥ 99.50 %** | Por lote de registros | 0.50 % de cargas de imagen | SLI-27 |
| **SLO-14**| Reintentos en broker ejecutados dentro de la escalera | **≥ 99.00 %** | Ventana mensual / Corrida | 1.00 % de entregas | SLI-5, SLI-23 |

---

### 5.2 Invariantes Financieros y de Seguridad (Sin Presupuesto de Error)

Son **invariantes absolutos de corrección bancaria**. Tienen **presupuesto de error igual a CERO (0 %)**. Una sola violación constituye un defecto crítico inaceptable:

| # | Invariante Bancario / de Seguridad | Umbral Exigido | Ventana de Evaluación | Presupuesto de Error | Indicador |
|---|---|---|---|---|---|
| **SLO-3** | Comandos duplicados que producen exactamente un efecto contable | **100.00 %** | Toda operación recibida | **0 % (Tolerancia Cero)** | SLI-6, SLI-15 |
| **SLO-4** | Fallos post-débito que culminan en compensación contable | **100.00 %** | Todo fallo post-débito | **0 % (Tolerancia Cero)** | SLI-2, SLI-6 |
| **SLO-5** | Eventos del flujo principal que portan `correlationId` | **100.00 %** | Todo mensaje emitido | **0 % (Tolerancia Cero)** | SLI-4, SLI-19 |
| **SLO-15**| Cuentas bancarias con saldo negativo (`balance < 0`) | **0 cuentas** | Todo movimiento contable | **0 filas (Invariante)** | SLI-21 |
| **SLO-16**| Cuadre al centavo: $\sum \text{Débitos} = \sum \text{Créditos} + \sum \text{Compensaciones}$ | **100.00 %** | Todo cierre transaccional | **0 % (Tolerancia Cero)** | SLI-6, SLI-21 |
| **SLO-17**| Pagos que agotan reintentos y finalizan en `COMPENSATED` | **100.00 %** | Todo pago no completado | **0 % (Tolerancia Cero)** | SLI-2, SLI-23 |
| **SLO-18**| Aceptación de transiciones ilegales fuera del grafo de 6 estados | **0 transiciones** | Toda petición de cambio | **0 casos (Invariante)** | SLI-22 |
| **SLO-19**| Serialización concurrente de saldo sin pérdida de actualización | **100.00 %** | Todo conflicto concurrente | **0 % (Tolerancia Cero)** | SLI-20 |
| **SLO-20**| Eventos del flujo principal persistidos en bitácora de auditoría | **100.00 %** | Todo evento en broker | **0 % (Tolerancia Cero)** | SLI-16 |
| **SLO-21**| Mensajes corruptos registrados como `INVALID` (no descartados) | **100.00 %** | Todo mensaje no válido | **0 % (Tolerancia Cero)** | SLI-17 |
| **SLO-22**| Registros de auditoría con datos sensibles (DPI, saldo) en claro | **0 registros** | Toda fila en auditoría | **0 filas (Invariante)** | SLI-18 |
| **SLO-23**| Mensajes emitidos que cumplen la envolvente Zod canónica | **100.00 %** | Todo mensaje emitido | **0 % (Tolerancia Cero)** | SLI-19 |
| **SLO-24**| Peticiones autorizadas que respetan la matriz de roles D-06 | **100.00 %** | Toda petición HTTP | **0 % (Tolerancia Cero)** | SLI-28 |
| **SLO-25**| Capas de imágenes Docker con credenciales o secretos embebidos | **0 capas** | Todas las imágenes construidas| **0 capas (Invariante)**| SLI-30 |
| **SLO-26**| Reinicios de contenedor no provocados en operación | **0 reinicios** | Toda corrida operativa | **0 reinicios** | SLI-13 |

---

## 6. Gestión y Dinámica del Presupuesto de Error (*Error Budget & Burn Rate*)

### 6.1 Fórmula del Presupuesto de Error
El presupuesto de error (*Error Budget*) representa el margen tolerable de imperfección:

$$\text{Error Budget} = 100\% - \text{SLO} = 100\% - 99.99\% = 0.01\%$$

Para un volumen mensual estimado de **10,000,000 de transacciones**, se permite un máximo de **1,000 peticiones con error técnico 5xx al mes**.

### 6.2 Velocidad de Consumo (*Burn Rate*)

El **Burn Rate** mide la velocidad a la que se consume el presupuesto de error con respecto al tiempo:

$$\text{Burn Rate} = \frac{\text{Fracción de Presupuesto Consumida}}{\text{Fracción de la Ventana de Tiempo Transcurrida}}$$

| Factor de Burn Rate | \% Presupuesto Consumido | Tiempo para Agotar Presupuesto | Severidad de Alerta | Acción Operativa Obligatoria |
|---|---|---|---|---|
| **1.0x** | 100 % en 30 días | 30 días (720 horas) | Informativo | Operación nominal. Ninguna acción requerida. |
| **2.0x** | 10 % en 36 horas | 15 días (360 horas) | Advertencia (Ticket) | Revisión de logs en horario hábil. |
| **5.0x** | 15 % en 21 horas | 6 días (144 horas) | Alerta Media | Notificación a SRE on-call. Investigación de causa raíz. |
| **14.4x** | 5 % en 1 hora | 2 días (50 horas) | **Alerta Crítica (Páger)** | Notificación inmediata 24/7. Mitigación en < 15 min. |
| **36.0x** | 10 % en 2 horas | 20 horas | **Emergencia (SEV-1)** | Congelamiento de despliegues. Declaración de incidente mayor. |

### 6.3 Política de Agotamiento de Presupuesto (*Error Budget Policy*)

```
 Consumo del Presupuesto de Error Mensual:
 [ 0% -------------- 50% ----------------------- 100% ]
      ZONA VERDE              ZONA ÁMBAR              ZONA ROJA
   (Flujo normal)        (Revisión obligada)     (CONGELAMIENTO)
```

1. **Consumo < 50 % (Zona Verde)**: Operación normal. Se permiten nuevos despliegues y cambios de características (*features*).
2. **Consumo entre 50 % y 99 % (Zona Ámbar)**: Todo despliegue a producción requiere aprobación explícita del líder técnico y reporte de causa raíz del consumo anómalo.
3. **Consumo ≥ 100 % (Zona Roja)**:
   * **Congelamiento total de cambios (*Code Freeze*)**: Se bloquea la incorporación de nuevas funcionalidades.
   * **Prioridad 100 % a Confiabilidad**: El 100% de la capacidad de ingeniería se destina exclusivamente a tareas de estabilización, refactorización y resiliencia hasta el inicio del siguiente ciclo mensual.

---

## 7. Acuerdo de Nivel de Servicio (SLA)

### 7.1 Alcance y Compromiso Externo

* **Disponibilidad Comprometida**: **99.99 %** mensual.
* **Canales Atendidos**: Portal Web de Clientes, Terminal de Ventanilla de Cajeros, Consola Administrativa y API Gateway.
* **Garantía Contable**: Cero discrepancias en balances monetarios; reversas atómicas automáticas mediante Saga ante cualquier fallo de terceros.

### 7.2 Clasificación de Incidentes Bancarios (SEV-1 a SEV-4)

| Nivel de Severidad | Criterio de Impacto Bancario | Ejemplos Representativos | MTTD (Detección) | MTTA (Respuesta) | MTTR (Mitigación) |
|---|---|---|---|---|---|
| **SEV-1 (Crítica)** | Afectación generalizada del servicio, pérdida de datos o violación de invariante contable | Saldo negativo, dinero debitado sin crédito ni compensación, caída total del clúster GKE o PostgreSQL | **≤ 2 min** | **≤ 5 min** | **≤ 15 min** |
| **SEV-2 (Alta)** | Funcionalidad bancaria clave degradada para múltiples usuarios sin alternativa | Falla del servicio de Pagos de Servicios, degradación masiva de RabbitMQ, latencia P95 > 3,000 ms | **≤ 5 min** | **≤ 15 min** | **≤ 45 min** |
| **SEV-3 (Media)** | Problema intermitente o afectación que cuenta con mecanismo de mitigación | Retrasos en envío de notificaciones por correo, expiraciones aisladas de token JWT, fallas en carga de foto DPI | **≤ 15 min** | **≤ 30 min** | **≤ 4 horas** |
| **SEV-4 (Baja)** | Defecto cosmético, inconsistencia de etiquetas o consulta no bloqueante | Error ortográfico en interfaz, retraso en refresco de filtro de transferencias, duda operativa | **≤ 1 hora** | **≤ 4 horas** | Siguiente release |

### 7.3 Compensaciones Financieras por Incumplimiento

En contratos de servicios bancarios corporativos o acuerdos institucionales, el incumplimiento de la disponibilidad mensual acarrea la aplicación de **Créditos de Servicio** descontables de la facturación:

| Disponibilidad Mensual Real | Porcentaje de Crédito Otorgado al Cliente |
|---|---|
| **≥ 99.99 %** | 0 % (Cumplimiento de SLA) |
| **99.90 % a 99.98 %** | **10 %** de la cuota mensual de servicio |
| **99.50 % a 99.89 %** | **25 %** de la cuota mensual de servicio |
| **99.00 % a 99.49 %** | **50 %** de la cuota mensual de servicio |
| **< 99.00 %** | **100 %** de la cuota mensual de servicio (Reembolso completo del mes) |

### 7.4 Exclusiones Formales

No se computan como indisponibilidad ni consumen presupuesto de error:
1. **Rechazos de Negocio**: Peticiones rechazadas legítimamente por la lógica de dominio (fondos insuficientes `400`, cuenta inactiva o credenciales incorrectas `401`).
2. **Ventanas de Mantenimiento Programado**: Mantenimientos debidamente notificados con 5 días hábiles de anticipación y ejecutados en ventana de bajo tráfico (domingos de 02:00 a 04:00 UTC-6), con un tope máximo de 2 horas al mes.
3. **Fallas de Conectividad del Cliente**: Problemas imputables al proveedor de Internet del usuario, caídas de DNS público o fallas en el dispositivo cliente.
4. **Fuerza Mayor**: Caídas globales de infraestructura del proveedor de nube (GCP) declaradas oficialmente en su tablero de estado.

---

## 8. Métricas de Infraestructura, Capacidad y Saturación

Para garantizar que el sistema soporte el SLA de 99.99%, la infraestructura en Kubernetes y Compute Engine se dimensiona bajo las siguientes métricas nominales:

### 8.1 Dimensionamiento y Autoescalado (HPA)
* **Umbral de Activación de HPA**: **80 % de utilización promedio de CPU** por Pod.
* **Rango de Réplicas por Microservicio**: Mínimo **1 Pod**, Máximo **5 Pods** (escalado horizontal elástico).
* **Período de Estabilización de Escala (*Cooldown*)**: **300 segundos (5 minutos)** para evitar oscilaciones (*flapping*).
* **Límites de Recursos por Pod**:
  * Microservicios Node.js: `requests: { cpu: 50m, memory: 128Mi }`, `limits: { cpu: 250m, memory: 256Mi }`.
  * API Gateway: `requests: { cpu: 100m, memory: 128Mi }`, `limits: { cpu: 500m, memory: 512Mi }`.

### 8.2 Parámetros del Broker y Bases de Datos
* **Pool de Conexiones PostgreSQL**: Máximo **20 conexiones por Pod**; timeout de adquisición de conexión: **3,000 ms**.
* **Capacidad de Almacenamiento**: Almacenamiento persistente en discos SSD (`pd-ssd`) con IOPS aprovisionados para soportar ≥ 1,500 transacciones por segundo.
* **Escalera de Reintentos de Pagos**:
  * Intento 1: Inmediato ($t = 0\text{ ms}$).
  * Intento 2: Retraso de **1,000 ms**.
  * Intento 3: Retraso de **5,000 ms**.
  * Intento 4 (Final): Retraso de **30,000 ms**.
  * Tiempo total acumulado de la escalera: **36,000 ms**.
* **Frecuencia del Barrido de Reintentos (*Sweeper*)**: Cada **500 ms**.

### 8.3 Confiabilidad, Soberanía de Datos y Almacenamiento de Objetos (MinIO vs Almacenamiento Gestionado)

En la arquitectura de Bank USAC, la gestión de documentos de identidad (fotografías de DPI y pasaportes) se delega a un clúster de almacenamiento de objetos **MinIO (StatefulSet)** dentro de la VPC privada de Kubernetes, en lugar de utilizar un bucket público o multitenant de un proveedor de nube (como Google Cloud Storage estándar). Esta decisión responde a directrices estrictas de SRE y regulación bancaria:

1. **Aislamiento Perimetral y Modelo Zero Trust (Protección PII):**
   * Los documentos de identificación contienen información personal sensible (*Personally Identifiable Information - PII*).
   * Al ejecutarse MinIO dentro de la VPC privada (`10.10.0.0/20`), el tráfico de subida y validación criptográfica (hash SHA-256) **nunca transita por la red pública de Internet**, eliminando vectores de ataque por configuraciones erróneas de permisos en buckets globales.
2. **Eliminación del Bloqueo de Proveedor (*Vendor Lock-in*) y Estrategia de Salida (*Exit Strategy*):**
   * MinIO implementa la API estándar abierta de **Amazon S3** (`@aws-sdk/client-s3`).
   * Los entes reguladores financieros (como la Superintendencia de Bancos - SIB) exigen planes de contingencia y salida multicloud: el banco puede migrar su plataforma entre GCP, AWS, Azure o centros de datos On-Premise sin modificar una sola línea de código fuente.
3. **Métricas de Durabilidad y Disponibilidad de Almacenamiento:**
   * **SLI de Durabilidad de Objetos**: **99.999999 % (8 Nueves)** sobre volúmenes persistentes SSD (`PersistentVolumeClaims`) con snapshots automatizados.
   * **SLO de Latencia de Carga de Documentos (P95)**: $\le 400\text{ ms}$ (throughput interno dentro del clúster).
   * **Cero Cobro por Operación (*Zero API Op Fees*)**: A diferencia de servicios gestionados que tarifan por cada operación Clase A/B (`PUT`/`GET`), MinIO permite millones de lecturas internas para validación de identidad con costo predecible y cero *egress fees*.

---

## 9. Matriz Cruzada de Trazabilidad SLI ↔ SLO ↔ SLA

| Componente del Banco | Indicador (SLI) | Objetivo Interno (SLO) | Compromiso Externo (SLA) | Comando / Evidencia de Validación |
|---|---|---|---|---|
| **API Gateway** | SLI-1, SLI-7, SLI-8 | SLO-6, SLO-7, SLO-8 (≥ 95.0% < 1s) | Disponibilidad 99.99%, respuesta < 5s | `pnpm --filter gateway test` |
| **Transferencias (Saga)**| SLI-2, SLI-3, SLI-4 | SLO-2, SLO-4, SLO-17 (≥ 95.0% < 5s) | Reversas automáticas garantizadas ante fallo | `pnpm images:flow` |
| **Libro Contable** | SLI-6, SLI-20, SLI-21 | SLO-3, SLO-15, SLO-16 (100% cuadre) | Tolerancia cero a saldos negativos o duplicados | `pnpm --filter account-service test` |
| **Pagos a Terceros** | SLI-23, SLI-24 | SLO-11, SLO-14 (≥ 99.0% en escalera)| Transparencia y compensación tras 4 intentos | `pnpm --filter payment-service test` |
| **Mensajería RabbitMQ** | SLI-5, SLI-19 | SLO-1, SLO-23 (≥ 99.0% sin DLQ) | Cero pérdida de mensajes válidos en tránsito | `pnpm test:contract` |
| **Almacenamiento DPI (MinIO)** | SLI-9, SLI-10 | SLO-12 (P95 ≤ 400ms, 0 expuestos) | Soberanía perimetral privada y durabilidad 99.9999% | `pnpm --filter customer-service test` |
| **Auditoría Forense** | SLI-16, SLI-17, SLI-18| SLO-20, SLO-21, SLO-22 (0 en claro) | Registro inmutable con datos sensibles ofuscados| `pnpm --filter notification-audit-service test`|
| **Seguridad de Acceso** | SLI-28, SLI-29, SLI-30| SLO-24, SLO-25 (0 secretos) | Segregación de roles (D-06) y JWT inviolable | `pnpm images:smoke` |
| **Plataforma K8s / Cloud**| SLI-11, SLI-12, SLI-13| SLO-9, SLO-10 (≥ 99.0% / < 90s) | Autoescalado al 80% CPU y RTO < 15 min | `pnpm k8s:evidence` |
