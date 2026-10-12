# Pirámide de pruebas

Generado por `pnpm test:pyramid` el 2026-10-11T23:58:59.063Z.

Integración es la prueba que cruza un proceso real (PostgreSQL, RabbitMQ o
MinIO). Todo lo que corre en proceso con dobles es unitaria. E2E atraviesa los
siete componentes desplegados.

## Por paquete

| Paquete | Unitarias | Integración | % integ | Objetivo | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `gateway` | 406 | 111 | 21.5 % | 22.2 % | ok |
| `web` | 309 | 94 | 23.3 % | 22.2 % | ok |
| `customer-service` | 160 | 43 | 21.2 % | 22.2 % | ok |
| `account-service` | 188 | 56 | 23.0 % | 22.2 % | ok |
| `transaction-service` | 203 | 55 | 21.3 % | 22.2 % | ok |
| `payment-service` | 151 | 45 | 23.0 % | 22.2 % | ok |
| `notification-audit-service` | 201 | 56 | 21.8 % | 22.2 % | ok |
| `@bank/messaging` | 57 | 16 | 21.9 % | 22.2 % | ok |
| `@bank/observability` | 48 | 13 | 21.3 % | 22.2 % | ok |
| `@bank/contracts` | 875 | 0 | 0.0 % | — | excepción |

## Sistema (las siete apps desplegables)

| Capa | Casos | Real | Objetivo |
| --- | ---: | ---: | ---: |
| Unitarias | 1618 | 72.6 % | 70 % |
| Integración | 460 | 20.6 % | 20 % |
| E2E | 152 | 6.8 % | 10 % |
| **Total** | **2230** | | |

**Esta corrida no ejecutó el E2E.** La fila de arriba sale de
`docs/qa/pyramid-e2e.json`, que escribe `test/e2e/run-all.mjs` contra un stack
levantado a mano, así que es de otra corrida y se informa sin afirmarse.
Lo que sí se comprobó es la relación entre las dos capas que sí se
midieron: la integración pesa 22.1 %
de lo propio de las siete apps, contra el objetivo de 22.2 %.

Para medir las tres capas: levanta el stack, corre `node test/e2e/run-all.mjs`
y vuelve a ejecutar `pnpm test:pyramid` sin `--without-e2e`.
