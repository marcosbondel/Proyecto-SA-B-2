# AI Project Skills Setup

This document defines a standard skill setup for AI-assisted projects. It is
organized by work mode: product/design, frontend, backend, architecture,
quality, data, deployment, and agent workflow.

Already set up and just want to work? Skip to
[Using The Skills](#using-the-skills). The catalogue below is for choosing what
to install next.

## Recommendation

Start with a small, high-signal set of skills and add stack-specific skills only
when the project actually uses that technology. Too many overlapping skills make
agent behavior harder to predict.

The `npx skills add` commands below are written in their upstream form. Before
running any of them, append `-a universal -a claude-code -y` so the skill lands
in the agent-neutral location this project uses. See
[Installed In This Project](#installed-in-this-project) for the layout and the
CLI caveats.

## Core Skill Stack

Install these for most AI product projects:

| Area | Skill | Why |
| --- | --- | --- |
| Skill discovery | `find-skills` | Discover and install new skills as needs evolve. |
| Visual frontend design | `frontend-design` | Distinctive production-grade UI direction and implementation guidance. |
| Web interface quality | `web-design-guidelines` | Practical spacing, typography, interaction, and accessibility guidance. |
| UX/UI systems | `ui-ux-pro-max` or focused design-system variant | Advanced UI/UX patterns and design-system thinking. |
| Mobile responsiveness | `mobile-responsiveness` plus `webapp-testing` | Keeps mobile layouts, touch targets, and viewport behavior explicit. |
| Architecture review | `improve-codebase-architecture` | Finds architectural friction and proposes refactors. |
| Domain modeling | `domain-modeling` | Keeps vocabulary, boundaries, and business concepts explicit. |
| Codebase design | `codebase-design` | Shared language for modules, interfaces, adapters, and boundaries. |
| Spec-driven development | `spec-driven-development` | Turns product intent into specs, acceptance criteria, and implementation flow. |
| Security | `security-audit` plus stack-specific security skills | Reviews auth, authorization, data exposure, config, and platform rules. |
| Scalability | `performance`, `cloud-design-patterns`, and stack-specific performance skills | Covers runtime performance, caching, infrastructure shape, and data bottlenecks. |
| Debugging | `systematic-debugging` or `diagnosing-bugs` | Repro-first debugging instead of trial-and-error. |
| Code review | `code-review` or `requesting-code-review` | Review changes for bugs, regressions, and missing tests. |
| Verification | `verification-before-completion` | Prevents claiming completion before checks pass. |
| Planning | `writing-plans` and `executing-plans` | Durable implementation plans for multi-step work. |

## Design-Focused Skills

Recommended:

```sh
npx skills add https://github.com/anthropics/skills --skill frontend-design
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns
```

Optional, depending on taste and project type:

```sh
npx skills add https://github.com/leonxlnx/taste-skill --skill design-taste-frontend
npx skills add https://github.com/leonxlnx/taste-skill --skill high-end-visual-design
npx skills add https://github.com/leonxlnx/taste-skill --skill brandkit
npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
```

Use graphic-design skills cautiously unless the source is known and the install
count is healthy. Current search results for generic graphic design are weaker
than the frontend and UI/UX options.

## Responsive And Mobile Skills

Responsive behavior should be treated as product quality, not a final CSS pass.
Use mobile-first specs, viewport checks, and browser verification.

Recommended:

```sh
npx skills add hoodini/ai-agents-skills@mobile-responsiveness
npx skills add https://github.com/anthropics/skills --skill webapp-testing
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
```

Optional:

```sh
npx skills add aj-geddes/useful-ai-prompts@mobile-first-design
npx skills add pproenca/dot-skills@tailwind-responsive-ui
```

Use the optional Tailwind skill only when Tailwind is part of the stack.

## Spec-Driven Development Skills

Spec-driven development is the primary workflow here, and it is implemented by
this repository rather than by any one skill: the phases, the gates, and the
file layout come from [SPEC_WORKFLOW.md](SPEC_WORKFLOW.md) and the `/spec-*`
commands.

Recommended:

```sh
npx skills add addyosmani/agent-skills@spec-driven-development
npx skills add https://github.com/obra/superpowers --skill writing-plans
npx skills add https://github.com/obra/superpowers --skill executing-plans
npx skills add https://github.com/obra/superpowers --skill verification-before-completion
```

**Path overrides.** Two of these carry upstream file conventions that do not
apply here, and an agent following them will write artifacts the workflow cannot
see:

| Skill | Says | Here |
| --- | --- | --- |
| `spec-driven-development` | `tasks/plan.md`, `tasks/todo.md` | `specs/NNN-slug/plan.md`, `tasks.md` |
| `writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-*.md` | `specs/NNN-slug/plan.md` |

`spec-driven-development` also references four skills that are not installed
(`planning-and-task-breakdown`, `incremental-implementation`,
`test-driven-development`, `context-engineering`) and `/plan` and `/build`
commands that do not exist here. Use it for its vocabulary and its gated-phase
discipline; take the layout from `docs/templates/spec/`.

## Frontend Stack

For React or Next.js projects:

```sh
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns
npx skills add https://github.com/anthropics/skills --skill webapp-testing
npx skills add https://github.com/shadcn-ui/ui --skill shadcn
```

If using Vercel or modern Next.js patterns, also consider:

```sh
npx skills add https://github.com/vercel-labs/agent-skills --skill deploy-to-vercel
```

## Backend And API Stack

Pick by backend technology:

| Need | Recommended Skill |
| --- | --- |
| Auth/backend API with Clerk | `clerk-backend-api` |
| Supabase app backend | `supabase` |
| Postgres best practices | `supabase-postgres-best-practices` |
| Prisma ORM | `prisma-database-setup`, `prisma-client-api`, `prisma-cli` |
| Firebase backend | `firebase-basics`, `firebase-auth-basics`, `firebase-hosting-basics` |
| Cloud architecture | `cloud-design-patterns` |

Example commands:

```sh
npx skills add https://github.com/supabase/agent-skills --skill supabase
npx skills add https://github.com/supabase/agent-skills --skill supabase-postgres-best-practices
npx skills add https://github.com/prisma/skills --skill prisma-database-setup
npx skills add https://github.com/prisma/skills --skill prisma-client-api
npx skills add https://github.com/clerk/skills --skill clerk-backend-api
```

## Security Skills

Use a general security audit skill plus provider-specific skills for auth,
database rules, hosting, and edge/network controls.

Recommended baseline:

```sh
npx skills add cloudflare/security-audit-skill@security-audit
```

Provider-specific:

```sh
npx skills add firebase/agent-skills@firebase-security-rules-auditor
npx skills add firebase/agent-skills@firestore-security-rules-auditor
npx skills add https://github.com/clerk/skills --skill clerk-backend-api
npx skills add https://github.com/supabase/agent-skills --skill supabase-postgres-best-practices
```

If deploying on Vercel, prefer the available Vercel security and platform
skills for firewall, environment variables, routing middleware, observability,
and deployment review.

Security should cover:

- Auth and authorization boundaries.
- Tenant isolation.
- Secret handling and environment variables.
- Database access rules and row-level security.
- Input validation and output encoding.
- File upload, export, and user-generated content risks.
- Logging without leaking sensitive data.

## Architecture, Clean Code, And Patterns

Recommended first:

```sh
npx skills add https://github.com/mattpocock/skills --skill improve-codebase-architecture
npx skills add https://github.com/mattpocock/skills --skill codebase-design
npx skills add https://github.com/mattpocock/skills --skill domain-modeling
```

`mattpocock/skills` no longer publishes a `request-refactor-plan` skill. Use
`improve-codebase-architecture` for refactor discovery, and `grill-with-docs`
if a plan needs to be interrogated before implementation.

Clean architecture search results exist, but the best matches are less
established than the architecture skills above. If clean architecture is a hard
requirement, test one of these in a sandbox project before adding it globally:

```sh
npx skills add wondelai/skills@clean-architecture
npx skills add giuseppe-trisciuoglio/developer-kit@clean-architecture
```

For language-specific design patterns:

```sh
npx skills add https://github.com/wshobson/agents --skill python-design-patterns
npx skills add https://github.com/samber/cc-skills-golang --skill golang-design-patterns
```

## Scalability And Performance Skills

Avoid a single generic "scalability" skill as the main answer. In practice,
scalability comes from good architecture boundaries, performance budgets,
observability, caching, database design, and deployment topology.

Recommended:

```sh
npx skills add addyosmani/web-quality-skills@performance
npx skills add github/awesome-copilot@cloud-design-patterns
npx skills add https://github.com/mattpocock/skills --skill improve-codebase-architecture
npx skills add https://github.com/supabase/agent-skills --skill supabase-postgres-best-practices
```

Stack-specific:

```sh
npx skills add get-convex/agent-skills@convex-performance-audit
npx skills add https://github.com/wshobson/agents --skill python-performance-optimization
npx skills add https://github.com/samber/cc-skills-golang --skill golang-performance
```

If using Vercel or Next.js, also use the available skills for CDN caching,
runtime cache, Cache Components, observability, functions, and deployments.

Scalability reviews should check:

- Data model and query shape.
- Caching strategy.
- Background jobs and queue boundaries.
- API rate limits and backpressure.
- Horizontal scaling assumptions.
- Cold starts and runtime constraints.
- Observability for latency, errors, saturation, and cost.

## Quality, Testing, And Delivery

Recommended:

```sh
npx skills add https://github.com/anthropics/skills --skill webapp-testing
npx skills add https://github.com/mattpocock/skills --skill code-review
npx skills add https://github.com/mattpocock/skills --skill qa
npx skills add https://github.com/mattpocock/skills --skill setup-pre-commit
npx skills add https://github.com/obra/superpowers --skill systematic-debugging
npx skills add https://github.com/obra/superpowers --skill verification-before-completion
```

## Standard Bundles

### Frontend-Only Product

- `frontend-design`
- `web-design-guidelines`
- `mobile-responsiveness`
- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `webapp-testing`
- `spec-driven-development`
- `code-review`
- `verification-before-completion`

### Full-Stack SaaS

- Everything in Frontend-Only Product.
- `security-audit`
- `domain-modeling`
- `codebase-design`
- `improve-codebase-architecture`
- `performance`
- `cloud-design-patterns`
- `supabase` or Prisma/Firebase equivalents.
- Auth skill such as `clerk-backend-api` if Clerk is used.
- Deployment skill for the chosen platform.

### AI-First Product

- Everything in Full-Stack SaaS.
- OpenAI/API-specific guidance if the project uses OpenAI products.
- Observability and error-tracking skills for the chosen stack.
- Spec-driven development, planning, systematic debugging, security review, and
  verification skills should be treated as mandatory workflow skills.

## Installed In This Project

Installed project-level and agent-neutral. Because this repository is still a
documentation scaffold with no runtime or framework selected, only
stack-agnostic skills are installed. Stack-specific skills are deliberately
deferred until [ARCHITECTURE.md](../ARCHITECTURE.md) names a runtime.

| Skill | Source | Role |
| --- | --- | --- |
| `find-skills` | `vercel-labs/skills` | Discover and install skills as needs evolve. |
| `spec-driven-development` | `addyosmani/agent-skills` | Primary workflow: spec to acceptance criteria to implementation. |
| `writing-plans` | `obra/superpowers` | Durable execution plans for multi-step work. |
| `executing-plans` | `obra/superpowers` | Work a plan to completion. |
| `verification-before-completion` | `obra/superpowers` | Block completion claims until checks pass. |
| `systematic-debugging` | `obra/superpowers` | Repro-first debugging. |
| `code-review` | `mattpocock/skills` | Standards and spec review of a diff. |
| `improve-codebase-architecture` | `mattpocock/skills` | Architectural friction and refactor discovery. |
| `codebase-design` | `mattpocock/skills` | Deep-module and seam vocabulary. |
| `domain-modeling` | `mattpocock/skills` | Ubiquitous language and ADRs. |
| `security-audit` | `cloudflare/security-audit-skill` | Auth, data exposure, config, secrets review. |
| `setup-pre-commit` | `mattpocock/skills` | Encode checks as commit-time guardrails. |
| `frontend-design` | `anthropics/skills` | Production-grade UI direction. |
| `web-design-guidelines` | `vercel-labs/agent-skills` | Spacing, typography, interaction, accessibility. |

Deferred until the stack exists: `webapp-testing`, `mobile-responsiveness`,
`vercel-react-best-practices`, `vercel-composition-patterns`, `shadcn`,
`performance`, `cloud-design-patterns`, and every backend, auth, database, and
deployment skill listed above. Add them in the same change that introduces the
technology, and update this table.

### Layout

Skills are vendor-neutral, not Claude-specific. This mirrors the choice to use
`AGENTS.md` instead of a single-vendor instruction file.

- `.agents/skills/<name>/` holds the real skill content. This is the single
  source of truth. `npx skills list` confirms 11 agents wired to it: Antigravity,
  Antigravity CLI, Claude Code, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot,
  Kimi Code CLI, OpenCode, and Warp.
- `.claude/skills/<name>` is a relative symlink into `.agents/skills/`, because
  Claude Code does not read `.agents/` natively. Relative targets keep the links
  valid after a clone.
- `skills-lock.json` at the repository root pins all 14 by content hash.
  Skill content is committed, so a fresh clone works offline with no install
  step. Use `npx skills experimental_install` to re-sync if the tree and the
  lockfile ever disagree.

No skill content is duplicated: adding an agent means adding a symlink, not a
copy.

### CLI notes

```sh
npx skills add <owner/repo> --skill <name> -a universal -a claude-code -y
```

- `-a universal` is what writes to `.agents/skills/`; other agents need no flag
  of their own since they read that directory directly.
- Use repeated `--skill` flags. A comma-separated `--skill a,b,c` list is
  silently ignored by the CLI, which reports success while installing nothing.
- The agent target for Claude Code is `claude-code`; plain `claude` is rejected.

## Using The Skills

### How A Skill Activates

Skills are not commands you must memorize. Each one carries a `description` in
its frontmatter, and the agent matches your request against those descriptions
and loads the skill itself. **Describe the task, not the skill.** Saying "this
test fails and I do not know why" is enough to pull in `systematic-debugging`.

Two exceptions to that rule:

- `improve-codebase-architecture` sets `disable-model-invocation: true`. It will
  never self-trigger; you must ask for it by name. It is the one skill that
  scans the codebase and produces an HTML report, so it is deliberately opt-in.
- `web-design-guidelines` declares `argument-hint: <file-or-pattern>`. Point it
  at something: "review `src/components/Button.tsx` against the web interface
  guidelines".

### Invoking By Name

When description matching does not pick the skill you wanted, name it
explicitly. In Claude Code that is `/<skill-name>`; in other agents, write "use
the `<skill-name>` skill" in the prompt. Naming it also works to force a skill
the agent would otherwise skip.

To read what a skill actually does before trusting it, open its source:
`.agents/skills/<name>/SKILL.md`.

### Trigger Reference

Phrasing that reliably reaches each installed skill:

| Say something like | Skill that answers |
| --- | --- |
| "start a spec for X", "requirements are still vague" | `spec-driven-development` — but prefer `/spec-new`, which also scaffolds the state |
| "write a plan for this", "break this into steps" | `writing-plans` — reached by `/spec-plan` and `/spec-tasks` |
| "work through the plan", "continue the plan" | `executing-plans` — reached by `/spec-build` |
| "this is broken/failing/slow", "why does this throw?" | `systematic-debugging` |
| "is this done?", "before you commit", "confirm it passes" | `verification-before-completion` |
| "review my changes", "review since `main`" | `code-review` |
| "audit for vulnerabilities", "find security bugs" | `security-audit` |
| "pin down the terminology", "record this decision as an ADR" | `domain-modeling` |
| "where should this seam go?", "make this module testable" | `codebase-design` |
| "scan the codebase for refactors" (manual only) | `improve-codebase-architecture` |
| "design this screen", "it looks templated" | `frontend-design` |
| "review my UI", "check accessibility" (+ a path) | `web-design-guidelines` |
| "add pre-commit hooks", "set up Husky" | `setup-pre-commit` |
| "is there a skill for X?" | `find-skills` |

### Which Skill Serves Which Phase

The skills carry knowledge; the `/spec-*` commands carry the procedure. Each
phase of [SPEC_WORKFLOW.md](SPEC_WORKFLOW.md) pulls in the skills that apply:

| Phase | Command | Skills in play |
| --- | --- | --- |
| specify | `/spec-new` | `spec-driven-development` |
| plan | `/spec-plan` | `domain-modeling` and `codebase-design` when vocabulary or seams move, then `writing-plans` |
| tasks | `/spec-tasks` | `writing-plans` |
| implement | `/spec-build` | `executing-plans`, `frontend-design` for new UI, `systematic-debugging` when something breaks |
| verify | `/spec-verify` | `verification-before-completion`, `systematic-debugging` |
| review | `/spec-review` | `code-review`, `security-audit` when the change touches auth or data exposure, `web-design-guidelines` when it touches UI |
| done | `/spec-close` | `domain-modeling` for the ADRs that outlive the spec |

Do not debug by guessing — `systematic-debugging` reproduces first. And
`verification-before-completion` is why `qa` refuses to call work done without
pasted command output: that is the gate, not a formality.

The skills' own advice about *where files go* is overridden by this repository
in every case. See the path-override table above.

### Maintenance

```sh
npx skills list                  # what is installed, and for which agents
npx skills update                # update all skills to latest
npx skills update <name>         # update one
npx skills remove <name>         # uninstall
npx skills experimental_install  # restore from skills-lock.json after a clone
npx skills find <query>          # search for a new skill
```

A fresh clone needs no install step: `.agents/skills/` and the `.claude/skills/`
symlinks are committed. Run `npx skills experimental_install` only to repair a
tree that has drifted from `skills-lock.json`.

### Before You Trust A Skill

Skills execute with full agent permissions, which the CLI warns about on every
install. Two consequences worth internalizing:

- Read `SKILL.md` before running an unfamiliar skill, especially one that ships
  scripts. `security-audit` includes `validate-findings.cjs` and
  `systematic-debugging` includes `find-polluter.sh`; both run locally.
- A skill is guidance, not authority. When a skill's advice conflicts with
  [AGENTS.md](../AGENTS.md), `ARCHITECTURE.md`, or a doc under `docs/`, the
  repository wins. Repository-local knowledge is the source of truth.

## Install Policy

- Prefer official or high-reputation sources.
- Prefer skills with more than 1K installs.
- Verify GitHub stars and security audit status before adopting a low-install
  skill.
- Avoid installing several skills that claim the same job unless each has a
  clear role.
- Record project-specific skill choices in this file.

## Sources Checked

- Skills directory: https://www.skills.sh/
- Frontend design: https://www.skills.sh/anthropics/skills/frontend-design
- React best practices: https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
- Architecture: https://www.skills.sh/mattpocock/skills/improve-codebase-architecture
- Domain modeling: https://www.skills.sh/mattpocock/skills/domain-modeling
- Security audit: https://www.skills.sh/cloudflare/security-audit-skill/security-audit
- Spec-driven development: https://skills.sh/addyosmani/agent-skills/spec-driven-development
- Mobile responsiveness: https://skills.sh/hoodini/ai-agents-skills/mobile-responsiveness
- Web performance: https://skills.sh/addyosmani/web-quality-skills/performance
- Cloud design patterns: https://skills.sh/github/awesome-copilot/cloud-design-patterns
