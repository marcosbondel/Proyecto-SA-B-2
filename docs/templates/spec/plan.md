# Plan NNN: Title

Status: Draft
Owner: TBD
Created: YYYY-MM-DD
Spec: ./spec.md

> The **how**. Written for someone with zero context who opens this file in a
> fresh session: absolute paths, exact commands, no "as discussed above".

## Approach

The technical shape of the solution in a paragraph. What gets built, where it
sits, and why this shape over the alternative.

## Architecture Impact

- Modules or layers touched:
- Dependency direction respected / changed:
- ADR required? If the change introduces new domain vocabulary or moves a
  boundary, `architect` writes one in `docs/design-docs/` and it is linked in
  `state.yaml` before this gate is approved.
- `ARCHITECTURE.md` update needed:

## File Structure

Which files are created or modified, and what each one is responsible for.
Decomposition decisions get locked in here, not during implementation.

| File | Responsibility | New? |
| --- | --- | --- |
|  |  |  |

## Steps

Ordered so the repository works after each one. A plan whose middle is a broken
build cannot be paused, reviewed, or resumed.

1. **Step** — files touched, verification command, owning role.

## Verification Strategy

How each acceptance criterion in `spec.md` will be proven. `qa` executes this
and records real output in `evidence.md`.

| AC | How it will be verified | Level |
| --- | --- | --- |
| AC-01 |  | unit / integration / e2e / manual |

## Parallelism

Which steps are independent and can run in separate worktrees, and which file
set each parallel role owns. Two agents editing one file is the fastest way to
lose work.

- Independent:
- Sequential, and why:

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
|  |  |  |

## Decision Log

| Date | Decision | Alternative rejected | Reason |
| --- | --- | --- | --- |
|  |  |  |  |
