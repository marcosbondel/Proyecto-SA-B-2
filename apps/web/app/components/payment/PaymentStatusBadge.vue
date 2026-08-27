<script setup lang="ts">
import { VERDICT_PRESENTATION, verdictOf } from '../../lib/payment';
import type { PaymentSignals } from '../../lib/payment';

/**
 * The verdict as one pill, in the prototype's badge treatment.
 *
 * One component rather than a badge written into each screen, because the four
 * endings are the thing the three payment surfaces must agree about: the panel
 * inside a transfer, the monitoring table and the payment detail all say
 * "Rechazado" or "Fallido" about the same row, and a table that disagreed with
 * the detail it links to is a table somebody would use to argue that the system
 * lost their money.
 *
 * The verdict itself is computed in `app/lib/payment.ts`, where it is tested
 * (TD-010). This file only draws it.
 *
 * Owned by T-19.
 */
const props = defineProps<{ signals: PaymentSignals; size?: 'sm' | 'md' }>();

const verdict = computed(() => verdictOf(props.signals));
const presentation = computed(() => VERDICT_PRESENTATION[verdict.value]);
</script>

<template>
  <UBadge
    :color="presentation.color"
    variant="subtle"
    class="rounded-full font-semibold uppercase tracking-[0.04em]"
    :class="size === 'sm' ? 'px-2.5 py-0.5 text-[10px]' : 'px-3.5 py-1 text-[11px]'"
    :data-verdict="verdict"
  >{{ presentation.label }}</UBadge>
</template>
