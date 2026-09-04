# Documentation Inventory

This inventory classifies every Markdown file in the repository. Project
documents have a named owner and review date. Tooling and installed harness
content is covered by directory rules so that adding a skill or workflow does
not require a new row for every generated link or vendor file.

## Classes

| Class | Meaning | Authority |
| --- | --- | --- |
| `project` | Live Bank USAC documentation that explains what the system is and how the team works. | The named owner maintains it. |
| `template` | Reusable scaffold content copied into another artifact. | Never treated as project truth. |
| `generated` | Output derived from another source and regenerated when that source changes. | Never edited as the source of truth. |
| `harness` | Normative agent, role, skill, or Spec Kit workflow content. | Governs how work is performed, not the product architecture. |
| `vendored` | Installed or imported content owned by an external tool or reference source. | Read-only from the project's perspective. |

## Project Documents

| Path | Class | Owner | State | Last reviewed |
| --- | --- | --- | --- | --- |
| `README.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `ARCHITECTURE.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `AGENTS.md` | project | Marcos Bonifasi | current | 2026-08-24 |
| `CLAUDE.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/AI_PROJECT_AGENTS.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/AI_PROJECT_SKILLS.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/DESIGN.md` | project | Marcos Bonifasi | current | 2026-08-24 |
| `docs/DOC_INVENTORY.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/FRONTEND.md` | project | Marcos Bonifasi | blocked | 2026-08-24 |
| `docs/METHODOLOGY.md` | project | Marcos Bonifasi | current | 2026-08-24 |
| `docs/OWNERSHIP.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/PRODUCT_SENSE.md` | project | Marcos Bonifasi | blocked | 2026-08-11 |
| `docs/QUALITY_SCORE.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/RELIABILITY.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/SECURITY.md` | project | Marcos Bonifasi | blocked | 2026-08-15 |
| `docs/TECH_DEBT.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/TECHNICAL_DOCUMENT.md` | project | Marcos Bonifasi | current | 2026-08-28 |
| `docs/manual/README.md` | project | Marcos Bonifasi | current | 2026-08-28 |
| `docs/manual/rol-cliente.md` | project | Marcos Bonifasi | current | 2026-08-28 |
| `docs/manual/rol-cajero-receptor.md` | project | Marcos Bonifasi | current | 2026-08-28 |
| `docs/manual/rol-administrador.md` | project | Marcos Bonifasi | current | 2026-08-28 |
| `docs/domain/README.md` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/domain/bounded-contexts.md` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/domain/entities.md` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/domain/actors.md` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/domain/use-cases.md` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/domain/message-catalog.md` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/events/README.md` | project | Marcos Bonifasi | current | 2026-08-19 |
| `docs/events/envelope.md` | project | Marcos Bonifasi | current | 2026-08-19 |
| `docs/events/catalog.md` | generated | Marcos Bonifasi | current | 2026-08-19 |
| `docs/events/topology.md` | project | Marcos Bonifasi | current | 2026-08-19 |
| `docs/events/saga-transfer.md` | project | Marcos Bonifasi | current | 2026-08-19 |
| `docs/operations/README.md` | project | Marcos Bonifasi | current | 2026-09-03 |
| `docs/operations/CONTAINERS.md` | project | Marcos Bonifasi | current | 2026-08-27 |
| `docs/operations/DEPLOYMENT.md` | project | Marcos Bonifasi | current | 2026-09-03 |
| `docs/operations/EMAIL_RESEND.md` | project | Marcos Bonifasi | current | 2026-08-30 |
| `docs/architecture/deployment.md` | project | Marcos Bonifasi | current | 2026-09-03 |
| `infra/k8s/README.md` | project | Marcos Bonifasi | current | 2026-09-03 |
| `infra/docker/README.md` | project | Marcos Bonifasi | current | 2026-08-27 |
| `docs/architecture/adr/ADR-012-object-storage.md` | project | Marcos Bonifasi | current | 2026-08-19 |
| `docs/design-docs/PROMPT_MOCKUP.MD` | project | Marcos Bonifasi | current | 2026-08-14 |
| `docs/architecture/README.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/decision-matrix.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/README.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-001-backend-stack.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-002-frontend-stack.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-003-communication-model.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-004-message-broker.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-005-persistence.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-006-containerization.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-007-local-orchestration.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-008-service-internal-architecture.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-009-distributed-transactions.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-010-authentication.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/architecture/adr/ADR-011-diagramming-toolchain.md` | project | Marcos Bonifasi | current | 2026-08-15 |
| `docs/design-docs/core-beliefs.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/design-docs/index.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/references/README.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `apps/web/README.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/dda.md` | project | Marcos Bonifasi | current | 2026-09-01 |
| `docs/adr.md` | project | Marcos Bonifasi | current | 2026-09-01 |
| `docs/architecture.md` | project | Marcos Bonifasi | current | 2026-09-01 |
| `docs/happypath.md` | project | Marcos Bonifasi | current | 2026-09-01 |

Blocked project documents are still current as documents: their `blocked`
state records an explicit missing decision, owner, and arrival ticket in the
document itself. A reader must not fill that gap with an assumption.

## Directory Rules

| Glob | Class | Owner | Note |
| --- | --- | --- | --- |
| `.agents/roles/**/*.md` | harness | — | Canonical agent role definitions. |
| `.agents/skills/**/*.md` | harness | — | Canonical skill content and its supporting references. |
| `.claude/agents/**/*.md` | harness | — | Symlinked role entry points into `.agents/roles/`. |
| `.claude/skills/**/*.md` | harness | — | Symlinked skill entry points into `.agents/skills/`. |
| `.opencode/commands/**/*.md` | harness | — | Symlinked command entry points into Spec Kit skill bodies. |
| `.specify/memory/**/*.md` | harness | — | The active Spec Kit constitution and future workflow memory. |
| `.specify/templates/**/*.md` | template | — | Spec Kit templates; update through the Spec Kit workflow. |
| `specs/**/*.md` | harness | — | Archived or active feature-work artifacts governed by Spec Kit. |
| `docs/templates/**/*.md` | template | — | Project document templates; copy, do not treat as live guidance. |
| `docs/generated/**/*.md` | generated | — | Generated reference and schema outputs. |
| `apps/**/README.md` | project | Component owner | Layer and package READMEs that live beside the code they describe; the component's owner in `OWNERSHIP.md` maintains them. |

The `.claude/` and `.opencode/` entries are symlinks to canonical bodies under
`.agents/`; the links are covered by the rule and are not duplicated as project
documents. Installed external references under `.agents/` are covered by the
harness rule even when their upstream author is different.

## Coverage Check

Run this from the repository root after adding or removing Markdown files:

```sh
find . -name '*.md' -not -path './.git/*' -not -path '*/node_modules/*' | sort
```

The following coverage check applies the rows and directory rules and prints
only uncovered paths. Its expected output is empty:

```sh
find . -name '*.md' -not -path './.git/*' -not -path '*/node_modules/*' -print | while IFS= read -r path; do
  case "$path" in
    ./README.md|./ARCHITECTURE.md|./AGENTS.md|./CLAUDE.md|./apps/*/README.md|./apps/*/*/README.md|./apps/*/src/*/README.md|./apps/*/*/src/*/README.md|./apps/*/*/scripts/*.md|./docs/*.md|./docs/domain/*.md|./docs/events/*.md|./docs/manual/*.md|./docs/operations/*.md|./docs/architecture/*.md|./docs/architecture/adr/*.md|./docs/architecture/diagrams/*.md|./docs/architecture/diagrams/*/*.md|./docs/decisions/*.md|./docs/design-docs/*.md|./docs/sre/*.md|./docs/uml/*.md|./docs/saga/*.md|./docs/references/*.md|./infra/*/README.md|./.agents/roles/*.md|./.agents/skills/*/*.md|./.agents/skills/*/*/*.md|./.claude/agents/*.md|./.claude/skills/*/*.md|./.opencode/commands/*.md|./.specify/memory/*.md|./.specify/templates/*.md|./docs/templates/*.md|./docs/generated/*.md|./specs/*/*.md|./specs/*/*/*.md|./specs/*/*/*/*.md)
      ;;
    *) printf '%s\n' "$path" ;;
  esac
done
```

Every result is either a row in **Project Documents** or falls under one of
the **Directory Rules**. The expected uncovered set is empty.

The inventory intentionally does not list `docs/templates/` or
`docs/generated/` files individually, because their directory rules are the
authority and those directories are protected from this feature's edits.
