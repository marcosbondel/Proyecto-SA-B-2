# Capturas del despliegue en Kubernetes

Evidencia visual de que el sistema corre en el clúster local. Acompaña a la
salida de texto que `pnpm k8s:evidence` deja en
[`specs/008-audit-remediation/evidence/`](../../../specs/008-audit-remediation/evidence/);
esto es lo mismo, pero mirable de un vistazo en la defensa.

El procedimiento que las produce está en
[`docs/operations/DEPLOYMENT.md`](../../operations/DEPLOYMENT.md).

**Están todas.** Se muestran, con su lectura, en
[`docs/TECHNICAL_DOCUMENT.md` §9](../../TECHNICAL_DOCUMENT.md#9-contenedores-y-despliegue-en-kubernetes).
Tomadas el 2026-09-03 contra el clúster kind, release `bank-usac`.

## Qué debe haber aquí

Nombres en minúsculas, numerados, con guiones — igual que `docs/images/happypath/`.

| Archivo | Qué debe mostrar | Qué criterio de la rúbrica defiende |
| --- | --- | --- |
| `01-build-imagenes.png` | El resumen final de `pnpm images:build -- --kind bank-usac`: las siete imágenes con su tag de commit, y la línea de carga en kind. | Contenerización (§8.1) |
| `02-helm-install.png` | El final de `pnpm k8s:install`: `helm upgrade --install` correcto y los siete Deployments disponibles. | Despliegue en Kubernetes (§8.1) · 2.10 |
| `03-pods-running.png` | `kubectl get pods -n bank-usac -o wide` con los **siete** pods en `1/1 Running`. | 2.10 Despliegue funcional |
| `04-dependencias-fuera-del-cluster.png` | `docker ps --filter network=bank-usac-local`: las cinco PostgreSQL, RabbitMQ y MinIO corriendo **fuera** del clúster. | **Bases de datos externas (§8.1)** — es el requisito que se comprueba con `docker ps` y no con `kubectl` |
| `05-ready-por-componente.png` | El `/ready` de los siete componentes: `broker connected`, `database reachable`, `queues consuming`. | Uso de broker · Independencia de datos |
| `06-saga-completed.png` | El resumen final del flujo: una transferencia `COMPLETED` y dos `COMPENSATED`, con los saldos antes/después. | 2.7 Flujo distribuido · 2.8 Manejo de fallos · Código funcional |
| `07-degradado-not-ready.png` | Con una base detenida: su pod `0/1 Running` — **no** `CrashLoopBackOff`. Muestra `RESTARTS 2`, del defecto que esta misma prueba destapó y que `921426f` corrigió; ver la nota en §9. | 2.8 Manejo de fallos (escenarios de fallo, no solo happy path) |
| `07b-health-ok-ready-503.png` | Con la base caída: `/health` responde `ok` y `/ready` devuelve `503`. La diferencia entre vivo y listo, que es la razón de que liveness no reinicie el pod. | 2.8 Manejo de fallos · SRE |
| `08-frontend-desde-el-cluster.png` | El navegador en `localhost:3010` con sesión iniciada, servido por el pod `web` vía `port-forward`. | Frontend (§4.4) · Despliegue funcional |

## Por qué la 04 importa más de lo que parece

El enunciado exige en §4.2 que las bases de datos sean **externas al clúster**, y
la rúbrica lo vuelve a pedir en §8.1. La única forma de demostrarlo es enseñar
que aparecen en `docker ps` y **no** en `kubectl get pods`. Una captura de los
pods, por sí sola, no lo prueba: prueba lo que hay dentro, no lo que quedó fuera.
