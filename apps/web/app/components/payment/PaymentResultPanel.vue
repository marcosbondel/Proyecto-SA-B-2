<script setup lang="ts">
import { PAYMENT_STATUS_PRESENTATION, explainReason } from '../../lib/transaction';
import type { PaymentOutcome } from '../../lib/transaction';
import { formatDate } from '../../lib/money';

/**
 * What the payment step of this transfer did.
 *
 * Everything here comes from `transaction.status.replied.v1` — that is, from
 * the events Transaction Service received and wrote down. It is **not** a read
 * of Payment Service, which owns no route this application can call and whose
 * database is off limits (§8.2, 2.3). The panel repeats a verdict; it does not
 * obtain one.
 *
 * The three states are three different sentences, and the first is the one
 * people get wrong: `PENDING` means the payment was **ordered and has not
 * answered**, which is not the same as "there is no payment". A transfer
 * sitting in `PAYMENT_PENDING` with the money already out of the source account
 * is precisely when somebody needs to be told that clearly.
 *
 * `attempt` is Payment Service's own retry counter, not the broker's
 * redeliveries. Shown only when it is greater than one, because "intento 1" is
 * noise and "intento 3" is the story.
 *
 * Owned by T-19 (Payment Service). Built here by T-18 because the transfer
 * detail screen has nowhere else to show a rejected payment; recorded as TD-034.
 */
const props = defineProps<{ payment: PaymentOutcome | null }>();

const presentation = computed(() =>
  props.payment === null ? null : PAYMENT_STATUS_PRESENTATION[props.payment.status],
);

const reason = computed(() => explainReason(props.payment?.reason ?? null));
</script>

<template>
  <section
    v-if="payment && presentation"
    class="rounded-2xl border border-[#DCDCE0] bg-white p-5"
    data-testid="payment-result"
  >
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-[16px] font-semibold leading-6">Resultado del pago</h3>
      <UBadge
        :color="presentation.color"
        variant="subtle"
        class="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]"
        :data-status="payment.status"
      >{{ presentation.label }}</UBadge>
    </header>

    <p v-if="payment.status === 'PENDING'" class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
      El pago se solicitó y todavía no ha respondido. El dinero ya salió de la cuenta de origen;
      si el pago se rechaza, se devuelve automáticamente.
    </p>

    <p v-else-if="reason" class="mt-2 text-[13px] leading-5 text-[#5A5B63]">{{ reason }}</p>

    <p v-else class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
      El pago se aprobó y se ordenó el crédito a la cuenta de destino.
    </p>

    <dl class="mt-4 flex flex-col">
      <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-2.5">
        <dt class="text-[13px] text-[#75767F]">paymentId</dt>
        <dd
          class="break-all text-right font-mono text-[12px] text-[#5A5B63]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ payment.paymentId }}</dd>
      </div>
      <div
        v-if="payment.attempt !== null && payment.attempt > 1"
        class="flex justify-between gap-4 border-t border-[#E9E9EC] py-2.5"
      >
        <dt class="text-[13px] text-[#75767F]">Intentos del proveedor</dt>
        <dd
          class="text-[13px] font-medium"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ payment.attempt }}</dd>
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
  </section>
</template>
