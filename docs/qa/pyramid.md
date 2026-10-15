# Pirámide de pruebas

Generado por `pnpm test:pyramid` el 2026-10-15T20:42:02.528Z.

Integración es la prueba que cruza un proceso real (PostgreSQL, RabbitMQ o
MinIO). Todo lo que corre en proceso con dobles es unitaria. E2E atraviesa los
siete componentes desplegados.

## Por paquete

| Paquete | Unitarias | Integración | % integ | Objetivo | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `gateway` | 410 | 114 | 21.8 % | 22.2 % | ok |
| `web` | 317 | 94 | 22.9 % | 22.2 % | ok |
| `customer-service` | 160 | 43 | 21.2 % | 22.2 % | ok |
| `account-service` | 192 | 57 | 22.9 % | 22.2 % | ok |
| `transaction-service` | 203 | 55 | 21.3 % | 22.2 % | ok |
| `payment-service` | 192 | 58 | 23.2 % | 22.2 % | ok |
| `notification-audit-service` | 201 | 56 | 21.8 % | 22.2 % | ok |
| `@bank/messaging` | 60 | 18 | 23.1 % | 22.2 % | ok |
| `@bank/observability` | 52 | 15 | 22.4 % | 22.2 % | ok |
| `@bank/contracts` | 939 | 0 | 0.0 % | — | excepción |

## Sistema (las siete apps desplegables)

| Capa | Casos | Real | Objetivo |
| --- | ---: | ---: | ---: |
| Unitarias | 1675 | 72.7 % | 70 % |
| Integración | 477 | 20.7 % | 20 % |
| E2E | 152 | 6.6 % | 10 % |
| **Total** | **2304** | | |

## Lo que no se ejecutó

401 casos están declarados pero se saltaron en esta corrida — suites
cerradas tras `describe.skip` por falta de `DATABASE_URL` o `RABBITMQ_URL`.
Cuentan para la proporción porque las pruebas existen; no cuentan como
evidencia de que el comportamiento funciona.

- `apps/gateway/test/publish-routing.integration.spec.ts` — 43 casos
- `apps/gateway/test/envelope-and-replies.integration.spec.ts` — 36 casos
- `apps/gateway/test/alert-webhook.integration.spec.ts` — 11 casos
- `apps/gateway/test/reply-correlation.integration.spec.ts` — 24 casos
- `apps/services/customer-service/test/repository-queries.integration.spec.ts` — 16 casos
- `apps/services/customer-service/test/repository.integration.spec.ts` — 17 casos
- `apps/services/customer-service/test/constraints.integration.spec.ts` — 10 casos
- `apps/services/account-service/test/repository.integration.spec.ts` — 42 casos
- `apps/services/account-service/test/repository-extended.integration.spec.ts` — 15 casos
- `apps/services/transaction-service/test/repository.integration.spec.ts` — 55 casos
- `apps/services/payment-service/test/simulation-handlers.integration.spec.ts` — 14 casos
- `apps/services/payment-service/test/interbank-repository.integration.spec.ts` — 2 casos
- `apps/services/payment-service/test/repository.integration.spec.ts` — 24 casos
- `apps/services/payment-service/test/interbank-send-repository.integration.spec.ts` — 11 casos
- `apps/services/payment-service/test/simulation.integration.spec.ts` — 7 casos
- `apps/services/notification-audit-service/test/repository.integration.spec.ts` — 39 casos
- `apps/services/notification-audit-service/test/trace-and-dedupe.integration.spec.ts` — 17 casos
- `apps/packages/messaging/test/heartbeat.integration.spec.ts` — 2 casos
- `apps/packages/messaging/test/topology.integration.spec.ts` — 3 casos
- `apps/packages/messaging/test/broker.integration.spec.ts` — 9 casos
- `apps/packages/messaging/test/trace-propagation.integration.spec.ts` — 4 casos
