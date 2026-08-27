<script setup lang="ts">
import { PAYMENT_SCENARIOS } from '../../lib/transaction';
import type { PaymentScenario } from '../../lib/transaction';
import { MAX_ATTEMPTS, RETRY_LADDER_MS, formatDelay } from '../../lib/payment';

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
 * Reshaped by T-19 from the version T-18 built under TD-034. What changed is
 * one sentence: `TRANSIENT_FAILURE` now names the actual ladder — four attempts
 * at 1s, 5s and 30s — read from `app/lib/payment.ts` rather than described in
 * round numbers. Somebody running the demonstration needs to know how long to
 * wait before deciding it hung, and "falla y se reintenta" does not tell them.
 *
 * Owned by T-19.
 */
const model = defineModel<PaymentScenario | null>({ default: null });

const items = computed(() => [
  { label: 'Sin escenario (comportamiento real)', value: null },
  ...PAYMENT_SCENARIOS.map((scenario) => ({ label: scenario.label, value: scenario.value })),
]);

const chosen = computed(() =>
  PAYMENT_SCENARIOS.find((scenario) => scenario.value === model.value) ?? null,
);

/** The ladder, spelled out, so nobody reads a 30-second wait as a hang. */
const ladder = computed(() => RETRY_LADDER_MS.map((delay) => formatDelay(delay)).join(', '));
</script>

<template>
  <div class="flex flex-col gap-3 rounded-xl border border-dashed border-[#C6C6CC] bg-[#F0F0F2] p-4">
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
      <template v-if="chosen.value === 'TRANSIENT_FAILURE'">
        Son hasta {{ MAX_ATTEMPTS }} intentos, con esperas de {{ ladder }} entre uno y otro,
        así que la transferencia puede tardar en cerrar. El panel de resultado muestra en qué
        intento va.
      </template>
    </p>
    <p v-else class="text-[13px] leading-5 text-[#5A5B63]">
      Sin escenario, el pago se procesa como lo haría normalmente.
    </p>
  </div>
</template>
