<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';
import {
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
  VERDICT_PRESENTATION,
  shouldKeepPolling,
  signalsOf,
  verdictOf,
} from '../../lib/payment';
import type { PaymentAttempt, PaymentRow } from '../../lib/payment';
import { PAYMENT_SCENARIOS, explainReason } from '../../lib/transaction';
import { mayQueryAudit } from '../../lib/audit';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * "Estado de pago" — the prototype's G-02a to G-02d, as one screen with four
 * states rather than four screens.
 *
 * The prototype draws pending, confirmed, failed and timeout as separate
 * artboards because a prototype cannot poll. Here they are the same screen at
 * four moments, and collapsing them is not a simplification: a payment moves
 * between them while somebody is watching, and a design that made each one its
 * own page would need a navigation event to show a retry succeeding.
 *
 * `timeout` is the fourth and the one most easily got wrong. It does **not**
 * mean the payment failed — it means this screen stopped asking. Payment
 * Service may still be climbing its ladder, and the copy says so.
 *
 * The layout is the prototype's two-column split: the verdict and the money on
 * the left, the identifiers on the right, which is the panel somebody actually
 * opens this page for during an incident.
 *
 * This asks Payment Service directly, unlike `PaymentResultPanel` inside a
 * transfer, and the difference is deliberate: this is the only place that can
 * show the per-attempt evidence, because it is the only question whose answer
 * comes from the service that recorded it.
 */
const route = useRoute();
const api = useGatewayApi();
const { role } = useSession();

const paymentId = computed(() => String(route.params.id ?? ''));
const malformed = computed(() => !isUuidV4(paymentId.value));

const payment = ref<PaymentRow | null>(null);
const attempts = ref<PaymentAttempt[]>([]);
const state = ref<'LOADING' | 'READY' | 'GAVE_UP' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;

const signals = computed(() => (payment.value === null ? null : signalsOf(payment.value)));

const presentation = computed(() =>
  signals.value === null ? null : VERDICT_PRESENTATION[verdictOf(signals.value)],
);

/** The catalogue code in plain words, when there is one. Beats the generic sentence. */
const reason = computed(() =>
  explainReason(payment.value?.failureReason ?? null, mayQueryAudit(role.value)),
);

const scenario = computed(() =>
  PAYMENT_SCENARIOS.find((entry) => entry.value === payment.value?.scenario) ?? null,
);

const finished = computed(
  () => payment.value !== null && !shouldKeepPolling(payment.value.status),
);

async function load(): Promise<void> {
  if (malformed.value) {
    return;
  }

  const result = await api.call<{
    payment: PaymentRow;
    attempts: PaymentAttempt[];
    correlationId?: string;
  }>(`/api/payments/${paymentId.value}`);

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    correlationId.value = result.error.correlationId ?? correlationId.value;

    return;
  }

  payment.value = result.data.payment;
  attempts.value = result.data.attempts;
  correlationId.value = result.data.payment.originCorrelationId ?? result.correlationId;
  state.value = 'READY';

  if (shouldKeepPolling(result.data.payment.status)) {
    schedule();
  }
}

/**
 * `setTimeout` after each reply rather than `setInterval`, for the reason the
 * transfer screen gives: a slow answer must not queue a second question behind
 * it, which is how a five-second reply ceiling turns into a pile of overlapping
 * requests.
 */
function schedule(): void {
  stop();

  if (Date.now() - startedAt >= POLL_CEILING_MS) {
    state.value = 'GAVE_UP';

    return;
  }

  timer = setTimeout(() => void load(), POLL_INTERVAL_MS);
}

