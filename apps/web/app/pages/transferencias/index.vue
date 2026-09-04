<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { LoadState } from '../../lib/gateway-error';
import type { Biller } from '../../lib/payment';
import type { TransferRow } from '../../lib/transaction';

const api = useGatewayApi();
const { role } = useSession();

const rows = ref<readonly TransferRow[]>([]);
const total = ref(0);
const state = ref<LoadState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

const isStaff = computed(() => role.value !== null && role.value !== 'CLIENTE');

async function load(): Promise<void> {
  state.value = 'LOADING';
  failure.value = null;

  const [transfers, catalogue] = await Promise.all([
    api.call<{
      transactions: TransferRow[];
      total: number;
      correlationId: string;
    }>('/api/transfers', { query: { limit: '50' } }),
    api.call<{ billers: Biller[] }>('/api/accounts/billers'),
  ]);

  if (!transfers.ok) {
    correlationId.value = transfers.error.correlationId;
    failure.value = transfers.error.message;
    state.value = asyncStateFor(transfers.error);
    return;
  }

  const billerAccountIds = new Set(
    catalogue.ok ? catalogue.data.billers.map((b) => b.accountId) : [],
  );

  rows.value = transfers.data.transactions.filter(
    (row) => !billerAccountIds.has(row.targetAccount),
  );
  total.value = rows.value.length;
  correlationId.value = transfers.data.correlationId;
  state.value = 'READY';
}

onMounted(load);

const lookup = ref('');
const touched = ref(false);

const problem = computed(() =>
  !touched.value || isUuidV4(lookup.value)
    ? undefined
    : 'Ese número no tiene el formato correcto. Pega el número de operación completo que te dio el envío.',
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
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">
          {{ isStaff ? 'Transferencias entre cuentas' : 'Transferencias' }}
        </h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          {{
            isStaff
              ? 'Consulta y monitoreo de transferencias entre cuentas de clientes.'
              : 'Envía dinero entre cuentas y sigue el estado de cada transferencia.'
          }}
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
          <h2 class="text-[20px] font-semibold leading-7">
            {{ isStaff ? 'Historial de operaciones de clientes' : 'Historial' }}
          </h2>
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
        <p class="text-[20px] font-semibold leading-7">
          {{ isStaff ? 'No hay transferencias registradas' : 'Todavía no hay transferencias' }}
        </p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          {{
            isStaff
              ? 'Aún no se han procesado movimientos de transferencia entre cuentahabientes en el sistema.'
              : 'Cuando envíes dinero, cada transferencia aparecerá aquí con su estado. Si acabas de enviar una, puede tardar unos segundos en completarse.'
          }}
        </p>
        <UButton to="/transferencias/nueva" color="primary" class="mt-6">
          {{ isStaff ? 'Registrar transferencia' : 'Hacer la primera transferencia' }}
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

    <UCard v-if="isStaff">
      <template #header>
        <h2 class="text-[20px] font-semibold leading-7">Consultar una transferencia</h2>
      </template>

      <form class="flex flex-col gap-3" @submit.prevent="open">
        <UFormField
          label="Número de operación"
          name="transactionId"
          :error="problem"
          help="El número que te dio el sistema al enviar. Sirve para una transferencia que aún no aparece en el historial."
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
