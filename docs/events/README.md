# Events

The catalogue of domain events: what each one means, who publishes it, who
consumes it, and how it is versioned. Events are the only interface between
services (constitution IV), so this catalogue is the system's public contract
with itself.

## Relationship to the domain model

**Which events exist is already decided.** T-02 fixed the name, the producing
service, the consumers and the flow of all 13 commands and 22 events in
[`../domain/message-catalog.md`](../domain/message-catalog.md). That catalogue is
the starting point for everything here; this directory does not re-decide it.

## Relationship to the code

This directory documents the events; the executable shapes live in
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/).
The two arrive together — a documented event with no contract cannot be
published, and a contract with no documentation cannot be consumed safely.

## What each entry adds on top of the catalogue

- Version suffix and compatibility rules (`account.opened.v1`).
- Payload shape, field by field, and which field carries the idempotency key.
- Exchange, queue and routing-key naming conventions.
- Serialization format, retry and dead-letter policy.

> **Blocked**: Payload shape, versioning and topic conventions are not written. The producer/consumer catalogue they build on is done and lives in [`../domain/message-catalog.md`](../domain/message-catalog.md). Owner: Marcos Bonifasi. Arrives with: T-05.
