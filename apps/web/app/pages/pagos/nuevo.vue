<script setup lang="ts">
import { accountReference } from '../../lib/account';
import type { AccountSummary } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { LoadState } from '../../lib/gateway-error';
import { formatQuetzales, MIN_AMOUNT_MINOR } from '../../lib/money';
import type { Biller } from '../../lib/payment';
import type { PaymentScenario } from '../../lib/transaction';

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
 *
 * **`PaymentScenarioSelect` (added by T-29's correction).** Since a service
 * payment is the same `POST /api/transfers` a transfer is, it goes through the
 * identical Payment Service simulation — but until this fix, this screen was
 * the one place in the product that could never demonstrate it: a pago de
 * servicio always ran with no scenario, so a timeout, a rejection or a
 * transient failure could only ever be rehearsed from `/transferencias/nueva`,
 * never from the external-payment screen the ticket is actually about.
 */
const api = useGatewayApi();
const { role, session } = useSession();

/**
 * A courtesy warning, not the rule itself (T-31) — see the identical notice in
 * `TransactionTransferForm`. A service payment is a transfer, so it goes
 * through the same KYC gate; staff are never gated by it.
 */
const ownKycStatus = ref<'PENDING' | 'VERIFIED' | 'REJECTED' | null>(null);
const ownKycLoading = ref(false);

async function loadOwnKyc(): Promise<void> {
  if (role.value === null || role.value !== 'CLIENTE' || session.value === null) {
    return;
  }

  ownKycLoading.value = true;
  const result = await api.call<{ kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' }>(
    `/api/customers/${session.value.customerId}`,
  );
  ownKycLoading.value = false;

  if (result.ok) {
    ownKycStatus.value = result.data.kycStatus;
  }
}

const kycBlocksSubmission = computed(
  () => ownKycStatus.value !== null && ownKycStatus.value !== 'VERIFIED',
);

/**
 * Format holder name to show first name and primary surname.
 */
function formatDisplayName(name?: string): string {
  if (!name || name.trim().length === 0) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  const first = parts[0]!;
  const surname = parts.length >= 3 ? parts[2]! : parts[1]!;
  return `${first} ${surname}`;
}

const sourceAccount = ref<string | undefined>(undefined);
const billerCode = ref<string | undefined>(undefined);
const amountMinor = ref<number | null>(null);
const reference = ref('');
const paymentScenario = ref<PaymentScenario | null>(null);
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
  billers.value = catalogue.ok ? catalogue.data.billers : [];
  state.value = 'READY';
}

onMounted(() => {
  load();
  loadOwnKyc();
  if (import.meta.client) {
    window.addEventListener('focus', loadOwnKyc);
  }
});

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('focus', loadOwnKyc);
  }
});

function describe(account: AccountSummary): string {
  const kind = account.accountType === 'MONETARIA' ? 'Monetaria' : 'Ahorro';
  const namePart = account.holderName ? `${formatDisplayName(account.holderName)} · ` : '';

  return `${namePart}${kind} · ${accountReference(account)} · ${formatQuetzales(account.balance.amountMinor)}`;
}

const sourceItems = computed(() =>
  accounts.value.map((account) => ({
    value: account.accountId,
    label: describe(account),
  })),
);

const billerItems = computed(() =>
  billers.value.map((biller) => ({
    value: biller.code,
    label: biller.name,
  })),
);

const source = computed(
  () => accounts.value.find((account) => account.accountId === sourceAccount.value) ?? null,
);

const targetAccount = computed(() => {
  return billers.value.find((biller) => biller.code === billerCode.value)?.accountId ?? '';
});

const localProblem = computed(() => {
  if (amountMinor.value !== null && amountMinor.value < MIN_AMOUNT_MINOR) {
    return 'El monto tiene que ser mayor que cero.';
  }

  if (
    source.value !== null &&
    amountMinor.value !== null &&
    amountMinor.value > source.value.balance.amountMinor
  ) {
    return 'El monto es mayor que el saldo disponible de la cuenta de origen.';
  }

  if (billerCode.value !== undefined && reference.value.trim() === '') {
    return 'El servicio necesita un número de contrato o referencia.';
  }

  return null;
});

const canSend = computed(
  () =>
    !kycBlocksSubmission.value &&
    sourceAccount.value !== undefined &&
    targetAccount.value !== '' &&
    reference.value.trim() !== '' &&
    amountMinor.value !== null &&
    amountMinor.value >= MIN_AMOUNT_MINOR &&
    localProblem.value === null &&
    !sending.value,
);

