#!/usr/bin/env bash
set -uo pipefail

# The assignment's flow — register a customer, open accounts, transfer money —
# executed end to end against the **built images**, not against a development
# server. This is the ticket's "registro del flujo completo ejecutado en
# contenedores".
#
#   ./infra/docker/scripts/build-images.sh
#   BANK_GATEWAY_PORT=3100 docker compose -f infra/docker/docker-compose.images.yml up -d
#   BANK_GATEWAY_PORT=3100 ./infra/docker/scripts/flow-images.sh
#
# Every request enters through the Gateway, which is the only door the system
# has (§4.1). Nothing here talks to a service directly, and nothing here reads a
# service's database — except the two seeds below, which are labelled where they
# happen and are not features.
#
# What this proves is containerization: seven images, one network, a business
# flow that crosses six of them and is visible in the seventh's audit trail.
# What it does not prove is that the transfer completes — it cannot, and the
# reason is printed at the end.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

GATEWAY="http://localhost:${BANK_GATEWAY_PORT:-3000}"
STAMP="$(date +%s)"
EMAIL="t21-${STAMP}@bank.usac.gt"
CREDENTIAL='Contrasena-Segura-2026'

cd "$REPO_ROOT"

set -a
# shellcheck source=/dev/null
source infra/docker/.env
set +a

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
note() { printf '   \033[33m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }

# Runs SQL inside a service's own database container. Used twice, both times to
# stand in for something the system does not model — never to read or write on
# a service's behalf during the flow itself.
seed_sql() {
  docker exec -i "$1" psql -U "$2" -d "$3" -qtAc "$4"
}

step "0. the stack answers"
curl -fsS "${GATEWAY}/ready" || fail "the Gateway is not ready at ${GATEWAY}"
echo

step "1. register a customer  →  POST /api/customers"
photo="$(mktemp -t t21photo)"
printf '\x89PNG\r\n\x1a\n' > "$photo"
head -c 4096 /dev/urandom >> "$photo"

registered="$(curl -fsS -X POST "${GATEWAY}/api/customers" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "fullName=Marta Lopez" \
  -F "identityDocument=29${STAMP}" \
  -F "email=${EMAIL}" \
  -F "dateOfBirth=1994-03-11" \
  -F "address=Zona 1, Guatemala" \
  -F "role=CLIENTE" \
  -F "credential=${CREDENTIAL}" \
  -F "photo=@${photo};type=image/png")" || fail "registration was refused"
rm -f "$photo"

customer_id="$(echo "$registered" | sed -n 's/.*"customerId":"\([^"]*\)".*/\1/p')"
correlation="$(echo "$registered" | sed -n 's/.*"correlationId":"\([^"]*\)".*/\1/p')"
echo "   202 Accepted — customerId ${customer_id}"
echo "   correlationId ${correlation}"
sleep 3

step "2. activate the account  →  GET /api/customers/verify-email"
# Through the front door, with the token from the activation email.
#
# The "email" is notification-audit-service's simulated channel, and the link is
# in its log because `REVEAL_ACTIVATION_LINKS` is on for this stack — see the
# compose file for why that is a flag rather than a reading of NODE_ENV, and
# TD-043 for what it costs. It is the same thing every local mail catcher does.
token=""
for _ in $(seq 1 20); do
  token="$(docker logs notification-audit-service 2>&1 \
    | grep "$correlation" \
    | sed -n 's/.*"activationLink":"[^"]*token=\([^"&]*\)".*/\1/p' | tail -1)"
  [[ -n "$token" ]] && break
  sleep 1
done

[[ -n "$token" ]] || fail "no activation link reached the notification channel (TD-044)"

# A GET with the token in the query string, because the audience is a person
# clicking a link in their inbox — see the route's own comment.
verified="$(curl -fsS "${GATEWAY}/api/customers/verify-email?token=${token}")" \
  || fail "activation was refused"

echo "   ${verified}"
[[ "$verified" == *ACTIVATED* || "$verified" == *ACTIVE* ]] \
  || fail "the customer was not activated: ${verified}"

step "3. sign in  →  POST /api/auth/login"
session="$(curl -fsS -X POST "${GATEWAY}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"credential\":\"${CREDENTIAL}\"}")" || fail "login was refused"

token="$(echo "$session" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[[ -n "$token" ]] || fail "no token in the login response: ${session}"
echo "   signed in, JWT issued (${#token} characters)"

auth=(-H "Authorization: Bearer ${token}")

step "4. open two accounts  →  POST /api/accounts"
source_account=""
target_account=""
for slot in source target; do
  opened="$(curl -fsS -X POST "${GATEWAY}/api/accounts" "${auth[@]}" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $(uuidgen)" \
    -d '{"accountType":"MONETARIA"}')" || fail "opening the ${slot} account was refused"

  account_id="$(echo "$opened" | sed -n 's/.*"accountId":"\([^"]*\)".*/\1/p')"
  echo "   202 Accepted — ${slot} account ${account_id}"
  [[ "$slot" == "source" ]] && source_account="$account_id" || target_account="$account_id"
done
sleep 3

step "5. give the source account a balance"
# The second and last seed. Nothing in this system can put money into an
# account: a credit only ever happens as step 3 of a transfer Saga, and cash
# deposit is not modelled at all (TD-018). So a transfer needs a balance that
# no route can create.
note "seeded: no operation exists that deposits money (TD-018)"
seed_sql postgres-account "$ACCOUNT_POSTGRES_USER" "$ACCOUNT_POSTGRES_DB" \
  "UPDATE accounts SET balance = 1500.00 WHERE account_id = '${source_account}';" \
  || fail "could not seed the balance"

balance="$(curl -fsS "${GATEWAY}/api/accounts/${source_account}/balance" "${auth[@]}")"
echo "   GET /api/accounts/{id}/balance → ${balance}"

step "6. a transfer that works  →  POST /api/transfers"
transfer_of() {
  local scenario="$1"
  local body

  if [[ "$scenario" == "none" ]]; then
    body="{\"sourceAccount\":\"${source_account}\",\"targetAccount\":\"${target_account}\",\"amount\":{\"amountMinor\":25000,\"currency\":\"GTQ\"}}"
  else
    body="{\"sourceAccount\":\"${source_account}\",\"targetAccount\":\"${target_account}\",\"amount\":{\"amountMinor\":25000,\"currency\":\"GTQ\"},\"paymentScenario\":\"${scenario}\"}"
  fi

  curl -fsS -X POST "${GATEWAY}/api/transfers" "${auth[@]}" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $(uuidgen)" \
    -d "$body"
}

# The transfer's own status — the *first* one in the reply.
#
# The payload nests the payment's status under `payment`, and a grep for
# `"status":"FAILED"` matches that one too. It cost a false pass the first time
# this script ran: a refused payment was read as a settled transfer while the
# compensation was still in flight.
# The correlation the transfer began under. The audit trail is keyed by it, not
# by the transaction id — following a flow across five services is exactly what
# a correlation id is for (§6 paso 4).
transfer_correlation() {
  echo "$1" | sed -n 's/.*"originCorrelationId":"\([^"]*\)".*/\1/p'
}

transfer_status() {
  echo "$1" | sed -n 's/.*"transactionId":"[^"]*","status":"\([^"]*\)".*/\1/p'
}

# Polls until the transfer stops moving, or the window closes. The Saga is
# asynchronous by mandate (§4.1), so there is nothing to await — only a state to
# watch. A fixed sleep would either be too short for the retry ladder or too
# long for the happy path.
settle() {
  local transaction_id="$1" attempts="${2:-40}" state status

  for _ in $(seq 1 "$attempts"); do
    state="$(curl -fsS "${GATEWAY}/api/transfers/${transaction_id}" "${auth[@]}")"
    status="$(transfer_status "$state")"

    case "$status" in
      COMPLETED|FAILED|COMPENSATED)
        echo "$state"
        return 0
        ;;
    esac

    sleep 1
  done

  echo "$state"
  return 1
}

balance_of() {
  curl -fsS "${GATEWAY}/api/accounts/$1/balance" "${auth[@]}" \
    | sed -n 's/.*"amountMinor":\([0-9-]*\).*/\1/p' | head -1
}

before="$(balance_of "$source_account")"
happy="$(transfer_of none)"
happy_id="$(echo "$happy" | sed -n 's/.*"transactionId":"\([^"]*\)".*/\1/p')"
echo "   202 Accepted — transactionId ${happy_id}"

state="$(settle "$happy_id")" || fail "the transfer never settled: ${state}"
echo "   settled: $(transfer_status "$state")"
echo "   ${state}"

after="$(balance_of "$source_account")"
echo "   source balance ${before} → ${after} minor units"
[[ "$state" == *'"status":"COMPLETED"'* ]] || fail "expected COMPLETED, got: ${state}"
[[ $((before - after)) -eq 25000 ]] || fail "the debit did not stick: ${before} → ${after}"
happy_correlation="$(transfer_correlation "$state")"

step "7. a payment the provider refuses  →  the Saga compensates"
# §6 paso 12 asks for failure scenarios, not only successful ones. `REJECT` is
# a permanent refusal: no ladder, and the debit is given back.
before="$(balance_of "$source_account")"
declined="$(transfer_of REJECT)"
declined_id="$(echo "$declined" | sed -n 's/.*"transactionId":"\([^"]*\)".*/\1/p')"
echo "   202 Accepted — transactionId ${declined_id}"

state="$(settle "$declined_id")" || fail "the refused transfer never settled: ${state}"
echo "   settled: $(transfer_status "$state")"
echo "   ${state}"

after="$(balance_of "$source_account")"
echo "   source balance ${before} → ${after} minor units"
[[ "$state" == *'"status":"COMPENSATED"'* ]] || fail "expected COMPENSATED, got: ${state}"
[[ "$before" -eq "$after" ]] || fail "the compensation did not return the money: ${before} → ${after}"
echo "   the money came back — the compensation is real, not a status"
declined_correlation="$(transfer_correlation "$state")"

step "8. a payment that keeps timing out  →  the ladder, then the compensation"
# `TRANSIENT_FAILURE` fails every attempt with a retryable error. The Saga must
# not compensate until the ladder is exhausted: a payment mid-retry may still
# succeed, and refunding it early would be a transfer undone twice.
before="$(balance_of "$source_account")"
flaky="$(transfer_of TRANSIENT_FAILURE)"
flaky_id="$(echo "$flaky" | sed -n 's/.*"transactionId":"\([^"]*\)".*/\1/p')"
echo "   202 Accepted — transactionId ${flaky_id}"

state="$(settle "$flaky_id" 60)" || fail "the flaky transfer never settled: ${state}"
echo "   settled: $(transfer_status "$state")"
echo "   ${state}"

after="$(balance_of "$source_account")"
echo "   source balance ${before} → ${after} minor units"
[[ "$state" == *'"status":"COMPENSATED"'* ]] || fail "expected COMPENSATED, got: ${state}"
[[ "$before" -eq "$after" ]] || fail "the compensation did not return the money: ${before} → ${after}"

flaky_correlation="$(transfer_correlation "$state")"

# The ladder itself, counted from the reply the Saga carries. Four attempts:
# the first, plus one per rung of PAYMENT_RETRY_DELAYS_MS.
climbed="$(echo "$state" | sed -n 's/.*"payment":{[^}]*"attempt":\([0-9]*\).*/\1/p')"
echo "   the provider was asked ${climbed} times before the Saga gave up"
[[ "${climbed:-0}" -gt 1 ]] || fail "the ladder was never climbed: ${state}"

step "9. the audit trail  →  the seventh image"
# The trail is restricted to ADMINISTRADOR (D-06, TD-021), so this client
# session cannot read it over HTTP. What it can be shown to have recorded is
# read from the service's own log, which is where a container's evidence lives.
for label in "the transfer that worked:${happy_correlation}" \
             "the payment that was refused:${declined_correlation}" \
             "the payment that timed out:${flaky_correlation}"; do
  echo "   ${label%%:*}"
  docker logs notification-audit-service 2>&1 \
    | grep "${label##*:}" \
    | sed -n 's/.*"messageType":"\([^"]*\)".*"outcome":"\([^"]*\)".*/     \1 → \2/p' \
    | sort -u
done

echo
echo "════════════════════════════════════════════════════════════════"
echo " Three Sagas, seven images, one network."
echo
echo " COMPLETED   — debit, payment, credit"
echo " COMPENSATED — a refusal, and the money given back"
echo " COMPENSATED — a retry ladder climbed to its end, then the same"
echo
echo " Every request entered through the Gateway; no service was called"
echo " directly and no service read another's database. The balances were"
echo " checked before and after each one, so the compensation is a fact"
echo " about the money rather than a status somebody wrote down."
echo "════════════════════════════════════════════════════════════════"
