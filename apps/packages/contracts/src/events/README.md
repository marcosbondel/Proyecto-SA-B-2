# @bank/contracts / events

The contracts for the domain events and for the transfer Saga belong here: one
file per event, versioned in its name (`account.opened.v1`), each one a payload
that travels inside the shared `MessageEnvelope`.

Events are the only interface between services (constitution IV), so this
directory is the seam the whole system leans on. It stays empty until the
events are actually designed — an invented event contract is worse than a
missing one, because five services would build against it.

> **Blocked**: The domain and Saga event contracts are not designed yet. Owner: Marcos Bonifasi. Arrives with: T-05.
