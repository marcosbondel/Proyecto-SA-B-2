# The Crazy Template

Agent-first project scaffold inspired by OpenAI's "Harness engineering"
recommendations.

Engineers direct; agents implement, verify, and review. The workflow is
spec-driven and the gates are enforced by the harness, not by good intentions.

## Structure

- `AGENTS.md`: short operational map for agents.
- `ARCHITECTURE.md`: top-level technical map.
- `specs/`: the work — one directory per spec, archived when it ships.
- `docs/`: the knowledge that outlives a spec. Source of truth.
- `apps/`: application code, once a stack is chosen.
- `.agents/skills/`: installed agent skills, shared across AI tools.
- `.agents/roles/`: role agents (backend, frontend, qa, reviewer, and so on),
  symlinked into `.claude/agents/`.
- `.agents/commands/`: the `/spec-*` slash commands that drive the workflow,
  symlinked into `.claude/commands/`.
- `scripts/agent-checks/`: spec state, structural validation, and the hook
  scripts that enforce role boundaries.

## The Loop

```
/spec-new "add tenant-scoped search"
/spec-approve 002 spec        ← you decide, not the agent
/spec-plan 002
/spec-approve 002 plan
/spec-tasks 002
/spec-approve 002 tasks       ← this is what unblocks code
/spec-build 002
/spec-verify 002
/spec-approve 002 verify
/spec-review 002
/spec-approve 002 review
/spec-close 002
```

`/spec-status` at any point shows every spec, its phase, and whether it is
waiting on a human or on work. See [docs/SPEC_WORKFLOW.md](docs/SPEC_WORKFLOW.md).

## First Steps

1. Answer the open questions in `specs/001-new-user-onboarding/spec.md`, or
   archive it and start your own with `/spec-new`.
2. Choose a stack and record it in `ARCHITECTURE.md` — every implementing role
   is deliberately blocked until you do.
3. Install the stack-specific skills in that same change
   ([docs/AI_PROJECT_SKILLS.md](docs/AI_PROJECT_SKILLS.md)).
4. Capture the first architectural decision as an ADR in `docs/design-docs/`.

## Philosophy

The repo should be easy for humans and agents to inspect, verify, and improve.
Important knowledge belongs in versioned files, not only in chat, meetings, or
memory.

Restrictions are structural. A reviewer that could fix what it finds would stop
reviewing and start implementing; an agent that could approve its own gate would
approve it. So the harness removes the tool rather than asking the model to
behave.
