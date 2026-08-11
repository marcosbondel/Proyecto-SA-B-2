# The Crazy Template

Agent-first project scaffold inspired by OpenAI's "Harness engineering"
recommendations.

Engineers direct; agents implement, verify, and review. Spec-driven work runs on
[Spec Kit](https://github.com/github/spec-kit).

## Structure

- `AGENTS.md`: short operational map for agents.
- `ARCHITECTURE.md`: top-level technical map. Still a placeholder.
- `docs/`: the knowledge that outlives a change. Source of truth.
- `apps/web/`: the Nuxt 4 application.
- `.agents/skills/`: installed agent skills, shared across AI tools.
- `.agents/roles/`: role agents (backend, frontend, qa, reviewer, and so on),
  symlinked into `.claude/agents/`.

## The Loop

Spec-driven development is handled by Spec Kit and its `/speckit.*` commands.
**It is not initialized in this repository yet** — until it is, there is no spec
workflow here.

The home-grown `/spec-*` commands, their state machine, and their enforcement
hooks were removed in favour of Spec Kit. If you find a reference to
`/spec-new`, `scripts/agent-checks/`, `state.yaml`, or `docs/SPEC_WORKFLOW.md`
anywhere, it is stale — delete it.

## First Steps

1. Initialize Spec Kit and record how it is wired here.
2. Choose the rest of the stack and record it in `ARCHITECTURE.md` — it is still
   a placeholder.
3. Install the stack-specific skills in that same change
   ([docs/AI_PROJECT_SKILLS.md](docs/AI_PROJECT_SKILLS.md)).
4. Capture the first architectural decision as an ADR in `docs/design-docs/`.
5. Add a test and a lint script to `apps/web/package.json`. There are none, so
   nothing can currently be verified beyond a build.

## Development

```bash
cd apps/web
pnpm install
pnpm dev
```

## Philosophy

The repo should be easy for humans and agents to inspect, verify, and improve.
Important knowledge belongs in versioned files, not only in chat, meetings, or
memory.

Restrictions are structural where the harness still allows it: `design`,
`reviewer`, and `security` have no write tools, because a reviewer that could fix
what it finds would stop reviewing and start implementing. The gates that used to
block unspecced code were enforced by hooks that are now gone — that discipline
is a convention until Spec Kit replaces it.
