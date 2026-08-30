<script setup lang="ts">
import { mayMonitorPayments, summariseFailures } from '../../lib/payment';
import type { PaymentErrorType, PaymentRow, PaymentStatus } from '../../lib/payment';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';

/**
 * "Monitoreo de pagos" — the prototype's `show.payMonitor` (G-04), merged with
 * the payment history it also draws (G-03).
 *
 * **The prototype has two screens here and this has one**, and the merge is the
 * honest reading rather than a shortcut. G-03 is a customer's own list of bills
 * they paid; in this system a customer does not start payments — a payment is
 * step 4 of a transfer — so their "historial de pagos" is their history of
 * transfers, and it is `/transferencias` that owes it (TD-033). What is left
 * once that is taken out is exactly G-04: the operational list, which is staff
 * work. Recorded as TD-038.
 *
 * **Restricted, and unusually so.** Every other listing in this system narrows
 * itself to what the asker owns. Payment Service cannot: a payment row holds a
 * `transactionId` and no customer reference, and resolving one to the other
 * means reading another service's tables (§8.2, 2.3). So an unrestricted
 * listing would hand every `CLIENTE` every payment in the bank, and the
 * restriction is what makes the route safe rather than a policy preference
 * (TD-037).
 *
 * The redirect is a courtesy and not the defence. The Gateway's
 * `@Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')` refuses the listing whether or
 * not this ran — which is the whole point of the parity test.
 */
const api = useGatewayApi();
const { role } = useSession();

const mayMonitor = computed(() => mayMonitorPayments(role.value));

watchEffect(() => {
  if (role.value !== null && !mayMonitor.value) {
    navigateTo('/transferencias');
  }
});

const payments = ref<PaymentRow[]>([]);
const state = ref<'LOADING' | 'READY' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

const search = ref('');
const statusFilter = ref<'TODOS' | PaymentStatus>('TODOS');
const errorFilter = ref<'TODOS' | PaymentErrorType>('TODOS');

const STATUS_ITEMS = [
  { label: 'Todos los estados', value: 'TODOS' },
  { label: 'En proceso', value: 'PENDING' },
  { label: 'Aprobado', value: 'SUCCEEDED' },
  { label: 'No completado', value: 'FAILED' },
];

const ERROR_ITEMS = [
  { label: 'Cualquier tipo de fallo', value: 'TODOS' },
  { label: 'Transitorio', value: 'TRANSIENT' },
  { label: 'Permanente', value: 'PERMANENT' },
];

/**
 * The search filters what is already on screen; the two dropdowns go to the
 * Gateway. Same split as the account administration screen, and for the same
 * reason: `payment.list.query.v1` has `status` and `errorType` and no free-text
 * field, so a search sent to the server would be a parameter nobody reads.
 */
const visible = computed(() => {
  const needle = search.value.trim().toLowerCase();

  return needle.length === 0
    ? payments.value
    : payments.value.filter(
        (payment) =>
          payment.paymentId.toLowerCase().includes(needle) ||
          payment.transactionId.toLowerCase().includes(needle),
      );
});

/**
 * The banner counts what is on screen rather than a time window nobody can
 * verify. A banner that claimed "las últimas 24 horas" over a list that does
 * not cover them would eventually contradict the table beneath it.
 */
const failures = computed(() => summariseFailures(visible.value));

async function load(): Promise<void> {
  state.value = 'LOADING';
  message.value = undefined;

  const result = await api.call<{ payments: PaymentRow[]; correlationId?: string }>(
    '/api/payments',
    {
      query: {
        ...(statusFilter.value === 'TODOS' ? {} : { status: statusFilter.value }),
        ...(errorFilter.value === 'TODOS' ? {} : { errorType: errorFilter.value }),
      },
    },
  );

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    correlationId.value = result.error.correlationId;

    return;
  }

  payments.value = result.data.payments;
  correlationId.value = result.data.correlationId ?? result.correlationId;
  state.value = 'READY';
}

onMounted(async () => {
  if (mayMonitor.value) {
    await load();
  }
});

