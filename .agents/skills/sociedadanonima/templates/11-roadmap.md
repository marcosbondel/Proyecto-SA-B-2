<!--
PLANTILLA · Cronograma — Fase F8
Lee references/ESTIMACION.md antes de escribir la primera fecha.
Un cronograma sin ruta crítica es una lista de deseos ordenada.
-->

# Cronograma — <Proyecto>

> **Inicio:** <YYYY-MM-DD> · **Entrega comprometida:** <YYYY-MM-DD> ·
> **Restricción dura:** <fecha | alcance | presupuesto | tecnología>

## 1. Capacidad de partida

| Persona | Rol | Horas reales / semana | Factor de foco |
| --- | --- | --- | --- |
| <…> | <…> | <n> | 0.7 |

**Capacidad semanal del equipo:** <n> días ideales.
**Duración total del trabajo:** <n> días ideales ≈ <n> semanas de calendario.

<Si el resultado no cabe en la restricción dura, dilo aquí con el número exacto
de desfase y qué se recorta. Ese párrafo vale más que todo el diagrama.>

## 2. Hitos

| # | Hito | Fecha | Qué se puede demostrar que antes no | Tickets | Cómo se comprueba |
| --- | --- | --- | --- | --- | --- |
| H-1 | <…> | <YYYY-MM-DD> | <capacidad nueva y verificable> | T-01, T-02 | <comando o demostración> |

## 3. Ruta crítica

**Cadena crítica:** <T-01 → T-03 → T-07 → T-11> · **Duración:** <n> días.

Un retraso de un día en cualquiera de estos tickets retrasa la entrega un día.

**Holgura de los demás:**

| Ticket | Holgura | Puede ceder persona a |
| --- | --- | --- |
| T-04 | <n> días | <T-nn de la ruta crítica> |

## 4. Diagrama

```mermaid
gantt
    title <Proyecto>
    dateFormat YYYY-MM-DD
    axisFormat %d/%m

    section <Fase>
    T-01 <título>   :crit, t01, <YYYY-MM-DD>, 3d
    T-04 <título>   :      t04, after t01, 4d

    section Cierre
    Colchón         :      buf, after t04, 3d
```

`crit` marca la ruta crítica.

## 5. Colchón

**<n> días (<15–20> % del total)**, en bloque al final y no repartido por tarea.
Cada vez que se consume se anota aquí por qué:

| Fecha | Días usados | Motivo |
| --- | --- | --- |

## 6. Riesgos

| Riesgo | Prob. | Impacto | **Señal temprana** | Respuesta |
| --- | :---: | :---: | --- | --- |
| <…> | A/M/B | A/M/B | <qué se verá cuando empiece a ocurrir, no cuando ya ocurrió> | <…> |

## 7. Supuestos y plan de recorte

- **Se asume:** <capacidad, disponibilidad, dependencias externas>
- **Fechas externas inamovibles:** <…>
- **Si la fecha no alcanza, se recorta en este orden:** <1º…, 2º…, 3º…>

## 8. Revisión

En cada hito: comparar estimado contra real, calcular el factor de desviación y
**aplicarlo a lo que queda**. Reestimar con el dato real no es admitir un
fracaso; es lo único que hace que la segunda mitad del plan valga más que la
primera.

| Hito | Estimado | Real | Factor | Ajuste aplicado |
| --- | --- | --- | --- | --- |
