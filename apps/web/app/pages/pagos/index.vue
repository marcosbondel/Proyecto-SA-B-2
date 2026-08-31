<script setup lang="ts">
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { formatDate, formatQuetzales } from '../../lib/money';
import { billerOf, mayMonitorPayments } from '../../lib/payment';
import type { Biller } from '../../lib/payment';
import type { TransferRow } from '../../lib/transaction';

/**
 * `G-03` — "Historial de pagos", and the module's front door.
 *
 * **It lists transfers, not payments, and that is the point.** A service
 * payment is a transfer to the biller's collection account, so the rows are
 * already there and already scoped: Transaction Service narrows them against
 * the `customer_id` it records at request time. Payment Service's own listing —
 * the attempts, the retry ladder — answers a different question and is still
 * staff work, one level down at `/pagos/monitor` (TD-037).
 *
 * Which transfers are *payments* is decided by looking the target account up in
 * the biller catalogue, rather than by a flag on the row. A flag would have to
 * be set by whoever created the transfer and would then be wrong for every
 * transfer created before the catalogue existed; the account id is a fact the
 * row already carries.
 *
 * A catalogue that fails to load empties the list rather than filling it with
 * every transfer: showing somebody's rent transfer under "pagos de servicios"
 * would be worse than showing nothing.
 */
const api = useGatewayApi();
const { role } = useSession();

const mayMonitor = computed(() => mayMonitorPayments(role.value));

const rows = ref<readonly TransferRow[]>([]);
const billers = ref<readonly Biller[]>([]);
const state = ref<AsyncState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

async function load(): Promise<void> {
  state.value = 'LOADING';
  failure.value = null;

  const [transfers, catalogue] = await Promise.all([
    api.call<{ transactions: TransferRow[]; correlationId: string }>('/api/transfers', {
      query: { limit: '100' },
    }),
    api.call<{ billers: Biller[] }>('/api/accounts/billers'),
  ]);

  if (!transfers.ok) {
    correlationId.value = transfers.error.correlationId;
    failure.value = transfers.error.message;
    state.value = asyncStateFor(transfers.error);
    return;
  }

  rows.value = transfers.data.transactions;
  billers.value = catalogue.ok ? catalogue.data.billers : [];
  correlationId.value = transfers.data.correlationId;
  state.value = 'READY';
}

onMounted(load);

/** The transfers that went to a biller — the service payments. */
const payments = computed(() =>
  rows.value
    .map((row) => ({ row, biller: billerOf(row.targetAccount, billers.value) }))
    .filter((entry): entry is { row: TransferRow; biller: Biller } => entry.biller !== null),
);

useHead({ title: 'Pagos · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Pagos</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Paga servicios y consulta los pagos que ya hiciste.
        </p>
      </div>
      <div class="flex gap-3">
        <UButton v-if="mayMonitor" to="/pagos/monitor" variant="outline" color="neutral">
          Monitoreo
        </UButton>
        <UButton to="/pagos/nuevo" color="primary" size="lg">Nuevo pago</UButton>
      </div>
    </header>

    <UCard>
      <template #header>
        <h2 class="text-[20px] font-semibold leading-7">Historial de pagos</h2>
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

      <div v-else-if="payments.length === 0" class="py-10 text-center" data-testid="payments-empty">
        <p class="text-[20px] font-semibold leading-7">Todavía no has pagado ningún servicio</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          Cuando pagues luz, agua o teléfono, cada pago aparecerá aquí con su referencia y su
          estado.
        </p>
        <UButton to="/pagos/nuevo" color="primary" class="mt-6">Pagar un servicio</UButton>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[680px] border-collapse text-[13px]">
          <thead>
            <tr class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">
              <th class="py-3 pr-4 text-left font-semibold">Fecha</th>
              <th class="py-3 pr-4 text-left font-semibold">Servicio</th>
              <th class="py-3 pr-4 text-left font-semibold">Estado</th>
              <th class="py-3 pl-4 text-right font-semibold">Monto</th>
              <th class="py-3 pl-4 text-right font-semibold" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in payments" :key="entry.row.transactionId" class="align-top">
              <td class="tab border-t border-[#E9E9EC] py-3.5 pr-4 text-[#5A5B63]">
                {{ formatDate(entry.row.createdAt) }}
              </td>
              <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
                <div class="text-[13px] font-medium text-[#23242A]">{{ entry.biller.name }}</div>
                <!-- The pill the prototype draws. Everything in this table is
                     external by construction: an internal payment does not go
                     to a biller, so it is not in this list at all. -->
                <UBadge
                  variant="subtle"
                  color="warning"
                  class="mt-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                >Externo</UBadge>
              </td>
              <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
                <TransactionStatusBadge :status="entry.row.status" />
              </td>
              <td class="tab border-t border-[#E9E9EC] py-3.5 pl-4 text-right font-semibold">
                {{ formatQuetzales(entry.row.amount.amountMinor) }}
              </td>
              <td class="border-t border-[#E9E9EC] py-3.5 pl-4 text-right">
                <UButton
                  :to="`/transferencias/${entry.row.transactionId}`"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                >Ver →</UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
      <h2 class="text-[14px] font-semibold">Por qué un pago aparece como transferencia</h2>
      <p class="mt-2 max-w-[70ch] text-[13px] leading-5 text-[#5A5B63]">
        Cada prestador tiene una cuenta recaudadora en este banco, así que pagar un servicio
        <strong class="font-semibold">es</strong> transferirle dinero. Por eso el detalle de un
        pago se ve en la pantalla de la transferencia: es la misma operación, con la misma Saga y
        la misma compensación automática si el pago falla.
      </p>
    </UCard>
  </section>
</template>
