#!/usr/bin/env bash
# PreToolUse hook for the implementing roles: backend, frontend, mobile,
# infra-aws.
#
# This is the gate that makes the workflow spec-driven rather than
# spec-flavoured. Production code may only be written while some spec has
# reached an implementable state: its tasks gate approved by a human, and its
# phase at implement, verify, or review.
#
# It is deliberately coarse — it asks "is the factory cleared to build?", not
# "does this exact line belong to task T-04". The fine-grained ownership lives
# in tasks.md, where a reviewer can see it. A hook that tried to enforce that
# would block legitimate work far more often than it caught a real violation.
#
# Wire it from a subagent's frontmatter:
#   hooks:
#     PreToolUse:
#       - matcher: "Write|Edit"
#         hooks:
#           - type: command
#             command: "${CLAUDE_PROJECT_DIR}/scripts/agent-checks/validate-implementation-gate.sh"

set -uo pipefail

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE#"$ROOT"/}"

case "$FILE" in
  /tmp/*|/private/tmp/*|/var/folders/*) exit 0 ;;
esac

# Documentation, specs, and the agent scaffolding itself are never gated —
# reporting a blocker must not require passing the gate that blocks you.
case "$REL" in
  docs/*|specs/*|.agents/*|.claude/*|scripts/*|*.md) exit 0 ;;
esac

CLEARED=$("$ROOT/scripts/agent-checks/spec-state.sh" implementable 2>/dev/null) || CLEARED=""

[ -n "$CLEARED" ] && exit 0

cat >&2 <<EOF
Blocked: no spec is cleared for implementation.

  Attempted: $REL

Production code is written against an approved task list, never ahead of one.
Nothing under specs/ currently has gate_tasks approved and a phase of
implement, verify, or review.

  ./scripts/agent-checks/spec-state.sh list     see where every spec stands

If the work is already specced, the missing step is a human approving the
gate:

  /spec-approve <id> tasks

If it is not specced yet, start there: /spec-new "<what you are building>".
If this is a one-line fix too small for a spec, the human runs it — say so and
hand it over rather than working around the gate.
EOF
exit 2
