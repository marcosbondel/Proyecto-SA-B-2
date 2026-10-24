# Postmortem — El orquestador de la Saga, eliminado a mitad de carga

**Fecha:** 2026-10-15, 20:34–20:36 UTC
**Entorno:** `kind-bank-usac`, namespace `bank-usac`
**Tipo:** **escenario inyectado a propósito**
**Escenario del enunciado:** §4.1 — «eliminación de un pod durante la carga»
**Inyectado con:** `kubectl delete pod --grace-period=0 --force` sobre
`transaction-service`, a los 25 segundos de los 80 de la ventana.

> **Relectura T-61 (2026-10-21):** cifras y cronología históricas de kind.
> La explicación de Account limitado a una réplica quedó obsoleta: existe
> `PostgresSweepLease` con `pg_try_advisory_lock` y el HPA permite 1–5. Un
> máximo de Saga inferior a los 11 s de ausencia no demuestra por sí solo que
> hubo una Saga activa esperando todo el hueco; el recuento prueba las
> operaciones observadas, no cualquier momento posible de fallo.

## 1. Resumen en tres líneas

Se mató sin aviso al servicio que **decide** la Saga, en caliente, mientras 15
usuarios transferían. Estuvo fuera 11 segundos. De 531 transferencias, **531
terminaron `COMPLETED`**: ni una perdida, ni una duplicada, ni una atascada, y
ningún umbral cruzado.

## 2. Por qué se eligió esa víctima

De los siete componentes, `transaction-service` es el único que **no se puede
sustituir por un reintento del cliente**: tiene la máquina de estados, la fila
de la transacción y el bloqueo con el que decide cada transición. El Gateway se
puede perder y el cliente ve un 503; Payment se puede perder y la escalera lo
recoge. Si el orquestador se cae a mitad de una Saga, la pregunta es si la Saga
sabe retomarse — y esa es la pregunta que vale la pena hacerle a un banco.

Es también el componente que **no** lleva la restricción de una sola réplica:
`account-service` sí, porque además corre el barrido de cuentas inactivas sin
elección de líder. Matar a ese habría medido otra cosa.

## 3. Cronología

| Hora (UTC) | Qué |
| --- | --- |
| 20:34:35 | arranca `transfer.js`: rampa 1 → 5 → 15 VUs |
| 20:35:00 | `kubectl delete pod bank-usac-transaction-service-66d9965bf4-pv5cx --force --grace-period=0` |
| 20:35:01 | pod nuevo creado (`…-md44n`) |
| 20:35:11 | pod nuevo **Ready**: migraciones, topología y consumidores declarados |
| 20:35:55 | fin de la ventana de carga |
| 20:36:40 | recuento: 531 `COMPLETED`, 0 `COMPENSATED`, 0 `PENDING` |

**11 segundos de orquestador ausente**, contados entre el borrado y la
condición `Ready` del Deployment.

## 4. Impacto en los SLO

| Indicador | Objetivo | Medido | |
| --- | --- | --- | --- |
| SLO-7 — aceptación del comando, p95 | < 3 s | 42,3 ms | ✓ |
| SLO-2 — Saga cerrada, p95 | < 5 s | 1,22 s | ✓ |
| Saga cerrada, **máximo** | — | **3,87 s** | |
| SLO-27 — respuestas 5xx | < 1 % | 0,00 % (0 de 1 618) | ✓ |
| Comprobaciones de k6 | > 99 % | 100 % (1 062/1 062) | ✓ |
| Transferencias atascadas | 0 | 0 | ✓ |

El número que explica el resto es el **máximo de 3,87 s**. Si la caída hubiera
detenido las Sagas en vuelo, alguna habría tardado los 11 segundos del hueco. No
llegó a cuatro: las que estaban a mitad esperaron en el broker el tiempo que el
pod tardó en volver a consumir, y el broker no es el orquestador.

## 5. Causa raíz

Ninguna. El escenario salió bien y vale la pena decir **por qué**, porque no es
suerte y no es Kubernetes:

1. **Cada paso de la Saga es un mensaje persistente en RabbitMQ**, no una
   llamada en memoria. Un consumidor que desaparece deja el mensaje `unacked`;
   al cerrarse su canal, el broker lo devuelve a la cola. El trabajo espera, no
   se pierde.
2. **El estado vive en PostgreSQL, no en el proceso.** El pod nuevo no hereda
   nada del viejo y no necesita hacerlo: lee la fila y sigue.
3. **El consumo se deduplica por el `messageId` del sobre antes de tocar el
   estado.** Un mensaje que se re-entrega porque el `ack` no llegó a salir se
   descarta en vez de aplicar la transición dos veces — que es la forma en que
   este escenario podría haber **duplicado** dinero en lugar de perderlo.
4. **Las transiciones se deciden bajo un bloqueo de fila** y una función pura
   que rechaza todo lo que no esté en el diagrama. Dos instancias solapadas
   durante el relevo no pueden avanzar la misma transferencia dos veces.

Las cuatro son decisiones de diseño anteriores a este ticket. Este escenario es
la primera vez que se miden juntas contra una caída real en lugar de contra un
doble de pruebas.

## 6. Lo que no se midió, y es la grieta honesta

Este escenario mató al orquestador **mientras el resto del sistema estaba
sano**. El caso difícil es el otro, y ya ocurrió por accidente ese mismo día: el
[incidente del latido](2026-10-15-latido-amqp.md) mató a los siete a la vez, y
**ahí sí** quedó una transferencia atascada y Q1,00 sin devolver
([TD-093](../../TECH_DEBT.md)). La diferencia no es la cantidad de pods: es que
en el incidente el proceso murió **entre decidir un depósito y publicar el
veredicto**, y ese hueco no lo cubre ninguna de las cuatro propiedades de §5.

Así que la lectura correcta de este postmortem no es «la Saga sobrevive a que
maten un pod», es **«la Saga sobrevive a que maten un pod en cualquier paso que
pase por el broker»**. El paso que no pasa por el broker es el de TD-093.

## 7. Acciones

| # | Acción | Estado |
| --- | --- | --- |
| 1 | `pnpm load:scenario pod` deja el escenario repetible, con el borrado a mitad de la ventana y no al principio | hecho |
| 2 | **TD-091** — nada avisa de un reinicio de contenedor. Aquí fue intencional y se sabía; en el incidente del latido fue la señal que faltó | **abierto** |
| 3 | **TD-093** — el único hueco que este escenario no cubre, con su pérdida documentada | **abierto** |
