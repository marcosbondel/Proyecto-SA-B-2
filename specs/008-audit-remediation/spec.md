# Feature Specification: Audit Remediation

**Feature Branch**: `feature/008-audit-remediation-fix`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "trabajemos TODO lo que menciona el artefacto https://claude.ai/code/artifact/22465309-366e-4dc6-bf54-086469c48a8d"

## Context

A full-repository audit of Bank USAC (seven applications, three shared packages,
infrastructure and documentation) was run against the project statement
(`docs/references/780_Proyecto_1_2S2026.pdf`). It produced **9 critical**, **33
important**, and **40+ minor** findings. The system already avoids the three
largest rubric penalties (100% asynchronous messaging, one real database per
service, no disguised monolith), but it fails the single most severe penalty
(no Kubernetes deployment) and carries real money-integrity, access-control, and
audit-durability defects.

This feature is the remediation of **all** findings the audit surfaced. Each
requirement below traces to a finding. The audit report is the source of truth
for evidence (path:line references live there); this spec states the corrected
behavior each finding demands.

## Constitution Alignment

The repository constitution (`.specify/memory/constitution.md`, v1.0.0) has eight
non-negotiable principles. This remediation is required to satisfy the ones it
currently violates or under-serves, and must not regress the ones already met:

- **Principle VII (Local Kubernetes Deployment)** — currently **non-conforming**;
  no manifests exist. This feature must bring it into conformance (US1).
- **Principle VI (Saga With Compensation)** — currently **at risk**; compensation
  can be permanently lost. This feature must guarantee compensation delivery (US3).
- **Principle VIII (SRE From Design)** — currently **at risk**; idempotency and
  audit durability have gaps. This feature must close them (US3, US5).
- **Principles I–V** — currently **conforming** (exactly five services, one DB
  per service, DBs outside the cluster, async-only, gateway-only entry). This
  feature MUST NOT regress any of them; in particular, the Kubernetes work of US1
  MUST keep every database outside the cluster (Principle III).

## Visual Design Reference

This feature includes frontend changes (US6: exposing identity validation and
command-outcome visibility). Those changes MUST follow the Claude Design
reference recorded in `docs/DESIGN.md` (`bonking.dc.html` and the imported
`support.js`). Specifically:

- The **identity validation queue and detail** screens
  (`/clientes/validaciones` and `/clientes/validaciones/[id]`) already exist as
  built-but-disabled UI; enabling them MUST preserve their current layout,
  states, and component vocabulary, only wiring the actions and adding the
  loading/success/failure states the DESIGN reference prescribes for an
  asynchronous command.
- The **command-outcome** surfaces (registration confirmation, account opening)
  MUST render the pending/confirmed/failed states already used by the transfer
  timeline, applied consistently for non-administrator roles.
- No new visual language is introduced; deviations, if any, MUST be recorded as
  intentional in the feature's design notes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The system deploys and runs on local Kubernetes (Priority: P1)

An evaluator deploys the whole system to a local Kubernetes cluster (kind) from
the repository's own configuration, and exercises a bank transfer end to end
against the running cluster.

**Why this priority**: This is the single most severe rubric penalty (100%) and
a stated requirement to qualify for grading. It is also a constitution violation
(Principle VII). Nothing else in the audit outweighs it.

**Independent Test**: From a clean checkout, follow the documented steps to bring
up a kind cluster and deploy all seven components; confirm every pod reaches
readiness, the databases and broker remain outside the cluster, and a transfer
completes end to end through the deployed Gateway.

**Acceptance Scenarios**:

1. **Given** a machine with kind and the repository, **When** the evaluator runs
   the documented deployment, **Then** all seven components (five services,
   Gateway, frontend) are deployed as Kubernetes workloads and reach readiness.
2. **Given** the deployed cluster, **When** the evaluator inspects where data
   lives, **Then** the five PostgreSQL databases, the RabbitMQ broker, and the
   object store run **outside** the cluster and the cluster reaches them as
   external dependencies.
3. **Given** the deployed cluster, **When** a client registers, opens accounts
   and transfers funds through the Gateway's external address, **Then** the Saga
   completes and balances reflect the transfer.
