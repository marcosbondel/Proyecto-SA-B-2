#!/usr/bin/env bash
# PreToolUse hook for the infra-aws role.
#
# Lets the agent read, plan, and diff infrastructure freely, but blocks commands
# that would actually mutate a cloud account. Those are handed to a human.
# Reads the hook payload on stdin and exits 2 to block.
#
# Wire it from a subagent's frontmatter:
#   hooks:
#     PreToolUse:
#       - matcher: "Bash"
#         hooks:
#           - type: command
#             command: "${CLAUDE_PROJECT_DIR}/scripts/agent-checks/validate-infra-command.sh"

set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')

[ -z "$CMD" ] && exit 0

# Commands that change real infrastructure. Extend this list as the stack grows;
# prefer blocking one command too many over discovering a deleted database.
MUTATING='(^|[;&|[:space:]])('\
'(terraform|terragrunt|tofu)[[:space:]]+(apply|destroy|import|taint|untaint)|'\
'(terraform|terragrunt|tofu)[[:space:]]+state[[:space:]]+(rm|mv|push|replace-provider)|'\
'(cdk|cdktf)[[:space:]]+(deploy|destroy|import|bootstrap)|'\
'pulumi[[:space:]]+(up|destroy|import|refresh)|'\
'(sam|copilot|serverless|sls|eb|amplify)[[:space:]]+(deploy|delete|remove|destroy)|'\
'aws[[:space:]]+cloudformation[[:space:]]+(deploy|create-stack|update-stack|delete-stack|execute-change-set)|'\
'aws[[:space:]]+[a-z0-9-]+[[:space:]]+(delete|terminate|remove|reboot|stop|create|update|modify|put|attach|detach|associate|disassociate|authorize|revoke|register|deregister)[a-z0-9-]*|'\
'aws[[:space:]]+s3[[:space:]]+(rm|mv|sync|cp)|'\
'kubectl[[:space:]]+(apply|create|delete|replace|patch|scale|drain|cordon)|'\
'helm[[:space:]]+(install|upgrade|uninstall|rollback)|'\
'docker[[:space:]]+(push)|'\
'gh[[:space:]]+workflow[[:space:]]+run'\
')([[:space:]]|$)'

if printf '%s' "$CMD" | grep -qiE "$MUTATING"; then
  cat >&2 <<EOF
Blocked: this command mutates real infrastructure, and the infra-aws role is
plan-only by design.

  Command: $CMD

Show the plan or diff instead (terraform plan, cdk diff, a change set), then
report the exact command for a human to run, along with its blast radius and
whether it is reversible.
EOF
  exit 2
fi

exit 0
