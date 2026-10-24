# Evidencia de pruebas

Lo que se probó, cómo se probó y qué se vio. Las capturas históricas de suites no se editan a mano; volver a correrlas las
reescribe. Las nuevas capturas manuales del navegador se separan en
`docs/images/fase3/`, con manifiesto y procedencia.

## Evidencia de backend (por ticket)

[backend/](backend/) guarda la salida real de `pnpm lint` / `pnpm typecheck` /
`pnpm test` para tickets de un microservicio, un archivo por ticket. A
diferencia de lo de abajo, **no la produce un script** — es una captura manual
del día de la implementación, y no se sobrescribe: una revisión posterior
agrega una entrada nueva en vez de editar la existente.

## Los documentos

| Documento | Qué contiene |
| --- | --- |
| [guia-validacion-manual-fase3-produccion.md](guia-validacion-manual-fase3-produccion.md) | Procedimiento de validación Fase III en producción desde frontend, Grafana y GitHub. Describe pasos y resultados esperados; su existencia no demuestra que se hayan ejecutado. |
| [happypath.md](happypath.md) | La guía integral: cada módulo con su camino exitoso frente a sus casos de validación y error, para los tres roles, con las capturas de cada paso. |
| [validation-report.md](validation-report.md) | El informe de validación: las 68 pruebas con su veredicto una por una, agrupadas en once categorías, y el Quality Score resultante. |
| [qa-test-results.json](qa-test-results.json) | Las métricas de la última corrida, escritas por la suite. |
| [pyramid.md](pyramid.md) | La forma de la pirámide de pruebas: unitarias, integración y E2E por paquete y para el sistema, con el objetivo al lado y lo que no llegó a ejecutarse. |
| [pyramid.json](pyramid.json) | Lo mismo en JSON, para que CI lo lea y lo publique como artefacto. |
| [pyramid-e2e.json](pyramid-e2e.json) | El recuento por suite E2E, escrito por `test/e2e/run-all.mjs`. Es lo único que le dice a `pnpm test:pyramid` cuántos casos E2E hay, porque medir el E2E exige los siete contenedores en pie y el script no los levanta. |

## Las capturas

| Carpeta | Origen |
| --- | --- |
| [screenshots/](screenshots/) | 57 capturas de `test/e2e/happypath.e2e.mjs`, en alta resolución, una por paso y por caso de error. |
| [automated_test/](automated_test/) | 6 capturas de `test/e2e/run-cajero-audit-flow.mjs`: el flujo completo de validación de identidad desde la ventanilla, incluida la apertura bloqueada por identidad sin validar. |

## Cómo se regenera

Las tres suites necesitan el stack levantado (`pnpm dev` o `pnpm images:up`) y
escriben dentro de esta carpeta:

```bash
node test/e2e/run-all.mjs                # → pyramid-e2e.json, screenshots/ y qa-test-results.json
node test/e2e/happypath.e2e.mjs          # → screenshots/ y qa-test-results.json
node test/e2e/qa-suite.e2e.mjs           # → qa-test-results.json
node test/e2e/run-cajero-audit-flow.mjs  # → automated_test/
```

`run-all.mjs` es el camino que importa: corre las suites por flujo de
`test/e2e/suites/`, agrega **una sola forma** de JSON y deja el recuento que
`pnpm test:pyramid` necesita. Los dos scripts sueltos siguen ahí por
compatibilidad y **escriben el mismo `qa-test-results.json` con formas
distintas** — `passed`/`details` contra `pass`/`detail` — así que la última en
correr es la que queda registrada. Ese choque es la razón por la que existe el
agregador; correr los sueltos después de él pisa su informe.

La pirámide se mide aparte y no necesita navegador:

```bash
pnpm test:pyramid                   # la tabla; informa lo que no se ejecutó
pnpm test:pyramid --require-executed # y lo convierte en fallo — así corre en CI
```

Ocho pasos de [happypath.md](happypath.md) quedaron sin captura porque la última
corrida no las guardó; están marcados en el texto como pendientes de recapturar.

## Revisión Fase III de 2026-10-21

- [Plan y matriz documental T-61](T-61-documentation-audit.md).
- [Guía de 24 casos, con ejecución parcial explícita](guia-validacion-manual-fase3.md).
- [Cloud: inventario, carga, HPA, saldos y fallos](backend/T-60-cloud-evidence.md).
- [Recorrido real por roles (Fase III)](../manual-usuario.md#4-recorrido-visual-de-fase-iii-evidencia-real-en-producción).

Los resultados históricos de abajo no se renuevan por cambiar documentación.
Los archivos raw en `load/` conservan fallos y tiempos, no sólo los éxitos.
