<script setup lang="ts">
import type { AccountSummary } from '../../lib/account';
import { transferProblems } from '../../lib/transaction';
import type { PaymentScenario } from '../../lib/transaction';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState, LoadState } from '../../lib/gateway-error';
import { formatQuetzales } from '../../lib/money';

/**
 * Asking for a transfer.
 *
 * **Accounts are chosen, not typed.** This form used to ask for two account
 * identifiers as free text, with a 36-character UUID for a placeholder and
 * "el accountId desde el que sale el dinero" for help — on the one screen where
 * a customer moves their own money, and while `Nuevo pago` two routes away had
 * been offering a proper selector with balances all along. The list comes from
 * `GET /api/accounts`, which the Gateway already scopes by role: a client sees
 * their own accounts, staff see the ones they may act on.
 *
 * Where the money goes is a question with two answers, so the form asks it:
 * another of your own accounts is a choice from a list, someone else's account
 * is the number they gave you. Only the second one can be typed, and it is the
 * only place a 36-character identifier is unavoidable — the ledger has no
 * shorter account number to offer.
 *
 * Four things this screen is careful about, and each of them is a way a transfer
 * screen can cost somebody real money:
 *
 * - **Nothing is sent until it has been read back.** The review step repeats the
 *   two accounts and the amount, because this is the only operation where a
 *   customer moves their own money and the previous version sent it on one
 *   click. `Abrir cuenta` and `Depósito` had a confirmation; this did not.
 * - **It validates locally and sends nothing when validation fails.** The
 *   Gateway refuses the same three things; a `400` the interface could have
 *   prevented is an error somebody has to interpret, and the rules live in
 *   `app/lib/transaction.ts` where they are tested (TD-010).
 * - **The idempotency key survives a retry.** `SharedIdempotencyKeyField` stays
 *   mounted for the life of this form precisely so that pressing the button
 *   again after a timeout is recognised as the same intention rather than as a
 *   second transfer. That is the whole reason a timeout here is safe to retry.
 * - **A `202` is never shown as a completed transfer.** It navigates to the
 *   detail screen, where the state is followed honestly, rather than saying
 *   "transferencia enviada" and leaving somebody to assume the money arrived.
 *
 * There is deliberately **no balance check that refuses**. Whether the source
 * account can afford this is Account Service's judgement, made under a row lock,
 * and anything this screen computed would be stale before it was drawn. The
 * balance is shown next to the account because a person choosing where to take
 * money from needs to see it; it is not consulted to block the send.
 */
const api = useGatewayApi();

/**
 * `null` is "nothing chosen yet", and it has to be `null` rather than `''`.
 *
 * A `USelect` item whose value is the empty string never opens: Reka reserves
 * the empty string for "no selection" and refuses it as an item value, and the
 * failure is silent — the trigger flips `aria-expanded` to `true` and the list
 * never mounts. `PaymentScenarioSelect` had it right with `value: null`;
 * `pagos/nuevo` had it wrong, which is why its two selects had never opened.
 */
const sourceAccount = ref<string | null>(null);
const destination = ref<'MINE' | 'SOMEONE_ELSE'>('MINE');
const ownTarget = ref<string | null>(null);
const otherTarget = ref('');
const amountMinor = ref<number | null>(null);
const amount = ref<number | null>(null);
const paymentScenario = ref<PaymentScenario | null>(null);
const idempotencyKey = ref('');

const accounts = ref<readonly AccountSummary[]>([]);
const loadState = ref<LoadState>('LOADING');
const loadFailure = ref<string | null>(null);

const step = ref<'FORM' | 'REVIEW'>('FORM');
const submitted = ref(false);
const isSending = ref(false);
const state = ref<'IDLE' | AsyncState>('IDLE');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

async function load(): Promise<void> {
  loadState.value = 'LOADING';
  loadFailure.value = null;

  const mine = await api.call<{ accounts: AccountSummary[] }>('/api/accounts');

  if (!mine.ok) {
    loadFailure.value = mine.error.message;
    loadState.value = asyncStateFor(mine.error);

    return;
  }

  accounts.value = mine.data.accounts.filter((account) => account.status === 'ACTIVE');
  loadState.value = 'READY';

  /** One account can only send outward, so do not offer a list of none. */
  if (accounts.value.length < 2) {
    destination.value = 'SOMEONE_ELSE';
  }
}

onMounted(load);

const source = computed(
  () => accounts.value.find((account) => account.accountId === sourceAccount.value) ?? null,
);

/** The accounts a transfer of mine may land in: mine, except the one paying. */
const ownTargets = computed(() =>
  accounts.value.filter((account) => account.accountId !== sourceAccount.value),
);

