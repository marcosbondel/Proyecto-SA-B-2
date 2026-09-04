<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';
import { mayMonitorPayments } from '../../lib/payment';
import {
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
  explainReason,
  isTerminal,
  meaningOfMissing,
  shouldKeepPolling,
} from '../../lib/transaction';
import type { TransferStatus } from '../../lib/transaction';
import { mayQueryAudit } from '../../lib/audit';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * One transfer, followed until it stops moving.
 *
 * This screen is the reason a `202` is honest rather than a shrug. The Gateway
 * answers "accepted" the moment it publishes; what actually happened takes four
 * services and several messages, and this is where somebody watches it happen.
 *
 * The four states it has to distinguish, and why each one is separate:
 *
 * - **Not written down yet.** `POST /api/transfers` answers before Transaction
 *   Service has committed the row, so the first query after the redirect
 *   legitimately finds nothing. Reporting that as "no existe" would tell
 *   somebody their transfer vanished a second after they sent it, so for the
 *   first ten seconds it reads as "registrando" and keeps asking
 *   (`meaningOfMissing`).
 * - **In flight.** Polled every two seconds while the state is not terminal.
 * - **Finished.** Polling stops. A screen that keeps asking about a transfer
 *   that closed two minutes ago is a screen that will still be asking tomorrow.
 * - **Given up.** After two minutes the polling stops and says so, with a
 *   button. A Saga that has not closed by then will not close because this page
 *   asked again — and "no lo sabemos" is a better answer than a spinner.
 *
 * The correlation shown is `originCorrelationId`: the one the transfer was born
 * under, not the one this particular question was stamped with. They are
 * different identifiers, and only the first finds anything in the audit trail.
 */
const route = useRoute();
const api = useGatewayApi();
const { role } = useSession();

const transactionId = computed(() => String(route.params.id ?? ''));
const malformed = computed(() => !isUuidV4(transactionId.value));

const transfer = ref<TransferStatus | null>(null);
const state = ref<'LOADING' | 'READY' | 'STARTING' | 'GAVE_UP' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;

/** The correlation to show, and the only one worth searching the trail with. */
const shownCorrelation = computed(
  () => transfer.value?.originCorrelationId ?? correlationId.value,
);

/**
 * Whether to offer the audit trail of this transfer.
 *
 * Offered rather than always shown, because `GET /api/audit` is the one route
 * D-06 restricts by role outright: a `CLIENTE` who followed the button would
 * get a `403` that reads like the bank refusing to explain their own transfer.
 * The identifier is on screen for everybody either way (`SharedCorrelationIdBadge`),
 * which is what makes the restriction a difference in convenience rather than
 * in what somebody is told. Added by T-20.
 *
 * The same boolean also decides what `explainReason`'s fallback tells somebody
 * to do next: a `CLIENTE` cannot follow "consulta la auditoría" any more than
 * they can follow this button.
 */
const mayAudit = computed(() => mayQueryAudit(role.value));

const reason = computed(() => explainReason(transfer.value?.reason ?? null, mayAudit.value));

const finished = computed(
  () => transfer.value !== null && isTerminal(transfer.value.status),
);

/**
 * Where to send somebody who wants the payment's own record, or `null`.
 *
 * `GET /api/payments/:paymentId` admits every role, but the screen it opens is
 * part of the staff-only Pagos module, and offering a `CLIENTE` a link into a
 * module their navigation does not show would be offering a dead end. The panel
 * shows the verdict either way; only the deeper evidence is staff work.
 */
const paymentDetailTo = computed(() =>
  mayMonitorPayments(role.value) && transfer.value?.payment
    ? `/pagos/${transfer.value.payment.paymentId}`
    : null,
);

async function load(): Promise<void> {
  if (malformed.value) {
    return;
  }

  const result = await api.call<TransferStatus>(`/api/transfers/${transactionId.value}`);

  if (result.ok) {
    transfer.value = result.data;
    correlationId.value = result.data.originCorrelationId ?? result.correlationId;
    state.value = 'READY';

    if (shouldKeepPolling(result.data.status)) {
      schedule();
    }

    return;
  }

  /**
   * A business rejection here is the Gateway's rendering of `NOT_FOUND`, and
   * for the first few seconds after a `202` that is the expected answer rather
   * than an error.
   */
  if (result.error.type === 'BUSINESS_REJECTION' && transfer.value === null) {
    if (meaningOfMissing(Date.now() - startedAt) === 'STILL_STARTING') {
      state.value = 'STARTING';
      schedule();

      return;
    }
  }

  state.value = asyncStateFor(result.error);
  message.value = result.error.message;
  correlationId.value = result.error.correlationId ?? correlationId.value;
}

