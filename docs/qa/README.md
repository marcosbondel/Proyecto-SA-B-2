# Evidencia de pruebas

Lo que se probó, cómo se probó y qué se vio. Las capturas de esta carpeta no se
editan a mano: **las produce la suite**, y volver a correrla las reescribe.

## Evidencia de backend (por ticket)

[backend/](backend/) guarda la salida real de `pnpm lint` / `pnpm typecheck` /
`pnpm test` para tickets de un microservicio, un archivo por ticket. A
diferencia de lo de abajo, **no la produce un script** — es una captura manual
del día de la implementación, y no se sobrescribe: una revisión posterior
agrega una entrada nueva en vez de editar la existente.

## Los documentos

| Documento | Qué contiene |
| --- | --- |
| [happypath.md](happypath.md) | La guía integral: cada módulo con su camino exitoso frente a sus casos de validación y error, para los tres roles, con las capturas de cada paso. |
| [validation-report.md](validation-report.md) | El informe de validación: las 68 pruebas con su veredicto una por una, agrupadas en once categorías, y el Quality Score resultante. |
| [qa-test-results.json](qa-test-results.json) | Las métricas de la última corrida, escritas por la suite. |

## Las capturas

| Carpeta | Origen |
| --- | --- |
| [screenshots/](screenshots/) | 57 capturas de `test/e2e/happypath.e2e.mjs`, en alta resolución, una por paso y por caso de error. |
| [automated_test/](automated_test/) | 6 capturas de `test/e2e/run-cajero-audit-flow.mjs`: el flujo completo de validación de identidad desde la ventanilla, incluida la apertura bloqueada por identidad sin validar. |

## Cómo se regenera

Las tres suites necesitan el stack levantado (`pnpm dev` o `pnpm images:up`) y
escriben dentro de esta carpeta:

```bash
node test/e2e/happypath.e2e.mjs          # → screenshots/ y qa-test-results.json
node test/e2e/qa-suite.e2e.mjs           # → qa-test-results.json
node test/e2e/run-cajero-audit-flow.mjs  # → automated_test/
```

**Las dos primeras escriben el mismo `qa-test-results.json` con formas
distintas**, así que la última en correr es la que queda registrada. Hoy el
archivo contiene la corrida de `qa-suite` del 2026-09-05.

Ocho pasos de [happypath.md](happypath.md) quedaron sin captura porque la última
corrida no las guardó; están marcados en el texto como pendientes de recapturar.
