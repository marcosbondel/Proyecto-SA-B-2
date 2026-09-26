# Pirámide de pruebas

Generado por `pnpm test:pyramid` el 2026-09-26T00:30:04.512Z.

Integración es la prueba que cruza un proceso real (PostgreSQL, RabbitMQ o
MinIO). Todo lo que corre en proceso con dobles es unitaria. E2E atraviesa los
siete componentes desplegados.

## Por paquete

| Paquete | Unitarias | Integración | % integ | Objetivo | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `gateway` | 321 | 95 | 22.8 % | 22.2 % | ok |
| `web` | 272 | 84 | 23.6 % | 22.2 % | ok |
| `customer-service` | 137 | 40 | 22.6 % | 22.2 % | ok |
| `account-service` | 130 | 37 | 22.2 % | 22.2 % | ok |
| `transaction-service` | 173 | 48 | 21.7 % | 22.2 % | ok |
| `payment-service` | 60 | 17 | 22.1 % | 22.2 % | ok |
| `notification-audit-service` | 130 | 39 | 23.1 % | 22.2 % | ok |
| `@bank/messaging` | 42 | 12 | 22.2 % | 22.2 % | ok |
| `@bank/contracts` | 775 | 0 | 0.0 % | — | excepción |

## Sistema (las siete apps desplegables)

| Capa | Casos | Real | Objetivo |
| --- | ---: | ---: | ---: |
| Unitarias | 1223 | 71.2 % | 70 % |
| Integración | 360 | 21.0 % | 20 % |
| E2E | 134 | 7.8 % | 10 % |
| **Total** | **1717** | | |

**Esta corrida no ejecutó el E2E.** La fila de arriba sale de
`docs/qa/pyramid-e2e.json`, que escribe `test/e2e/run-all.mjs` contra un stack
levantado a mano, así que es de otra corrida y se informa sin afirmarse.
Lo que sí se comprobó es la relación entre las dos capas que sí se
midieron: la integración pesa 22.7 %
de lo propio de las siete apps, contra el objetivo de 22.2 %.

Para medir las tres capas: levanta el stack, corre `node test/e2e/run-all.mjs`
y vuelve a ejecutar `pnpm test:pyramid` sin `--without-e2e`.

## Lo que no se ejecutó


36 casos E2E se declararon pero se omitieron — una precondición
que la suite no pudo montar, no infraestructura ausente. Cuentan para la
proporción; no cuentan como evidencia.
- `accounts-deposits` — 2 casos
- `kyc-identity` — 2 casos
- `notifications-audit` — 5 casos
- `payments` — 9 casos
- `registration-activation` — 1 casos
- `resilience` — 3 casos
- `transfers-saga` — 14 casos
