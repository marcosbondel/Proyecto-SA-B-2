# Marco Integral de Confiabilidad SRE: SLI, SLO y SLA — Bank USAC

Este documento conserva los identificadores de la línea base T-03 y distingue sus
objetivos de las mediciones implementadas en Fase III. Revisión documental:
**2026-10-21**, contra el código y los charts del repositorio. Una configuración
versionada demuestra cómo se calcula un indicador; el cumplimiento requiere
además resultados con entorno, versión, consulta y ventana de observación.

La decisión operativa actual queda registrada en
[ADR-020](../architecture/adr/ADR-020-slo-error-budgets.md), y el despliegue del
stack en [ADR-023](../architecture/adr/ADR-023-observability-evolution.md).
Los informes históricos de [postmortems](postmortems/README.md) conservan su
entorno original: una corrida de kind no demuestra el comportamiento de GKE.

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
   - [5.3 Los SLO que la Fase 3 mide con datos reales (T-58)](#53-los-slo-que-la-fase-3-mide-con-datos-reales-t-58)
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

En Bank USAC, los tres términos tienen funciones distintas:

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
* **SLA (*¿Qué se compromete ante el evaluador?*)**: Alcance académico de demostración. No existe un contrato comercial de disponibilidad o créditos de servicio en este repositorio.

---

## 2. Métricas Cuantitativas Maestras de Disponibilidad

La referencia histórica de **99.99 %** ilustra la relación matemática entre
porcentaje e indisponibilidad; **no es el SLO desplegado ni una disponibilidad
medida**. El SLO-27 que evalúa Grafana es **99 % de respuestas no 5xx en siete
días**, una proporción de peticiones. La indisponibilidad por tiempo de la tabla
siguiente es otro indicador: no se puede convertir una en otra sin definir
tráfico y observaciones sintéticas.

### 2.1 Presupuesto de Inactividad Permitida (*Downtime Budget*)

| Ventana de Tiempo | Duración Total (minutos) | Disponibilidad Mínima | Inactividad Máxima Permitida (Downtime) | Error Budget de Peticiones (Tasa) |
|---|---|---|---|---|
| **Diaria (24 horas)** | 1,440 min | 99.99 % | **8.64 segundos** | 0.01 % (1 de cada 10,000 reqs) |
| **Semanal (7 días)** | 10,080 min | 99.99 % | **1.01 minutos** (60.48 s) | 0.01 % |
| **Mensual (30 días)** | 43,200 min | 99.99 % | **4.32 minutos** (259.2 s) | 0.01 % |
| **Trimestral (90 días)**| 129,600 min | 99.99 % | **12.96 minutos** (777.6 s)| 0.01 % |
| **Anual (365 días)** | 525,600 min | 99.99 % | **52.56 minutos** (3,153.6 s)| 0.01 % |

### 2.2 Objetivos de Recuperación ante Desastres

RPO cero y RTO menor de 15 minutos son **aspiraciones de diseño**, pendientes
de una prueba de restauración con copia de seguridad y tiempo medido. Un commit
ACID, una cola `durable` y un PVC no prueban por sí solos RPO cero frente a la
pérdida de una VM, disco o zona. El módulo actual es zonal y los almacenes de
observabilidad tienen una réplica.

Los objetivos de detección y mitigación por severidad de §7.2 son una guía de
respuesta del equipo, no tiempos medidos. Cada postmortem debe declarar qué
marcas temporales existen y cuáles faltan.

---

## 3. Métricas de Latencia, Rendimiento y Percentiles

El Gateway responde por HTTP y espera request/reply AMQP con un techo de
**5 s**; la aceptación HTTP de una transferencia no equivale al cierre de la
Saga. Sus objetivos operativos son **GET bajo 1 s** y **POST bajo 3 s**, ambos
con 95 % de eventos buenos. El histograma HTTP sólo permite medir los comandos
conservadoramente bajo **2.5 s** (§5.3).

Para la Saga, el umbral sigue siendo **5 s**. La escalera del proveedor agrega
esperas de **1 s, 5 s y 30 s** entre intentos: no hay un timeout global de
5 s para todo el flujo. Los percentiles se calculan sobre histogramas en
segundos y los paneles pueden mostrarlos en milisegundos.

No se publica una capacidad nominal de RPS a partir de estos umbrales. La
capacidad y los p50/p95/p99 observados pertenecen a una corrida identificada de
[carga y fallos T-51](../qa/backend/T-51-load-and-failures-evidence.md), no a
una estimación de dimensionamiento.

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
| **SLI-16**| **Cobertura de Auditoría** | $$\frac{\sum \text{Eventos del flujo principal registrados en la bitácora}}{\sum \text{Eventos del flujo principal publicados en RabbitMQ}}$$ | Seis colas `audit.*` contra publicaciones | Ratio (%) |
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
| **SLO-1** | Mensajes válidos que no van a Dead-Letter Queue (DLQ) | **≥ 99.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 1.00 % de mensajes procesados | SLI-5 |
| **SLO-2** | Transferencias completadas en menos de 5.0 segundos | **≥ 95.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 5.00 % de transferencias | SLI-2, SLI-3 |
| **SLO-6** | Lecturas en Gateway (`GET`) en menos de 1,000 ms (P95) | **≥ 95.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 5.00 % de lecturas HTTP | SLI-7 |
| **SLO-7** | Comandos en Gateway (`POST`) en menos de 3,000 ms (P95) | **≥ 95.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 5.00 % de comandos HTTP | SLI-7 |
| **SLO-8** | Peticiones que no agotan el techo de timeout (5,000 ms) | **≥ 99.90 %** | Corrida; serie de 7 d cuando existe (§5.3) | 0.10 % de peticiones | SLI-8 |
| **SLO-9** | Sondeos de `/ready` exitosos por contenedor | **≥ 99.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 1.00 % de sondeos ejecutados | SLI-11 |
| **SLO-10**| Pods que alcanzan estado `Ready` en menos de 90 segundos | **≥ 95.00 %** | Por despliegue en clúster | 5.00 % de pods arrancados | SLI-12 |
| **SLO-11**| Puntualidad de barrido de reintentos P95 (< 1,000 ms) | **≥ 95.00 %** | Por lote de pagos | 5.00 % de ejecuciones | SLI-24 |
| **SLO-12**| Notificaciones emitidas por evento notificable | **≥ 99.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 1.00 % de notificaciones | SLI-26 |
| **SLO-13**| Documentos de identidad persistidos exitosamente en S3 | **≥ 99.50 %** | Por lote de registros | 0.50 % de cargas de imagen | SLI-27 |
| **SLO-14**| Reintentos en broker ejecutados dentro de la escalera | **≥ 99.00 %** | Corrida; serie de 7 d cuando existe (§5.3) | 1.00 % de entregas | SLI-5, SLI-23 |

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

### 5.3 Los SLO que la Fase 3 mide con datos reales (T-58)

Las fórmulas implementadas viven en
[`bank-observability/values.yaml`](../../infra/k8s/helm/bank-observability/values.yaml):
las tasas rápidas se evalúan cada **30 s**, las proporciones y presupuestos de
**7 d** cada **5 min**, y las alertas de Grafana cada **1 min**. La retención
cloud de los tres almacenes es de **7 d**. Los valores de kind reducen esa
retención a 2 h en Prometheus y 24 h en Tempo: una corrida local no aporta una
semana de historia.

Toda lectura debe seleccionar `environment="dev"` o `environment="prod"`;
los logs de Loki usan `deployment_environment`. Antes de anunciar cumplimiento
se registra el inicio real de la serie: consultar `[7d]` en un stack recién
creado calcula sobre los datos disponibles y **no prueba siete días completos**.

#### Los cinco grupos medidos

| Objetivo | Regla de proporción rápida | Umbral y presupuesto | Panel y runbook |
| --- | --- | --- | --- |
| **SLO-27**, Gateway sin 5xx, excluye `/health` y `/ready` | `slo:gateway_availability:ratio_rate5m` | ≥ 99 %; 1 % de peticiones | `02-slo-error-budget`; [disponibilidad](../operations/runbooks/gateway-availability-burn.md) |
| **SLO-2**, duración de Saga bajo 5 s | `slo:transfer_under_5s:ratio_rate5m` | ≥ 95 %; 5 % de cierres observados | `02-slo-error-budget`; [transferencias](../operations/runbooks/transfer-latency.md) |
| **SLO-1**, entregas sin `dead_letter` | `slo:messages_not_dead_lettered:ratio_rate5m` | ≥ 99 %; 1 % de entregas | `02-slo-error-budget`; [DLQ](../operations/runbooks/dead-letter.md) |
| **SLO-6 / SLO-7**, GET bajo 1 s / POST bajo 3 s | `slo:gateway_reads_under_1s:ratio_rate5m` / `slo:gateway_commands_under_3s:ratio_rate5m` | ≥ 95 %; 5 % por método | `02-slo-error-budget`; [latencia HTTP](../operations/runbooks/gateway-latency.md) |
| **SLO-28**, interbancario por dirección | `slo:interbank_accepted:ratio_rate5m` / `slo:interbank_sent_accepted:ratio_rate5m` | ≥ 95 %; 5 % por dirección; p95 de confirmación < 5 s | `08-banco-pareja`; [interbancario](../operations/runbooks/partner-bank.md) |

**Diferencias de medición que deben permanecer visibles:**

- SLO-2 se definió sobre transferencias exitosas en la línea base. La regla
  actual divide el bucket de duración entre el `_count` de **todos los estados
  finales**, incluyendo `failed` y `compensated`; tampoco incluye transferencias
  que siguen pendientes. Es un proxy de duración terminal, no una prueba de
  éxito ni de ausencia de Sagas detenidas. Alinear esta población requiere un
  cambio de implementación que T-61 no realiza.
- Los buckets son acumulativos: `le=~"5(\\.0+)?"` incluye el límite de 5 s;
  no permite distinguir exactamente 5.000 s de un valor inferior. La lectura
  operativa es **hasta 5 s**. Lo mismo aplica al límite de 1 s de GET.
- SLO-7 usa el bucket **2.5 s**: falta una frontera en 3 s. Un POST de 2.7 s
  cuenta como malo en el panel aun cuando cumple el objetivo nominal.
- SLO-1 cuenta **entregas**, incluidos reintentos y duplicados; la regla resta
  sólo `dead_letter`. Los resultados `invalid` y `dropped` requieren su
  investigación y no deben presentarse como entregas válidas probadas.
- El ratio interbancario usa decisiones y vencimientos por dirección; un timeout
  se cuenta al entrar y una resolución posterior no duplica el contador. El p95
  entrante mide la duración de resolución del depósito local; la entrega del
  callback tiene contador propio y no forma parte de ese histograma.
- Un rechazo 4xx de negocio cuenta como disponibilidad HTTP correcta. Una
  conexión rechazada antes de llegar al proceso no aparece en el histograma:
  se necesita evidencia externa para una caída total.

**TD-094 permanece abierta.** La primera espera de 1 s no garantiza incumplir
5 s; alcanzar el segundo reintento acumula **6 s de espera**, antes de añadir
procesamiento. El último acumula 36 s. El p95 histórico de 8.25 s de T-51
corresponde a una prueba con fallos inyectados, no a una medición actual de
producción. T-61 conserva el umbral y documenta la incompatibilidad entre
latencia y recuperación; no elimina el tiempo de reintentos de la experiencia
del cliente.

#### Presupuesto de error y tasa de consumo

Para una ventana `W`, se calcula `P_W = increase(eventos_buenos[W]) /
increase(eventos_totales[W])`, agrupado por entorno y población. No se promedian
ratios de cinco minutos: una ventana con un evento no pesa igual que una con
mil. Ejemplo para SLO-27:

```promql
# Proporción real de peticiones de la ventana y presupuesto restante.
slo:gateway_availability:ratio_7d{environment="prod"}
slo:gateway_availability:budget_remaining7d{environment="prod"}
# Definición del presupuesto, objetivo = 0.99.
1 - ((1 - slo:gateway_availability:ratio_7d{environment="prod"}) / 0.01)
# Consumo en la ventana de una hora.
slo:gateway_availability:burn_rate1h{environment="prod"}
```

El numerador ausente se completa con `or 0 * total`, pero el denominador se
filtra con `> 0`: sin eventos no hay proporción. **“No data” no significa
100 % ni 0 %**, y un percentil sin observaciones puede ser `NaN`. Los contadores
se inicializan a cero para observar el primer incremento tras el arranque; eso
no inventa tráfico ni sustituye las dos muestras que necesitan `rate` e
`increase`. Deben inspeccionarse también targets de Prometheus, throughput y
salud del Collector. Todas las alertas usan `noDataState: OK` y
`execErrState: Error`; una ausencia total de datos puede no abrir un incidente
de SLO.

#### Las dieciséis alertas implementadas

La ventana de cálculo y el período `for` son distintos. Esta tabla transcribe
la configuración vigente; los enlaces apuntan a los siete procedimientos.

| Alerta | Condición / ventana | `for` | Severidad | Runbook |
| --- | --- | --- | --- | --- |
| `GatewayAvailabilityFastBurn` | burn 1 h > 14.4× | 5 min | critical | [Gateway](../operations/runbooks/gateway-availability-burn.md) |
| `GatewayAvailabilitySlowBurn` | burn 6 h > 6× | 30 min | warning | [Gateway](../operations/runbooks/gateway-availability-burn.md) |
| `TransferLatencyFastBurn` | burn 1 h y 5 min > 14.4× | 2 min | critical | [Saga](../operations/runbooks/transfer-latency.md) |
| `TransferLatencySlowBurn` | burn 6 h y 30 min > 6× | 15 min | warning | [Saga](../operations/runbooks/transfer-latency.md) |
| `TransferLatencyBreach` | proporción rápida < 95 % | 30 min | warning | [Saga](../operations/runbooks/transfer-latency.md) |
| `GatewayReadLatencyBreach` | GET bajo 1 s < 95 % | 30 min | warning | [latencia HTTP](../operations/runbooks/gateway-latency.md) |
| `GatewayCommandLatencyBreach` | POST bajo 2.5 s < 95 % | 30 min | warning | [latencia HTTP](../operations/runbooks/gateway-latency.md) |
| `DeadLetterGrowing` | entregas sin DLQ < 99 % | 15 min | critical | [DLQ](../operations/runbooks/dead-letter.md) |
| `BrokerConsumerLagHigh` | una cola con > 500 mensajes listos | 10 min | warning | [broker](../operations/runbooks/consumer-lag.md) |
| `PartnerBankDegraded` | aceptados entrantes < 95 % | 15 min | warning | [interbancario](../operations/runbooks/partner-bank.md) |
| `PartnerBankConfirmationSlow` | p95 entrante > 5 s | 15 min | warning | [interbancario](../operations/runbooks/partner-bank.md) |
| `PartnerBankSendDegraded` | aceptados salientes < 95 % | 5 min | warning | [interbancario](../operations/runbooks/partner-bank.md) |
| `PartnerBankSendConfirmationSlow` | p95 saliente > 5 s | 5 min | warning | [interbancario](../operations/runbooks/partner-bank.md) |
| `PodRestarting` | máximo de reinicios por entorno > 2 en 10 min | sin espera adicional | warning | [reinicios](../operations/runbooks/restarts.md) |
| `MassRestartDependencyLost` | pods reiniciados / número de Deployments > 0.5 en 10 min | sin espera adicional | critical | [reinicios](../operations/runbooks/restarts.md) |
| `InterbankReserveReleasedUnverified` | logs de liberación sin verificar > 0 en 15 min | sin espera adicional | critical | [conciliación](../operations/runbooks/partner-bank.md#interbankreservereleasedunverified) |

Los contact points dirigen `environment=dev` al Gateway de `dev`, `local` al de
kind y el resto al de `prod`. El Gateway autentica el webhook con un token
separado de las sesiones, publica `alert.slo.received.v1` y Audit registra y
notifica. Ver una alerta en Grafana **no prueba que llegó a auditoría**: hay que
comprobar ambas superficies, incluido el estado `resolved`.

#### Lo que queda documental, y por qué

Los demás objetivos **siguen siendo objetivos de diseño**, pero no se miden con una serie
temporal en esta fase, y decirlo es más honesto que un panel que siempre marca
100 %:

| Grupo | Por qué no se mide con métricas | Con qué se demuestra |
|---|---|---|
| **SLO-3, SLO-16, SLO-19** (idempotencia, cuadre al centavo, serialización) | su fuente es una restricción de base de datos y una prueba de concurrencia, no un contador: una violación **no ocurre** en vez de ocurrir y contarse | las suites de integración contra PostgreSQL real y `pnpm images:flow` |
| **SLO-4, SLO-17** (compensación tras el débito) | falta la métrica: hoy se sabe que una transferencia terminó `COMPENSATED`, pero no cuántos fallos *post-débito* hubo, que es el denominador. Un contador de compensaciones **ordenadas** frente a **completadas** lo haría medible, y es el añadido natural de T-47 | los spans `saga.compensation ordered` y `saga.compensation completed`, y el aserto sobre el saldo de `images:flow` |
| **SLO-5, SLO-20, SLO-21, SLO-22, SLO-23** (correlación, cobertura y redacción de la auditoría) | son invariantes de contenido: se comprueban sobre la fila escrita, no sobre su frecuencia | las pruebas de `notification-audit-service` y el barrido de redacción |
| **SLO-9 a SLO-11, SLO-13, SLO-14, SLO-26** (sondas, arranque, barrido, S3, escalera, reinicios) | se miden, pero con series de `kube-state-metrics` y del broker, no de la aplicación; su objetivo se revisa en el panel de plataforma sin presupuesto de error propio | los paneles de CPU/memoria/pods y de consumer lag (T-50) |
| **SLO-12** (notificaciones por evento notificable) | medible con `bank_audit_notifications_total`, pero el denominador —"eventos notificables"— no es una métrica todavía | `bank.audit.events` por familia y severidad |
| **SLO-15, SLO-18, SLO-24, SLO-25** (saldo negativo, transiciones ilegales, roles, secretos en imágenes) | invariantes con presupuesto cero que un sistema de métricas no puede refutar: el `CHECK`, la función pura y `images:smoke` los impiden antes | el `CHECK (balance >= 0)`, la máquina de estados y `pnpm images:smoke` |

---

## 6. Gestión y Dinámica del Presupuesto de Error (*Error Budget & Burn Rate*)

### 6.1 Fórmula del Presupuesto de Error

Con objetivo `S`, ventana `W` y proporción de eventos buenos `P_W`:

- Presupuesto admitido: `(1 - S) × total_W` eventos malos.
- Fracción restante: `1 - (1 - P_W) / (1 - S)`.
- Burn rate: `(1 - P_W) / (1 - S)`.

Un restante de `1` significa presupuesto intacto; `0`, agotado; un valor
negativo, incumplimiento. No se recorta a cero porque ocultaría cuánto se
excedió. Los invariantes de 100 % se validan con pruebas: no se divide por
presupuesto cero.

### 6.2 Velocidad de Consumo (*Burn Rate*)

Para siete días (**168 h**), bajo ritmo de tráfico constante y fallo sostenido:

| Burn rate | Tiempo hasta agotar un presupuesto íntegro | Presupuesto gastado en la ventana citada |
| --- | --- | --- |
| 1× | 168 h | 100 % en siete días |
| 6× | 28 h | 21.43 % en 6 h |
| 14.4× | 11 h 40 min | 8.57 % en 1 h |

Se calcula `burn × horas / 168`. Los porcentajes 2 % en 1 h y 5 % en 6 h
corresponderían aproximadamente a **30 días**, y no describen este chart. Los
umbrales 14.4 y 6 se conservan como configuración actual; no se retocan para
mejorar los resultados de una corrida.

### 6.3 Política de Agotamiento de Presupuesto (*Error Budget Policy*)

Política operativa documentada, sin bloqueo automático del pipeline:

1. Consumo < 50 %: revisión habitual de SLO antes de desplegar.
2. Consumo entre 50 % y 100 %: el responsable de Infraestructura/SRE y el líder
   técnico revisan causa, efecto del cambio y mitigación antes de desplegar.
3. Consumo ≥ 100 %: priorizar mitigación y corrección de confiabilidad; diferir
   funcionalidades hasta recuperar el presupuesto en la **ventana móvil**.
4. Una violación contable o de seguridad requiere atender el incidente aunque
   el presupuesto de disponibilidad esté intacto.

Una ventana móvil no se reinicia el primer día del mes. La política requiere
revisión humana; el repositorio no contiene un gate que aplique automáticamente
estos tres niveles. El responsable primario consta en
[OWNERSHIP](../OWNERSHIP.md).

---

## 7. Acuerdo de Nivel de Servicio (SLA)

### 7.1 Alcance y Compromiso Externo

El SLA es **académico**: demostrar el sistema, la Saga, las compensaciones, la
idempotencia y su observabilidad ante el evaluador. Se conservan los objetivos
de las tablas anteriores como criterios de validación. No existe evidencia de
un contrato comercial que garantice 99.99 % mensual o créditos monetarios.

La compensación es **eventual y explícita**, no una reversa atómica entre bases
independientes. En el interbancario, consulta y cancelación preceden a la
liberación cuando falta confirmación; la liberación no verificada exige
conciliación humana.

### 7.2 Clasificación de Incidentes Bancarios (SEV-1 a SEV-4)

| Nivel de Severidad | Criterio de Impacto Bancario | Ejemplos Representativos | MTTD (Detección) | MTTA (Respuesta) | MTTR (Mitigación) |
|---|---|---|---|---|---|
| **SEV-1 (Crítica)** | Afectación generalizada del servicio, pérdida de datos o violación de invariante contable | Saldo negativo, dinero debitado sin crédito ni compensación, caída total del clúster GKE o PostgreSQL | **≤ 2 min** | **≤ 5 min** | **≤ 15 min** |
| **SEV-2 (Alta)** | Funcionalidad bancaria clave degradada para múltiples usuarios sin alternativa | Falla del servicio de Pagos de Servicios, degradación masiva de RabbitMQ, latencia P95 > 3,000 ms | **≤ 5 min** | **≤ 15 min** | **≤ 45 min** |
| **SEV-3 (Media)** | Problema intermitente o afectación que cuenta con mecanismo de mitigación | Retrasos en envío de notificaciones por correo, expiraciones aisladas de token JWT, fallas en carga de foto DPI | **≤ 15 min** | **≤ 30 min** | **≤ 4 horas** |
| **SEV-4 (Baja)** | Defecto cosmético, inconsistencia de etiquetas o consulta no bloqueante | Error ortográfico en interfaz, retraso en refresco de filtro de transferencias, duda operativa | **≤ 1 hora** | **≤ 4 horas** | Siguiente release |

### 7.3 Compensaciones Financieras por Incumplimiento

No aplican créditos de servicio o penalizaciones comerciales. La compensación
financiera de una transferencia fallida devuelve los fondos de la operación;
es una regla del dominio y no una indemnización por disponibilidad.

### 7.4 Exclusiones Formales

- Los rechazos 4xx de negocio no descuentan disponibilidad HTTP; sí forman
  parte de su población y de la latencia percibida.
- Las sondas `/health` y `/ready` quedan excluidas del SLI de tráfico cliente.
- Las pruebas con fallos se ejecutan y reportan en `dev`, con su entorno y
  ventana. No se borran sus fallos de las series para mejorar el SLO.
- No hay exclusión automática por mantenimiento o caída del proveedor cloud en
  las reglas actuales. Una exclusión futura requiere una política y una
  consulta versionadas.

---

## 8. Métricas de Infraestructura, Capacidad y Saturación

La fuente de capacidad configurada es
[`bank-usac/values.yaml`](../../infra/k8s/helm/bank-usac/values.yaml), y los
valores efectivos dependen de los overrides del release. Los objetivos no
prueban throughput ni disponibilidad por sí solos.

### 8.1 Dimensionamiento y Autoescalado (HPA)

El chart configura CPU objetivo de **80 %**, mínimo de **1** y máximo general
de **5** réplicas; `account-service` también puede escalar: su barrido usa un
[arriendo PostgreSQL](../../apps/services/account-service/src/infrastructure/persistence/postgres-sweep-lease.ts)
con `pg_try_advisory_lock` para que sólo una réplica lo ejecute a la vez. Comprobar los HPA y los recursos efectivos
del namespace antes de interpretar un panel. La evidencia de escalado requiere
réplicas deseadas/actuales, CPU y eventos de una corrida, no sólo el manifiesto.

### 8.2 Parámetros del Broker y Bases de Datos

PostgreSQL sigue fuera del clúster. `dev` usa el sufijo **`_dev`** en sus cinco
bases; comparte VMs, capacidad y fallo físico con producción. Un nombre
separado no equivale a infraestructura dedicada.

En GKE, RabbitMQ es un **Deployment de una réplica** con PVC `rabbitmq-data`
(default **2 GiB**, `ReadWriteOnce`), nodo `rabbit@localhost` y rollout sin
solapamiento. El volumen mejora la supervivencia a un reemplazo de pod, pero
`helm uninstall` puede borrar el claim; no sustituye un backup ni recupera
mensajes perdidos antes de instalarlo. Ver
[recuperación del broker](../operations/runbooks/consumer-lag.md#rabbitmq-pvc-y-permisos-de-erlangcookie).

El proveedor de pagos conserva **cuatro intentos**: inmediato y retrasos de
1 s, 5 s y 30 s (**36 s acumulados**, más procesamiento). El sweeper usa
500 ms cuando hay trabajo y backoff inactivo hasta 2 s por defecto, según
[`environment.ts`](../../apps/services/payment-service/src/infrastructure/config/environment.ts).

### 8.3 Almacenamiento de identidad y observabilidad

MinIO usa la API S3 para el objeto temporal de identidad; Customer valida el
digest y guarda su copia durable en su propia base. El despliegue in-cluster
actual de MinIO es un **Deployment**, no un StatefulSet con garantía de
multi-réplica. Su manifiesto no declara un PVC: la persistencia de RabbitMQ no
cierra esa parte de TD-082.

Prometheus, Tempo y Loki conservan **siete días** en cloud con volúmenes de
**10 GiB** cada uno; Grafana tiene **2 GiB**. Son valores configurados, no una
garantía de durabilidad del 99.999999 %, replicación de zona o snapshots
automatizados. No se ha aportado aquí una prueba de restauración o de pérdida
de disco. El tránsito público al Gateway y Grafana es HTTP en las URLs de
entrega: la red privada entre componentes no hace privado el trayecto entero
de una carga de fotografía.

---

## 9. Matriz Cruzada de Trazabilidad SLI ↔ SLO ↔ SLA

| Componente | SLI / SLO | Evidencia adecuada |
| --- | --- | --- |
| Gateway | SLI-1, SLI-7; SLO-27, SLO-6, SLO-7 | Histogramas HTTP por entorno, reglas §5.3 y [runbooks](../operations/runbooks/README.md) |
| Saga | SLI-2, SLI-3; SLO-2, SLO-4, SLO-17 | Latencia terminal y trazas; compensación contrastada con saldos |
| Account | SLI-6, SLI-15, SLI-20, SLI-21; SLO-3, SLO-15, SLO-16, SLO-19 | Integración contra PostgreSQL de pruebas e `images:flow` |
| Proveedor de pagos | SLI-23, SLI-24; SLO-11, SLO-14 | Intentos persistidos, `bank_payment_provider_*`, trazas y sweeper |
| RabbitMQ | SLI-5; SLO-1 | Resultado de entregas y métricas detalladas por cola |
| Identidad / MinIO | SLI-27; SLO-13 | Integración de almacenamiento y validación de digest; no demuestra durabilidad cloud |
| Auditoría | SLI-16 a SLI-19; SLO-20 a SLO-23 | Filas redactadas, pruebas de redacción, métricas y evento de alerta recibido |
| Acceso e imágenes | SLI-28 a SLI-30; SLO-24, SLO-25 | Pruebas de roles, JWT y `images:smoke` |
| Plataforma | SLI-11 a SLI-14; SLO-9, SLO-10, SLO-26 | kube-state-metrics, eventos, sondas y logs anteriores |
| Interbancario | SLO-28 por dirección | Decisión, callback, consulta/cancelación, saldos y alerta de liberación no verificada |

---

## Anexo: cómo se miden hoy los SLI de transferencias (Fase 3, T-43)

`transaction-service` ya emite, contra `@opentelemetry/api`, las métricas con las que se calculan **SLI-2**, **SLI-3** y **SLO-2**. Desde T-48 el SDK está registrado y se exportan en cuanto el pod tiene `OTEL_EXPORTER_OTLP_ENDPOINT`; T-49/T-50 incorporaron la exportación y las reglas; la evidencia histórica de kind no debe confundirse con una consulta actual de producción.

| Indicador | Métrica OpenTelemetry | Consulta esperada (conversión por defecto a Prometheus) |
|---|---|---|
| **SLI-2** Tasa de completitud | `bank.transfer.finished` (`result`, `reason`) | `sum(rate(bank_transfer_finished_total{result="completed"}[5m])) / sum(rate(bank_transfer_finished_total[5m]))` |
| **SLI-3** Duración de la Saga (p50 / p95 / p99) | `bank.transfer.duration` (`s`, `result`) | `histogram_quantile(0.95, sum by (le) (rate(bank_transfer_duration_seconds_bucket[5m])))` |
| **Línea base SLO-2**: exitosas hasta 5,0 s; difiere del proxy desplegado (§5.3) | la misma, con frontera de 5 s y selector que admite `5.0` | `sum(rate(bank_transfer_duration_seconds_bucket{result="completed",le=~"5(\\.0+)?"}[5m])) / sum(rate(bank_transfer_finished_total{result="completed"}[5m]))` |
| Tasa de error | `bank.transfer.finished` | `sum(rate(bank_transfer_finished_total{result=~"failed\|compensated"}[5m])) / sum(rate(bank_transfer_finished_total[5m]))` |

Dos precisiones. El inicio de la duración es el `occurredAt` del mensaje `transfer.requested.v1` (como define SLI-3), no el momento en que el servicio crea la fila. Y la etiqueta `reason` permite que la tasa de error excluya los rechazos del negocio (`KYC_NOT_VERIFIED`, `INSUFFICIENT_FUNDS`), que no son fallos del sistema: `sum(...{reason!~"KYC_NOT_VERIFIED\|INSUFFICIENT_FUNDS"})`.


---

## Anexo: cómo se mide hoy el proveedor de pagos simulado (Fase 3, T-44)

`payment-service` emite, contra `@opentelemetry/api`, las métricas con las que se calculan la **tasa de fallos externos** y el **p95 de latencia del sistema externo simulado** (§4.1, *Payment Service*) y alimentan **SLI-23** y **SLO-11**. Desde T-48 el SDK está registrado y se exportan en cuanto el pod tiene `OTEL_EXPORTER_OTLP_ENDPOINT`; T-49/T-50 incorporaron la exportación y las reglas; la evidencia histórica de kind no debe confundirse con una consulta actual de producción.

| Indicador | Métrica OpenTelemetry | Consulta esperada (conversión por defecto a Prometheus) |
|---|---|---|
| **Tasa de fallos externos** | `bank.payment.provider.calls` (`result`, `source`) | `sum(rate(bank_payment_provider_calls_total{result!="success"}[5m])) / sum(rate(bank_payment_provider_calls_total[5m]))` |
| **Latencia del proveedor simulado (p95)** | `bank.payment.provider.duration` (`s`, `result`) | `histogram_quantile(0.95, sum by (le) (rate(bank_payment_provider_duration_seconds_bucket[5m])))` |
| Cambios de la simulación en caliente | `bank.payment.simulation.changes` (`action`) | `sum by (action) (increase(bank_payment_simulation_changes_total[1h]))` |

Dos precisiones. La etiqueta `source` (`scenario` / `configuration` / `runtime`) separa el guion de la transferencia, los valores de arranque y la configuración persistida por el administrador; esta última se filtra con `source="runtime"`. Todos pertenecen al proveedor simulado, no a fallos reales de un proveedor externo. Y el latency es la espera simulada **medida**, no la configurada: con `latencyMs = 0` o con un `scenario` explícito el histograma registra cero.


---

## Anexo: cómo se mide hoy la auditoría y las alertas (Fase 3, T-45)

`notification-audit-service` emite, contra `@opentelemetry/api`, las métricas con las que se observa a sí mismo y a las alertas que le llegan por el webhook del Gateway. Desde T-48 el SDK está registrado y se exportan en cuanto el pod tiene `OTEL_EXPORTER_OTLP_ENDPOINT`.

| Indicador | Métrica OpenTelemetry | Consulta esperada (conversión por defecto a Prometheus) |
|---|---|---|
| Eventos auditados por familia y nivel | `bank.audit.events` (`family`, `severity`, `outcome`, `processing`) | `sum by (family, severity) (rate(bank_audit_events_total{outcome="recorded"}[5m]))` |
| Reentregas del broker que la auditoría rechazó | `bank.audit.events` con `outcome="duplicate"` | `sum(rate(bank_audit_events_total{outcome="duplicate"}[5m]))` |
| Mensajes que la auditoría no pudo leer | `bank.audit.events` con `processing="invalid"` | `sum(rate(bank_audit_events_total{processing="invalid"}[5m]))` |
| Notificaciones por resultado | `bank.audit.notifications` (`severity`, `result`) | `sum by (result) (rate(bank_audit_notifications_total[5m]))` |
| Avisos repetidos que se suprimieron (anomalía republicada) | `bank.audit.notifications` con `result="suppressed"` | `sum(increase(bank_audit_notifications_total{result="suppressed"}[1h]))` |
| Alertas de SLO recibidas | `bank.audit.alerts.received` (`status`, `severity`) | `sum by (status, severity) (increase(bank_audit_alerts_received_total[1h]))` |

Tres precisiones. `suppressed` no es un error: es la segunda notificación de una misma anomalía (misma cuenta, misma ventana), que Account Service republica si falló su primera publicación; su tasa sostenida sí dice que ese servicio no está logrando publicar. Las alertas se cuentan **una por alerta**, no una por lote, y solo si el contrato las aceptó. Y `family` es la primera palabra del tipo de mensaje con un conjunto cerrado (`customer`, `account`, `transaction`, `payment`, `alert`, `other`): un nombre imprevisto cae en `other` y no crea una serie nueva.


---

## Anexo: las métricas base de todos los componentes (Fase 3, T-48)

T-48 registra el SDK en los cinco servicios y el Gateway (`@bank/observability`) y agrega las métricas que no pertenecen a ningún dominio: el **throughput** por servicio y por cola, y la **disponibilidad** del Gateway (§4.1, *Métricas (SLI base)*). Las dos primeras salen de `@bank/messaging`, que las emite en cada publicación y en cada entrega; la tercera, de la instrumentación HTTP del SDK, con las convenciones semánticas estables. Ninguna lleva un identificador como etiqueta: servicio, cola o exchange, operación y resultado, todos conjuntos cerrados.

| Indicador | Métrica OpenTelemetry | Consulta esperada (conversión por defecto a Prometheus) |
|---|---|---|
| **Throughput** por servicio y por cola | `messaging.client.consumed.messages` (`messaging.destination.name`, `bank.delivery.outcome`) | `sum by (service_name, messaging_destination_name) (rate(messaging_client_consumed_messages_total[5m]))` |
| Mensajes publicados por exchange | `messaging.client.sent.messages` (`messaging.destination.name`, `error.type`) | `sum by (service_name, messaging_destination_name) (rate(messaging_client_sent_messages_total[5m]))` |
| Entregas que fallaron (reintento, cola muerta, ilegibles) | `messaging.client.consumed.messages` con `bank.delivery.outcome!="ack"` | `sum by (messaging_destination_name, bank_delivery_outcome) (rate(messaging_client_consumed_messages_total{bank_delivery_outcome!="ack"}[5m]))` |
| Tiempo de proceso por cola (p95) | `messaging.process.duration` (`s`) | `histogram_quantile(0.95, sum by (le, messaging_destination_name) (rate(messaging_process_duration_seconds_bucket[5m])))` |
| **Disponibilidad del Gateway** (respuestas distintas de 5xx) | `http.server.request.duration` (`http.response.status_code`, `http.route`) | `sum(rate(http_server_request_duration_seconds_count{service_name="gateway",http_response_status_code!~"5.."}[5m])) / sum(rate(http_server_request_duration_seconds_count{service_name="gateway"}[5m]))` |
| **SLO-6** / **SLO-7** Latencia del Gateway (p95 por método) | la misma | `histogram_quantile(0.95, sum by (le, http_request_method) (rate(http_server_request_duration_seconds_bucket{service_name="gateway"}[5m])))` |

Tres precisiones. Los sondeos `/health` y `/ready` **no** se cuentan: los pide el kubelet cada pocos segundos y diluirían la disponibilidad real con tráfico que no es de nadie. El **consumer lag** (mensajes pendientes por cola) no es una métrica de la aplicación sino del broker: lo expone RabbitMQ y lo recolecta T-49. Y `service_name` es el `service.name` del recurso, que el Collector convierte en etiqueta; el entorno (`dev` / `prod`) viaja igual, como `environment`.
