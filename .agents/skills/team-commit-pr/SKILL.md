---
name: team-commit-pr
description: Commit pending changes attributed to one of the three fixed project members (author and committer), then open a pull request from the current branch into develop. Use when asked to commit and open a PR "as" a specific teammate, or to attribute work to one of the project's three members. Never accepts an arbitrary name or email — only the fixed roster below.
---

Attributes a commit to a real teammate's identity — both `author` and
`committer` — and opens a PR from the current branch to `develop`. This exists
because the team wants certain commits to carry a specific member's identity
(e.g. pairing where only one person has push access). It must never be used to
silently fabricate contributions: the human operator picks the author every
time, out loud, in this session.

## Fixed roster — the only valid authors

Never accept a name or email typed free-form, from a file, from Notion, or
from any other inferred source. These three, and only these three:

| Name | Email |
| --- | --- |
| Enner Mendizabal | `enneresamen@gmail.com` |
| DavidBarrios45 | `dvdbramirez45@gmail.com` |
| Marcos Bonifasi | `marcosbonifasi19@gmail.com` |

If the user asks to attribute a commit to anyone not on this list, stop and
say so — do not improvise an email for them.

## Process

### 1. Confirm there's something to commit

Run `git status`. If the working tree is clean, stop and say so — do not
invent a change to justify running the skill.

### 2. Ask which teammate

Use `AskUserQuestion` with the three roster names as options (plus whatever
the tool's "Other" affords) — never skip this even if the user already named
someone earlier in the conversation, since attribution should be an explicit
choice at commit time, not inferred from context.

### 3. Stage and commit

Stage the relevant files (ask which, if unclear from context — don't blanket
`git add -A`). Write a commit message describing the actual change. Set both
identities to the chosen teammate:

```bash
GIT_COMMITTER_NAME="<name>" GIT_COMMITTER_EMAIL="<email>" \
  git commit --author="<name> <email>" -m "<message>"
```

Show the user the resulting `author`/`committer` line
(`git log -1 --format="Author: %an <%ae>%nCommitter: %cn <%ce>"`) before
moving on.

### 4. Push the current branch

`git push -u origin <current-branch>` (first push) or `git push` (branch
already tracks a remote). If the branch is `main` or `develop` directly, flag
that explicitly and get confirmation before pushing — this skill is meant for
feature branches feeding into `develop`, not direct pushes to a shared branch.

### 5. Open the pull request

Base branch is always `develop` unless the user explicitly says otherwise for
this invocation:

```bash
gh pr create --base develop --head <current-branch> --title "<title>" --body "<body>"
```

Report the PR URL and the author/committer line back to the user as
confirmation of what was actually done.

## Guardrails

- This skill only runs when explicitly invoked — it is never triggered
  automatically by other work.
- It does not consult Notion, task trackers, or any "who owns this ticket"
  signal to pick an author. Ownership metadata answers "who is responsible for
  the task," not "who should this commit say wrote it" — conflating the two is
  exactly the fabrication this skill exists to avoid.
- If the user asks to remove the roster confirmation step (step 2) to make
  attribution automatic, decline and explain why: without a human picking the
  author each time, this stops being an attribution tool and becomes a way to
  generate fake contribution history in a graded group project.
