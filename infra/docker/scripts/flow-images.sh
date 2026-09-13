#!/usr/bin/env bash
set -uo pipefail

# The assignment's flow — register a customer, open accounts, transfer money —
# executed end to end against the **built images**, not against a development
# server. This is the ticket's "registro del flujo completo ejecutado en
# contenedores".
#
#   ./infra/docker/scripts/build-images.sh
#   SEED_DEMO_DATA=true BANK_GATEWAY_PORT=3100 \
#     docker compose -f infra/docker/docker-compose.images.yml up -d
#   BANK_GATEWAY_PORT=3100 ./infra/docker/scripts/flow-images.sh
#
# The same flow runs against the **Kubernetes deployment** — the images are the
# same artefacts, so the only thing that changes is where the Gateway is and how
# the notification log is read:
#
#   pnpm k8s:forward &   # 3000 -> gateway
#   BANK_LOGS_CMD="kubectl logs -n bank-usac deploy/bank-usac-notification-audit-service --tail 400" \
#     ./infra/docker/scripts/flow-images.sh
#
# `SEED_DEMO_DATA=true` matters here and nowhere else in these three lines:
# step 5 below needs a staff session to put money into an account, and
# self-service registration can only ever create a `CLIENTE`
# (`customers.controller.ts`, `#requireAdministrator`) — there is no route
# through which an anonymous caller, or this script, can mint the very first
# `CAJERO_RECEPTOR`. The seeded demo teller is the documented bootstrap for
# exactly that case. Leave it off and step 5 fails with a message that says
# so, rather than falling back to something else.
#
# Every request enters through the Gateway, which is the only door the system
# has (§4.1). Nothing here talks to a service directly, and nothing here reads
# or writes a service's database.
#
# What this proves: seven images, one network, and the assignment's flow start
# to finish — register, activate, sign in, open two accounts, fund one through
# the real teller-deposit route, then the Saga's own KYC gate (T-31) refusing a
# transfer before the customer is verified, then the Saga in all three of its
# shapes once a teller verifies them. One transfer COMPLETES; one payment is
# refused on the first attempt and the Saga COMPENSATES; one climbs the retry
# ladder to its end and COMPENSATES the same way. The source balance is read
# before and after each, so the compensation — and the KYC refusal's *lack* of
# one — is a fact about the money, not a status somebody wrote down. The
# seventh image, the audit trail, is read at the end to show it recorded all
# four.

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "${SCRIPT_DIR}/../../.." && pwd)"

GATEWAY="http://localhost:${BANK_GATEWAY_PORT:-3000}"
STAMP="$(date +%s)"
EMAIL="t21-${STAMP}@bank.usac.gt"
CREDENTIAL='Contrasena-Segura-2026'

cd "$REPO_ROOT"

