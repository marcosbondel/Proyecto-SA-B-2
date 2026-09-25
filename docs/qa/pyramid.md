# Pirámide de pruebas

Generado por `pnpm test:pyramid` el 2026-09-25T23:12:14.843Z.

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
| Unitarias | 1223 | 72.8 % | 70 % |
| Integración | 360 | 21.4 % | 20 % |
| E2E | 98 | 5.8 % | 10 % |
| **Total** | **1681** | | |

## Lo que no se ejecutó

288 casos están declarados pero se saltaron en esta corrida — suites
cerradas tras `describe.skip` por falta de `DATABASE_URL` o `RABBITMQ_URL`.
Cuentan para la proporción porque las pruebas existen; no cuentan como
evidencia de que el comportamiento funciona.

- `apps/gateway/test/publish-routing.integration.spec.ts` — 37 casos
- `apps/gateway/test/envelope-and-replies.integration.spec.ts` — 36 casos
- `apps/gateway/test/reply-correlation.integration.spec.ts` — 22 casos
- `apps/services/customer-service/test/repository-queries.integration.spec.ts` — 16 casos
- `apps/services/customer-service/test/repository.integration.spec.ts` — 14 casos
- `apps/services/customer-service/test/constraints.integration.spec.ts` — 10 casos
- `apps/services/account-service/test/repository.integration.spec.ts` — 22 casos
- `apps/services/account-service/test/repository-extended.integration.spec.ts` — 15 casos
- `apps/services/transaction-service/test/repository.integration.spec.ts` — 48 casos
- `apps/services/payment-service/test/repository.integration.spec.ts` — 17 casos
- `apps/services/notification-audit-service/test/repository.integration.spec.ts` — 39 casos
- `apps/packages/messaging/test/broker.integration.spec.ts` — 9 casos
- `apps/packages/messaging/test/topology.integration.spec.ts` — 3 casos
