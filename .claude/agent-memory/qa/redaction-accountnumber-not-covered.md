---
name: redaction-accountnumber-not-covered
description: notification-audit-service's redaction deny-list has no token matching account/iban/cuenta — a field literally named accountNumber would leak to disk unredacted
metadata:
  type: project
---

`apps/services/notification-audit-service/src/domain/redaction.ts`'s
`SENSITIVE` regex is a deny-list by field name:
`credential|password|token|secret|digest|hash|email|document|dpi|fullname|
firstname|lastname|surname|address|phone|birth|amount|balance|recipient|
photo|objectkey|username`. Nothing in it matches `account`, `iban`, or
`cuenta`/`numeroCuenta`.

Today this is latent, not exploited: every contract in `@bank/contracts`
addresses an account only by the UUID `accountId` (grepped the whole
catalogue, 2026-09-25 — no field named `accountNumber`/`iban`/`cuenta`
anywhere), and a UUID is not sensitive. But the rule is explicitly a blunt,
name-based deny-list by design (see the file's own header comment), and this
service is the one database in the bank that hears every event and is meant
to store nothing personal or financial (§8.2, 2.3). If any future producer
adds a field literally named `accountNumber` (or `iban`/`cuenta`), it would
be written to `audit_events.payload` verbatim.

**Proven, not just reasoned about:** a real-Postgres test in
`apps/services/notification-audit-service/test/repository.integration.spec.ts`
(`privacy: what actually reaches disk › [KNOWN DEFECT] does not currently
redact a field named accountNumber`) seeds an event with an `accountNumber`
field through `repository.record()` and asserts
`SELECT 1 FROM audit_events WHERE payload::text LIKE '%<value>%'` returns
zero rows. It returns one — the value is on disk. That test is left **red on
purpose**; QA does not own `src/` and must not weaken a test to hide a real
finding.

**Why this matters:** the same pattern (regex covers today's known field
names, not the concept) is how `dpi`/`document`/`credential` got covered in
the first place — someone had to name them. `account`/`iban`/`cuenta` were
never named.

**How to apply:** report to the implementing role (`backend`) as a one-line
fix candidate — add `account|iban|cuenta` (or similar) to the `SENSITIVE`
regex in `redaction.ts` — but do not make that change from a QA/verify
session. Once fixed, this test should be re-verified (it should then pass
without being touched) rather than rewritten.