4. **Given** a briefly unavailable database, **When** liveness is probed, **Then**
   the affected pod is not restart-looped (readiness fails, liveness holds).

---

### User Story 2 - Grading deliverables are complete and consistent (Priority: P1)

An evaluator opens the documentation and finds every required deliverable
present, and every mandatory diagram complete and consistent with the code.

**Why this priority**: The user manual and the C4 context diagram are mandatory
deliverables whose absence/incompleteness is independently gradable, and
diagram/code inconsistency carries a 25% penalty.

**Independent Test**: Check the documentation set against the statement's §4.4
deliverable list and the mandatory-diagram list; confirm the user manual exists,
the C4 context diagram includes the API Gateway, the deployment diagram matches
the real Kubernetes artifacts, and no diagram references a path that does not
exist.

**Acceptance Scenarios**:

1. **Given** the documentation set, **When** the evaluator looks for a user
   manual, **Then** a user-facing manual exists covering how each role uses each
   functionality.
2. **Given** the C4 context diagram, **When** the evaluator inspects it, **Then**
   the API Gateway appears as the system's entry point, and interactions are
   labeled with technology, protocol, and synchronicity.
3. **Given** the deployment diagram, **When** the evaluator cross-checks it
   against the repository, **Then** every artifact it depicts (the Helm chart or
   manifest set) exists at the path shown.
4. **Given** the two source forms of each diagram (PlantUML and Mermaid), **When**
   compared, **Then** they agree; and the sequence diagrams carry the required
   technology/protocol labels.
5. **Given** the documentation index, **When** its own coverage check is run,
   **Then** it reports no uncovered set that it claims is empty, and a single
   integrator technical document maps each §4.4 deliverable to its file.

---

### User Story 3 - Money cannot be created, lost, or frozen under failure (Priority: P1)

Across broker failures, redeliveries, and concurrent messages, a transfer either
completes or compensates; it never leaves money debited without a matching credit
or refund, and never credits money twice.

**Why this priority**: These are the money-integrity critical findings. In a
banking simulation, silent creation or loss of funds is the most damaging class
of defect, and it directly threatens Saga-with-compensation (Principle VI).

**Independent Test**: Inject a broker publish failure in the window between a
committed state change and its outbound event, for both the compensation path
(Transaction) and the terminal payment event (Payment); confirm the operation is
eventually retried and the Saga reaches a terminal state with correct balances.
Separately, deliver a duplicate success event and confirm only one credit occurs.

**Acceptance Scenarios**:

1. **Given** a payment that must compensate, **When** the compensation event
   fails to publish after the state was committed, **Then** the compensation is
   eventually re-attempted and the debited funds are refunded — the transfer does
   not stay frozen in `PAYMENT_PENDING`.
2. **Given** a payment whose terminal event fails to publish, **When** the command
   is redelivered, **Then** the terminal event is eventually delivered and the
   Saga closes — the outcome is not ACKed away and lost.
3. **Given** two `payment succeeded` messages with distinct message ids for the
   same transfer, **When** both are processed, **Then** exactly one credit is
   applied to the destination account.
4. **Given** a compensation for a transfer that was never debited, **When** it is
   processed, **Then** no credit is applied and the anomaly is recorded rather
   than silently crediting funds.
5. **Given** a duplicate movement command for the same transfer and movement type,
   **When** processed, **Then** the balance moves at most once, enforced by the
   service that owns the balance, not by an upstream service's behavior.

---

### User Story 4 - A user can only act within their own authority (Priority: P1)

A client can update only their own record; no message path can create a
privileged account; concurrent updates do not silently overwrite each other.

**Why this priority**: The customer-update authorization gap is an IDOR
confirmed by two independent auditors and demonstrable through the UI as shipped;
it is the most exploitable finding. Role-escalation via the broker and the
lost-update race compound it.

**Independent Test**: As a client, attempt to update another client's record by
its identifier and confirm refusal; submit a register command with an elevated
role directly and confirm refusal; issue two concurrent updates to one record and
confirm neither field is lost.

**Acceptance Scenarios**:

1. **Given** an authenticated client, **When** they attempt to update a different
   client's data, **Then** the owning service refuses it (the decision is made by
   the service that owns the data, using the caller identity carried in the
   message).
