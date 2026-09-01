<script setup lang="ts">
import type { AccountSummary } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { LoadState } from '../../lib/gateway-error';
import { formatQuetzales, MIN_AMOUNT_MINOR } from '../../lib/money';
import type { Biller, PaymentKind } from '../../lib/payment';

/**
 * `G-01` — "Nuevo pago", and the screen that made this module a product rather
 * than a monitor.
 *
 * **A service payment is a transfer.** The biller holds a collection account at
 * this bank, so paying EEGSA is `POST /api/transfers` with EEGSA's account as
 * the target and the contract number as the `reference`. That is how the
 * product works in the world, and it is why this needed no second Saga, no
 * nullable target account and no branch in the six-state machine — the ledger
 * does not have the distinction, so neither does the system.
 *
 * The prototype's first question is internal or external, and it is a property
 * of the **destination** rather than a separate product: an internal payment
 * targets one of your own accounts and carries no reference, an external one
 * targets a biller and carries the number that tells them whose bill was paid.
 *
 * The catalogue is **asked for**, never compiled in. A biller's collection
 * account id in a browser bundle is an account id that is wrong the first time
 * anything is reseeded.
 */
const api = useGatewayApi();

/**
 * `null` is "nothing chosen yet", and it cannot be `''`.
 *
 * A `USelect` item whose value is the empty string never opens: Reka reserves
 * the empty string for "no selection" and refuses it as an item value. The
 * failure is silent — the trigger flips `aria-expanded` to `true`, the list
 * never mounts, and nothing is logged where a form would show it. Both selects
 * on this screen had it, so **this form has never been usable in a browser**:
 * neither the account nor the biller could be picked. Found by opening it
 * (TD-054); `PaymentScenarioSelect` had the right shape all along.
 */
const kind = ref<PaymentKind>('EXTERNAL');
const sourceAccount = ref<string | null>(null);
const billerCode = ref<string | null>(null);
const internalTarget = ref<string | null>(null);
const amountMinor = ref<number | null>(null);
const reference = ref('');
const idempotencyKey = ref('');

const accounts = ref<readonly AccountSummary[]>([]);
const billers = ref<readonly Biller[]>([]);
const state = ref<LoadState>('LOADING');
const loadFailure = ref<string | null>(null);

const sending = ref(false);
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

async function load(): Promise<void> {
  state.value = 'LOADING';
  loadFailure.value = null;

  const [mine, catalogue] = await Promise.all([
    api.call<{ accounts: AccountSummary[] }>('/api/accounts'),
    api.call<{ billers: Biller[] }>('/api/accounts/billers'),
  ]);

  if (!mine.ok) {
    loadFailure.value = mine.error.message;
    state.value = asyncStateFor(mine.error);
    return;
  }

  accounts.value = mine.data.accounts.filter((account) => account.status === 'ACTIVE');
  // A catalogue that failed to load is not a reason to refuse an internal
  // payment, so this failure narrows the screen instead of stopping it.
  billers.value = catalogue.ok ? catalogue.data.billers : [];
  state.value = 'READY';
}

onMounted(load);

const source = computed(
  () => accounts.value.find((account) => account.accountId === sourceAccount.value) ?? null,
);

const targetAccount = computed(() => {
  if (kind.value === 'INTERNAL') {
    return internalTarget.value ?? '';
  }

  return billers.value.find((biller) => biller.code === billerCode.value)?.accountId ?? '';
});

/** The accounts an internal payment may go to: mine, except the one paying. */
const internalTargets = computed(() =>
  accounts.value.filter((account) => account.accountId !== sourceAccount.value),
);

const localProblem = computed(() => {
  if (amountMinor.value !== null && amountMinor.value < MIN_AMOUNT_MINOR) {
    return 'El monto tiene que ser mayor que cero.';
  }

  /**
   * Checked here so the form can say so while somebody is typing. It is **not**
   * the guarantee: the balance moves on its own, and Account Service decides
   * under a row lock. A screen that treated this as the answer would refuse a
   * payment that a deposit had just made affordable.
   */
  if (
    source.value !== null &&
    amountMinor.value !== null &&
    amountMinor.value > source.value.balance.amountMinor
  ) {
    return 'El monto es mayor que el saldo disponible de la cuenta de origen.';
  }

  if (kind.value === 'EXTERNAL' && billerCode.value !== null && reference.value.trim() === '') {
    return 'El servicio necesita un número de contrato o referencia.';
  }

  return null;
});

const canSend = computed(
  () =>
    sourceAccount.value !== null &&
    targetAccount.value !== '' &&
    targetAccount.value !== sourceAccount.value &&
    amountMinor.value !== null &&
    amountMinor.value >= MIN_AMOUNT_MINOR &&
    (kind.value === 'INTERNAL' || reference.value.trim() !== '') &&
    localProblem.value === null &&
    !sending.value,
);

async function send(): Promise<void> {
  if (amountMinor.value === null || sourceAccount.value === null) {
    return;
  }

  sending.value = true;
  failure.value = null;

  const result = await api.call<{ transactionId: string; correlationId: string }>(
    '/api/transfers',
    {
      method: 'POST',
      idempotencyKey: idempotencyKey.value,
      body: {
        sourceAccount: sourceAccount.value,
        targetAccount: targetAccount.value,
        amount: { amountMinor: amountMinor.value, currency: 'GTQ' },
        ...(kind.value === 'EXTERNAL' ? { reference: reference.value.trim() } : {}),
      },
    },
  );

  sending.value = false;

  if (result.ok) {
    // The Saga has four more steps to take; the tracking screen is where they
    // are watched, and it is the transfer's own screen because that is what
    // this is.
    await navigateTo(`/transferencias/${result.data.transactionId}`);
    return;
  }

  correlationId.value = result.error.correlationId;
  failure.value = result.error.message;
}

