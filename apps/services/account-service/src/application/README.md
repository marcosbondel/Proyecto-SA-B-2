# account-service / application

Use cases, commands, ports and policies. Depends on `domain` and on the shared
transport contracts; never on `infrastructure` or `interfaces` (FR-006).

> **Blocked**: The use cases themselves. Their two prerequisites are done — the domain model (T-02) and the message contracts (T-05, in `@bank/contracts`) — so what is missing is the implementation, not the agreement. Owner: Marcos Bonifasi. Arrives with: T-17.
