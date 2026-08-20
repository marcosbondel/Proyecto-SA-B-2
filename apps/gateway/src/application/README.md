# gateway / application

Request orchestration for the gateway: shape validation, correlation-id
propagation and publication of commands onto the broker. No banking rule and no
domain decision live here (constitution V).

> **Blocked**: The concrete request flows. The contracts they publish exist (T-05, in `@bank/contracts`), and `request-envelope.ts` already stamps the verified identity onto them; what is missing is the routes. Owner: Marcos Bonifasi. Arrives with: T-15.
