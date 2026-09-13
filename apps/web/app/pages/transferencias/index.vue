<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { LoadState } from '../../lib/gateway-error';
import type { Biller } from '../../lib/payment';
import { historyFilterProblems, phaseFilterOptions } from '../../lib/transaction';
import type { PhaseStatus, TransferRow } from '../../lib/transaction';

const api = useGatewayApi();
const { role } = useSession();

const rows = ref<readonly TransferRow[]>([]);
const total = ref(0);
const state = ref<LoadState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

const isStaff = computed(() => role.value !== null && role.value !== 'CLIENTE');

/**
 * `'TODAS'`, not `''`: a `USelect` item whose value is the empty string never
 * opens (see `monitor.vue`'s own note on the same sentinel).
 */
const phase = ref<PhaseStatus | 'TODAS'>('TODAS');
/** Plain `YYYY-MM-DD`, what `UInput type="date"` produces — converted to a
 * full day range only when the request is built. */
const fromDate = ref('');
const toDate = ref('');

/**
 * The one thing worth catching before the request goes out (T-28): a
 * reversed range comes back from the Gateway as a generic `400` a filter bar
 * cannot show next to the field that caused it.
 */
const rangeProblem = computed(() =>
  historyFilterProblems({
    from: fromDate.value === '' ? null : fromDate.value,
    to: toDate.value === '' ? null : toDate.value,
  }),
);

function hasFilters(): boolean {
  return phase.value !== 'TODAS' || fromDate.value !== '' || toDate.value !== '';
}

function clearFilters(): void {
  phase.value = 'TODAS';
  fromDate.value = '';
  toDate.value = '';
}

async function load(): Promise<void> {
  if (rangeProblem.value !== undefined) {
    return;
  }

  state.value = 'LOADING';
  failure.value = null;

  const [transfers, catalogue] = await Promise.all([
    api.call<{
      transactions: TransferRow[];
      total: number;
      correlationId: string;
    }>('/api/transfers', {
      query: {
        limit: '50',
        ...(phase.value === 'TODAS' ? {} : { phaseStatus: phase.value }),
        // Both ends inclusive, so the picked day is covered start to end.
        ...(fromDate.value === '' ? {} : { from: `${fromDate.value}T00:00:00.000Z` }),
        ...(toDate.value === '' ? {} : { to: `${toDate.value}T23:59:59.999Z` }),
      },
    }),
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
watch([phase, fromDate, toDate], load);

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
        <div class="flex flex-col gap-3">
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

          <!-- T-28: date and status filter, combinable. -->
          <div class="flex flex-wrap items-end gap-3">
            <USelect
              v-model="phase"
              class="w-[180px]"
              :items="[{ value: 'TODAS', label: 'Todos los estados' }, ...phaseFilterOptions()]"
              value-key="value"
              aria-label="Filtrar por estado"
            />
            <UFormField label="Desde" name="from" :error="rangeProblem">
              <UInput v-model="fromDate" type="date" aria-label="Desde" />
            </UFormField>
            <UFormField label="Hasta" name="to">
              <UInput v-model="toDate" type="date" aria-label="Hasta" />
            </UFormField>
            <UButton
              v-if="phase !== 'TODAS' || fromDate !== '' || toDate !== ''"
              variant="ghost"
              color="neutral"
              @click="clearFilters"
            >Limpiar filtros</UButton>
          </div>
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

      <!-- Two different messages on purpose: an empty account history reads as
           reassurance, an empty filtered result reads as "try other filters" —
           conflating them would make somebody re-check that their money moved. -->
      <div
        v-else-if="rows.length === 0 && hasFilters()"
        class="py-10 text-center"
        data-testid="transfers-empty-filtered"
      >
        <p class="text-[20px] font-semibold leading-7">Ninguna transferencia coincide</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          No hay transferencias con esos filtros. Prueba con otro estado o rango de fechas.
        </p>
        <UButton variant="outline" color="neutral" class="mt-6" @click="clearFilters">
          Limpiar filtros
        </UButton>
      </div>

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

    <!--
      Every role, not only staff — this is the lookup the manual documents for
      CLIENTE too (docs/manual/rol-cliente.md, docs/manual/README.md §6.4): the
      way back to a transfer that has not shown up in the history yet, or one
      whose identifier is all a receipt kept. Safe for every role because the
      restriction is not here — `GetTransactionStatusUseCase` answers a
      stranger's identifier with the same NOT_FOUND it gives a guessed one.
    -->
    <UCard>
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
