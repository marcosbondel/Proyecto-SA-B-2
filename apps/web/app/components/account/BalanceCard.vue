<script setup lang="ts">
import { ACCOUNT_TYPE_PRESENTATION } from '../../lib/account';
import type { AccountSummary } from '../../lib/account';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * The hero of the detail screen: one balance, large, on lacquered obsidian.
 *
 * `docs/DESIGN.md` reserves the lit surface for exactly this — "Financial
 * 'Hero' cards (e.g. balance displays) use the lacquered obsidian surface to
 * stand out from standard neutral data cards" — and the whole point of a
 * monochrome system is that this one object gets to be the thing you look at
 * first. Tabular figures are mandatory for money, so the 48px figure carries
 * them.
 *
 * The account identifier is copyable because it is what somebody pastes into a
 * transfer, and a UUID transcribed by hand is a transfer to nowhere.
 */
const props = defineProps<{ account: AccountSummary; refreshing?: boolean }>();

defineEmits<{ (event: 'refresh'): void }>();

const copied = ref(false);

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(props.account.accountId);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1_500);
}
</script>

<template>
  <article
    class="rounded-3xl border border-[#2E313C] p-7 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_1px_2px_rgba(11,12,16,.24)]"
    style="background: linear-gradient(180deg, #2e313c 0%, #17191f 58%)"
  >
    <div class="flex flex-wrap items-start justify-between gap-6">
      <div>
        <div class="mb-3 flex items-center gap-3">
          <span class="text-[14px] font-semibold text-[#C3C4CC]">
            Cuenta {{ ACCOUNT_TYPE_PRESENTATION[account.accountType].label }}
          </span>
          <AccountStatusBadge :status="account.status" />
        </div>

        <p class="text-[12px] text-[#A8A9B2]">Saldo disponible</p>

        <USkeleton v-if="refreshing" class="my-2 h-14 w-64 bg-white/10" />
        <p
          v-else
          class="my-1 text-[48px] font-bold leading-[56px] tracking-[-0.02em]"
          style="font-variant-numeric: tabular-nums lining-nums"
          data-testid="balance"
        >{{ formatQuetzales(account.balance.amountMinor) }}</p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <code
            class="break-all font-mono text-[13px] tracking-[0.04em] text-[#C3C4CC]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ account.accountId }}</code>
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            class="border-white/25 text-white hover:bg-white/10"
            :aria-label="copied ? 'Copiado' : 'Copiar el número de cuenta'"
            @click="copy"
          >{{ copied ? 'Copiado' : 'Copiar' }}</UButton>
        </div>

        <p class="mt-3 text-[12px] text-[#A8A9B2]">
          Último movimiento:
          <span style="font-variant-numeric: tabular-nums lining-nums">
            {{ account.lastActivityAt ? formatDate(account.lastActivityAt) : 'sin movimientos' }}
          </span>
        </p>
      </div>

      <div class="flex gap-2">
        <UButton color="neutral" variant="solid" :loading="refreshing" @click="$emit('refresh')">
          Actualizar
        </UButton>
        <UButton
          to="/cuentas"
          variant="outline"
          color="neutral"
          class="border-white/25 text-white hover:bg-white/10"
        >Volver</UButton>
      </div>
    </div>
  </article>
</template>
