#!/usr/bin/env bash
# Validate every spec under specs/ — shape, state consistency, and traceability.
#
# Catches the failure modes that make a spec-driven repo quietly stop being
# spec-driven: a phase that outran its gate, acceptance criteria with no IDs,
# evidence that references criteria the spec does not define, tasks that claim
# an AC that was never written.
#
#   sh scripts/agent-checks/validate-spec-structure.sh          all active specs
#   sh scripts/agent-checks/validate-spec-structure.sh 007       one spec
#
# Exits non-zero on the first failing spec, listing every problem it found.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SPECS="$ROOT/specs"
STATE="$ROOT/scripts/agent-checks/spec-state.sh"

VALID_TYPES="feature fix refactor infra debt"
VALID_PHASES="specify plan tasks implement verify review done"
VALID_GATES="pending approved waived"

problems=0
note() { echo "  ✗ $*"; problems=$((problems + 1)); }

key() {
  awk -v k="$2" '$0 ~ "^"k":" { sub("^"k": *", ""); sub(/[[:space:]]+$/, ""); print; exit }' "$1/state.yaml"
}

# Files each phase must have produced by the time it is entered.
required_files_for_phase() {
  case "$1" in
    specify)                 echo "spec.md" ;;
    plan)                    echo "spec.md plan.md" ;;
    tasks)                   echo "spec.md plan.md tasks.md" ;;
    implement)               echo "spec.md plan.md tasks.md" ;;
    verify|review|done)      echo "spec.md plan.md tasks.md evidence.md" ;;
  esac
}

# Gates that must already be settled by the time a phase is current.
gates_settled_by_phase() {
  case "$1" in
    plan)      echo "spec" ;;
    tasks)     echo "spec plan" ;;
    implement) echo "spec plan tasks" ;;
    verify)    echo "spec plan tasks" ;;
    review)    echo "spec plan tasks verify" ;;
    done)      echo "spec plan tasks verify review" ;;
  esac
}

validate_one() {
  local dir="$1" name before after
  name=$(basename "$dir")
  before=$problems
  echo "specs/$name"

  if [ ! -f "$dir/state.yaml" ]; then
    note "no state.yaml — every spec directory needs one"
    return
  fi

  basename "$dir" | grep -qE '^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*$' \
    || note "directory name must be NNN-kebab-slug"

  local id type phase slug
  id=$(key "$dir" id); type=$(key "$dir" type)
  phase=$(key "$dir" phase); slug=$(key "$dir" slug)

  [ "${name%%-*}" = "$id" ] || note "state.yaml id '$id' does not match directory prefix '${name%%-*}'"
  [ "${name#*-}" = "$slug" ] || note "state.yaml slug '$slug' does not match directory suffix '${name#*-}'"

  printf '%s' " $VALID_TYPES "  | grep -q " $type "  || note "type '$type' is not one of: $VALID_TYPES"
  printf '%s' " $VALID_PHASES " | grep -q " $phase " || note "phase '$phase' is not one of: $VALID_PHASES"

  local g status
  for g in spec plan tasks verify review; do
    status=$(key "$dir" "gate_$g")
    status="${status%%#*}"; status="${status%"${status##*[![:space:]]}"}"
    printf '%s' " $VALID_GATES " | grep -q " $status " \
      || note "gate_$g is '$status' — must be pending, approved, or waived"
  done

  local f
  for f in $(required_files_for_phase "$phase"); do
    [ -f "$dir/$f" ] || note "phase is '$phase' but $f is missing"
  done

  for g in $(gates_settled_by_phase "$phase"); do
    status=$(key "$dir" "gate_$g")
    case "$status" in
      approved|waived*) ;;
      *) note "phase is '$phase' but gate_$g is still '$status' — the phase outran its gate" ;;
    esac
  done

  # Acceptance criteria must be IDed, because evidence and review key off them.
  local acs
  if [ -f "$dir/spec.md" ]; then
    acs=$(grep -oE '\bAC-[0-9]{2,}\b' "$dir/spec.md" | sort -u)
    [ -n "$acs" ] || note "spec.md defines no AC-NN acceptance criteria"
  fi

  # Nothing downstream may invent a criterion the spec never made.
  local ref
  for f in tasks.md evidence.md; do
    [ -f "$dir/$f" ] || continue
    for ref in $(grep -oE '\bAC-[0-9]{2,}\b' "$dir/$f" | sort -u); do
      printf '%s\n' "$acs" | grep -qx "$ref" || note "$f references $ref, which spec.md does not define"
    done
  done

  # Evidence without pasted output is an assertion, not evidence.
  if [ -f "$dir/evidence.md" ] && [ "$phase" != specify ]; then
    grep -q '```' "$dir/evidence.md" || note "evidence.md has no fenced command output"
  fi

  after=$problems
  [ "$before" = "$after" ] && echo "  ✓ ok"
}

[ -d "$SPECS" ] || { echo "no specs/ directory — nothing to validate"; exit 0; }

if [ $# -ge 1 ]; then
  dir=$("$STATE" path "$1") || exit 1
  validate_one "$dir"
else
  found=0
  for dir in $(find "$SPECS" -maxdepth 1 -mindepth 1 -type d ! -name archive 2>/dev/null | sort); do
    found=1
    validate_one "$dir"
  done
  [ "$found" = 1 ] || echo "no active specs"
fi

if [ "$problems" -gt 0 ]; then
  echo
  echo "$problems problem(s) found."
  exit 1
fi
