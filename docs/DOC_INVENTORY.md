# Documentation Inventory

This inventory classifies every Markdown file in the repository. Project
documents have a named owner and review date. Tooling and installed harness
content is covered by directory rules so that adding a skill or workflow does
not require a new row for every generated link or vendor file.

Two directories hold written documentation and the split between them is by
audience, not by topic: **`docs/` documents the banking system**, and
**`context/` documents how agents build it** — the roles, the skills and the
prompts. Configuration the AI tools execute rather than read (`.agents/`,
`.claude/`, `.opencode/`, `.specify/`) stays at the repository root, where each
tool looks for it; those are covered by the directory rules below.

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
| `context/AI_PROJECT_AGENTS.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `context/AI_PROJECT_SKILLS.md` | project | Marcos Bonifasi | current | 2026-08-11 |
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
| `docs/references/README.md` | project | Marcos Bonifasi | current | 2026-09-09 |
| `apps/web/README.md` | project | Marcos Bonifasi | current | 2026-08-11 |
| `docs/README.md` | project | Marcos Bonifasi | current | 2026-09-09 |
| `docs/dda.md` | project | Enner Mendizabal | current | 2026-09-01 |
| `docs/adr.md` | project | Enner Mendizabal | current | 2026-09-01 |
| `docs/architecture.md` | project | Enner Mendizabal | current | 2026-09-01 |
| `docs/architecture/c4-context.md` | project | Enner Mendizabal | current | 2026-09-02 |
| `docs/architecture/c4-container.md` | project | Enner Mendizabal | current | 2026-09-02 |
| `docs/architecture/c4-component.md` | project | Enner Mendizabal | current | 2026-09-02 |
| `docs/architecture/sequence-create-account.md` | project | Enner Mendizabal | current | 2026-09-02 |
| `docs/architecture/sequence-transfer.md` | project | Enner Mendizabal | current | 2026-09-02 |
| `docs/architecture/use-cases-uml.md` | project | Enner Mendizabal | current | 2026-09-02 |
| `docs/architecture/diagrams/cdu/README.md` | project | Enner Mendizabal | current | 2026-09-09 |
| `docs/architecture/diagrams/er/README.md` | project | Enner Mendizabal | current | 2026-09-03 |
| `docs/generated/db-schema.md` | project | Enner Mendizabal | current | 2026-09-03 |
| `docs/sre/sli.md` | project | Marcos Bonifasi | current | 2026-09-05 |
| `docs/sre/slo.md` | project | Marcos Bonifasi | current | 2026-09-05 |
| `docs/sre/sla.md` | project | Marcos Bonifasi | current | 2026-09-05 |
| `docs/manual/recorrido-visual.md` | project | Enner Mendizabal | current | 2026-09-03 |
| `docs/qa/README.md` | project | Marcos Bonifasi | current | 2026-09-09 |
| `docs/qa/happypath.md` | project | Enner Mendizabal | current | 2026-09-09 |
| `docs/qa/validation-report.md` | project | Enner Mendizabal | current | 2026-09-01 |
| `docs/qa/backend/T-26-kyc-evidence.md` | project | Enner Mendizabal | current | 2026-09-09 |
| `docs/qa/backend/T-27-account-type-rules-evidence.md` | project | Enner Mendizabal | current | 2026-09-10 |
| `docs/qa/backend/T-28-transaction-history-evidence.md` | project | David Barrios | current | 2026-09-10 |
| `docs/qa/backend/T-29-payment-provider-evidence.md` | project | David Barrios | current | 2026-09-11 |
| `docs/qa/backend/T-30-event-classification-evidence.md` | project | Marcos Bonifasi | current | 2026-09-12 |
| `docs/qa/backend/T-31-integration-evidence.md` | project | Marcos Bonifasi | current | 2026-09-12 |
| `docs/process/implementations.md` | project | David Barrios | current | 2026-09-12 |
| `docs/images/kubernetes/README.md` | project | Marcos Bonifasi | current | 2026-09-03 |
| `context/README.md` | project | Marcos Bonifasi | current | 2026-09-09 |
| `context/prompt-mockup.md` | project | Marcos Bonifasi | superseded | 2026-09-09 |
| `E2E.md` | project | Enner Mendizabal | current | 2026-09-03 |
| `lluquitas.md` | project | Enner Mendizabal | superseded | 2026-09-09 |

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
| `docs/architecture/adr/ADR-*.md` | project | Marcos Bonifasi | One record per decision; ADR-013 and any successor are covered here without a row of their own. |
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

The following coverage check prints every Markdown file that has **neither** a
row in the table above **nor** a directory rule. Its expected output is empty.
It reads the rows out of this very file, so adding a row is all it takes to
cover a new document:

```sh
rows=$(sed -nE 's/^\| `([^`]*)` \| (project|template|generated|harness|vendored) \|.*/\1/p' docs/DOC_INVENTORY.md)
find . -name '*.md' -not -path './.git/*' -not -path '*/node_modules/*' \
       -not -path './.turbo/*' -not -path './.pnpm-store/*' -print |
  sed 's|^\./||' | while IFS= read -r path; do
    printf '%s\n' "$rows" | grep -qxF "$path" && continue
    case "$path" in
      .agents/roles/*|.agents/skills/*|.claude/agents/*|.claude/skills/*) ;;
      .opencode/commands/*|.specify/memory/*|.specify/templates/*|specs/*) ;;
      docs/architecture/adr/ADR-*) ;;
      apps/*/README.md|apps/*/*/README.md|apps/*/*/*/README.md) ;;
      apps/*/src/*|apps/*/*/src/*|apps/*/*/scripts/*) ;;
      *) printf '%s\n' "$path" ;;
    esac
  done
```

The earlier version of this check used a single `case` with `./docs/*.md`. In a
POSIX `case`, `*` matches `/` as well, so that one pattern swallowed every
document at any depth under `docs/` and the check could never report anything.
It is replaced rather than patched: a check that cannot fail is worse than no
check, because it reads as a passing one.
