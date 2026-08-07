#!/usr/bin/env bash
# Read and write the machine-readable state of a spec.
#
# state.yaml is deliberately flat — one key per line, no nesting — so that this
# script and the PreToolUse hooks can parse it with grep and awk, with no YAML
# dependency. Every phase transition and gate approval goes through here.
#
#   spec-state.sh list                      every spec, phase, and gate summary
#   spec-state.sh next-id                   next free spec number
#   spec-state.sh path <id>                 resolve an id to its directory
#   spec-state.sh get <id> <key>            read one key
#   spec-state.sh set <id> <key> <value>    write one non-gate key
#   spec-state.sh approve <id> <gate>       approve a gate (human action)
#   spec-state.sh waive <id> <gate> <why>   waive a gate, with a reason
#   spec-state.sh advance <id>              move to the next phase, if cleared
#   spec-state.sh implementable             exit 0 if any spec is cleared for code
#
# Exit codes: 0 success, 1 usage or not-found, 3 gate refused.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SPECS="$ROOT/specs"

PHASES="specify plan tasks implement verify review done"
GATES="spec plan tasks verify review"

# The gate that must be approved before a phase may be entered.
gate_for_phase() {
  case "$1" in
    plan)      echo spec ;;
    tasks)     echo plan ;;
    implement) echo tasks ;;
    review)    echo verify ;;
    done)      echo review ;;
    *)         echo "" ;;   # specify and verify have no entry gate
  esac
}

next_phase() {
  local current="$1" seen=0 p
  for p in $PHASES; do
    if [ "$seen" = 1 ]; then echo "$p"; return 0; fi
    [ "$p" = "$current" ] && seen=1
  done
  echo ""
}

die() { echo "$*" >&2; exit 1; }

# Accept "7", "007", "007-slug", or "slug". Never resolves into archive/.
resolve() {
  local id="$1" padded dir
  [ -d "$SPECS" ] || die "no specs/ directory at $SPECS"

  if printf '%s' "$id" | grep -qE '^[0-9]+$'; then
    padded=$(printf '%03d' "$((10#$id))")
    dir=$(find "$SPECS" -maxdepth 1 -mindepth 1 -type d ! -name archive \
            -name "${padded}-*" 2>/dev/null | head -1)
  else
    dir=$(find "$SPECS" -maxdepth 1 -mindepth 1 -type d ! -name archive \
            \( -name "$id" -o -name "*-$id" \) 2>/dev/null | head -1)
  fi

  [ -n "$dir" ] || die "no spec matches '$id' (try: spec-state.sh list)"
  [ -f "$dir/state.yaml" ] || die "$dir has no state.yaml"
  printf '%s' "$dir"
}

get_key() {
  awk -v k="$2" -F': *' '
    $0 ~ "^"k":" { sub("^"k": *", ""); sub(/[[:space:]]+$/, ""); print; exit }
  ' "$1/state.yaml"
}

set_key() {
  local dir="$1" key="$2" value="$3" tmp
  grep -qE "^${key}:" "$dir/state.yaml" || die "state.yaml has no key '$key'"
  tmp=$(mktemp)
  awk -v k="$key" -v v="$value" '
    $0 ~ "^"k":" { print k": "v; next }
    { print }
  ' "$dir/state.yaml" > "$tmp" && mv "$tmp" "$dir/state.yaml"
}

spec_dirs() {
  find "$SPECS" -maxdepth 1 -mindepth 1 -type d ! -name archive 2>/dev/null | sort
}

cmd="${1:-}"
case "$cmd" in

  list)
    printf '%-8s %-28s %-9s %-10s %s\n' ID SLUG TYPE PHASE GATES
    for dir in $(spec_dirs); do
      [ -f "$dir/state.yaml" ] || continue
      gates=""
      for g in $GATES; do
        case "$(get_key "$dir" "gate_$g")" in
          approved*) gates="$gates ${g}:ok" ;;
          waived*)   gates="$gates ${g}:WAIVED" ;;
          *)         gates="$gates ${g}:-" ;;
        esac
      done
      printf '%-8s %-28s %-9s %-10s %s\n' \
        "$(get_key "$dir" id)" \
        "$(get_key "$dir" slug)" \
        "$(get_key "$dir" type)" \
        "$(get_key "$dir" phase)" \
        "${gates# }"
    done
    ;;

  next-id)
    max=0
    for dir in $(find "$SPECS" -maxdepth 2 -mindepth 1 -type d 2>/dev/null); do
      n=$(basename "$dir" | grep -oE '^[0-9]{3}' || true)
      [ -n "$n" ] && [ "$((10#$n))" -gt "$max" ] && max=$((10#$n))
    done
    printf '%03d\n' $((max + 1))
    ;;

  path)
    [ $# -ge 2 ] || die "usage: spec-state.sh path <id>"
    resolve "$2"; echo
    ;;

  get)
    [ $# -ge 3 ] || die "usage: spec-state.sh get <id> <key>"
    dir=$(resolve "$2") || exit 1
    get_key "$dir" "$3"
    ;;

  set)
    [ $# -ge 4 ] || die "usage: spec-state.sh set <id> <key> <value>"
    dir=$(resolve "$2") || exit 1
    case "$3" in
      gate_*) die "gates are not set directly. Use: spec-state.sh approve $2 <gate>" ;;
      phase)  die "phase is not set directly. Use: spec-state.sh advance $2" ;;
    esac
    set_key "$dir" "$3" "$4"
    echo "$(basename "$dir"): $3 = $4"
    ;;

  approve|waive)
    [ $# -ge 3 ] || die "usage: spec-state.sh $cmd <id> <gate>"
    dir=$(resolve "$2") || exit 1; gate="$3"
    printf '%s' " $GATES " | grep -q " $gate " || die "unknown gate '$gate' (one of: $GATES)"
    if [ "$cmd" = waive ]; then
      [ $# -ge 4 ] || die "a waived gate needs a reason: spec-state.sh waive <id> <gate> <why>"
      set_key "$dir" "gate_$gate" "waived  # ${*:4}"
      echo "$(basename "$dir"): gate_$gate WAIVED — ${*:4}"
    else
      set_key "$dir" "gate_$gate" "approved"
      echo "$(basename "$dir"): gate_$gate approved"
    fi
    ;;

  advance)
    [ $# -ge 2 ] || die "usage: spec-state.sh advance <id>"
    dir=$(resolve "$2") || exit 1
    current=$(get_key "$dir" phase)
    target=$(next_phase "$current")
    [ -n "$target" ] || die "$(basename "$dir") is already at the final phase ($current)"
    required=$(gate_for_phase "$target")
    if [ -n "$required" ]; then
      status=$(get_key "$dir" "gate_$required")
      case "$status" in
        approved*|waived*) ;;
        *)
          echo "Refused: $(basename "$dir") cannot enter '$target' while gate_$required is '$status'." >&2
          echo "A human approves it:  ./scripts/agent-checks/spec-state.sh approve $2 $required" >&2
          exit 3
          ;;
      esac
    fi
    set_key "$dir" phase "$target"
    echo "$(basename "$dir"): $current → $target"
    ;;

  implementable)
    found=""
    for dir in $(spec_dirs); do
      [ -f "$dir/state.yaml" ] || continue
      case "$(get_key "$dir" "gate_tasks")" in approved*|waived*) ;; *) continue ;; esac
      case "$(get_key "$dir" phase)" in
        implement|verify|review) found="$found $(basename "$dir")" ;;
      esac
    done
    [ -n "$found" ] || exit 1
    echo "${found# }"
    ;;

  *)
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