2. **Given** a register command carrying an elevated role, **When** it reaches
   the owning service, **Then** the service rejects the role rather than trusting
   the upstream check alone.
3. **Given** two concurrent updates to the same customer, **When** both commit,
   **Then** the later write does not revert the earlier field, and no event
   announces a change that did not persist.
4. **Given** a name or document consisting only of whitespace, **When** submitted,
   **Then** it is rejected rather than stored as an empty value that blocks later
   registrations.

---

### User Story 5 - The audit trail keeps what the system could not process (Priority: P2)

Every message that fails to parse or process is retained as evidence — recorded
as invalid or routed to a durable error store — never silently discarded.

**Why this priority**: The audit service's central promise is to record what
happened, including failures. The unbound error exchange and the un-recorded
malformed envelope defeat that promise system-wide, but they do not directly move
money, so they rank below the P1 integrity work.

**Independent Test**: Publish a malformed envelope and a message that exhausts its
retry ladder; confirm both end up retained (recorded as invalid and/or in a bound
error queue that is consumed), and none vanish.

**Acceptance Scenarios**:

1. **Given** a message that exhausts its retry ladder, **When** it is parked,
   **Then** it lands in a durable, bound error queue that is consumed, not in an
   exchange with no bindings that discards it.
2. **Given** a malformed envelope reaching the audit service, **When** it cannot
   be parsed, **Then** it is recorded as `INVALID` rather than parked or lost.
3. **Given** an envelope that passes a lax shape check but violates the full
   contract, **When** it reaches the audit insert, **Then** it is classified and
   retained instead of crashing the insert and being retried into the void.

---

### User Story 6 - Every service function can be exercised from the interface (Priority: P2)

An evaluator can drive every named functionality of every microservice from the
UI, including identity validation, and can see the outcome of an asynchronous
command regardless of role.

**Why this priority**: The statement requires a UI to validate each service's
functionality. Identity validation is implemented in the service but unreachable,
and non-administrators can never see how a command ended — both make functionality
look absent during evaluation.

**Independent Test**: As a teller, open a pending identity validation and approve
or reject it, observing the account move to the expected state; as a client,
register and watch the confirmation resolve to a definitive outcome rather than a
perpetual pending.

**Acceptance Scenarios**:

1. **Given** a client who uploaded an identity document, **When** a teller opens
   the validation queue, **Then** the pending item is present and can be approved
   or rejected, and the verdict takes effect.
2. **Given** a non-administrator who submits a command accepted for processing,
   **When** the command resolves, **Then** the interface shows the definitive
   outcome (confirmed or failed), not an indefinite pending state.
3. **Given** a staff member looking at a customer, **When** they open the record,
   **Then** the current stored data is shown (a read path exists) rather than an
   empty form edited blind.

---

### User Story 7 - Public surface and delivery are hardened (Priority: P2)

The anonymous entry points resist abuse, activation tokens have a bounded
lifecycle, and a transient delivery failure does not permanently strand a signup.

**Why this priority**: These reduce real attack surface and delivery fragility
(brute force, unbounded object writes, unlimited live tokens, a dropped
activation email that blocks an account forever), but none corrupts stored money
or access, so they sit at P2.

**Independent Test**: Hammer the public login and registration endpoints and
confirm throttling; request activation repeatedly and confirm prior tokens are
invalidated; simulate a transient delivery failure and confirm the notification
is retried until it succeeds.

**Acceptance Scenarios**:

1. **Given** repeated requests to a public endpoint, **When** a threshold is
   exceeded, **Then** further requests are rate-limited.
2. **Given** an anonymous registration that is later rejected, **When** the object
   store is inspected, **Then** an unbounded number of orphaned uploads cannot
   accumulate from unauthenticated callers.
3. **Given** a new activation token issued for a customer, **When** it is created,
   **Then** previously issued live tokens for that customer are invalidated.
4. **Given** a transient failure of the delivery channel, **When** it recovers,
   **Then** the pending activation notification is retried and eventually
   delivered rather than left failed forever.
5. **Given** a production-style deployment, **When** its configuration is applied,
   **Then** activation links are not revealed in logs by default.

