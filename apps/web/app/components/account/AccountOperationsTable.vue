<script setup lang="ts">
import { OPERATION_PRESENTATION } from '../../lib/account';
import type { AccountOperation } from '../../lib/account';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * The statement, from `show.accountDetail`.
 *
 * `balanceAfter` is printed as the ledger recorded it, never recomputed here.
 * A running total derived at display time disagrees with the ledger the moment
 * two movements share a timestamp, and the person reading it has no way to tell
 * which number is the real one.
 *
 * A `COMPENSATED` debit is shown as a debit that was undone rather than removed
 * from the list. The money did leave, and a statement that quietly dropped the
 * row would not add up.
 */
defineProps<{ operations: readonly AccountOperation[] }>();

const TONE: Record<string, string> = {
  DEBIT: 'text-[#8A1010]',
  CREDIT: 'text-[#186A32]',
  COMPENSATION: 'text-[#186A32]',
};
</script>

<template>
  <div class="overflow-x-auto rounded-2xl border border-[#DCDCE0] bg-white px-6 pb-4 pt-2">
    <table class="w-full border-collapse">
      <thead>
        <tr class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
          <th class="py-4 pr-4 text-left font-semibold">Fecha</th>
          <th class="py-4 pr-4 text-left font-semibold">Descripción</th>
          <th class="py-4 pr-4 text-left font-semibold">Estado</th>
          <th class="py-4 pr-4 text-right font-semibold">Débito / Crédito</th>
          <th class="py-4 text-right font-semibold">Saldo resultante</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="operation in operations" :key="operation.operationId" data-testid="operation-row">
          <td
            class="whitespace-nowrap border-t border-[#E9E9EC] py-3.5 pr-4 text-[13px] text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatDate(operation.occurredAt) }}</td>
          <td class="border-t border-[#E9E9EC] py-3.5 pr-4 text-[13px]">
            {{ OPERATION_PRESENTATION[operation.type].label }}
            <span v-if="operation.transactionId" class="block text-[11px] text-[#75767F]">
              Transacción
              <code class="font-mono">{{ operation.transactionId }}</code>
            </span>
          </td>
          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <UBadge
              :color="operation.status === 'COMPENSATED' ? 'warning' : 'success'"
              variant="subtle"
              class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            >{{ operation.status === 'COMPENSATED' ? 'Compensada' : 'Aplicada' }}</UBadge>
          </td>
          <td
            class="border-t border-[#E9E9EC] py-3.5 pr-4 text-right text-[14px] font-semibold"
            :class="TONE[operation.type]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >
            {{ OPERATION_PRESENTATION[operation.type].sign }}
            {{ formatQuetzales(operation.amount.amountMinor) }}
          </td>
          <td
            class="border-t border-[#E9E9EC] py-3.5 text-right text-[14px] text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatQuetzales(operation.balanceAfter.amountMinor) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
