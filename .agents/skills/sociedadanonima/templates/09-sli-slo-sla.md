<!--
PLANTILLA · SLI, SLO y SLA — Fase F6
Tres documentos separados en el destino. El SLA NO introduce umbrales propios:
cada promesa apunta a un SLO, y cada SLO a un SLI. Ver references/FIABILIDAD.md.
-->

# ══════════ sli.md ══════════

# Indicadores de nivel de servicio (SLI) — <Proyecto>

Cada indicador: una fórmula que produce un número y **una fuente de datos que ya
existe**. Si la fuente no existe, esto es una tarea de instrumentación en el
backlog, no un indicador.

| # | Indicador | Fórmula | Fuente de datos |
| --- | --- | --- | --- |
| SLI-1 | <lo que le importa al usuario> | `<eventos buenos> / <eventos totales>` | <de dónde sale hoy> |

## Aclaraciones de medición

- **Fallo técnico frente a rechazo de negocio.** <Cuáles son respuestas
  correctas del dominio y por tanto no cuentan como indisponibilidad.>
- **Indicadores cuyo valor correcto es cero.** <Cuáles se reportan como recuento
  absoluto y no como porcentaje, y por qué.>
- **Percentiles.** <Sobre qué ventana, y cuáles se reportan solo como
  información porque no hay muestras suficientes para que sean estables.>

## Convenciones

1. **Unidad de tiempo:** <…>
2. **Ventana por defecto:** <…>
3. **Correlación:** <cómo se une un evento con su cadena>
4. **Reproducibilidad:** <qué comando captura la evidencia>

# ══════════ slo.md ══════════

# Objetivos de nivel de servicio (SLO) — <Proyecto>

## Objetivos con presupuesto de error

Admiten degradación acotada. Su incumplimiento dice que el sistema va mal, no
que los datos estén mal.

| # | Objetivo | Umbral | Ventana | Presupuesto de error | SLI base |
| --- | --- | --- | --- | --- | --- |
| SLO-1 | <…> | ≥ <n> % | <ventana> | <n> % | SLI-<n> |

## Invariantes sin presupuesto de error

No admiten grados. Una sola infracción invalida el objetivo.

| # | Objetivo | Umbral | Ventana | SLI base |
| --- | --- | --- | --- | --- |
| SLO-n | <…> | **0 <unidad>** | <cada ocurrencia> | SLI-<n> |

<Por qué estos no llevan presupuesto: un presupuesto de error es un permiso para
fallar una fracción del tiempo, y aquí ninguna fracción es aceptable.>

## Gestión del presupuesto

| Consumo | Estado | Acción |
| --- | --- | --- |
| < 50 % | Verde | Ninguna |
| 50–99 % | Ámbar | Se documenta la causa antes de declarar el objetivo cumplido |
| ≥ 100 % | Rojo | Objetivo incumplido: se detiene alcance nuevo y se prioriza la causa raíz |
| Infracción de invariante | Rojo inmediato | Defecto crítico; la corrida no es válida |

**Velocidad de consumo** = fracción de presupuesto gastada / fracción de ventana
transcurrida. Por encima de 1 sostenido, el objetivo se incumplirá aunque el
porcentaje instantáneo todavía se vea sano.

## Reglas de interpretación

1. Un objetivo sin ventana es indemostrable.
2. Los rechazos de negocio no consumen presupuesto.
3. Los invariantes se reportan como recuentos, no como porcentajes.

# ══════════ sla.md ══════════

# Acuerdo de nivel de servicio (SLA) — <Proyecto>

## 1. Alcance y partes

- **Ámbito:** <…> · **Proveedor:** <…> · **Consumidor:** <…>
- **Compromiso principal:** <qué se garantiza en una frase>

## 2. Compromisos por componente

Cada promesa apunta al objetivo que la respalda. **Este documento no introduce
umbrales propios.**

| Componente | Compromiso | Objetivo que lo respalda |
| --- | --- | --- |
| <…> | <…> | SLO-n, SLO-m |

## 3. Ventana de servicio

- **Comprometida:** <cuándo aplica>
- **Fuera de la ventana:** <qué no se promete>
- **No acumulación:** <…>

## 4. Severidades

| Severidad | Definición | Respuesta objetivo | Mitigación objetivo |
| --- | --- | --- | --- |
| S1 crítica | <se viola un invariante> | Inmediata | <…> |
| S2 alta | <el flujo principal no se completa> | <…> | <…> |
| S3 media | <degradación sin pérdida de corrección> | <…> | <…> |
| S4 baja | <cosmético> | <…> | <…> |

## 5. Exclusiones

No cuentan como incumplimiento:

1. **Rechazos correctos del negocio.**
2. **Fallos del entorno del consumidor.**
3. **Degradación inducida deliberadamente** en una prueba no acordada.
4. <…>

## 6. Responsabilidades

- **Del proveedor:** <incluida la de reportar los incumplimientos aunque nadie
  pregunte — un objetivo incumplido y silenciado es peor que uno incumplido>.
- **Del consumidor:** <…>

## 7. Verificación

| Comando / prueba | Compromiso que verifica |
| --- | --- |
| <…> | <…> |

## 8. Remedios

<Qué ocurre ante un incumplimiento: declararlo, documentar la causa raíz,
reejecutar y generar evidencia nueva — no reinterpretar la anterior.>
