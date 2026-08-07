---
description: Close a reviewed spec — promote what must outlive it into docs/, then archive it.
argument-hint: <spec id>
---

Close spec **$ARGUMENTS**.

## 1. Check the gate

```sh
./scripts/agent-checks/spec-state.sh advance $ARGUMENTS
```

Refuses unless `gate_review` is approved. Sets the phase to `done`.

## 2. Promote what outlives the spec

This is the step that keeps `docs/` true and stops it rotting into a museum.
The spec is about to be archived, so anything durable has to move out of it
first:

- **Behaviour that is now permanent** → the relevant doc under `docs/`. A spec
  describes a change; `docs/` describes the system as it stands.
- **Architectural decisions** → an ADR in `docs/design-docs/`, and
  `ARCHITECTURE.md` updated in this same change. A layering rule that lives
  only in a closed spec will be violated within a week.
- **Deferred work**, from the spec's Carried Debt and from anything `reviewer`
  labelled taste → `docs/TECH_DEBT.md`, each row citing this spec number.
- **Product behaviour that changed** → update the docs the change made stale.
  Not doing this in the same change is how documentation drift starts.

Also update anything the spec invalidated: `AGENTS.md` if the workflow changed,
`docs/AI_PROJECT_SKILLS.md` if the stack now justifies a skill that was
deferred.

## 3. Archive

```sh
mkdir -p specs/archive
git mv specs/<NNN>-<slug> specs/archive/<NNN>-<slug>
```

The number is never reused. It stays the traceability key linking the archived
spec to its ADRs, its commits, and its tech-debt rows.

## 4. Report back

The docs updated, the debt recorded, the ADRs linked, and the archive path.
State plainly anything the spec promised and did not deliver — a closed spec
with a silently dropped acceptance criterion is worse than an open one.
