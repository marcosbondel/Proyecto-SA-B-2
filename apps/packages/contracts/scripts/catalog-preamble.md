# Message catalogue

The payload of every message the system can put on the broker. Forty-eight contracts: the
thirty-five [`../domain/message-catalog.md`](../domain/message-catalog.md) fixed, plus the
thirteen recorded there as an extension.

**The executable definition is the code.** Each entry links to its contract in
[`../../apps/packages/contracts/src/events/`](../../apps/packages/contracts/src/events/), and
the field tables below are generated from those contracts so the two cannot drift. Regenerate
the machine-readable form with `pnpm --filter @bank/contracts schema:emit`.

## Rules that hold for every message

Stated once here instead of forty-eight times below.

**Envelope.** Every payload travels inside the envelope described in
[`envelope.md`](envelope.md). Field tables below describe the `payload` only.

**Routing.** The routing key **is** the message name, version suffix included. The exchange
follows from the category: commands and requests on `bank.commands`, events on `bank.events`,
replies on `bank.replies`. See [`topology.md`](topology.md).

**Idempotency.** Every consumer recognises a redelivery through the envelope's
`idempotencyKey` and produces at most one domain effect per intention. Where a message names a
different key, the entry says so.

**Compatibility.** Inside `v1` only optional fields may be added. Removing a field, renaming
one, narrowing a type or making an optional field required requires `v2`, and the producer
publishes both until every consumer has moved. Consumers tolerate fields they do not know.

**Validation.** The envelope and the payload are validated before any domain logic runs. An
unknown name, an unsupported version or a non-conforming payload is refused and dead-lettered
without a retry — retrying a malformed message never repairs it.

**Error vocabulary.** Failure reasons are drawn from a closed set, mirroring the expected
failures of [`../domain/entities.md`](../domain/entities.md). No free text, no internal
messages, nothing that reveals whether an account or an email exists.

