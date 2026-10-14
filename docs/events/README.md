# Events

How the system talks to itself: the envelope every message travels in, the
broker topology that carries them, and the transfer Saga they compose into.
The incoming interbank extension (T-46) is documented in
[`../operations/INTERBANK.md`](../operations/INTERBANK.md).

## The documents

| Document | What it answers |
| --- | --- |
| [`envelope.md`](envelope.md) | What every message carries regardless of its contents, and why the version is written twice |
| [`catalog.md`](catalog.md) | The original flow catalogue, with producer, consumers, preconditions, effects and error behaviour; newer extensions live in their ticket runbooks until this generator is expanded |
| [`topology.md`](topology.md) | Exchanges, queues, routing keys, the retry ladder and the dead-letter queues |
| [`saga-transfer.md`](saga-transfer.md) | The transfer step by step, its two endings, and its six failure scenarios |
| [`examples/`](examples/) | Complete worked flows — happy path, rejection, compensation |

## Relationship to the domain model

**Which messages exist was decided by T-02.** The name, the producing service,
the consumers and the flow of the thirty-five original messages live in
[`../domain/message-catalog.md`](../domain/message-catalog.md), together with the
seven that T-05 added and recorded there as an extension. This directory does not
re-decide any of that; it decides how they are serialized.

## Relationship to the code

The executable contracts live in
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/),
and `catalog.md` and the worked examples are **generated from them**. The
catalogue generator currently lists only the original flows; it does not yet
include every later contract. T-46 uses the table in its runbook as its
additional message inventory.

```bash
pnpm --filter @bank/contracts build
pnpm --filter @bank/contracts schema:emit    # JSON Schema, one file per contract
pnpm --filter @bank/contracts docs:catalog   # regenerates catalog.md
pnpm --filter @bank/contracts docs:examples  # regenerates the worked flows
```

A document that cannot drift from the code is worth more than one that reads
better, so the field tables are derived and only the reasoning is written by hand.

## What is not here

Runbooks, the local stack and the broker's own configuration are
[`../operations/`](../operations/README.md) and **T-06**. The formal UML sequence
diagram of the Saga is **T-13**; the state diagram in `saga-transfer.md` is its
input, not its replacement.
