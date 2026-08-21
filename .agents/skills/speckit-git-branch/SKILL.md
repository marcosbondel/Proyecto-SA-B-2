---
name: "speckit-git-branch"
description: "Create or switch to the feature branch for a Spec Kit feature, following this repository's one-branch-per-ticket convention."
argument-hint: "Ticket id (T-05) or the feature description"
compatibility: "Requires spec-kit project structure with .specify/ directory and a git repository"
metadata:
  author: "bank-usac"
  source: "repository-local; not part of upstream Spec Kit"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

## What this does

Creates the git branch for a feature, or switches to it if it already exists.
It runs as the `before_specify` hook of `/speckit-specify`, and can also be
invoked on its own before starting work on a ticket.

Spec Kit does not do this itself: `create-new-feature.sh` computes a branch
name, creates the spec directory, and never touches git.

## The convention this follows

Recorded in `AGENTS.md`: **every ticket gets its own branch**, named
`feature/T-XX`, cut from the latest `origin/develop`, and every commit for that
ticket stays on it.

**The ticket number and the spec number are different sequences.** Spec `004` is
ticket T-03; spec `003` is ticket T-02. Never derive one from the other.

## Steps

1. Determine the ticket id:
   - Use it if the user named one (`T-05`), or if the feature description
     contains one.
   - If the user gave an exact branch name, use that verbatim and skip the rest.
   - If there is no ticket, let the script fall back to Spec Kit's numbering.
2. Run, from the repository root:

   ```bash
   .specify/scripts/bash/create-feature-branch.sh --json --ticket <TICKET> "<description>"
   ```

   Omit `--ticket` when there is none. Use `--branch-name <name>` for an exact
   name, `--base <branch>` for a different start point.
3. Read the JSON it prints: `BRANCH_NAME`, `BASE_BRANCH`, `ACTION`, `NOTE`.
4. Report the outcome by `ACTION`:
   - `created` / `switched` — say which branch and from where.
   - `already-on-branch` — say so; nothing happened.
   - `skipped` — say **why** (`NOTE`) and what the user must do. Do not retry,
     do not stash on their behalf, do not force anything.
   - `failed` — report the failure verbatim. Do not work around it.

## What this never does

- No `push`, no `merge`, no `rebase`, no `reset`, no branch deletion.
- No stashing or discarding of the user's uncommitted work.
- Never blocks the spec from being written. A missing repository or a failed
  branch creation is reported and the workflow continues.

## Maintenance

This skill is **repository-local**. `specify integration upgrade` does not know
about it and will not overwrite it, unlike the ten upstream `speckit-*`
workflows. Its symlinks follow the same layout as those, described in
`AGENTS.md`:

```
.agents/skills/speckit-git-branch/SKILL.md      ← the only real file
  ├── .claude/skills/speckit-git-branch         → symlink to the directory
  └── .opencode/commands/speckit.git.branch.md  → symlink to the SKILL.md
```
