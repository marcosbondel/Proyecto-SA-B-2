<script setup lang="ts">
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { isInFlight, statusFilterOptions } from '../../lib/transaction';
import type { TransactionStatus, TransferRow } from '../../lib/transaction';
import { formatQuetzales } from '../../lib/money';

/**
 * `T-05` — the operational view of the Saga, for staff.
 *
 * A separate screen from `/transferencias` rather than a widened version of it,
 * because the two answer different questions. A customer's history asks "what
 * happened to my money"; this asks "is anything stuck", and the counters at the
 * top are the whole point: a transfer sitting in `PAYMENT_PENDING` has already
 * been debited, so the number of in-flight transfers is the number of customers
 * whose money is currently nowhere.
 *
 * **It filters by asking, not by hiding.** The status filter goes to the
 * Gateway and from there to Transaction Service, which is also what applies the
 * scope — this screen never receives a row it then declines to draw.
 *
 * The redirect for a client is a courtesy, not the defence: the listing they
 * would get is their own transfers, because the owning service scopes it, so
 * the worst case of reaching this page is a monitor of one person's transfers.
 * It is still the wrong screen for them.
 */
const api = useGatewayApi();
const { role } = useSession();

const isStaff = computed(() => role.value !== null && role.value !== 'CLIENTE');

watchEffect(() => {
  if (role.value !== null && !isStaff.value) {
    void navigateTo('/transferencias');
  }
});

const rows = ref<readonly TransferRow[]>([]);
const total = ref(0);
const state = ref<AsyncState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);
const status = ref<TransactionStatus | ''>('');

async function load(): Promise<void> {
  state.value = 'LOADING';
  failure.value = null;

  const result = await api.call<{
    transactions: TransferRow[];
    total: number;
    correlationId: string;
  }>('/api/transfers', {
    query: {
      limit: '100',
      ...(status.value === '' ? {} : { status: status.value }),
    },
  });

  if (result.ok) {
    rows.value = result.data.transactions;
    total.value = result.data.total;
    correlationId.value = result.data.correlationId;
    state.value = 'READY';
    return;
  }

  correlationId.value = result.error.correlationId;
  failure.value = result.error.message;
  state.value = asyncStateFor(result.error);
}

onMounted(load);
watch(status, load);

/**
 * The three numbers worth having above the table.
 *
 * They are computed from the rows on screen and say so — a count over a
 * hundred-row page is not a count over the bank, and labelling it as one would
 * be the kind of dashboard number nobody can reproduce.
 */
const inFlight = computed(() => rows.value.filter((row) => isInFlight(row.status)));
const compensated = computed(() => rows.value.filter((row) => row.status === 'COMPENSATED'));
const strandedMinor = computed(() =>
  inFlight.value
    .filter((row) => row.status === 'PAYMENT_PENDING')
    .reduce((sum, row) => sum + row.amount.amountMinor, 0),
);

useHead({ title: 'Monitoreo de transferencias · bonking' });
</script>

<template>
  <section v-if="isStaff" class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Monitoreo de transferencias</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          El estado de la Saga en las transferencias más recientes.
        </p>
      </div>
      <UButton to="/transferencias" variant="outline" color="neutral">Volver al módulo</UButton>
    </header>

    <div class="grid gap-4 sm:grid-cols-3">
      <UCard>
        <p class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">En vuelo</p>
        <p class="tab mt-1 text-[32px] font-bold leading-10">{{ inFlight.length }}</p>
        <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
          Aceptadas, debitando o esperando el pago.
        </p>
      </UCard>

      <UCard>
        <p class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">Compensadas</p>
        <p class="tab mt-1 text-[32px] font-bold leading-10 text-[#8A1010]">
          {{ compensated.length }}
        </p>
        <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
          El dinero salió y volvió. Se ven dos movimientos en el estado de cuenta.
        </p>
      </UCard>

      <UCard>
        <p class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">Débito sin cerrar</p>
        <p class="tab mt-1 text-[32px] font-bold leading-10">
          {{ formatQuetzales(strandedMinor) }}
        </p>
        <!-- The one number on this screen that is about risk rather than
             volume: money that has left an account and not yet arrived. -->
        <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
          Ya debitado y con el pago en proceso, en las filas mostradas.
        </p>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-[20px] font-semibold leading-7">Transferencias</h2>
          <div class="flex items-center gap-3">
            <USelect
              v-model="status"
              class="w-[200px]"
              :items="[
                { value: '', label: 'Todos los estados' },
                ...statusFilterOptions(),
              ]"
              value-key="value"
              aria-label="Filtrar por estado"
            />
            <p v-if="state === 'READY'" class="tab text-[13px] text-[#75767F]">
              {{ rows.length }} de {{ total }}
            </p>
          </div>
        </div>
      </template>

      <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
        <USkeleton v-for="line in 6" :key="line" class="h-12 w-full rounded-xl" />
      </div>

      <SharedAsyncStateAlert
        v-else-if="state !== 'READY'"
        :state="state"
        :message="failure"
        @retry="load"
      />

      <div v-else-if="rows.length === 0" class="py-10 text-center" data-testid="monitor-empty">
        <p class="text-[20px] font-semibold leading-7">Nada que mostrar</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          No hay transferencias que coincidan con el filtro.
        </p>
      </div>

      <TransactionHistoryTable v-else :rows="rows" :show-accounts="true" />

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UButton
            variant="ghost"
            color="neutral"
            :disabled="state === 'LOADING'"
            @click="load"
          >Actualizar</UButton>
          <SharedCorrelationIdBadge :correlation-id="correlationId" />
        </div>
      </template>
    </UCard>
  </section>
</template>