function stop(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Asking again is free: a query changes nothing, so this needs no key. */
async function refresh(): Promise<void> {
  stop();
  startedAt = Date.now();
  state.value = payment.value === null ? 'LOADING' : 'READY';
  message.value = undefined;
  await load();
}

onMounted(async () => {
  if (malformed.value) {
    state.value = 'VALIDATION_ERROR';

    return;
  }

  startedAt = Date.now();
  await load();
});

// A screen closed mid-wait must not keep questioning the Gateway.
onScopeDispose(stop);

useHead({ title: 'Pago · bonking' });
</script>

<template>
  <section class="flex w-full flex-col gap-4">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Estado del pago</h1>
        <p
          class="mt-1 break-all font-mono text-[13px] text-[#5A5B63]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ paymentId }}</p>
      </div>
      <UButton to="/pagos" variant="outline" color="neutral">Volver al monitoreo</UButton>
    </header>

    <SharedAsyncStateAlert
      v-if="malformed"
      state="VALIDATION_ERROR"
      message="Ese número no tiene el formato correcto, así que no se envió ninguna consulta. Abre el pago desde el monitoreo o desde la transferencia a la que pertenece."
    />

    <template v-else>
      <div v-if="state === 'LOADING'" class="flex flex-col gap-4">
        <USkeleton class="h-72 w-full rounded-2xl" />
      </div>

      <div
        v-else-if="payment && signals && presentation"
        class="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]"
      >
        <div class="rounded-2xl border border-[#DCDCE0] bg-white p-7">
          <PaymentStatusBadge :signals="signals" />
          <h2 class="mt-4 text-[28px] font-bold leading-9 tracking-tight">
            {{ presentation.headline }}
          </h2>
          <p class="mt-2 text-[15px] leading-6 text-[#5A5B63]">
            {{ reason ?? presentation.explanation }}
          </p>

          <!--
            A rehearsal says so. Somebody reading a rejected payment during a
            demonstration must not file it as an incident, and somebody reading
            a real one must not dismiss it as a demonstration.
          -->
          <div
            v-if="scenario"
            class="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#C6C6CC] bg-[#F0F0F2] px-4 py-3"
            data-testid="payment-scenario-note"
          >
            <UBadge
              color="warning"
              variant="subtle"
              class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]"
            >Demostración</UBadge>
            <span class="text-[13px] leading-5 text-[#5A5B63]">
              Este pago recibió el escenario «{{ scenario.label }}». No refleja el
              comportamiento de un proveedor real.
            </span>
          </div>

          <div class="mt-6 rounded-2xl bg-[#F0F0F2] p-5">
            <p class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">Monto</p>
            <p
              class="mt-1 text-[32px] font-bold leading-10 tracking-tight"
              style="font-variant-numeric: tabular-nums lining-nums"
              data-testid="payment-amount"
            >{{ formatQuetzales(payment.amount.amountMinor) }}</p>

            <dl class="mt-4 flex flex-col">
              <div class="flex justify-between gap-4 border-t border-[#DCDCE0] py-2.5">
                <dt class="text-[13px] text-[#5A5B63]">Solicitado</dt>
                <dd
                  class="text-[13px] font-medium"
                  style="font-variant-numeric: tabular-nums lining-nums"
                >{{ formatDate(payment.createdAt) }}</dd>
              </div>
              <div
                v-if="payment.decidedAt"
                class="flex justify-between gap-4 border-t border-[#DCDCE0] py-2.5"
              >
                <dt class="text-[13px] text-[#5A5B63]">Resuelto</dt>
                <dd
                  class="text-[13px] font-medium"
                  style="font-variant-numeric: tabular-nums lining-nums"
                >{{ formatDate(payment.decidedAt) }}</dd>
              </div>
            </dl>
          </div>

          <div class="mt-6">
            <h3 class="text-[14px] font-semibold leading-5">Intentos</h3>
            <div class="mt-3">
              <PaymentAttemptTrail :signals="signals" :attempts="attempts" />
              <p
                v-if="attempts.length === 0 && payment.attempt === null"
                class="text-[13px] leading-5 text-[#5A5B63]"
              >
                Todavía no se ha registrado ningún intento.
              </p>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap gap-2">
            <UButton
              v-if="!finished && state === 'READY'"
              variant="outline"
              color="neutral"
              @click="refresh"
            >Actualizar estado</UButton>
            <UButton
              :to="`/transferencias/${payment.transactionId}`"
              variant="ghost"
              color="neutral"
            >Ver la transferencia</UButton>
          </div>
        </div>

        <PaymentIdentifiersCard
          :payment-id="payment.paymentId"
          :transaction-id="payment.transactionId"
          :correlation-id="payment.originCorrelationId"
          :provider-reference="payment.providerReference"
        />
      </div>

      <!-- Two minutes with no ending. Honest about not knowing. -->
      <div v-if="state === 'GAVE_UP'" class="flex flex-col items-start gap-3">
        <SharedAsyncStateAlert
          class="w-full"
          state="REPLY_TIMEOUT"
          message="Dejamos de consultar tras dos minutos. El pago sigue en el sistema: no asumas que falló. Vuelve a consultar cuando quieras."
          :correlation-id="correlationId"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Consultar de nuevo</UButton>
      </div>

      <div
        v-else-if="!['READY', 'LOADING'].includes(state)"
        class="flex flex-col items-start gap-3"
      >
        <SharedAsyncStateAlert
          class="w-full"
          :state="state as AsyncState"
          :message="message"
          :correlation-id="correlationId"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Reintentar la consulta</UButton>
      </div>
    </template>
  </section>
</template>
