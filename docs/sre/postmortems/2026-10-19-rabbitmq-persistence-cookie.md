# Registro de incidente — RabbitMQ, persistencia y permisos de cookie

**Fecha de referencia:** 2026-10-19, según commits y comentarios versionados.
**Entorno descrito por la fuente:** producción GKE; el documento no representa
una nueva inyección de fallos.
**Estado documental:** reconstrucción parcial; faltan logs, duración e impacto
cuantificados del incidente original.
**Responsable de seguimiento:** Infraestructura/SRE, Marcos Bonifasi, según
[OWNERSHIP](../../OWNERSHIP.md).

## Resumen

El manifiesto de RabbitMQ documenta dos fallos encadenados durante una prueba
de caída del broker: el almacenamiento efímero perdía mensajes al reemplazar el
pod; después de añadir un PVC, el siguiente arranque podía fallar porque
`.erlang.cookie` recibía permisos de grupo. Los cambios versionados reparan
persistencia e inicio. Este registro separa ese diagnóstico conservado en el
repositorio de la evidencia operativa que no se adjuntó.

## Evidencia disponible y cronología verificable

| Marca conservada | Hecho verificable | Qué no permite inferir |
| --- | --- | --- |
| 2026-10-19 16:09:10 UTC−6 | [`6402d9b`](https://github.com/marcosbondel/Proyecto-SA-B-2/commit/6402d9b) añade PVC, nombre estable `rabbit@localhost` y rollout sin dos escritores | No es la hora de inicio de la caída ni prueba de despliegue de ese commit |
| 2026-10-19 17:19:11 UTC−6 | [`4f9593c`](https://github.com/marcosbondel/Proyecto-SA-B-2/commit/4f9593c) corrige permisos al reiniciar con volumen | No es la hora de recuperación de producción |
| Comentarios del manifiesto actual | Registran pérdida de colas al escalar a cero y error de cookie en una prueba de broker de producción del 2026-10-19 | No aportan recuento de mensajes, operaciones afectadas o logs originales |

Las dos horas corresponden a `git log --date=iso-strict`, no a observaciones
de Prometheus o Kubernetes. No hay evidencia suficiente aquí para extender la
cronología al 20 de octubre ni calcular MTTD, MTTA, MTTR o error budget gastado.

Fuente técnica:
[`templates/infra/rabbitmq.yaml`](../../../infra/k8s/helm/bank-usac/templates/infra/rabbitmq.yaml).

## Causa técnica documentada

1. Sin volumen, la cola durable y el mensaje persistente seguían guardados en
   la capa efímera del contenedor. Sustituir el pod eliminaba ese estado.
2. Un PVC sin identidad estable tampoco bastaba: RabbitMQ usa el nombre del
   nodo para su directorio. `rabbit@<hostname-del-pod>` cambia en un Deployment
   y el pod nuevo puede abrir otro directorio vacío en el mismo disco.
3. `fsGroup` con recorrido recursivo podía añadir permisos de grupo a
   `.erlang.cookie`. RabbitMQ exige que sólo su dueño la lea; el proceso
   rechazaba el arranque con `must be accessible by owner only`.
4. La corrección usa `fsGroupChangePolicy: OnRootMismatch` y un init container
   como UID/GID 999 que aplica `chmod 400`, sin leer o publicar el valor de la
   cookie. El rollout tiene `maxSurge: 0`, `maxUnavailable: 1` por el PVC RWO.

## Impacto y estado del dinero

El código fuente menciona operaciones que podían quedar `PENDING` tras perder
mensajes. **No se adjunta un inventario original de operaciones, saldos antes y
después ni una conciliación del incidente.** No se declara cero pérdida de
dinero ni recuperación completa por observar el broker Ready posteriormente.

SLO potencialmente afectados: disponibilidad Gateway (SLO-27), duración Saga
(SLO-2), mensajes (SLO-1) y reinicios (SLO-26). No hay consultas fechadas de la
ventana original para publicar un porcentaje de incumplimiento.

## Respuesta y acciones

| Acción | Responsable de seguimiento | Estado y evidencia |
| --- | --- | --- |
| Persistir colas y fijar identidad estable del nodo | Infraestructura/SRE | Implementado en `6402d9b`; verificar valores efectivos y supervivencia con una prueba separada en dev |
| Corregir permisos de cookie antes del arranque | Infraestructura/SRE | Implementado en `4f9593c`; el diff es evidencia de configuración, no un log de recuperación |
| Documentar diagnóstico, rotación y preservación del PVC | Infraestructura/SRE | [Runbook actualizado](../../operations/runbooks/consumer-lag.md#rabbitmq-pvc-y-permisos-de-erlangcookie), T-61 |
| Recuperar logs, eventos, versión desplegada y horas del incidente | Infraestructura/SRE | Pendiente; conservar ausencia explícita si la retención ya venció |
| Identificar y conciliar operaciones que perdieron mensajes | Dueños de Account, Transaction y Payment; coordinación SRE | Pendiente de evidencia; un outbox no reconstruye cualquier mensaje ya perdido del broker |
| Probar reinicio del broker y preservación de colas sin afectar producción | Infraestructura/SRE y QA | Pendiente de una corrida aislada en dev con saldos, volúmenes y recuperación medidos |

## Criterio de cierre y aprendizaje

Preservar estado durable requiere volumen, nombre de nodo y permisos de
arranque compatibles. Un test que sólo instala con volumen vacío no reproduce
el siguiente montaje del mismo volumen. Una recuperación válida debe probar
ese segundo arranque, confirmar consumidores y conciliar las Sagas en vuelo.

El incidente histórico queda **parcialmente documentado** mientras falten sus
resultados operativos y conciliación. No se reemplazan por una captura nueva
sin identificarla como una verificación posterior.
