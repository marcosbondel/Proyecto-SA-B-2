<script setup lang="ts">
import { PAYMENT_SCENARIOS } from '../../lib/transaction';
import type { PaymentScenario } from '../../lib/transaction';

/**
 * How the payment step should be made to end — **for a demonstration only**.
 *
 * The assignment's Saga is only worth showing when it can be seen failing and
 * compensating on demand, and no payment provider can be asked to decline to
 * order. So the ending is choosable, and the field travels
 * `transfer.requested.v1` → `payment.requested.v1` to the one service allowed
 * to obey it. The Gateway validates it and never acts on it; Transaction
 * Service carries it and never acts on it either.
 *
 * **The legend is not decoration.** A control that silently decides whether
 * somebody's money arrives would be indefensible in a banking interface; the
 * only thing that makes it defensible is that the screen says, in plain words
 * and without being asked, that it is a rehearsal. Leaving it empty is the
 * normal path and is what a real transfer does.
 *
 * Owned by T-19 (Payment Service). Built here by T-18 because the Transferencias
 * screens cannot demonstrate a compensated Saga without it; recorded as TD-034.
 */
const model = defineModel<PaymentScenario | null>({ default: null });

const items = computed(() => [
  { label: 'Sin escenario (comportamiento real)', value: null },
  ...PAYMENT_SCENARIOS.map((scenario) => ({ label: scenario.label, value: scenario.value })),
]);

const chosen = computed(() =>
  PAYMENT_SCENARIOS.find((scenario) => scenario.value === model.value) ?? null,
);
</script>

<template>
  <div class="flex flex-col gap-2 rounded-xl border border-dashed border-[#C6C6CC] bg-[#F0F0F2] p-4">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge
        color="warning"
        variant="subtle"
        class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]"
      >Solo para demostración</UBadge>
      <span class="text-[12px] text-[#5A5B63]">
        Fuerza cómo termina el pago. No existe en un banco real.
      </span>
    </div>

    <UFormField label="Escenario de pago" name="paymentScenario">
      <USelect
        v-model="model"
        :items="items"
        value-key="value"
        class="w-full"
        data-testid="payment-scenario"
      />
    </UFormField>

    <p v-if="chosen" class="text-[13px] leading-5 text-[#5A5B63]">
      {{ chosen.description }}
    </p>
    <p v-else class="text-[13px] leading-5 text-[#5A5B63]">
      Sin escenario, el pago se procesa como lo haría normalmente.
    </p>
  </div>
</template>