/**
 * `setTimeout` after each reply rather than `setInterval`: a slow answer must
 * not queue a second question behind it, which is how a five-second reply
 * ceiling turns into a queue of overlapping requests.
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
  state.value = transfer.value === null ? 'LOADING' : 'READY';
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

useHead({ title: 'Transferencia · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[760px] flex-col gap-4">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Transferencia</h1>
        <p
          class="mt-1 break-all font-mono text-[13px] text-[#5A5B63]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ transfer?.transactionId ?? transactionId }}</p>
      </div>
      <UButton to="/transferencias/nueva" variant="outline" color="neutral">
        Nueva transferencia
      </UButton>
    </header>

    <SharedAsyncStateAlert
      v-if="malformed"
      state="VALIDATION_ERROR"
      message="Ese número no tiene el formato correcto, así que no se envió ninguna consulta. Abre la transferencia desde el enlace que te dio el envío."
    />

    <template v-else>
      <!-- Accepted, not yet written down. Not an error, and not a success. -->
      <SharedAsyncStateAlert
        v-if="state === 'STARTING'"
        state="PENDING"
        message="El sistema aceptó la transferencia y la está registrando. Esta pantalla se actualiza sola."
        :correlation-id="shownCorrelation"
      />

      <div v-else-if="state === 'LOADING'" class="flex flex-col gap-4">
        <USkeleton class="h-64 w-full rounded-2xl" />
        <USkeleton class="h-32 w-full rounded-2xl" />
      </div>

      <template v-if="transfer">
        <div class="rounded-2xl border border-[#DCDCE0] bg-white p-6">
          <p class="text-[12px] uppercase tracking-[0.06em] text-[#75767F]">Monto</p>
          <p
            class="mt-1 text-[32px] font-bold leading-10"
            style="font-variant-numeric: tabular-nums lining-nums"
            data-testid="transfer-amount"
          >{{ formatQuetzales(transfer.amount.amountMinor) }}</p>

          <dl class="mt-4 flex flex-col">
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">Solicitada</dt>
              <dd
                class="text-[13px]"
                style="font-variant-numeric: tabular-nums lining-nums"
              >{{ formatDate(transfer.createdAt) }}</dd>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">Última actualización</dt>
              <dd
                class="text-[13px]"
                style="font-variant-numeric: tabular-nums lining-nums"
              >{{ formatDate(transfer.updatedAt) }}</dd>
            </div>
          </dl>
        </div>

        <TransactionStatusTimeline :status="transfer.status" :live="!finished" />

        <UAlert
          v-if="reason"
          color="error"
          variant="subtle"
          title="Por qué no se completó"
          data-testid="failure-reason"
        >
          <template #description>
            <p class="text-[14px] leading-[22px]">{{ reason }}</p>
          </template>
        </UAlert>

        <PaymentResultPanel
          :payment="transfer.payment ?? null"
          :detail-to="paymentDetailTo"
          :may-query-audit="mayAudit"
        />
      </template>

      <!-- Two minutes with no ending. Honest about not knowing. -->
      <div v-if="state === 'GAVE_UP'" class="flex flex-col items-start gap-3">
        <SharedAsyncStateAlert
          class="w-full"
          state="REPLY_TIMEOUT"
          message="Dejamos de consultar tras dos minutos. La transferencia sigue en el sistema: no asumas que falló. Vuelve a consultar cuando quieras."
          :correlation-id="shownCorrelation"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Consultar de nuevo</UButton>
      </div>

      <div
        v-else-if="!['READY', 'LOADING', 'STARTING'].includes(state)"
        class="flex flex-col items-start gap-3"
      >
        <SharedAsyncStateAlert
          class="w-full"
          :state="state as AsyncState"
          :message="message"
          :correlation-id="shownCorrelation"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Reintentar la consulta</UButton>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          v-if="!finished && state === 'READY'"
          variant="ghost"
          color="neutral"
          @click="refresh"
        >Actualizar ahora</UButton>
        <UButton
          v-if="mayAudit && shownCorrelation"
          :to="`/auditoria?correlationId=${shownCorrelation}`"
          variant="outline"
          color="neutral"
          data-testid="transfer-audit-link"
        >Ver auditoría</UButton>
        <UButton to="/cuentas" variant="ghost" color="neutral">Ver mis cuentas</UButton>
      </div>

      <!-- Criterion 9: the correlation is visible at every moment. -->
      <SharedCorrelationIdBadge
        v-if="shownCorrelation"
        :correlation-id="shownCorrelation"
        label="Código de seguimiento de la transferencia"
      />
    </template>
  </section>
</template>
