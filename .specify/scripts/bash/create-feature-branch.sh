#!/usr/bin/env bash
#
# create-feature-branch.sh — creates the branch for a feature, or switches to it.
#
# Spec Kit computes a branch name in create-new-feature.sh and then never uses
# it: that script creates the spec directory and exits without touching git.
# This is the missing half, wired in as the `before_specify` hook.
#
# The only thing it mutates is a local branch. It does not push, does not
# rewrite history and deletes nothing. Its only network access is a `git fetch`
# whose failure is ignored.

set -e
set -o pipefail

JSON_MODE=false
TICKET=""
BRANCH_OVERRIDE=""
BASE_BRANCH=""
ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --json)        JSON_MODE=true ;;
        --ticket)      shift; TICKET="${1:-}" ;;
        --branch-name) shift; BRANCH_OVERRIDE="${1:-}" ;;
        --base)        shift; BASE_BRANCH="${1:-}" ;;
        --help|-h)
            echo "Usage: $0 [--json] [--ticket T-05] [--branch-name <name>] [--base <branch>] <description>"
            echo ""
            echo "  --ticket T-05        Ticket id. Produces 'feature/T-05'."
            echo "  --branch-name <name> Exact branch name. Bypasses all generation."
            echo "  --base <branch>      Start point. Defaults to origin/develop, then develop, then HEAD."
            exit 0 ;;
        *) ARGS+=("$1") ;;
    esac
    shift
done

DESCRIPTION="${ARGS[*]:-}"

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

emit() { # branch, base, action, note
    if [ "$JSON_MODE" = true ]; then
        printf '{"BRANCH_NAME":"%s","BASE_BRANCH":"%s","ACTION":"%s","NOTE":"%s"}\n' "$1" "$2" "$3" "$4"
    else
        echo "BRANCH_NAME: $1"
        echo "BASE_BRANCH: $2"
        echo "ACTION: $3"
        [ -n "$4" ] && echo "NOTE: $4"
    fi
}

# A missing repository is not a reason to block the spec from being written.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    >&2 echo "[specify] Not a git repository — no branch created."
    emit "" "" "skipped" "not-a-git-repository"
    exit 0
fi

REPO_ROOT="$(get_repo_root)" || exit 1
cd "$REPO_ROOT"

# --- Branch name -------------------------------------------------------------
# The repository numbers branches by *ticket*, not by spec: spec 004 is ticket
# T-03, spec 003 is T-02. The two sequences diverged early and will keep
# diverging, so the ticket is never derived from the spec number. It comes from
# --ticket, or is read out of the description, or there is none.
if [ -z "$TICKET" ]; then
    TICKET="$(printf '%s' "$DESCRIPTION" | grep -Eo 'T-[0-9]{2,}' | head -1 || true)"
fi

if [ -n "$BRANCH_OVERRIDE" ]; then
    BRANCH_NAME="$BRANCH_OVERRIDE"
elif [ -n "$TICKET" ]; then
    BRANCH_NAME="feature/${TICKET}"
else
    # No ticket: reuse Spec Kit's own numbering rather than reimplementing it.
    # --dry-run computes the name without creating a directory or a spec file.
    DRY="$("$SCRIPT_DIR/create-new-feature.sh" --json --dry-run "$DESCRIPTION")"
    SUFFIX="$(printf '%s' "$DRY" | sed -n 's/.*"BRANCH_NAME":"\([^"]*\)".*/\1/p')"
    BRANCH_NAME="feature/${SUFFIX}"
fi

# --- Start point -------------------------------------------------------------
# AGENTS.md prescribes `git fetch origin && git switch -c feature/T-XX
# origin/develop`. The fetch is best-effort: working offline is not an error.
if [ -z "$BASE_BRANCH" ]; then
    git fetch origin --quiet 2>/dev/null || \
        >&2 echo "[specify] Could not reach origin — branching from the local ref."
    if git show-ref --verify --quiet refs/remotes/origin/develop; then
        BASE_BRANCH="origin/develop"
    elif git show-ref --verify --quiet refs/heads/develop; then
        BASE_BRANCH="develop"
    else
        BASE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
        >&2 echo "[specify] No develop branch found — branching from '$BASE_BRANCH'."
    fi
fi

CURRENT="$(git rev-parse --abbrev-ref HEAD)"
TRACKED_DIRTY=false
git diff --quiet && git diff --cached --quiet || TRACKED_DIRTY=true

# --- Act ---------------------------------------------------------------------
if [ "$CURRENT" = "$BRANCH_NAME" ]; then
    emit "$BRANCH_NAME" "$BASE_BRANCH" "already-on-branch" ""
elif git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    # Switching to an existing branch with modified tracked files can clobber
    # work or fail halfway. Refuse and let a human decide.
    if [ "$TRACKED_DIRTY" = true ]; then
        >&2 echo "[specify] '$BRANCH_NAME' exists and tracked files are modified."
        >&2 echo "[specify] Commit or stash, then: git switch $BRANCH_NAME"
        emit "$BRANCH_NAME" "$BASE_BRANCH" "skipped" "existing-branch-dirty-tree"
    elif git switch "$BRANCH_NAME"; then
        emit "$BRANCH_NAME" "$BASE_BRANCH" "switched" ""
    else
        emit "$BRANCH_NAME" "$BASE_BRANCH" "failed" "switch-failed"
    fi
else
    # Creating carries uncommitted work over, which is what you want when the
    # spec files were just written on the wrong branch.
    #
    # --no-track matters: branching from a remote ref would otherwise set
    # origin/develop as this branch's upstream, so a later `git pull` on the
    # feature branch would quietly merge develop into it.
    if git switch --create --no-track "$BRANCH_NAME" "$BASE_BRANCH"; then
        emit "$BRANCH_NAME" "$BASE_BRANCH" "created" ""
    else
        >&2 echo "[specify] Could not create '$BRANCH_NAME' from '$BASE_BRANCH'."
        emit "$BRANCH_NAME" "$BASE_BRANCH" "failed" "create-failed"
    fi
fi