watch([statusFilter, errorFilter], async () => {
  if (mayMonitor.value) {
    await load();
  }
});

useHead({ title: 'Pagos · bonking' });
</script>

<template>
  <section v-if="mayMonitor" class="flex flex-col gap-4">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Monitoreo de pagos</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Payment Service · el paso de pago de cada transferencia y sus reintentos.
        </p>
      </div>
      <UButton variant="outline" color="neutral" :disabled="state === 'LOADING'" @click="load">
        Actualizar
      </UButton>
    </header>

    <!--
      The prototype's red banner, counting rows this table can be counted to
      confirm. Refusals and exhausted ladders are separated because they are
      different incidents: one is a provider saying no, the other is the system
      giving up, and only the second is worth paging somebody about.
    -->
    <div
      v-if="failures.total > 0"
      class="flex gap-4 rounded-2xl bg-[#F7DCD7] px-5 py-4"
      data-testid="payment-failure-banner"
    >
      <span
        class="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-[#B01B1B] text-[13px] font-bold text-white"
        aria-hidden="true"
      >!</span>
      <div>
        <p class="text-[14px] font-semibold leading-5 text-[#8A1010]">
          {{ failures.total }}
          {{ failures.total === 1 ? 'pago no se completó' : 'pagos no se completaron' }}
          en esta lista
        </p>
        <p class="text-[13px] leading-5 text-[#8A1010]">
          <template v-if="failures.permanent > 0">
            {{ failures.permanent }} por rechazo permanente, que no se reintenta.
          </template>
          <template v-if="failures.transient > 0">
            {{ failures.transient }} por agotar los reintentos.
          </template>
          En ambos casos el débito ya fue compensado por la Saga.
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="search"
        placeholder="Buscar por paymentId o transactionId"
        class="w-[320px] max-w-full"
        style="font-variant-numeric: tabular-nums lining-nums"
        data-testid="payment-search"
      />
      <USelect v-model="statusFilter" :items="STATUS_ITEMS" value-key="value" class="w-[190px]" />
      <USelect v-model="errorFilter" :items="ERROR_ITEMS" value-key="value" class="w-[210px]" />
    </div>

    <div v-if="state === 'LOADING'" class="flex flex-col gap-4">
      <USkeleton class="h-64 w-full rounded-2xl" />
    </div>

    <template v-else-if="state === 'READY'">
      <PaymentMonitorTable v-if="visible.length > 0" :payments="visible" />

      <!--
        Two different emptinesses. "Nothing matched what you asked" is a filter
        problem the reader can fix; "no payments exist" is a statement about the
        system, and on a bank with no Payment Service running it is the expected
        one. Collapsing them would send somebody looking for a bug in a filter.
      -->
      <div
        v-else
        class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-14 text-center"
      >
        <h2 class="text-[20px] font-semibold leading-7">
          {{ payments.length === 0 ? 'Todavía no hay pagos' : 'Ningún pago coincide' }}
        </h2>
        <p class="mx-auto mt-2 max-w-[440px] text-[14px] leading-5 text-[#5A5B63]">
          <template v-if="payments.length === 0">
            Un pago nace de una transferencia, no de esta pantalla. Cuando alguien envíe una,
            su paso de pago aparecerá aquí.
          </template>
          <template v-else>
            Hay {{ payments.length }} pagos en la consulta, pero ninguno coincide con la
            búsqueda.
          </template>
        </p>
        <UButton
          v-if="payments.length === 0"
          to="/transferencias/nueva"
          color="primary"
          class="mt-6"
        >Ir a una transferencia nueva</UButton>
      </div>
    </template>

    <div v-else class="flex flex-col items-start gap-3">
      <SharedAsyncStateAlert
        class="w-full"
        :state="state as AsyncState"
        :message="message"
        :correlation-id="correlationId"
      />
      <UButton variant="outline" color="neutral" @click="load">Reintentar la consulta</UButton>
    </div>

    <SharedCorrelationIdBadge v-if="correlationId" :correlation-id="correlationId" />
  </section>
</template>
