#!/usr/bin/env bash
# PreToolUse hook for the roles that think but do not implement:
# product-mvp, architect, planner.
#
# Blocks Write and Edit outside the documentation surface, so a role whose job
# is to decide cannot quietly start implementing. Reads the hook payload on
# stdin and exits 2 to block, printing the reason on stderr.
#
# Arguments name the spec artifacts this particular role may write inside
# specs/<NNN-slug>/. Nothing is allowed there by default, which is what keeps
# product-mvp out of plan.md and planner out of spec.md.
#
# Wire it from a subagent's frontmatter:
#   hooks:
#     PreToolUse:
#       - matcher: "Write|Edit"
#         hooks:
#           - type: command
#             command: "${CLAUDE_PROJECT_DIR}/scripts/agent-checks/validate-docs-write.sh spec.md"

set -uo pipefail

ALLOWED_SPEC_FILES="$*"

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

# No path in the payload: nothing to judge, let the harness handle it.
[ -z "$FILE" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE#"$ROOT"/}"

# Scratch space outside the repository is always fine.
case "$FILE" in
  /tmp/*|/private/tmp/*|/var/folders/*) exit 0 ;;
esac

case "$REL" in
  docs/*|ARCHITECTURE.md|AGENTS.md|README.md) exit 0 ;;
esac

# specs/<NNN-slug>/<file> — allowed only if this role owns that artifact.
case "$REL" in
  specs/*/*)
    artifact="${REL##*/}"
    for allowed in $ALLOWED_SPEC_FILES; do
      [ "$artifact" = "$allowed" ] && exit 0
    done
    cat >&2 <<EOF
Blocked: this role does not own '$artifact'.

  Attempted: $REL
  Owns:      ${ALLOWED_SPEC_FILES:-nothing under specs/}

Each spec artifact has exactly one owning role: spec.md is product-mvp,
plan.md and tasks.md are planner, evidence.md is qa. state.yaml is written
only by scripts/agent-checks/spec-state.sh, because gate approval belongs to
a human. Hand the work to the role that owns the file.
EOF
    exit 2
    ;;
esac

cat >&2 <<EOF
Blocked: this role only writes documentation and the spec artifacts it owns.

  Attempted: $REL
  Allowed:   docs/**, ARCHITECTURE.md, AGENTS.md, README.md${ALLOWED_SPEC_FILES:+, specs/*/{$(printf '%s' "$ALLOWED_SPEC_FILES" | tr ' ' ',')}}

Write the decision down instead, and hand the implementation to backend,
frontend, mobile, or infra-aws.
EOF
exit 2
