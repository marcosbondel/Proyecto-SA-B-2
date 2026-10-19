<script setup lang="ts">
import { interbankDetailPath } from '../../lib/interbank-deposit';
import type { InterbankSendView } from '../../lib/interbank-deposit';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * The list of deposits sent to the partner bank.
 *
 * Shaped like `TransactionHistoryTable` — same scroll container, same
 * right-aligned tabular money column — because the two are read the same way and
 * a second idiom for "a list of transfers" would be a second thing to learn.
 * What differs is the destination: it is another bank's account, so it shows the
 * bank's code and the account **as the service masked it**. This component never
 * sees the full number and has nothing to hide.
 *
 * The amount is unsigned. Every row is money leaving this bank, so a minus sign
 * on all of them would be noise; the state says whether it stayed gone.
 */
defineProps<{ readonly rows: readonly InterbankSendView[] }>();
</script>

<template>
  <!-- Its own scroll container: a wide table must never make the page scroll
       sideways, which on a phone hides the navigation. `relative` is what keeps
       the `sr-only` caption and header from escaping it: they are absolutely
       positioned, and without a positioned ancestor here they were laid out
       against the page and widened it to the table's width. -->
  <div class="relative overflow-x-auto">
    <table class="w-full min-w-[640px] border-collapse text-[13px]" data-testid="interbank-table">
      <caption class="sr-only">Depósitos enviados a otros bancos, del más reciente al más antiguo</caption>
      <thead>
        <tr class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">
          <th scope="col" class="py-3 pr-4 text-left font-semibold">Fecha</th>
          <th scope="col" class="py-3 pr-4 text-left font-semibold">Destino</th>
          <th scope="col" class="py-3 pr-4 text-left font-semibold">Estado</th>
          <th scope="col" class="py-3 pl-4 text-right font-semibold">Monto</th>
          <th scope="col" class="py-3 pl-4 text-right font-semibold"><span class="sr-only">Detalle</span></th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="row in rows"
          :key="row.interbankTransferId"
          class="align-top"
          data-testid="interbank-row"
          :data-state="row.state"
        >
          <td class="tab border-t border-[#E9E9EC] py-3.5 pr-4 text-[#5A5B63]">
            {{ formatDate(row.createdAt) }}
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <div class="flex flex-col gap-0.5">
              <span class="font-medium text-[#23242A]">{{ row.destinationBankCode }}</span>
              <span class="tab break-all font-mono text-[12px] text-[#5A5B63]">
                {{ row.destinationAccount }}
              </span>
            </div>
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <TransactionInterbankStateBadge :state="row.state" />
          </td>

          <td class="tab border-t border-[#E9E9EC] py-3.5 pl-4 text-right font-semibold text-[#23242A]">
            {{ formatQuetzales(row.amount.amountMinor) }}
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pl-4 text-right">
            <UButton
              :to="interbankDetailPath(row.interbankTransferId)"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="`Ver el depósito de ${formatQuetzales(row.amount.amountMinor)} a ${row.destinationBankCode}`"
            >Ver →</UButton>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
