<script setup lang="ts">
import { ERROR_TYPE_PRESENTATION, signalsOf } from '../../lib/payment';
import type { PaymentRow } from '../../lib/payment';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * The payments, as the prototype's G-04 monitoring table draws them.
 *
 * Three columns of the prototype are missing and none of them by accident:
 * "Servicio / destino", "Referencia" and the internal/external pill all belong
 * to a payments product this system does not have — billers, contract numbers,
 * a third-party provider. In this system a payment is step 4 of a transfer, so
 * the columns that carry meaning are the Saga it belongs to and how many
 * attempts it took. Recorded as TD-038.
 *
 * What replaced them is the thing the ticket actually asks to be visible: the
 * attempt count and the kind of the last failure, side by side, so the table
 * answers "which of these were refused and which just ran out of tries" without
 * opening a single row.
 *
 * Currency right-aligned and tabular throughout — `docs/DESIGN.md` makes both
 * mandatory, and a column of amounts is scanned rather than read.
 *
 * Owned by T-19.
 */
defineProps<{ payments: readonly PaymentRow[] }>();
</script>

<template>
  <div class="overflow-x-auto rounded-2xl border border-[#DCDCE0] bg-white px-6 pb-4 pt-2">
    <table class="w-full border-collapse">
      <thead>
        <tr class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
          <th class="py-4 pr-4 text-left font-semibold">Pago / transferencia</th>
          <th class="py-4 pr-4 text-left font-semibold">Fecha</th>
          <th class="py-4 pr-4 text-left font-semibold">Intentos</th>
          <th class="py-4 pr-4 text-left font-semibold">Estado</th>
          <th class="py-4 pr-4 text-right font-semibold">Monto</th>
          <th class="py-4" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="payment in payments" :key="payment.paymentId" data-testid="payment-row">
          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <code
              class="block break-all font-mono text-[13px] font-medium text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ payment.paymentId }}</code>
            <code
              class="mt-0.5 block break-all font-mono text-[11px] text-[#75767F]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ payment.transactionId }}</code>
          </td>
          <td
            class="whitespace-nowrap border-t border-[#E9E9EC] py-3.5 pr-4 text-[13px] text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatDate(payment.updatedAt) }}</td>
          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <span
              class="text-[13px] text-[#5A5B63]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ payment.attempt ?? '—' }}</span>
            <span
              v-if="payment.errorType"
              class="mt-0.5 block text-[11px] text-[#75767F]"
            >{{ ERROR_TYPE_PRESENTATION[payment.errorType].label }}</span>
          </td>
          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <PaymentStatusBadge :signals="signalsOf(payment)" size="sm" />
            <!--
              A rehearsal is labelled as one. A monitoring table where a forced
              rejection looks identical to a real one is a table that will be
              used to report an outage that never happened.
            -->
            <span
              v-if="payment.scenario"
              class="mt-1 block text-[10px] uppercase tracking-[0.04em] text-[#7A4F06]"
            >Demostración</span>
          </td>
          <td
            class="border-t border-[#E9E9EC] py-3.5 pr-4 text-right text-[14px] font-semibold"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatQuetzales(payment.amount.amountMinor) }}</td>
          <td class="border-t border-[#E9E9EC] py-3.5 text-right">
            <UButton
              :to="`/pagos/${payment.paymentId}`"
              variant="outline"
              color="neutral"
              size="xs"
            >Ver estado</UButton>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
