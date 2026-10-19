# T-47 — Envío de depósitos al banco pareja: evidencia

Fecha: **2026-10-15**. Rama `feature/T-47`, seis commits.

## 1. La decisión que define el ticket

Un depósito al banco pareja sale de la cuenta del cliente y entra en la
**cuenta de liquidación interbancaria** de este banco: una cuenta propia que
representa lo que se le debe al otro. Visto así es una transferencia interna con
un paso de pago distinto, y eso tiene una consecuencia que vale más que el
código que la implementa:

> **La máquina de estados de la Saga no cambió ni una línea.**

La compensación, el historial, el estado de fase, la notificación y la pantalla
de seguimiento salen de la maquinaria que ya estaba probada. `targetAccount`
sigue siendo un UUID de este sistema, origen ≠ destino se sigue cumpliendo y la
partida sigue siendo doble.

La alternativa —una transferencia con cuenta destino nula y una rama nueva en la
Saga— es la forma que este repositorio ya había rechazado para los depósitos en
ventanilla, y por el mismo motivo: un orquestador con un camino que no puede
fallar y una columna que a veces no significa nada.

Lo interbancario quedó confinado a Payment y al Gateway, y el catálogo creció en
**dos** mensajes en vez de ocho.

## 2. Qué entra

| Capa | Qué |
| --- | --- |
| Contratos | bloque `interbank` **opcional** en `transfer.requested.v1` y `payment.requested.v1`; `payment.interbank.callback.received.v1` (unión discriminada); `payment.interbank.sent.v1` |
| Dominio | `interbank-send.ts`: los seis estados como función pura, sin importar nada fuera del dominio |
| Persistencia | `interbank_sends` con cuatro `CHECK` que son la misma máquina en SQL, y el vencimiento como **columna** |
| Payment | el caso de uso con tres entradas (comando, callback, barrido), el cliente HTTP, las dos métricas reservadas |
| Transaction | el bloque de paso, sin interpretarlo, y la Saga intacta |
| Account | la cuenta de liquidación, sembrada como las de los billers |
| Gateway | `POST /api/interbank/transfers` y `POST /api/interbank/callbacks` |
| Frontend | `/transferencias/interbancaria`, y el seguimiento que ya existía |

## 3. Las tres distinciones que cuestan dinero si se pierden

1. **Un fallo de entrega no es un rechazo.** Nadie ha opinado todavía: se
   reintenta con la escalera, y es el vencimiento del depósito el que decide
   cuándo rendirse.
2. **`TIMEOUT` y `REJECTED` compensan igual pero no son sinónimos.** Un rechazo
   es una opinión y un vencimiento su ausencia. Confundirlos hace imposible
   saber si el banco pareja está caído o es estricto.
3. **`REVERSED` no es un cuarto final, es la constancia de que el dinero
   volvió.** Se escribe cuando Payment oye la compensación, no cuando la ordena:
   una constancia escrita antes del hecho no es constancia. Sin ese estado,
   «rechazado» y «rechazado y devuelto» serían el mismo — la diferencia que
   §8.3 penaliza con un 50 %.

## 4. Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 14 de 14 |
| `pnpm typecheck` | 14 de 14 |
| `pnpm test` | 14 de 14 |
| `pnpm test:contract` | 939 casos |
| `pnpm test:pyramid` | `payment-service` 23.2 %, `web` 22.9 % — sin desviaciones de paquete |
| `pnpm build` | 14 de 14 |
| `pnpm --filter web test` | 317 unitarias + 94 de integración |

Pruebas nuevas: **12** sobre la máquina de estados (la matriz completa 6×6:
lo que no está en el diagrama lanza, y lo que está, no), **11** sobre la
orquestación con dobles, **11** de integración contra PostgreSQL real y **8**
sobre las reglas del formulario.

## 5. Cinco veces que el repositorio me corrigió

Ninguna de las cinco la encontré leyendo; las cinco las encontró una barrera que
ya estaba puesta.

1. **La prueba de aislamiento de Payment, dos veces.** Comparaba estados del
   depósito en la capa de aplicación y luego en un adaptador de telemetría. La
   regla dice que el vocabulario del dominio se compara en el dominio, y tenía
   razón: salió `isSendDecided`.
2. **La pirámide de pruebas.** 23 casos unitarios nuevos bajaron la integración
   de `payment-service` al 19.7 % y el script pidió 8 casos. Salieron 11, y son
   los que faltaban: los `CHECK`, el guardia de estado y `SKIP LOCKED`.
3. **Esos 11 encontraron un defecto que ningún doble ve.** `$3` se usaba a la
   vez para asignar un `VARCHAR(12)` y para comparar contra literales, y
   PostgreSQL se niega: *inconsistent types deduced for parameter $3*. Es
   exactamente para lo que está la capa de integración.
4. **El guard de clasificación de la auditoría** exigió una entrada explícita
   para el evento nuevo, con su severidad decidida y no por omisión.
5. **El typecheck cazó una migración que puse en el array equivocado** —
   `rindex` encontró el `const applied: string[] = []` de otra función — y con
   un número ya usado. Ahora es `012`.

## 6. La pantalla, y la desviación que `DESIGN.md` pide registrar

El prototipo de Claude Design **no tiene pantalla interbancaria**: sus treinta y
cuatro pantallas son de las fases anteriores. Verificado contra el inventario de
[`FRONTEND.md`](../../FRONTEND.md#the-screen-inventory) y contra la lista de
archivos del proyecto de diseño, que sólo contiene `bonking.dc.html` y
`support.js`.

Lo que se hizo, y es lo que `DESIGN.md` pide cuando el diseño y el repositorio
no cubren el mismo terreno —quedarse con la regla del repositorio y **anotar la
discrepancia** en vez de inventar una tercera variante:

- La composición es la de `T-01` (`TransactionTransferForm`), pantalla que ya se
  comparó con la referencia: misma `UCard`, mismo paso de revisión antes de
  enviar, mismo `SharedIdempotencyKeyField`, mismos tokens y mismas clases.
- Lo que cambia, cambia porque el dominio cambia: el destino **no** se elige de
  una lista (está en otro banco, no hay catálogo que pedir y el formato lo
  decide ese banco), y el aviso de que el otro banco tiene que confirmarlo es
  nuevo porque el `202` aquí dice menos que en una transferencia interna.
- La entrada está en `/transferencias` como acción secundaria, junto a
  «Monitoreo», porque es lo que menos gente hace.

**No se ha abierto en un navegador.** Es la misma deuda que TD-054 declara para
las otras treinta y cuatro, y no se cierra con esto: lint, tests y typecheck en
verde no son evidencia de que una pantalla dibuje.

## 7. Lo que queda abierto

- **TD-090**: el seguimiento muestra los estados de la Saga, no los seis del
  depósito. La información existe (la tabla, el evento, la métrica) pero sólo la
  ve quien entra a la auditoría o a Grafana. Llevarla a `T-03` necesita que
  `transaction.status.replied.v1` cargue el bloque — la misma ampliación que el
  `reference` del pago de servicios también necesita, y conviene hacerlas
  juntas.
- **La conciliación diaria** que §4.1 deja como opcional no está.
- **Contra el banco pareja real, nada está probado**: el flujo se ejercitó
  contra el mock en el clúster local. Eso es T-55 (la pareja y el contrato) y
  T-54 (la nube).