useHead({ title: 'Nuevo pago · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Nuevo pago</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Paga un servicio o mueve dinero entre tus cuentas.
        </p>
      </div>
      <UButton to="/pagos" variant="outline" color="neutral">Volver</UButton>
    </header>

    <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
      <USkeleton v-for="line in 4" :key="line" class="h-14 w-full rounded-xl" />
    </div>

    <SharedAsyncStateAlert
      v-else-if="state !== 'READY'"
      :state="state"
      :message="loadFailure"
      @retry="load"
    />

    <div v-else class="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
      <UCard>
        <form class="flex flex-col gap-5" @submit.prevent="send">
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-[14px] font-semibold">Tipo de pago</legend>

            <div class="grid gap-3 sm:grid-cols-2">
              <label
                v-for="option in [
                  { value: 'INTERNAL' as const, title: 'Pago interno', hint: 'Entre tus cuentas de este banco' },
                  { value: 'EXTERNAL' as const, title: 'Pago externo', hint: 'Luz, agua, teléfono' },
                ]"
                :key="option.value"
                class="flex cursor-pointer items-start gap-3 rounded-xl border p-4"
                :class="
                  kind === option.value
                    ? 'border-[#17191F] bg-[#F0F0F2]'
                    : 'border-[#DCDCE0] bg-white'
                "
              >
                <input v-model="kind" type="radio" :value="option.value" class="mt-1">
                <span>
                  <span class="block text-[14px] font-semibold text-[#23242A]">{{ option.title }}</span>
                  <span class="block text-[13px] leading-5 text-[#5A5B63]">{{ option.hint }}</span>
                </span>
              </label>
            </div>
          </fieldset>

          <UFormField label="Cuenta origen" name="sourceAccount">
            <USelect
              v-model="sourceAccount"
              class="w-full"
              :items="[
                { value: null, label: 'Elige una cuenta' },
                ...accounts.map((account) => ({
                  value: account.accountId,
                  label: `${account.accountType === 'MONETARIA' ? 'Monetaria' : 'Ahorro'} · ${account.accountId.slice(-10)}`,
                })),
              ]"
              value-key="value"
            />
            <p v-if="source" class="tab mt-1 text-[13px] text-[#5A5B63]">
              Saldo disponible: <strong class="font-semibold text-[#23242A]">{{
                formatQuetzales(source.balance.amountMinor)
              }}</strong>
            </p>
          </UFormField>

          <UFormField
            v-if="kind === 'EXTERNAL'"
            label="Servicio destino"
            name="biller"
            :help="billers.length === 0 ? 'No pudimos cargar el catálogo de servicios.' : undefined"
          >
            <USelect
              v-model="billerCode"
              class="w-full"
              :items="[
                { value: null, label: 'Elige un servicio' },
                ...billers.map((biller) => ({ value: biller.code, label: biller.name })),
              ]"
              value-key="value"
            />
          </UFormField>

          <UFormField v-else label="Cuenta destino" name="internalTarget">
            <USelect
              v-model="internalTarget"
              class="w-full"
              :items="[
                { value: null, label: 'Elige una cuenta' },
                ...internalTargets.map((account) => ({
                  value: account.accountId,
                  label: `${account.accountType === 'MONETARIA' ? 'Monetaria' : 'Ahorro'} · ${account.accountId.slice(-10)}`,
                })),
              ]"
              value-key="value"
            />
          </UFormField>

          <SharedMoneyInput label="Monto" name="amount" @update:amount-minor="amountMinor = $event" />

          <UFormField
            v-if="kind === 'EXTERNAL'"
            label="Referencia"
            name="reference"
            help="Número de contrato, de medidor o de línea. Es lo que le dice al prestador de quién es el pago."
          >
            <UInput v-model="reference" class="tab w-full" maxlength="60" />
          </UFormField>

          <p v-if="localProblem" class="text-[13px] text-[#B01B1B]" data-testid="payment-local-problem">
            {{ localProblem }}
          </p>

          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            title="No pudimos registrar el pago"
            :description="failure"
            data-testid="payment-failure"
          />

          <SharedIdempotencyKeyField v-model="idempotencyKey" :visible="true" />

          <UButton type="submit" :loading="sending" :disabled="!canSend" block size="lg">
            Pagar
          </UButton>
        </form>
      </UCard>

      <UCard>
        <h2 class="text-[14px] font-semibold">Qué pasa al pagar</h2>
        <ul class="mt-3 flex list-disc flex-col gap-2 pl-4 text-[13px] leading-5 text-[#5A5B63]">
          <li>
            Un pago de servicio es una <strong class="font-semibold">transferencia</strong> a la
            cuenta recaudadora del prestador, y pasa por los mismos pasos: se descuenta de tu
            cuenta, se procesa el pago y se acredita al prestador.
          </li>
          <li>
            Si algo falla después del débito, el dinero
            <strong class="font-semibold">se devuelve automáticamente</strong> y verás dos
            movimientos en el estado de cuenta.
          </li>
          <li>
            El saldo que se muestra arriba es el de la última consulta. Si alcanza o no se decide
            en el momento del cobro, no ahora.
          </li>
        </ul>

        <p class="mt-4 border-t border-[#E9E9EC] pt-4 text-[13px] leading-5 text-[#5A5B63]">
          Al terminar te llevamos al seguimiento de la transferencia, que es donde se ve cada paso.
        </p>

        <SharedCorrelationIdBadge class="mt-4" :correlation-id="correlationId" />
      </UCard>
    </div>
  </section>
</template>