const targetAccount = computed(() =>
  destination.value === 'MINE' ? (ownTarget.value ?? '') : otherTarget.value.trim(),
);

const target = computed(
  () => accounts.value.find((account) => account.accountId === targetAccount.value) ?? null,
);

const draft = computed(() => ({
  sourceAccount: sourceAccount.value ?? '',
  targetAccount: targetAccount.value,
  amountMinor: amountMinor.value,
}));

const problems = computed(() => transferProblems(draft.value));

/** Errors appear after the first attempt, not while somebody is still typing. */
const shown = computed(() => (submitted.value ? problems.value : {}));

/**
 * A retry after a timeout is safe and is offered; a retry after a business
 * rejection is not, because the same request would be refused for the same
 * reason. The two are different alerts and only one of them gets a button.
 */
const canRetry = computed(
  () => state.value === 'REPLY_TIMEOUT' || state.value === 'BROKER_UNAVAILABLE',
);

/** How an account reads in a list: what kind it is, which one, and what is in it. */
function describe(account: AccountSummary): string {
  const kind = account.accountType === 'MONETARIA' ? 'Monetaria' : 'Ahorro';

  return `${kind} · ···${account.accountId.slice(-6)} · ${formatQuetzales(account.balance.amountMinor)}`;
}

/** What the review step calls the account that receives the money. */
const targetLabel = computed(() => {
  if (target.value !== null) {
    return describe(target.value);
  }

  return `Cuenta de otra persona · ···${targetAccount.value.slice(-6)}`;
});

function review(): void {
  submitted.value = true;

  if (Object.keys(problems.value).length > 0) {
    // Criterion: no request at all when local validation fails.
    state.value = 'VALIDATION_ERROR';
    message.value = 'Revisa los datos marcados. No se envió ninguna solicitud.';

    return;
  }

  state.value = 'IDLE';
  message.value = undefined;
  step.value = 'REVIEW';
}

function correct(): void {
  step.value = 'FORM';
  state.value = 'IDLE';
  message.value = undefined;
}

