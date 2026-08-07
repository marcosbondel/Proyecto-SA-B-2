---
description: Turn an approved spec into a technical plan, with an ADR first when the change introduces new vocabulary or moves a boundary.
argument-hint: <spec id>
---

Plan spec **$ARGUMENTS**.

## 1. Check the gate

```sh
./scripts/agent-checks/spec-state.sh advance $ARGUMENTS
```

This refuses unless `gate_spec` is approved, and moves the phase to `plan` when
it is. If it refuses, stop and tell the human which gate is missing. Do not
plan around an unapproved spec.

## 2. Architecture first, when it applies

Read `spec.md`. Invoke `architect` **before** `planner` if the spec:

- introduces business vocabulary the codebase does not already have,
- adds a module or crosses an existing layer,
- changes dependency direction or data ownership.

`architect` writes an ADR into `docs/design-docs/` and updates
`ARCHITECTURE.md`. Record the ADR path in the spec's `state.yaml`:

```sh
./scripts/agent-checks/spec-state.sh set $ARGUMENTS adrs docs/design-docs/<file>.md
```

Skip this when the spec fits cleanly inside boundaries that already exist. An
ADR for a change with no architectural consequence is noise.

## 3. Delegate the plan

Invoke `planner` with the spec path, the template at
`docs/templates/spec/plan.md`, the ADR path if one was written, and the current
state of `ARCHITECTURE.md`.

Every step must name its files and its verification command. Every acceptance
criterion in `spec.md` must appear in the plan's verification strategy — a
criterion no step verifies is a criterion that will not ship.

If `ARCHITECTURE.md` has not chosen a stack yet, the plan's first step is that
decision. It is not an assumption to make quietly.

## 4. Report back

Give the plan path, the step count, the parallelisable steps, and every
unsatisfied prerequisite. Then stop:

```
/spec-approve $ARGUMENTS plan
```
