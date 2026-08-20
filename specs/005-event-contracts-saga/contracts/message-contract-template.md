# Plantilla: la entrada documental de un mensaje

Cada uno de los 41 mensajes tiene una entrada con **exactamente** estas secciones en
`docs/events/catalog.md`. Una entrada a la que le falte una sección está incompleta: FR-004
exige productor, consumidores, precondiciones, efectos y comportamiento ante error, y la
rúbrica califica "eventos definidos (nombres, payloads, flujo)" (§8.1, p. 20).

---

## `<nombre>.v<N>`

| | |
| --- | --- |
| **Categoría** | `command` \| `event` \| `reply` |
| **Productor** | Un único servicio |
| **Consumidores** | `command`: exactamente 1 · `event`: ≥ 1 · `reply`: quien preguntó |
| **Exchange** | `bank.commands` \| `bank.events` \| `bank.replies` |
| **Routing key** | Idéntica al nombre completo con versión |
| **Contrato** | Ruta del esquema en `apps/packages/contracts/src/events/` |

### Payload

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |

### Precondiciones

Qué debe ser cierto antes de emitirlo. Si nada lo condiciona, escribir "Ninguna" — no dejar la
sección vacía.

### Efectos

Qué cambia en el consumidor al procesarlo. Para un mensaje que mueve dinero, decir
explícitamente qué se mueve y en qué dirección.

### Idempotencia

Cómo reconoce el consumidor una reentrega, y qué hace al reconocerla.

### Ante error

Qué mensaje cierra el fallo, o si el mensaje va a la DLQ. Un mensaje sin salida de error
documentada es un flujo que puede quedarse colgado sin que nadie sepa dónde mirar.

### Compatibilidad

Qué cambios caben dentro de `vN` y cuál obliga a `vN+1`.

### Ejemplo

Un JSON completo, con sobre, no sólo el payload.

---

## Reglas que la plantilla impone

1. **Sin secciones vacías.** "Ninguna" y "No aplica" son respuestas; el silencio no.
2. **El ejemplo lleva sobre completo.** Un payload suelto no demuestra que la correlación
   funcione.
3. **Una razón de error es segura o no se escribe.** Nada que revele si un usuario existe,
   ni datos personales, ni rutas internas.
4. **Los consumidores se listan por nombre de servicio**, no por "quien lo necesite".
