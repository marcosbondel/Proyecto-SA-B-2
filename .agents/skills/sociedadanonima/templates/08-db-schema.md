<!--
PLANTILLA · Esquema de datos — Fase F5
Debe reflejar el esquema REAL. Si se genera a mano, dice de qué migración o
commit se sacó, y se regenera cuando cambie.
-->

# Esquema de datos — <Proyecto>

> **Sincronizado con:** <migración, commit o herramienta que lo generó> ·
> **Fecha:** <YYYY-MM-DD>

<Si hay más de un almacén, di la regla de aislamiento: quién puede leer qué, y
qué integración sustituye a las consultas cruzadas.>

---

## <Almacén / servicio>

- **Motor y versión:** <…>
- **Propósito:** <qué datos posee y por qué son suyos>

### Tabla `<nombre_tabla>`

<Una línea sobre qué representa.>

| Columna | Tipo | Nulo | Default | Restricciones / notas |
| --- | --- | :---: | --- | --- |
| `<columna>` | `<TIPO>` | NO | — | **PRIMARY KEY** |
| `<columna>` | `<TIPO>` | SÍ | `NULL` | `CHECK (<condición>)` — hace cumplir INV-<X>-n |

**Índices**

- `<nombre_indice>`: `UNIQUE (<columnas>)` — <qué invariante sostiene>

---

## Reglas de frontera

1. **Referencias opacas.** <Qué identificadores apuntan a datos de otro dueño y
   por qué no llevan clave foránea. Qué se pierde con eso y qué lo compensa.>
2. **Tipos sensibles.** <Dinero, tiempo, identidad: el tipo elegido y qué queda
   prohibido.>
3. **Datos que no se guardan.** <Qué se redacta, se hashea o no se persiste, y
   **antes de qué momento** se hace — redactar después de insertar no redacta
   nada.>
4. **Retención.** <Qué se borra de verdad, qué solo se marca, cuánto se conserva.>