async function send(): Promise<void> {
  if (kycBlocksSubmission.value || amountMinor.value === null || sourceAccount.value === undefined) {
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
        reference: reference.value.trim(),
        ...(paymentScenario.value === null ? {} : { paymentScenario: paymentScenario.value }),
      },
    },
  );

  sending.value = false;

  if (result.ok) {
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
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Pago de servicios</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Paga servicios públicos (luz, agua, telefonía) con débito directo a tu cuenta bancaria.
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
          <div v-if="kycBlocksSubmission" class="flex flex-col gap-2">
            <UAlert
              color="warning"
              variant="subtle"
              title="Verificación de identidad pendiente"
              description="Tu expediente se encuentra pendiente de verificación de identidad. No es posible realizar pagos de servicios hasta que tu documento sea aprobado por un cajero o administrador."
              data-testid="payment-kyc-blocked"
            />
            <div class="flex justify-end">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :loading="ownKycLoading"
                icon="i-lucide-refresh-cw"
                @click="loadOwnKyc"
              >
                ¿Ya fue aprobada tu verificación? Actualizar estado
              </UButton>
            </div>
          </div>

          <UFormField label="Cuenta origen" name="sourceAccount">
            <USelectMenu
              v-model="sourceAccount"
              class="w-full"
              :items="sourceItems"
              value-key="value"
              placeholder="Elige o busca una cuenta..."
              :search-input="{ placeholder: 'Buscar por titular o número de cuenta...' }"
            />
            <p v-if="source" class="tab mt-1 text-[13px] text-[#5A5B63]">
              Saldo disponible: <strong class="font-semibold text-[#23242A]">{{
                formatQuetzales(source.balance.amountMinor)
              }}</strong>
            </p>
          </UFormField>

          <UFormField
            label="Servicio público o factura"
            name="biller"
            :help="billers.length === 0 ? 'No pudimos cargar el catálogo de servicios.' : undefined"
          >
            <USelectMenu
              v-model="billerCode"
              class="w-full"
              :items="billerItems"
              value-key="value"
              placeholder="Elige el servicio (EEGSA, EMPAGUA, Claro...)"
              :search-input="{ placeholder: 'Buscar servicio...' }"
            />
          </UFormField>

          <SharedMoneyInput label="Monto" name="amount" @update:amount-minor="amountMinor = $event" />

          <UFormField
            label="Número de contrato o referencia"
            name="reference"
            help="Número de contrato, de medidor o de línea. Es lo que le dice al prestador de quién es el pago."
          >
            <UInput
              v-model="reference"
              placeholder="Ej. 24891024"
              class="tab w-full font-mono text-[13px]"
              maxlength="60"
            />
          </UFormField>

          <PaymentScenarioSelect v-model="paymentScenario" />

          <p v-if="localProblem" class="text-[13px] text-[#B01B1B]" data-testid="payment-local-problem">
            {{ localProblem }}
          </p>

          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            title="No pudimos registrar el pago"
            :description="failure"
          />

          <SharedIdempotencyKeyField v-model="idempotencyKey" />

          <div class="flex items-center justify-between gap-3">
            <UButton
              type="submit"
              color="primary"
              size="lg"
              :loading="sending"
              :disabled="!canSend"
            >
              {{ kycBlocksSubmission ? 'Pagos bloqueados (requiere verificación)' : 'Pagar servicio' }}
            </UButton>
            <SharedCorrelationIdBadge :correlation-id="correlationId" />
          </div>
        </form>
      </UCard>

      <UCard class="text-[13px] leading-5 text-[#5A5B63]">
        <h2 class="text-[14px] font-semibold text-[#23242A]">Qué pasa al pagar</h2>
        <ul class="mt-2 list-disc space-y-2 pl-4">
          <li>
            Un pago de servicio es una transferencia a la cuenta recaudadora del prestador (luz, agua, teléfono), y pasa por los mismos pasos: se descuenta de tu cuenta, se procesa el pago y se acredita al prestador.
          </li>
          <li>
            Si algo falla después del débito, el dinero se devuelve automáticamente mediante la compensación de la Saga.
          </li>
          <li>
            El saldo mostrado es el de la última consulta. Si alcanza o no se decide en el momento del cobro.
          </li>
        </ul>
        <p class="mt-4 border-t border-[#E9E9EC] pt-3 text-[12px] text-[#75767F]">
          Al terminar te llevamos al seguimiento de la transferencia, que es donde se ve cada paso.
        </p>
      </UCard>
    </div>
  </section>
</template>