---

### User Story 8 - Infrastructure and configuration are safe and reproducible (Priority: P3)

A clean checkout brings the local stack up with derived, consistent
configuration, and no plaintext credential in a versioned file silently overrides
the developer's own.

**Why this priority**: These break the new-clone experience and version a weak
secret, but the running system's correctness does not depend on them once
configured, so they are P3.

**Independent Test**: From a clean checkout, follow the documented local-run steps
and confirm the ports and credentials the scripts generate match the ports the
stack actually publishes, with no manual correction.

**Acceptance Scenarios**:

1. **Given** the example environment file, **When** it is copied per the docs,
   **Then** the ports it declares match the ports the stack actually publishes.
2. **Given** the host-env generation script, **When** it runs, **Then** it derives
   ports from the single source of truth rather than hardcoding them.
3. **Given** the broker definitions, **When** the broker starts, **Then** it does
   not import a plaintext credential that overrides the developer's configured
   password and silently breaks authentication.
4. **Given** the environment-parsing scripts, **When** they read the env file,
   **Then** they do not evaluate its contents as code.

---

### User Story 9 - Scheduled work runs reliably (Priority: P3)

The automatic account-deactivation process runs dependably, including immediately
after a restart, and concurrent sweepers do not duplicate work.

**Why this priority**: The deactivation job is a stated requirement, and a
frequently restarted pod could currently never run it; but it affects a
maintenance function, not live transaction integrity, so it is P3.

**Independent Test**: Restart the service on an interval shorter than the job
interval and confirm the job still executes (runs at startup and/or catches up);
run two sweepers and confirm no row is processed twice.

**Acceptance Scenarios**:

1. **Given** a service that restarts more often than the job interval, **When** it
   starts, **Then** the deactivation job still runs (at startup and/or via
   catch-up) rather than never firing.
2. **Given** two concurrent retry sweepers, **When** they run, **Then** a due row
   is claimed by exactly one of them.
3. **Given** a manual deactivation carrying a reason, **When** it is applied,
   **Then** the reason is persisted and appears in the audit trail rather than
   being discarded.

---

### User Story 10 - Documentation and contracts stay consistent with the code (Priority: P3)

The published contract schemas, the documentation inventory, and the diagram
sources all match the implemented system.

**Why this priority**: These are consistency and maintenance defects that a
diligent evaluator may notice but that do not affect runtime behavior; they are
the lowest-risk tier.

**Independent Test**: Regenerate the exported schemas and confirm they match the
contract catalog count; run the documentation inventory check and confirm it is
truthful; confirm the ADR count and blocked-state notes match reality.

**Acceptance Scenarios**:

1. **Given** the exported contract schemas, **When** compared to the catalog,
   **Then** the counts match and a check prevents future drift.
2. **Given** the documentation inventory, **When** its coverage claim is checked,
   **Then** the claim is accurate.
3. **Given** the recorded decision count and blocked-state notes, **When**
   reviewed, **Then** they reflect the current state of the repository.

### Edge Cases

- What happens when the broker is unavailable at the exact moment between a
  committed state change and its outbound publish? (US3 — must be recoverable.)
- What happens when a database briefly disappears while Kubernetes probes
  liveness? (US1 — must not restart-loop.)
- What happens when the same activation link is opened twice concurrently?
  (Existing behavior: activates once — must be preserved.)
- What happens when a client guesses another client's identifier and the
  identifier is shown in the UI after registration? (US4 — must be refused.)
- What happens when identity validation is approved and rejected concurrently?
  (US4/US6 — the terminal verdict must be honored exactly once.)
- What happens when a payment is ordered twice for the same transfer with distinct
  identifiers? (US3 — must not double-charge or crash into the dead-letter queue.)

## Requirements *(mandatory)*

### Functional Requirements

**Deployment & deliverables (US1, US2)**

- **FR-001**: The repository MUST provide Kubernetes deployment artifacts that
  deploy all seven components to a local cluster; nothing deployable may be
  deferred to a future ticket.
- **FR-002**: The Kubernetes deployment MUST keep all five databases, the broker,
  and the object store outside the cluster, reached as external dependencies.
