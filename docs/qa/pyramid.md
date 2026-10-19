# Pirámide de pruebas

Generado por `pnpm test:pyramid` el 2026-10-16T15:29:50.693Z.

Integración es la prueba que cruza un proceso real (PostgreSQL, RabbitMQ o
MinIO). Todo lo que corre en proceso con dobles es unitaria. E2E atraviesa los
siete componentes desplegados.

## Por paquete

| Paquete | Unitarias | Integración | % integ | Objetivo | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `gateway` | 439 | 121 | 21.6 % | 22.2 % | ok |
| `web` | 317 | 94 | 22.9 % | 22.2 % | ok |
| `customer-service` | 160 | 43 | 21.2 % | 22.2 % | ok |
| `account-service` | 192 | 57 | 22.9 % | 22.2 % | ok |
| `transaction-service` | 203 | 55 | 21.3 % | 22.2 % | ok |
| `payment-service` | 291 | 83 | 22.2 % | 22.2 % | ok |
| `notification-audit-service` | 201 | 56 | 21.8 % | 22.2 % | ok |
| `@bank/messaging` | 60 | 18 | 23.1 % | 22.2 % | ok |
| `@bank/observability` | 52 | 15 | 22.4 % | 22.2 % | ok |
| `@bank/contracts` | 1039 | 0 | 0.0 % | — | excepción |

## Sistema (las siete apps desplegables)

| Capa | Casos | Real | Objetivo |
| --- | ---: | ---: | ---: |
| Unitarias | 1803 | 73.2 % | 70 % |
| Integración | 509 | 20.7 % | 20 % |
| E2E | 152 | 6.2 % | 10 % |
| **Total** | **2464** | | |

**Esta corrida no ejecutó el E2E.** La fila de arriba sale de
`docs/qa/pyramid-e2e.json`, que escribe `test/e2e/run-all.mjs` contra un stack
levantado a mano, así que es de otra corrida y se informa sin afirmarse.
Lo que sí se comprobó es la relación entre las dos capas que sí se
midieron: la integración pesa 22.0 %
de lo propio de las siete apps, contra el objetivo de 22.2 %.

Para medir las tres capas: levanta el stack, corre `node test/e2e/run-all.mjs`
y vuelve a ejecutar `pnpm test:pyramid` sin `--without-e2e`.

## Lo que no se ejecutó

433 casos están declarados pero se saltaron en esta corrida — suites
cerradas tras `describe.skip` por falta de `DATABASE_URL` o `RABBITMQ_URL`.
Cuentan para la proporción porque las pruebas existen; no cuentan como
evidencia de que el comportamiento funciona.

- `apps/gateway/test/envelope-and-replies.integration.spec.ts` — 36 casos
- `apps/gateway/test/alert-webhook.integration.spec.ts` — 11 casos
- `apps/gateway/test/publish-routing.integration.spec.ts` — 50 casos
- `apps/gateway/test/reply-correlation.integration.spec.ts` — 24 casos
- `apps/services/customer-service/test/repository-queries.integration.spec.ts` — 16 casos
- `apps/services/customer-service/test/repository.integration.spec.ts` — 17 casos
- `apps/services/customer-service/test/constraints.integration.spec.ts` — 10 casos
- `apps/services/account-service/test/repository-extended.integration.spec.ts` — 15 casos
- `apps/services/account-service/test/repository.integration.spec.ts` — 42 casos
- `apps/services/transaction-service/test/repository.integration.spec.ts` — 55 casos
- `apps/services/payment-service/test/simulation-handlers.integration.spec.ts` — 14 casos
- `apps/services/payment-service/test/repository.integration.spec.ts` — 24 casos
- `apps/services/payment-service/test/interbank-send-repository.integration.spec.ts` — 19 casos
- `apps/services/payment-service/test/interbank-v1-repository.integration.spec.ts` — 15 casos
- `apps/services/payment-service/test/simulation.integration.spec.ts` — 7 casos
- `apps/services/payment-service/test/interbank-repository.integration.spec.ts` — 4 casos
- `apps/services/notification-audit-service/test/repository.integration.spec.ts` — 39 casos
- `apps/services/notification-audit-service/test/trace-and-dedupe.integration.spec.ts` — 17 casos
- `apps/packages/messaging/test/heartbeat.integration.spec.ts` — 2 casos
- `apps/packages/messaging/test/topology.integration.spec.ts` — 3 casos
- `apps/packages/messaging/test/broker.integration.spec.ts` — 9 casos
- `apps/packages/messaging/test/trace-propagation.integration.spec.ts` — 4 casos
