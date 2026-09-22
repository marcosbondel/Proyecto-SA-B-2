<script setup lang="ts">
import { directionOf } from '../../lib/transaction';
import type { TransferRow } from '../../lib/transaction';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * `T-04` and `T-05`'s shared table.
 *
 * One component and not two, because the difference between a customer's
 * history and an administrator's monitor is which rows arrive and which columns
 * are worth showing — not how a transfer is drawn. Two tables would be two
 * places for the money column to stop being right-aligned.
 *
 * The `accountId` prop is what makes a row read as **money leaving** or **money
 * arriving**. Without it — the admin monitor, where rows belong to many people —
 * the amount is unsigned, because "out" and "in" are not properties of a
 * transfer, they are properties of looking at one from a particular account.
 */
withDefaults(
  defineProps<{
    readonly rows: readonly TransferRow[];
    /** The account the reader is looking from, when there is one. */
    readonly accountId?: string | null;
    /** Shown by the admin monitor, hidden in a customer's own history. */
    readonly showAccounts?: boolean;
    readonly accountNamesMap?: Record<string, string>;
  }>(),
  { accountId: null, showAccounts: false, accountNamesMap: () => ({}) },
);

/** A UUID is unreadable at a glance; its last segment is enough to tell rows apart. */
function shortId(id: string): string {
  return id.slice(-12);
}
</script>

<template>
  <!-- Its own scroll container: a wide table must never make the page scroll
       sideways, which on a phone hides the navigation. -->
  <div class="overflow-x-auto">
    <table class="w-full min-w-[720px] border-collapse text-[13px]">
      <thead>
        <tr class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">
          <th class="py-3 pr-4 text-left font-semibold">Fecha</th>
          <th v-if="showAccounts" class="py-3 pr-4 text-left font-semibold">Origen → Destino</th>
          <th v-else class="py-3 pr-4 text-left font-semibold">Contraparte</th>
          <th class="py-3 pr-4 text-left font-semibold">Estado</th>
          <!-- Right-aligned and tabular, as `docs/DESIGN.md` requires of every
               currency column: a list of amounts is read by scanning digits. -->
          <th class="py-3 pl-4 text-right font-semibold">Monto</th>
          <th class="py-3 pl-4 text-right font-semibold" />
        </tr>
      </thead>

      <tbody>
        <tr v-for="row in rows" :key="row.transactionId" class="align-top">
          <td class="tab border-t border-[#E9E9EC] py-3.5 pr-4 text-[#5A5B63]">
            {{ formatDate(row.createdAt) }}
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <template v-if="showAccounts">
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-medium text-[#23242A]">
                    {{ accountNamesMap?.[row.sourceAccount] ?? shortId(row.sourceAccount) }}
                  </span>
                  <span class="text-[#A8A9B2]">→</span>
                  <span class="font-medium text-[#23242A]">
                    {{ accountNamesMap?.[row.targetAccount] ?? shortId(row.targetAccount) }}
                  </span>
                </div>
                <div class="font-mono text-[11px] text-[#75767F]">
                  ···{{ shortId(row.sourceAccount) }} → ···{{ shortId(row.targetAccount) }}
                </div>
              </div>
            </template>
            <div v-else class="flex flex-col gap-0.5">
              <span
                v-if="accountNamesMap?.[directionOf(row, accountId) === 'OUT' ? row.targetAccount : row.sourceAccount]"
                class="font-medium text-[#23242A]"
              >
                {{ accountNamesMap[directionOf(row, accountId) === 'OUT' ? row.targetAccount : row.sourceAccount] }}
              </span>
              <span class="tab font-mono text-[12px] text-[#5A5B63]">
                ···{{
                  directionOf(row, accountId) === 'OUT'
                    ? shortId(row.targetAccount)
                    : shortId(row.sourceAccount)
                }}
              </span>
            </div>
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <TransactionStatusBadge :status="row.status" />
          </td>

          <td
            class="tab border-t border-[#E9E9EC] py-3.5 pl-4 text-right font-semibold"
            :class="{
              'text-[#B01B1B]': directionOf(row, accountId) === 'OUT',
              'text-[#186A32]': directionOf(row, accountId) === 'IN',
              'text-[#23242A]': directionOf(row, accountId) === 'NEUTRAL',
            }"
          >
            {{ directionOf(row, accountId) === 'OUT' ? '−' : directionOf(row, accountId) === 'IN' ? '+' : ''
            }}{{ formatQuetzales(row.amount.amountMinor) }}
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pl-4 text-right">
            <UButton
              :to="`/transferencias/${row.transactionId}`"
              variant="ghost"
              color="neutral"
              size="xs"
            >Ver →</UButton>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
