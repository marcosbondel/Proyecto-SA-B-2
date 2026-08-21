#!/usr/bin/env bash
set -uo pipefail

# Export the live broker definitions via the management API and verify that
# the counts match the expected topology from docs/events/topology.md.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

# shellcheck source=/dev/null
set -a
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  eval "$line"
done < "${SCRIPT_DIR}/../.env"
set +a

EXPECTED_EXCHANGES=4
EXPECTED_QUEUES=30
EXPECTED_BINDINGS=14

OUTPUT="${REPO_ROOT}/specs/006-local-dev-infra/evidence/rabbitmq-definitions.json"

curl -s -u "${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}" \
  "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/definitions" \
  > "$OUTPUT"

EXCHANGES=$(jq '.exchanges | length' "$OUTPUT")
QUEUES=$(jq '.queues | length' "$OUTPUT")
BINDINGS=$(jq '.bindings | length' "$OUTPUT")

echo "Exported broker definitions to $OUTPUT"
echo "  Exchanges: $EXCHANGES (expected $EXPECTED_EXCHANGES)"
echo "  Queues:    $QUEUES (expected $EXPECTED_QUEUES)"
echo "  Bindings:  $BINDINGS (expected $EXPECTED_BINDINGS)"

if [[ "$EXCHANGES" -eq "$EXPECTED_EXCHANGES" && "$QUEUES" -eq "$EXPECTED_QUEUES" && "$BINDINGS" -eq "$EXPECTED_BINDINGS" ]]; then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
