# Events

The catalogue of domain events: what each one means, who publishes it, who
consumes it, and how it is versioned. Events are the only interface between
services (constitution IV), so this catalogue is the system's public contract
with itself.

## Relationship to the code

This directory documents the events; the executable shapes live in
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/).
The two arrive together — a documented event with no contract cannot be
published, and a contract with no documentation cannot be consumed safely.

## What each entry records

- Name and version (`account.opened.v1`).
- Owning service, and the services that consume it.
- Payload shape, and which field carries the idempotency key.
- Its place in the transfer Saga, including the compensating event.

> **Blocked**: The event catalogue depends on the domain boundaries and the Saga design. Owner: Marcos Bonifasi. Arrives with: T-05 and T-07.
