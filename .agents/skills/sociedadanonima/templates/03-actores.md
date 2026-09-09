<!--
PLANTILLA · Actores y permisos mínimos — Fase F3
La sección de FRONTERAS no es opcional: lo prohibido es lo que se implementa mal.
-->

# Actores y permisos — <Proyecto>

> **Origen:** <lo exige el enunciado / lo decide el equipo>. Si lo decide el
> equipo, esta matriz es una decisión de dominio y se numera (`D-nn`) en el ADR.

## Los actores

| Actor | Identificador | Quién es |
| --- | --- | --- |
| <Nombre> | `<ROL_EN_CODIGO>` | <descripción de una línea> |

Incluye los actores que no son personas: sistemas externos, procesos
programados, el propio sistema cuando actúa solo.

## Cómo se modelan

<Si varios roles comparten entidad, dilo aquí y di qué reglas aplican a cuál.>

| Regla | Aplica a |
| --- | --- |
| <…> | <todos / solo `<ROL>`> |

## Matriz de permisos

| Caso de uso | `<ROL_A>` | `<ROL_B>` | `<ROL_C>` |
| --- | :---: | :---: | :---: |
| <CDU001 …> | ✔ solo propios | ✔ cualquiera | ✔ |

Usa un alcance, no solo un tick: «solo propios», «cualquiera», «solo su turno».
Un ✔ sin alcance es la ambigüedad que acaba en una fuga de datos.

## Fronteras explícitas

Lo que cada rol **no** puede hacer, con el nombre del rechazo.

### `<ROL_A>`

- No puede <…>. Resultado esperado: `<NOMBRE_DEL_RECHAZO>` — un rechazo con
  nombre, nunca un silencio.

### `<ROL_B>`

- <…>

## Lo que deliberadamente no se modela

<Operaciones que alguien esperaría encontrar y no están, con el motivo. Sin esta
sección, cada revisor pregunta lo mismo.>

## Dónde se hace cumplir

<Componente y archivo que implementan esta matriz. Si hay dos copias —por
ejemplo servidor e interfaz— di cuál manda y qué impide que se separen.>
