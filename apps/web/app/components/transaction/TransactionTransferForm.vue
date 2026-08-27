<script setup lang="ts">
import { transferProblems } from '../../lib/transaction';
import type { PaymentScenario } from '../../lib/transaction';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';

/**
 * Asking for a transfer.
 *
 * Three things this screen is careful about, and each of them is a way a
 * transfer screen can cost somebody real money:
 *
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
 * There is deliberately **no balance check here**. Whether the source account
 * can afford this is Account Service's judgement, made under a row lock, and
 * anything this screen computed would be stale before it was drawn. Criterion 8
 * of the ticket says so, and a "saldo insuficiente" shown by a browser is the
 * kind of thing that is wrong exactly when it matters.
 */
const api = useGatewayApi();

const sourceAccount = ref('');
const targetAccount = ref('');
const amountMinor = ref<number | null>(null);
const amount = ref<number | null>(null);
const paymentScenario = ref<PaymentScenario | null>(null);
const idempotencyKey = ref('');

const submitted = ref(false);
const isSending = ref(false);
const state = ref<'IDLE' | AsyncState>('IDLE');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

const draft = computed(() => ({
  sourceAccount: sourceAccount.value,
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

async function submit(): Promise<void> {
  submitted.value = true;

  if (Object.keys(problems.value).length > 0 || isSending.value) {
    // Criterion: no request at all when local validation fails.
    state.value = 'VALIDATION_ERROR';
    message.value = 'Revisa los datos marcados. No se envió ninguna solicitud.';

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
        sourceAccount: sourceAccount.value.trim(),
        targetAccount: targetAccount.value.trim(),
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

    <form class="flex flex-col gap-5" @submit.prevent="submit">
      <UFormField
        label="Cuenta de origen"
        name="sourceAccount"
        :error="shown.sourceAccount"
        help="El accountId desde el que sale el dinero."
      >
        <UInput
          v-model="sourceAccount"
          placeholder="00000000-0000-4000-8000-000000000000"
          class="w-full"
          autocomplete="off"
          style="font-variant-numeric: tabular-nums lining-nums"
          data-testid="source-account"
        />
      </UFormField>

      <UFormField
        label="Cuenta de destino"
        name="targetAccount"
        :error="shown.targetAccount"
        help="El accountId que recibe el dinero. Debe ser distinta de la de origen."
      >
        <UInput
          v-model="targetAccount"
          placeholder="00000000-0000-4000-8000-000000000000"
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

      <SharedIdempotencyKeyField v-model="idempotencyKey" />

      <SharedAsyncStateAlert
        v-if="state !== 'IDLE' && state !== 'PENDING'"
        :state="state"
        :message="message"
        :correlation-id="correlationId"
      />

      <div class="flex flex-wrap gap-2">
        <UButton
          type="submit"
          color="primary"
          size="lg"
          class="flex-1"
          :loading="isSending"
          :disabled="isSending"
        >{{ canRetry ? 'Reintentar la transferencia' : 'Enviar la transferencia' }}</UButton>
        <UButton to="/cuentas" variant="ghost" color="neutral" :disabled="isSending">
          Ver mis cuentas
        </UButton>
      </div>

      <p v-if="canRetry" class="text-[13px] leading-5 text-[#5A5B63]">
        Reintentar es seguro: la clave de idempotencia no cambia, así que el sistema reconoce
        que es la misma transferencia y no la duplica.
      </p>
    </form>
  </UCard>
</template>
