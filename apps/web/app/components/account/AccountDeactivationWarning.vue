<script setup lang="ts">
import { INACTIVITY_MONTHS, deactivationRisk } from '../../lib/account';
import type { AccountSummary } from '../../lib/account';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * "This account is about to be deactivated by itself."
 *
 * The prototype's `acctWarn` banner. It exists because the automatic process is
 * the one thing in this system that changes an account with nobody asking, and
 * finding out afterwards is not the same as being told.
 *
 * The rule it states is computed by `deactivationRisk`, which mirrors the
 * service's own policy and is tested at the same four boundaries. A banner that
 * disagreed with the job would be worse than none: it would say "safe" on the
 * day the account is deactivated.
 */
const props = defineProps<{ account: AccountSummary; now?: Date }>();

const risk = computed(() => deactivationRisk(props.account, props.now ?? new Date()));

const remaining = computed(() => {
  const days = risk.value.daysRemaining;

  if (days <= 0) {
    return 'Ya cumple las condiciones: el próximo pase del proceso la desactivará.';
  }

  return `Faltan ${days} ${days === 1 ? 'día' : 'días'} (${formatDate(risk.value.deactivatesOn.toISOString())}).`;
});
</script>

<template>
  <UAlert
    v-if="risk.atRisk"
    color="warning"
    variant="subtle"
    title="Esta cuenta está en riesgo de desactivación automática"
    data-testid="deactivation-warning"
  >
    <template #description>
      <p class="text-[13px] leading-5">
        Lleva sin movimientos con un saldo de
        <strong style="font-variant-numeric: tabular-nums lining-nums">
          {{ formatQuetzales(account.balance.amountMinor) }}</strong>. Al cumplir
        {{ INACTIVITY_MONTHS }} meses inactiva con saldo menor a
        <strong>Q 50.00</strong>, el proceso automático de Account Service la desactivará.
        {{ remaining }}
      </p>
      <p class="mt-2 text-[13px] leading-5">
        Registra un movimiento —una transferencia recibida basta— para conservarla activa.
      </p>
    </template>
  </UAlert>
</template>
