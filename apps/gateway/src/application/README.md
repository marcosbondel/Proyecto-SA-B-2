# gateway / application

Request orchestration for the gateway: shape validation, correlation-id
propagation and publication of commands onto the broker. No banking rule and no
domain decision live here (constitution V).

> **Blocked**: The concrete request flows depend on the event and Saga contracts. Owner: Marcos Bonifasi. Arrives with: T-05.
