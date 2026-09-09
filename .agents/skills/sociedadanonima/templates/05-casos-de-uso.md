<!--
PLANTILLA · Casos de uso — Fase F3
Los fallos ESPERADOS —los que el diseño contempla— van en tabla. Los accidentes
no son casos de uso.
-->

# Casos de uso — <Proyecto>

Cada flujo con su actor, entrada, resultado observable, la secuencia de
componentes que reaccionan, y los fallos que el diseño espera.

---

## CDU00n — <Nombre del flujo>

| | |
| --- | --- |
| **Actor** | <quién lo inicia, y quién más puede> |
| **Precondiciones** | <qué debe ser cierto antes> |
| **Entrada** | <datos exactos> |
| **Resultado** | <qué es observable después, no qué ocurre por dentro> |
| **Requisitos** | RF-nn, HU-nn |

### Secuencia

1. <Componente> <hace qué> y <produce qué>.
2. <…>

### Fallos esperados

| Fallo | Resultado |
| --- | --- |
| <condición> | `<NOMBRE_DEL_FALLO>` — <qué queda sin cambiar> |

### Flujos alternos

- **FA1 (<condición>):** <qué ocurre en su lugar>.

---

## Flujos que cruzan componentes

Para cada operación que toca más de un componente, la compensación **se define
aquí o no existe**.

### <Nombre del flujo distribuido>

| # | Componente | Reacciona a | Hace | Produce |
| --- | --- | --- | --- | --- |
| 1 | <…> | <…> | <…> | <…> |

**Cierres posibles** — y por qué no son intercambiables:

- **<CIERRE_A>:** <qué significa exactamente sobre el estado del mundo>.
- **<CIERRE_B>:** <en qué se diferencia del anterior; por qué la auditoría debe
  poder distinguirlos>.

**Compensación:** <qué se deshace, quién lo ordena, en qué orden, y qué garantía
queda escrita después>.

---

## Correlación

<Cómo se sigue un flujo de punta a punta: quién origina el identificador, quién
lo propaga, dónde se registra. Y qué NO es: si sirve para trazar, no sirve para
deduplicar.>