- **FR-003**: A user manual MUST exist, covering how each of the three roles uses
  each functionality.
- **FR-004**: The C4 context diagram MUST include the API Gateway as the entry
  point and label interactions with technology, protocol, and synchronicity.
- **FR-005**: Every diagram MUST reference only artifacts that exist in the
  repository, and the two source forms (PlantUML, Mermaid) of each diagram MUST
  agree; sequence diagrams MUST carry the required labels.
- **FR-006**: A single integrator technical document MUST map each §4.4
  deliverable to its location.

**Money integrity (US3)**

- **FR-007**: A committed state change that requires an outbound event MUST NOT be
  able to lose that event to a broker failure; the event MUST be delivered
  eventually (e.g., via an outbox or a durable sweep), for both the Saga
  compensation and the terminal payment outcome.
- **FR-008**: Processing the same logical success outcome more than once MUST
  result in at most one credit to the destination account.
- **FR-009**: A compensation MUST verify that the corresponding debit exists
  before crediting; a compensation for a never-debited transfer MUST NOT create
  funds and MUST be recorded as an anomaly.
- **FR-010**: No-duplication of balance movements MUST be enforced by the service
  that owns the balance, keyed on the transfer/movement identity, not solely by an
  upstream service's refusal to re-publish.

**Access control (US4)**

- **FR-011**: The service that owns customer data MUST authorize updates using the
  caller identity carried in the message, refusing a client's attempt to modify
  another customer.
- **FR-012**: The service that owns customer data MUST validate the requested role
  on registration, rejecting an elevated role even if the upstream check was
  bypassed.
- **FR-013**: Concurrent updates to the same customer MUST NOT silently overwrite
  each other, and no event may announce a change that did not persist.
- **FR-014**: Names and documents that are empty after trimming MUST be rejected
  rather than stored.

**Audit durability (US5)**

- **FR-015**: The error/parking path MUST route to a durable, bound queue that is
  consumed; no message may be published to an exchange that discards it for lack
  of bindings.
- **FR-016**: A message the audit service cannot parse or that violates its
  contract MUST be recorded as `INVALID` (retained), not parked or crashed into
  retries.
- **FR-017**: The envelope shape check used before persistence MUST be as strict
  as the full envelope contract for the fields it persists.

**Functional coverage from the UI (US6)**

- **FR-018**: Identity validation MUST be reachable from the UI end to end: a
  teller can approve or reject a pending validation and the verdict takes effect.
- **FR-019**: A non-administrator MUST be able to see the definitive outcome of an
  asynchronous command they submitted.
- **FR-020**: A staff member MUST be able to read a customer's current stored data
  before editing it.

**Public-surface & delivery hardening (US7)**

- **FR-021**: Public endpoints MUST be rate-limited.
- **FR-022**: Unauthenticated callers MUST NOT be able to accumulate unbounded
  orphaned uploads in the object store.
- **FR-023**: Issuing a new activation token MUST invalidate previously issued live
  tokens for that customer.
- **FR-024**: A transient delivery failure MUST be retried until the notification
  is delivered; a signup MUST NOT be permanently stranded by one failed send.
- **FR-025**: Production-style configuration MUST NOT reveal activation links in
  logs by default.

**Infrastructure & configuration (US8)**

- **FR-026**: The example environment file MUST declare the ports the stack
  actually publishes.
- **FR-027**: Configuration-generation scripts MUST derive values from the single
  source of truth rather than hardcoding them.
- **FR-028**: The broker MUST NOT import a versioned plaintext credential that
  overrides the developer's configured credential.
- **FR-029**: Environment-parsing scripts MUST NOT evaluate env-file contents as
  code.

**Scheduled work (US9)**

- **FR-030**: The automatic deactivation job MUST run dependably even when the
  service restarts more frequently than the job interval (run at startup and/or
  catch up missed runs).
- **FR-031**: Concurrent retry sweepers MUST claim each due row exactly once.
- **FR-032**: A manual deactivation's reason MUST be persisted and surfaced in the
  audit trail.

**Documentation & contract consistency (US10)**

- **FR-033**: The exported contract schemas MUST match the contract catalog, and a
  check MUST prevent future drift.
