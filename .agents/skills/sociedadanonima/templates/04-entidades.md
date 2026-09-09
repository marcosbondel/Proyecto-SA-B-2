<!--
PLANTILLA · Entidades, estados e invariantes — Fase F3
Regla que hace útil al documento: toda transición no dibujada es ilegal y se
descarta. Escríbela, no la des por entendida.
-->

# Entidades, estados e invariantes — <Proyecto>

Cada entidad con su identidad, sus atributos, el conjunto **cerrado** de estados
que admite, las transiciones legales y las reglas que no puede violar. **Cada
invariante nombra el fallo** que produce intentarlo.

**Toda transición que no aparezca aquí es ilegal y se descarta**, no se aplica.
Esto importa sobre todo cuando los eventos llegan desordenados o dos veces.

---

## <Entidad>

**Dueño:** <componente> · **Identidad:** `<idEntidad>`

| Atributo | Notas |
| --- | --- |
| `<atributo>` | <tipo, unicidad, nulabilidad, de dónde sale> |

### Estados

```
<estadoInicial> ──▶ <estadoIntermedio> ──▶ <estadoFinal>
                          └────────────▶ <estadoAlterno>
```

<Cuáles son terminales. Qué transición parece razonable y no es legal, y por qué.>

### Invariantes

| # | Invariante | Fallo esperado |
| --- | --- | --- |
| INV-<X>-1 | <la regla que nunca puede violarse> | `<NOMBRE_DEL_FALLO>` — <qué pasa: se rechaza, no se aplica, se registra> |

### Dónde se hace cumplir

| Invariante | Mecanismo |
| --- | --- |
| INV-<X>-1 | <restricción de base de datos / bloqueo / índice único / código> |

> Una invariante que solo vive en el código se rompe bajo concurrencia. Si se
> acepta ese riesgo, escríbelo aquí como decisión, no lo dejes implícito.

---

## Invariantes transversales

Las que ninguna entidad posee por sí sola.

| # | Invariante | Protegida por |
| --- | --- | --- |
| INV-X-1 | <…> | <quién la sostiene> |

## Tipos sensibles

Decisión explícita por cada tipo que se elige mal cuando nadie lo decide.

| Concepto | Tipo elegido | Por qué, y qué se rechaza en vez de tolerar |
| --- | --- | --- |
| <Dinero> | <tipo exacto, no coma flotante> | <precisión, redondeo prohibido, qué se hace con un valor fuera de forma> |
| <Tiempo> | <con zona horaria> | <…> |
| <Identidad> | <…> | <…> |

## Idempotencia y duplicados

Si el sistema recibe la misma petición o el mismo mensaje dos veces, ¿qué
mecanismo lo absorbe? Nombra cada uno y **qué protege exactamente**; confundirlos
es el error clásico.

| Mecanismo | Alcance | Qué protege |
| --- | --- | --- |
| <clave de idempotencia> | <una petición> | <…> |
| <deduplicación por identificador de mensaje> | <cada consumidor> | <…> |
| <identificador de correlación> | <todo el flujo> | **Solo trazabilidad. No deduplica nada.** |
