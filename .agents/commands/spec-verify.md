---
description: Run qa against every acceptance criterion and record the real command output in evidence.md.
argument-hint: <spec id>
---

Verify spec **$ARGUMENTS**.

## 1. Advance

```sh
./scripts/agent-checks/spec-state.sh advance $ARGUMENTS
```

`verify` has no entry gate — verification is never something you need
permission to do.

## 2. Delegate to qa

Invoke the `qa` agent with `spec.md`, `tasks.md`, the branch and commit under
test, and the template at `docs/templates/spec/evidence.md`.

`qa` writes `evidence.md` and nothing else in that directory. Its contract:

- Every acceptance criterion walked one at a time, marked pass, fail, or not
  verifiable.
- The real command output pasted under each. Not "all green" — the output.
- Every edge case listed in `spec.md` checked.
- What could not be verified, and the residual risk that leaves.
- Missing tests written, not merely reported as missing.

## 3. Validate

```sh
sh scripts/agent-checks/validate-spec-structure.sh $ARGUMENTS
```

Catches evidence that references criteria the spec does not define, and
evidence with no pasted output at all.

## 4. Report back

The pass/fail table, every failure with its reproduction, and everything that
could not be checked. If anything failed, go back to `/spec-build` — do not
approve around it.

When it is clean:

```
/spec-approve $ARGUMENTS verify
```
