<script setup lang="ts">
import { VERDICT_PRESENTATION, verdictOf } from '../../lib/payment';
import type { PaymentSignals } from '../../lib/payment';
import { explainReason } from '../../lib/transaction';
import type { PaymentOutcome } from '../../lib/transaction';
import { formatDate } from '../../lib/money';

/**
 * What the payment step of this transfer did.
 *
 * Everything here comes from `transaction.status.replied.v1` — that is, from
 * the events Transaction Service received and wrote down. It is **not** a read
 * of Payment Service: that service now has two routes of its own
 * (`GET /api/payments`, `GET /api/payments/:paymentId`), but this panel sits
 * inside a transfer that already carries the answer, and asking twice would
 * make a screen able to contradict itself.
 *
 * The four verdicts are four different sentences, and two of them are the ones
 * people get wrong:
 *
 * - **`PROCESSING` means the payment was ordered and has not answered**, which
 *   is not the same as "there is no payment". A transfer sitting in
 *   `PAYMENT_PENDING` with the money already out of the source account is
 *   precisely when somebody needs to be told that clearly.
 * - **`REJECTED` and `FAILED` are not the same ending.** One was refused and
 *   retrying is pointless; the other exhausted the ladder and is worth doing
 *   again. `app/lib/payment.ts` decides which, and does it where it is tested.
 *
 * Reshaped by T-19 from the version T-18 built under TD-034. What changed: the
 * verdict is now four-valued rather than three, the retry ladder is shown while
 * it is being climbed rather than only after it stops, and the kind of the last
 * failure is named. All three became possible when `payment.attempt.failed.v1`
 * and the optional `errorType` were added to the catalogue — before that the
 * ticket's criteria described data nothing published.
 *
 * The composition follows the prototype's "Estado de pago" screen (G-02a–d):
 * pill, headline, sentence, then the details as a definition list.
 */
const props = defineProps<{
  payment: PaymentOutcome | null;
  /** Where to read the full evidence. Omitted where nobody may follow it. */
  detailTo?: string | null;
  /**
   * Whether this session may query `GET /api/audit` (D-06: `ADMINISTRADOR`
   * only). This panel sits inside a transfer every role can open, so it is the
   * caller's job to say — the same way `detailTo` already does — rather than
   * this component guessing at a session it has no other reason to know about.
   */
  mayQueryAudit?: boolean;
}>();

/**
 * The transfer's reply calls the failure code `reason`; Payment Service's own
 * reply calls it `failureReason`. Converting here rather than teaching the
 * shared module both names keeps one field from having two spellings.
 */
const signals = computed<PaymentSignals | null>(() =>
  props.payment === null
    ? null
    : {
        status: props.payment.status,
        errorType: props.payment.errorType ?? null,
        failureReason: props.payment.reason,
        attempt: props.payment.attempt,
      },
);

const presentation = computed(() =>
  signals.value === null ? null : VERDICT_PRESENTATION[verdictOf(signals.value)],
);

/**
 * The catalogue code in the words of the person it happened to, when there is
 * one. It is more specific than the verdict's own sentence, so it wins the
 * position under the headline; the verdict's sentence stays as the fallback.
 */
const reason = computed(() => explainReason(props.payment?.reason ?? null, props.mayQueryAudit ?? false));
</script>

<template>
  <section
    v-if="payment && signals && presentation"
    class="rounded-2xl border border-[#DCDCE0] bg-white p-6"
    data-testid="payment-result"
  >
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">Resultado del pago</p>
        <h3 class="mt-1 text-[20px] font-semibold leading-7">{{ presentation.headline }}</h3>
      </div>
      <PaymentStatusBadge :signals="signals" />
    </header>

    <p class="mt-2 text-[14px] leading-[22px] text-[#5A5B63]">
      {{ reason ?? presentation.explanation }}
    </p>

    <div class="mt-4">
      <PaymentAttemptTrail :signals="signals" />
    </div>

    <dl class="mt-4 flex flex-col">
      <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-2.5">
        <dt class="text-[13px] text-[#75767F]">Número del pago</dt>
        <dd
          class="break-all text-right font-mono text-[12px] text-[#5A5B63]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ payment.paymentId }}</dd>
      </div>
      <div
        v-if="payment.decidedAt"
        class="flex justify-between gap-4 border-t border-[#E9E9EC] py-2.5"
      >
        <dt class="text-[13px] text-[#75767F]">Resuelto</dt>
        <dd
          class="text-[13px]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ formatDate(payment.decidedAt) }}</dd>
      </div>
    </dl>

    <!--
      Offered only where somebody may actually follow it. `GET /api/payments/:id`
      admits every role, but the screen it opens is reached from the staff-only
      Pagos module, so the page decides whether to pass this.
    -->
    <UButton
      v-if="detailTo"
      :to="detailTo"
      variant="outline"
      color="neutral"
      size="sm"
      class="mt-4"
    >Ver el detalle del pago</UButton>
  </section>
</template>