async function submit(): Promise<void> {
  if (isSending.value) {
    return;
  }

  isSending.value = true;
  state.value = 'PENDING';
  message.value = undefined;

  const result = await api.call<{ transactionId: string; correlationId: string }>(
    '/api/transfers',
    {
      method: 'POST',
      body: {
        sourceAccount: draft.value.sourceAccount.trim(),
        targetAccount: targetAccount.value,
        amount: { amountMinor: amountMinor.value, currency: 'GTQ' },
        ...(paymentScenario.value === null ? {} : { paymentScenario: paymentScenario.value }),
      },
      idempotencyKey: idempotencyKey.value,
    },
  );

  isSending.value = false;

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    correlationId.value = result.error.correlationId;

    return;
  }

  correlationId.value = result.data.correlationId ?? result.correlationId;

  /**
   * The `202` means *accepted*, not *done*, so this goes to the screen that
   * says so and follows it. Announcing success here would be the one thing the
   * ticket's list of mandatory states forbids outright.
   */
  await navigateTo(`/transferencias/${result.data.transactionId}`);
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-[20px] font-semibold leading-7">Nueva transferencia</h2>
      <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
        La transferencia es asíncrona: al enviarla el sistema la acepta, todavía no la completa.
        En la pantalla siguiente verás avanzar su estado.
      </p>
    </template>

    <div v-if="loadState === 'LOADING'" class="flex flex-col gap-3">
      <USkeleton v-for="line in 4" :key="line" class="h-12 w-full rounded-xl" />
    </div>

    <SharedAsyncStateAlert
      v-else-if="loadState !== 'READY'"
      :state="loadState"
      :message="loadFailure ?? undefined"
      @retry="load"
    />

    <div
      v-else-if="accounts.length === 0"
      class="py-8 text-center"
      data-testid="transfer-no-accounts"
    >
      <p class="text-[18px] font-semibold leading-7">No tienes cuentas activas</p>
      <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
        Para enviar dinero necesitas al menos una cuenta activa de la que pueda salir.
      </p>
      <UButton to="/cuentas/nueva" class="mt-4" color="primary">Abrir una cuenta</UButton>
    </div>

    <!-- Paso 1: los datos. -->
    <form v-else-if="step === 'FORM'" class="flex flex-col gap-5" @submit.prevent="review">
      <UFormField
        label="Cuenta de origen"
        name="sourceAccount"
        :error="shown.sourceAccount"
        help="De aquí sale el dinero."
      >
        <USelect
          v-model="sourceAccount"
          class="w-full"
          value-key="value"
          data-testid="source-account"
          :items="[
            { value: null, label: 'Elige una cuenta' },
            ...accounts.map((account) => ({
              value: account.accountId,
              label: describe(account),
            })),
          ]"
        />
      </UFormField>

      <UFormField label="¿A dónde va el dinero?" name="destination">
        <URadioGroup
          v-model="destination"
          :disabled="ownTargets.length === 0"
          :items="[
            { value: 'MINE', label: 'A otra de mis cuentas' },
            { value: 'SOMEONE_ELSE', label: 'A la cuenta de otra persona' },
          ]"
        />
        <p v-if="ownTargets.length === 0" class="mt-1 text-[13px] text-[#5A5B63]">
          Solo tienes una cuenta activa, así que el dinero tiene que ir a la cuenta de otra
          persona.
        </p>
      </UFormField>

      <UFormField
        v-if="destination === 'MINE'"
        label="Cuenta de destino"
        name="targetAccount"
        :error="shown.targetAccount"
        help="Aquí entra el dinero."
      >
        <USelect
          v-model="ownTarget"
          class="w-full"
          value-key="value"
          data-testid="own-target-account"
          :items="[
            { value: null, label: 'Elige una cuenta' },
            ...ownTargets.map((account) => ({
              value: account.accountId,
              label: describe(account),
            })),
          ]"
        />
      </UFormField>

      <UFormField
        v-else
        label="Número de cuenta de destino"
        name="targetAccount"
        :error="shown.targetAccount"
        help="Pídeselo a la persona que va a recibir el dinero. Son 36 caracteres."
      >
        <UInput
          v-model="otherTarget"
          placeholder="Pega aquí el número de cuenta"
          class="w-full"
          autocomplete="off"
          style="font-variant-numeric: tabular-nums lining-nums"
          data-testid="target-account"
        />
      </UFormField>

      <div>
        <SharedMoneyInput v-model="amount" @update:amount-minor="amountMinor = $event" />
        <p v-if="shown.amount" class="mt-2 text-[13px] text-[#B01B1B]">{{ shown.amount }}</p>
      </div>

      <PaymentScenarioSelect v-model="paymentScenario" />

      <SharedAsyncStateAlert
        v-if="state === 'VALIDATION_ERROR'"
        :state="state"
        :message="message"
      />

      <div class="flex flex-wrap gap-2">
        <UButton type="submit" color="primary" size="lg" class="flex-1">Continuar</UButton>
        <UButton to="/cuentas" variant="ghost" color="neutral">Ver mis cuentas</UButton>
      </div>
    </form>

    <!--
      Paso 2: leerlo antes de enviarlo. Un dígito equivocado en la cuenta de
      destino manda dinero real a otra persona, y hasta aquí esta pantalla lo
      enviaba con un solo clic.
    -->
    <div v-else class="flex flex-col gap-5" data-testid="transfer-review">
      <div class="rounded-xl border border-[#E9E9EC] p-4">
        <h3 class="text-[16px] font-semibold leading-6">Revisa antes de enviar</h3>

        <dl class="mt-3 flex flex-col gap-3">
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-[13px] text-[#5A5B63]">Sale de</dt>
            <dd class="tab text-[14px] font-medium text-[#23242A]">
              {{ source === null ? sourceAccount : describe(source) }}
            </dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-[13px] text-[#5A5B63]">Entra a</dt>
            <dd class="tab text-[14px] font-medium text-[#23242A]">{{ targetLabel }}</dd>
          </div>
          <div class="flex flex-wrap items-baseline justify-between gap-2 border-t border-[#E9E9EC] pt-3">
            <dt class="text-[13px] text-[#5A5B63]">Monto</dt>
            <dd class="tab text-[22px] font-bold leading-7 text-[#23242A]">
              {{ formatQuetzales(amountMinor ?? 0) }}
            </dd>
          </div>
        </dl>
      </div>

      <SharedIdempotencyKeyField v-model="idempotencyKey" />

      <SharedAsyncStateAlert
        v-if="state !== 'IDLE' && state !== 'PENDING'"
        :state="state"
        :message="message"
        :correlation-id="correlationId"
      />

      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          size="lg"
          class="flex-1"
          :loading="isSending"
          :disabled="isSending"
          data-testid="confirm-transfer"
          @click="submit"
        >{{ canRetry ? 'Volver a intentar el envío' : 'Confirmar y enviar' }}</UButton>
        <UButton variant="ghost" color="neutral" :disabled="isSending" @click="correct">
          Corregir
        </UButton>
      </div>

      <p v-if="canRetry" class="text-[13px] leading-5 text-[#5A5B63]">
        Volver a intentarlo es seguro: el código de la operación no cambia, así que el sistema
        reconoce que es la misma transferencia y no la duplica.
      </p>
    </div>
  </UCard>
</template>
