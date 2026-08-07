---
description: Show every spec, its phase, its gates, and what the factory is waiting on.
allowed-tools: Bash(./scripts/agent-checks/spec-state.sh:*), Bash(sh scripts/agent-checks/validate-spec-structure.sh:*)
---

## State

```sh
./scripts/agent-checks/spec-state.sh list
```

## Structural health

```sh
sh scripts/agent-checks/validate-spec-structure.sh
```

## Report

Summarise, for each active spec:

- Where it stands, and **who it is waiting on** — a human approving a gate, or
  an agent producing the next artifact. This is the number that matters: a spec
  waiting on a human is not the same problem as a spec waiting on work.
- Any spec whose phase outran its gate, or whose artifacts do not match its
  phase.
- Any spec that has not moved and has an unanswered open question in `spec.md`.

End with the single next command to run.
