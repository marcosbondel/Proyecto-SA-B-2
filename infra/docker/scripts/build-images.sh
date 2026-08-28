#!/usr/bin/env bash
set -euo pipefail

# Builds the seven images of the system, from the repository root, with a tag
# that says which commit is inside them.
#
#   ./infra/docker/scripts/build-images.sh                  # every component
#   ./infra/docker/scripts/build-images.sh gateway web      # only these
#   ./infra/docker/scripts/build-images.sh --allow-dirty    # a tree mid-change
#   ./infra/docker/scripts/build-images.sh --kind bank-usac # and load into kind
#
# Every image gets two tags:
#
#   bank-usac/<component>:<short-commit>   immutable, and the one T-22 puts in
#                                          values.yaml
#   bank-usac/<component>:dev              moving, so docker-compose.images.yml
#                                          has something to name by default
#
# The commit also reaches the image as a label, so `docker inspect` answers the
# question without anyone having to trust the tag.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

# shellcheck source=./images.sh
source "${SCRIPT_DIR}/images.sh"

allow_dirty=false
kind_cluster=""
selected=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-dirty) allow_dirty=true; shift ;;
    --kind) kind_cluster="${2:?--kind needs a cluster name}"; shift 2 ;;
    -h|--help) sed -n '4,21p' "${BASH_SOURCE[0]}"; exit 0 ;;
    # `pnpm run images:build -- --allow-dirty` forwards the separator verbatim.
    --) shift ;;
    -*) echo "ERROR: unknown flag $1" >&2; exit 2 ;;
    *) selected+=("$1"); shift ;;
  esac
done

cd "$REPO_ROOT"

commit="$(git rev-parse HEAD)"
tag="$(bank_image_tag "$allow_dirty")"

if [[ "$allow_dirty" == "true" && -n "$(git status --porcelain)" ]]; then
  # Said out loud, because the tag now names a commit whose tree is not what
  # was built. Fine for iterating; never for the tag T-22 references.
  tag="${tag}-dirty"
  echo "WARNING: building a modified tree — tagging ${tag}" >&2
fi

echo "Repository : ${REPO_ROOT}"
echo "Commit     : ${commit}"
echo "Tag        : ${tag}"
echo

built=()

for row in "${BANK_COMPONENTS[@]}"; do
  bank_component_fields "$row"
  name="$BANK_COMPONENT_NAME"

  if [[ ${#selected[@]} -gt 0 ]]; then
    match=false
    for wanted in "${selected[@]}"; do
      [[ "$wanted" == "$name" ]] && match=true
    done
    [[ "$match" == "true" ]] || continue
  fi

  image="${BANK_IMAGE_PREFIX}/${name}"

  echo "──────────────────────────────────────────────────────────────"
  echo "Building ${image}:${tag}  (${BANK_COMPONENT_DOCKERFILE})"
  echo

  # The context is the repository root for every component, because pnpm
  # resolves the workspace through the lockfile there. `.dockerignore` is what
  # keeps that from meaning "send the whole clone".
  docker build \
    --file "$BANK_COMPONENT_DOCKERFILE" \
    --tag "${image}:${tag}" \
    --tag "${image}:dev" \
    --build-arg "IMAGE_VERSION=${tag}" \
    --build-arg "GIT_COMMIT=${commit}" \
    "$REPO_ROOT"

  built+=("${image}:${tag}")
done

if [[ ${#built[@]} -eq 0 ]]; then
  echo "ERROR: nothing matched. Known components:" >&2
  for row in "${BANK_COMPONENTS[@]}"; do
    bank_component_fields "$row"
    echo "  ${BANK_COMPONENT_NAME}" >&2
  done
  exit 2
fi

if [[ -n "$kind_cluster" ]]; then
  echo
  echo "Loading into kind cluster '${kind_cluster}'…"
  # The whole reason the tag is immutable: the same artefact that ran under
  # Compose is the one the cluster gets, with nothing recompiled in between.
  kind load docker-image --name "$kind_cluster" "${built[@]}"
fi

echo
echo "──────────────────────────────────────────────────────────────"
printf '%-34s %-14s %s\n' 'IMAGE' 'SIZE' 'REVISION'
for image in "${built[@]}"; do
  printf '%-34s %-14s %s\n' \
    "$image" \
    "$(docker image ls "$image" --format '{{.Size}}')" \
    "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
done
echo
echo "T-22 references these values per service in values.yaml:"
echo "  image.repository: ${BANK_IMAGE_PREFIX}/<component>"
echo "  image.tag:        ${tag}"