# Optional, because this script also runs against the Kubernetes deployment,
# where the credentials live in the cluster's Secret rather than in this file
# and the only thing needed from here is SEED_PASSWORD.
if [[ -f infra/docker/.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source infra/docker/.env
  set +a
fi

# How to read the notification service's log. The default is the Compose
# container; the Kubernetes deployment overrides it, which is the only
# difference between running this flow there and running it here:
#
#   BANK_LOGS_CMD="kubectl logs -n bank-usac deploy/bank-usac-notification-audit-service --tail 400"
#
# Everything else in this script is curl against $GATEWAY and does not care
# where the Gateway is.
BANK_LOGS_CMD="${BANK_LOGS_CMD:-docker logs notification-audit-service}"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
note() { printf '   \033[33m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$1"; exit 1; }

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
  # The field is `deliveryLink`, not `activationLink`. It was renamed on
  # purpose — see the comment in notification-audit-service's
  # interfaces/logging.ts — and this grep was not updated with it, which broke
  # this script at step 2 for every caller, Compose included. Both spellings
  # are accepted so an older container's log still parses.
  token="$($BANK_LOGS_CMD 2>&1 \
    | grep "$correlation" \
    | sed -nE 's/.*"(deliveryLink|activationLink)":"[^"]*token=([^"&]*)".*/\2/p' | tail -1)"
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

step "5. give the source account a balance  →  a teller's deposit, POST /api/accounts/{id}/deposit"
# The front door for money entering an account (A-05) — the route TD-018
# names as half-closed: a CAJERO_RECEPTOR or ADMINISTRADOR session credits the
# account and the response carries the resulting balance. No SQL, and no
# service is touched directly.
#
# Getting that session is the one thing a fresh registration cannot do:
# self-service registration only ever creates a CLIENTE (see the header
# above), so there is no route through which this script could mint its own
# CAJERO_RECEPTOR. The seeded demo teller is the documented way around
# exactly that — using it here is that mechanism doing its job, not a
# shortcut around the system.
note "signing in as the seeded demo teller — requires SEED_DEMO_DATA=true (see the header)"
teller_password="${SEED_PASSWORD:-BankUsac#2026}"
teller_session="$(curl -fsS -X POST "${GATEWAY}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"cajero@bankusac.gt\",\"credential\":\"${teller_password}\"}")" \
  || fail "the demo teller could not sign in — set SEED_DEMO_DATA=true for customer-service in infra/docker/.env, recreate the images stack, and re-run"

teller_token="$(echo "$teller_session" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[[ -n "$teller_token" ]] || fail "no token in the teller's login response: ${teller_session}"
echo "   signed in as cajero@bankusac.gt, JWT issued (${#teller_token} characters)"

deposited="$(curl -fsS -X POST "${GATEWAY}/api/accounts/${source_account}/deposit" \
  -H "Authorization: Bearer ${teller_token}" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"amount":{"amountMinor":150000,"currency":"GTQ"},"description":"Deposito inicial - flow-images.sh"}')" \
  || fail "the deposit was refused"
echo "   200 OK — ${deposited}"

balance="$(curl -fsS "${GATEWAY}/api/accounts/${source_account}/balance" "${auth[@]}")"
echo "   GET /api/accounts/{id}/balance → ${balance}"

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

step "6. a transfer before KYC verification  →  the Saga's own gate refuses it (T-31)"
# A freshly-registered customer's kycStatus is PENDING (T-26). Nothing in this
# script has verified it yet, so the transfer Saga must refuse the transfer
# before ordering any debit — no compensation, because no money moved.
before="$(balance_of "$source_account")"
gated="$(transfer_of none)"
gated_id="$(echo "$gated" | sed -n 's/.*"transactionId":"\([^"]*\)".*/\1/p')"
echo "   202 Accepted — transactionId ${gated_id}"

state="$(settle "$gated_id")" || fail "the gated transfer never settled: ${state}"
echo "   settled: $(transfer_status "$state")"
echo "   ${state}"

after="$(balance_of "$source_account")"
echo "   source balance ${before} → ${after} minor units (must be unchanged)"
[[ "$state" == *'"status":"FAILED"'* ]] || fail "expected FAILED before KYC verification, got: ${state}"
[[ "$state" == *'"reason":"KYC_NOT_VERIFIED"'* ]] || fail "expected reason KYC_NOT_VERIFIED, got: ${state}"
[[ "$before" -eq "$after" ]] || fail "the KYC gate let money move: ${before} → ${after}"
echo "   refused before any debit — the source balance never moved"
gated_correlation="$(transfer_correlation "$state")"

step "7. a teller verifies the customer's KYC  →  POST /api/customers/{id}/kyc-status"
# The same teller session step 5 already holds — no second bootstrap needed.
kyc_verified="$(curl -fsS -X POST "${GATEWAY}/api/customers/${customer_id}/kyc-status" \
  -H "Authorization: Bearer ${teller_token}" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"status":"VERIFIED"}')" || fail "the KYC verdict was refused"
echo "   202 Accepted — ${kyc_verified}"
sleep 2

step "8. a transfer that works  →  POST /api/transfers"
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

step "9. a payment the provider refuses  →  the Saga compensates"
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

step "10. a payment that keeps timing out  →  the ladder, then the compensation"
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

step "11. the audit trail  →  the seventh image"
# The trail is restricted to ADMINISTRADOR (D-06, TD-021), so this client
# session cannot read it over HTTP. What it can be shown to have recorded is
# read from the service's own log, which is where a container's evidence lives.
for label in "the transfer refused for KYC:${gated_correlation}" \
             "the transfer that worked:${happy_correlation}" \
             "the payment that was refused:${declined_correlation}" \
             "the payment that timed out:${flaky_correlation}"; do
  echo "   ${label%%:*}"
  $BANK_LOGS_CMD 2>&1 \
    | grep "${label##*:}" \
    | sed -n 's/.*"messageType":"\([^"]*\)".*"outcome":"\([^"]*\)".*/     \1 → \2/p' \
    | sort -u
done

echo
echo "════════════════════════════════════════════════════════════════"
echo " Four Sagas, seven images, one network."
echo
echo " FAILED      — the KYC gate refused before any debit (T-31)"
echo " COMPLETED   — debit, payment, credit"
echo " COMPENSATED — a refusal, and the money given back"
echo " COMPENSATED — a retry ladder climbed to its end, then the same"
echo
echo " Every request entered through the Gateway; no service was called"
echo " directly and no service read another's database — not even the source"
echo " balance, which arrived through a teller's deposit (A-05), not SQL."
echo " The balances were checked before and after each transfer, so the"
echo " compensation — and the KYC refusal's lack of one — is a fact about the"
echo " money rather than a status somebody wrote down."
echo "════════════════════════════════════════════════════════════════"
