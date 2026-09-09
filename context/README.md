# Contexto para agentes de IA

Cómo trabajan los agentes en este repositorio: qué roles existen, qué skills hay
instaladas y con qué prompts se generó lo que se generó.

**La regla de reparto es una sola:** `docs/` describe **el sistema bancario**;
`context/` describe **cómo se construye con agentes**. Un documento que un
evaluador leería para entender Bank USAC va en `docs/`. Un documento que solo
importa a quien opera el harness va aquí.

## Los documentos

| Documento | Qué responde |
| --- | --- |
| [AI_PROJECT_AGENTS.md](AI_PROJECT_AGENTS.md) | Los roles de agente instalados: para qué sirve cada uno, qué tiene **prohibido** hacer y cómo encadenan. Añadir un rol obliga a añadir una fila aquí. |
| [AI_PROJECT_SKILLS.md](AI_PROJECT_SKILLS.md) | Las skills instaladas, cómo se invocan y la política para añadir más. Instalar una skill obliga a registrarla aquí. |
| [prompt-mockup.md](prompt-mockup.md) | El prompt maestro con el que se generó el primer prototipo de interfaz. **Superado**: lo que se implementó vino de Claude Design y vive en [`../docs/DESIGN.md`](../docs/DESIGN.md). Se conserva porque el índice de casos de uso lo cita como origen de las superficies del frontend. |

## Lo que NO está aquí, y por qué

Buena parte del material de agentes **no puede moverse**: su ruta es un contrato
con la herramienta que lo lee, y cambiarla lo desactiva en silencio.

| Ruta | Por qué se queda donde está |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | El estándar `agents.md` se lee desde la raíz del repositorio. Es la fuente operativa compartida por todas las herramientas de IA. |
| [`../CLAUDE.md`](../CLAUDE.md) | Claude Code lo carga desde la raíz. Añade lo específico de Claude sobre AGENTS.md. |
| `.agents/` | El contenido canónico de roles y skills. Es donde `npx skills add` instala, así que moverlo haría que la herramienta lo recreara en la siguiente instalación. |
| `.claude/` · `.opencode/` | Puntos de entrada por herramienta, con **symlinks relativos** hacia `.agents/`. Cada herramienta busca su propio directorio en la raíz. |
| `.specify/` | Spec Kit: la constitución, las plantillas y el estado del flujo de especificación. La ruta la fija la herramienta. |

Esa asimetría es deliberada: aquí vive la **documentación** sobre los agentes,
que se lee; allá vive la **configuración** que las herramientas ejecutan. Mover
la segunda para que hiciera juego con la primera rompería el harness sin ganar
nada que un lector aproveche.

## Al añadir un rol o una skill

El procedimiento completo está en
[`../AGENTS.md`](../AGENTS.md#maintenance-conventions). En corto: se escribe el
archivo real bajo `.agents/`, se crea el symlink a mano, y se registra la fila
en el documento que corresponda de esta carpeta.