- **FR-034**: The documentation inventory's coverage claims MUST be accurate.
- **FR-035**: Recorded decision counts and blocked-state notes MUST reflect the
  current repository state.

### Non-Functional Requirements

- **NFR-001**: No remediation may regress the currently-passing rubric guarantees:
  communication between services stays 100% asynchronous, each service keeps its
  own database, and no synchronous inter-service call or cross-database access is
  introduced.
- **NFR-002**: The money-integrity guarantees (FR-007–FR-010) MUST be covered by
  automated tests that exercise the real persistence layer, including for the
  Payment service, which currently has no integration tests.
- **NFR-003**: Every change MUST keep the existing executable isolation tests and
  lint architecture rules passing.

### Key Entities

- **Kubernetes deployment set**: The manifests/chart, external-dependency
  bindings, and cluster configuration that deploy the seven components locally.
- **Outbox / durable event record**: The persisted intent-to-publish that makes a
  committed state change's outbound event recoverable after a broker failure.
- **Bound error queue**: The durable, consumed destination for parked and
  retry-exhausted messages.
- **Caller identity (in the message envelope)**: The authenticated actor's role
  and identifier, carried to the owning service so it can authorize domain
  decisions.
- **Activation token lifecycle**: The set of a customer's live activation tokens
  and the rule that issuing one invalidates the rest.
- **User manual**: The role-by-functionality user-facing documentation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the audit's critical findings (9) are resolved, verified by
  the acceptance scenarios of US1–US5.
- **SC-002**: The system deploys to a local Kubernetes cluster and completes a
  full transfer end to end, with 100% of the seven components reaching readiness
  and 0 databases inside the cluster.
- **SC-003**: Under an injected broker failure at the commit/publish boundary,
  100% of transfers reach a terminal state (completed or fully compensated) with
  correct balances; 0 transfers remain frozen.
- **SC-004**: A duplicate success outcome produces exactly 1 credit in 100% of
  trials; a compensation for a never-debited transfer produces 0 credits.
- **SC-005**: A client attempting to modify another client's data is refused in
  100% of attempts, and no privileged account can be created through a message
  path.
- **SC-006**: 0 messages that fail to parse or process are lost; 100% are retained
  as invalid or in a bound, consumed error queue.
- **SC-007**: Every named functionality of every microservice can be exercised
  from the UI, including identity validation, verified by a walkthrough with a
  non-administrator and a teller.
- **SC-008**: All required §4.4 deliverables are present (user manual included),
  every mandatory diagram is complete and consistent with the code, and 0 diagrams
  reference a nonexistent path.
- **SC-009**: A clean checkout brings up the local stack with 0 manual
  configuration corrections needed, and no plaintext credential overrides the
  developer's own.
- **SC-010**: The full test suite, the executable isolation tests, and the lint
  architecture rules all pass, with new automated coverage for the money-integrity
  guarantees including the Payment persistence layer.

## Assumptions

- **Scope is remediation, not redesign.** The five-service boundary, the event
  contracts, and the layered architecture stay as they are; this feature fixes
  defects and fills gaps within that design.
- **kind is the local Kubernetes target**, consistent with the recorded decision
  (ADR-007). minikube or k3d would also satisfy the statement, but the existing
  image-loading tooling already targets kind.
- **The outbox pattern (or an equivalent durable sweep) is the intended mechanism**
  for FR-007; the exact mechanism is a planning decision, but "deduplicate before
  publish with no recovery" is explicitly out of bounds because it is the root of
  the two money-integrity criticals.
- **The caller identity already travels in the message envelope**, so closing the
  customer-update authorization gap (FR-011) does not require a contract change.
- **The earlier session/guest-route fixes** made on `feature/onboarding-and-ui-fixes`
  are a separate concern from this remediation; this branch is cut from
  `develop` and does not depend on them.
- **This is a large feature by design** ("trabajemos TODO"). It is expected to be
  planned as multiple sequenced slices (P1 first: deployment, deliverables, money
  integrity, access control), and may be split into several tickets during
  planning; the priorities above define that sequence.
- **Grading deliverables (US2) and infrastructure hygiene (US8)** assume the
  statement's §4.4 list and the audit report are the definition of "complete."
