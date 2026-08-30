<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import type { TransferRow } from '../../lib/transaction';

/**
 * `T-04` — the history, and the question this module could not answer until
 * now.
 *
 * For two tickets this screen was a lookup box and an explanation: the Gateway
 * exposed no route that listed transfers, because Transaction Service held two
 * opaque account references and could not resolve either to a person without
 * reading Account Service's database (§8.2, 2.3). That was TD-033, and it is
 * closed — the transfer now records who asked for it, and the listing is
 * scoped by the owning service against that column.
 *
 * **The scope is not this screen's.** A `CLIENTE` sees their own transfers
 * because Transaction Service narrowed the answer, not because this page asked
 * politely; filtering in the browser would be a permission a devtools console
 * can turn off. The lookup box stays, because a `transactionId` from a receipt
 * is still the fastest way to one transfer.
 *
 * An empty list is an empty state and never an error. It means the same thing
 * whether nothing exists or nothing is visible, which is the point.
 */
const api = useGatewayApi();
const { role } = useSession();

const rows = ref<readonly TransferRow[]>([]);
const total = ref(0);
const state = ref<AsyncState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

const isStaff = computed(() => role.value !== null && role.value !== 'CLIENTE');

async function load(): Promise<void> {
  state.value = 'LOADING';
  failure.value = null;

  const result = await api.call<{
    transactions: TransferRow[];
    total: number;
    correlationId: string;
  }>('/api/transfers', { query: { limit: '25' } });

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

const lookup = ref('');
const touched = ref(false);

const problem = computed(() =>
  !touched.value || isUuidV4(lookup.value)
    ? undefined
    : 'Ese identificador no es un UUID v4. Pega el transactionId completo que devolvió el envío.',
);

async function open(): Promise<void> {
  touched.value = true;

  if (!isUuidV4(lookup.value)) {
    return;
  }

  await navigateTo(`/transferencias/${lookup.value.trim()}`);
}

useHead({ title: 'Transferencias · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Transferencias</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Envía dinero entre cuentas y sigue el estado de cada transferencia.
        </p>
      </div>
      <div class="flex gap-3">
        <UButton v-if="isStaff" to="/transferencias/monitor" variant="outline" color="neutral">
          Monitoreo
        </UButton>
        <UButton to="/transferencias/nueva" color="primary" size="lg">Nueva transferencia</UButton>
      </div>
    </header>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-[20px] font-semibold leading-7">Historial</h2>
          <!-- Says what it is not showing, rather than implying that 25 is all
               there is. -->
          <p v-if="state === 'READY' && total > rows.length" class="tab text-[13px] text-[#75767F]">
            Mostrando {{ rows.length }} de {{ total }}
          </p>
        </div>
      </template>

      <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
        <USkeleton v-for="line in 4" :key="line" class="h-12 w-full rounded-xl" />
      </div>

      <SharedAsyncStateAlert
        v-else-if="state !== 'READY'"
        :state="state"
        :message="failure"
        @retry="load"
      />

      <div v-else-if="rows.length === 0" class="py-10 text-center" data-testid="transfers-empty">
        <p class="text-[20px] font-semibold leading-7">Todavía no hay transferencias</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          Cuando envíes dinero, cada transferencia aparecerá aquí con su estado. Si acabas de
          enviar una, puede tardar unos segundos en completarse.
        </p>
        <UButton to="/transferencias/nueva" color="primary" class="mt-6">
          Hacer la primera transferencia
        </UButton>
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

    <UCard>
      <template #header>
        <h2 class="text-[20px] font-semibold leading-7">Consultar una transferencia</h2>
      </template>

      <form class="flex flex-col gap-3" @submit.prevent="open">
        <UFormField
          label="transactionId"
          name="transactionId"
          :error="problem"
          help="El identificador que devolvió el envío. Sirve para una transferencia que aún no aparece en el historial."
        >
          <UInput
            v-model="lookup"
            placeholder="00000000-0000-4000-8000-000000000000"
            class="tab w-full"
            autocomplete="off"
            data-testid="transfer-lookup"
          />
        </UFormField>

        <UButton type="submit" variant="outline" color="neutral" class="w-fit">
          Ver el estado
        </UButton>
      </form>
    </UCard>
  </section>
</template>
