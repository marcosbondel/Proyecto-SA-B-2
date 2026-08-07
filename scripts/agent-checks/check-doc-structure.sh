#!/usr/bin/env sh
set -eu

required_paths="
AGENTS.md
ARCHITECTURE.md
docs/DESIGN.md
docs/AI_PROJECT_AGENTS.md
docs/AI_PROJECT_SKILLS.md
docs/FRONTEND.md
docs/PRODUCT_SENSE.md
docs/QUALITY_SCORE.md
docs/RELIABILITY.md
docs/SECURITY.md
docs/SPEC_WORKFLOW.md
docs/TECH_DEBT.md
docs/design-docs/index.md
docs/design-docs/core-beliefs.md
docs/generated/README.md
docs/generated/db-schema.md
docs/references/README.md
docs/templates/design-doc-template.md
docs/templates/review-checklist.md
docs/templates/spec/spec.md
docs/templates/spec/plan.md
docs/templates/spec/tasks.md
docs/templates/spec/evidence.md
docs/templates/spec/state.yaml
specs/README.md
scripts/agent-checks/spec-state.sh
scripts/agent-checks/validate-spec-structure.sh
scripts/agent-checks/validate-docs-write.sh
scripts/agent-checks/validate-implementation-gate.sh
scripts/agent-checks/validate-infra-command.sh
"

missing=0
for path in $required_paths; do
  if [ ! -e "$path" ]; then
    echo "missing: $path"
    missing=1
  fi
done

exit "$missing"
