# Pirámide de pruebas

Generado por `pnpm test:pyramid` el 2026-09-25T23:27:47.928Z.

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
