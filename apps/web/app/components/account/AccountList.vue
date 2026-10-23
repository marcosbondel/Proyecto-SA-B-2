<script setup lang="ts">
import { ACCOUNT_TYPE_PRESENTATION } from '../../lib/account';
import type { AccountSummary } from '../../lib/account';
import { formatQuetzales } from '../../lib/money';

/**
 * The accounts table from `show.accounts`.
 *
 * Two rules from `docs/DESIGN.md` that are not decoration: currency columns are
 * right-aligned and use tabular figures, and the table is borderless between
 * columns with horizontal dividers only. A column of amounts is scanned rather
 * than read, and both rules exist so the scan works.
 *
 * The row is a link to the detail rather than a button that fetches in place:
 * the balance shown here came from a list query, and refreshing one row of a
 * list would leave the consolidated total silently stale.
 */
defineProps<{ accounts: readonly AccountSummary[]; showHolder?: boolean }>();
</script>

<template>
  <div class="overflow-x-auto rounded-2xl border border-[#DCDCE0] bg-white px-6 pb-4 pt-2">
    <table class="w-full border-collapse">
      <thead>
        <tr class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
          <th class="py-4 pr-4 text-left font-semibold">Tipo</th>
          <th class="py-4 pr-4 text-left font-semibold">Número de cuenta</th>
          <th v-if="showHolder" class="py-4 pr-4 text-left font-semibold">Titular</th>
          <th class="py-4 pr-4 text-left font-semibold">Estado</th>
          <th class="py-4 pr-4 text-right font-semibold">Saldo</th>
          <th class="py-4" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="account in accounts" :key="account.accountId" data-testid="account-row">
          <td class="border-t border-[#E9E9EC] py-4 pr-4">
            <span class="inline-flex items-center gap-2.5 text-[14px] font-medium">
              <span
                class="grid h-7 w-7 place-items-center rounded-lg bg-[#E9E9EC] text-[12px] font-bold text-[#23242A]"
              >{{ ACCOUNT_TYPE_PRESENTATION[account.accountType].mark }}</span>
              {{ ACCOUNT_TYPE_PRESENTATION[account.accountType].label }}
            </span>
          </td>
          <td
            class="border-t border-[#E9E9EC] py-4 pr-4 font-mono text-[13px] tracking-[0.03em] text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >
            <div
              v-if="account.accountNumber"
              class="font-medium text-[#23242A]"
              data-testid="account-number"
            >{{ account.accountNumber }}</div>
            <div :class="account.accountNumber ? 'text-[11px] text-[#75767F]' : ''">{{ account.accountId }}</div>
          </td>
          <td
            v-if="showHolder"
            class="border-t border-[#E9E9EC] py-4 pr-4 text-[13px]"
          >
            <div class="font-medium text-[#23242A]">{{ account.holderName ?? '—' }}</div>
            <div
              class="font-mono text-[11px] text-[#75767F]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ account.customerId }}</div>
          </td>
          <td class="border-t border-[#E9E9EC] py-4 pr-4">
            <AccountStatusBadge :status="account.status" />
          </td>
          <td
            class="border-t border-[#E9E9EC] py-4 pr-4 text-right text-[15px] font-semibold"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatQuetzales(account.balance.amountMinor) }}</td>
          <td class="border-t border-[#E9E9EC] py-4 text-right">
            <UButton
              :to="`/cuentas/${account.accountId}`"
              size="xs"
              variant="outline"
              color="neutral"
            >Ver detalle</UButton>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
