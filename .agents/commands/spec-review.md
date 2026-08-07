---
description: Run reviewer and security in parallel against the diff, judged on both standards and the originating spec.
argument-hint: <spec id>
---

Review spec **$ARGUMENTS**.

## 1. Check the gate

```sh
./scripts/agent-checks/spec-state.sh advance $ARGUMENTS
```

Refuses unless `gate_verify` is approved. Reviewing unverified work wastes the
reviewer on defects a test run would have caught.

## 2. Fan out

Invoke `reviewer` and `security` **in parallel**. Both are read-only by design;
neither can fix what it finds, which is what keeps findings written down instead
of quietly patched.

Give each of them:

- The diff range — the branch, or the commit the spec started from.
- The spec path and its acceptance criteria.
- `evidence.md`, so they can see what was actually verified.

`reviewer` judges two axes: does the diff follow this repository's documented
standards, and does it do what `spec.md` asked — including the parts quietly
skipped. `security` only matters when the change touches auth, permissions,
user input, uploads, secrets, or tenant boundaries; skip it otherwise and say
you skipped it.

## 3. Synthesise

The subagents do not talk to each other — you are the message bus. Merge the
two reports, drop duplicates, and split findings into what blocks a merge and
what is taste. Present them ordered by severity, each with its failure
scenario.

If a finding blocks, hand it back to the implementing role and return to
`/spec-build`. Do not approve past it.

## 4. Report back

When it is clean:

```
/spec-approve $ARGUMENTS review
/spec-close $ARGUMENTS
```
