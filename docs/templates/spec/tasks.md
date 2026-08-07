# Tasks NNN: Title

Spec: ./spec.md
Plan: ./plan.md

> The executable checklist. One task is the smallest unit that carries its own
> test cycle and is worth a fresh reviewer's gate. No task should touch more
> than about five files.

## Legend

- **Role** — which agent owns it: `backend`, `frontend`, `mobile`, `qa`,
  `infra-aws`, `architect`.
- **Depends** — task IDs that must land first. Blank means it can start now.
- **AC** — which acceptance criteria this task advances.

## Task List

- [ ] **T-01** — Description
  - Role: `backend`
  - Depends: —
  - AC: AC-01
  - Files: `path/to/file`
  - Acceptance: what must be true when this task is done
  - Verify: the exact command, and what its output must show

- [ ] **T-02** — Description
  - Role: `frontend`
  - Depends: T-01
  - AC: AC-02
  - Files: `path/to/file`
  - Acceptance:
  - Verify:

## Parallel Batches

Tasks with no dependency between them and disjoint file sets. The orchestrator
runs a batch in parallel worktrees.

| Batch | Tasks | Roles |
| --- | --- | --- |
| 1 |  |  |

## Carried Debt

Anything deliberately deferred while working these tasks. Moved to
`docs/TECH_DEBT.md` at `/spec-close`.

- Item → why deferred
