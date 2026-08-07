---
description: Approve a phase gate on a spec. The engineer's control point — agents propose, humans approve.
argument-hint: <spec id> <spec|plan|tasks|verify|review>
allowed-tools: Bash(./scripts/agent-checks/spec-state.sh:*)
---

Approve a gate on spec: **$ARGUMENTS**

## Before approving

This command exists because the human is the one deciding. Do not run it on
your own initiative, and do not run it to unblock yourself.

Show the human what they are approving first — the artifact produced for this
phase, and specifically:

| Gate | What must be judged |
| --- | --- |
| `spec` | The open questions and assumptions. Approving means accepting those bets. |
| `plan` | The approach and the rejected alternative. Approving means the shape is right. |
| `tasks` | Coverage — every acceptance criterion reached by some task. This gate unblocks code. |
| `verify` | The evidence, and what `qa` could not check. Approving means accepting the residual risk. |
| `review` | The findings ranked as taste rather than blocking. |

## Approve

```sh
./scripts/agent-checks/spec-state.sh approve $ARGUMENTS
```

If the gate genuinely does not apply — a `refactor` spec with no user-facing
behaviour to review, say — waive it with a reason rather than approving a check
that never happened:

```sh
./scripts/agent-checks/spec-state.sh waive <id> <gate> <why>
```

A waiver is visible forever in `state.yaml` and in `/spec-status`. That is the
point: a skipped check should leave a mark.

## Then

Report the new state and name the next command in the chain.
