<script setup lang="ts">
import { interbankHistorySteps } from '../../lib/interbank-deposit';
import type { InterbankHistoryEntry } from '../../lib/interbank-deposit';
import { formatDate } from '../../lib/money';

/**
 * The states a deposit went through, in the order they happened.
 *
 * Drawn from the history Payment recorded and nothing else: `interbankHistorySteps`
 * labels each entry and never adds one. A line that showed the steps a deposit
 * *should* have taken would hide the one that matters when something went wrong
 * — a `TIMEOUT` the other bank never answered, a `REJECTED` that did not reach
 * `REVERSED`.
 *
 * Same dots as `TransactionStatusTimeline`'s real trace, for the same reason as
 * the badge: one idiom for "what happened, in order".
 */
const props = defineProps<{ readonly history: readonly InterbankHistoryEntry[] }>();

const steps = computed(() => interbankHistorySteps(props.history));

const DOT: Record<'ok' | 'wait' | 'fail', string> = {
  ok: 'border-[#17191F] bg-[#17191F] text-white',
  wait: 'border-[#B4740A] bg-white text-[#7A4F06]',
  fail: 'border-[#B01B1B] bg-[#B01B1B] text-white',
};

const GLYPH: Record<'ok' | 'wait' | 'fail', string> = { ok: '✓', wait: '…', fail: '!' };
</script>

<template>
  <section class="rounded-2xl border border-[#DCDCE0] bg-white p-6" data-testid="interbank-history">
    <h2 class="text-[20px] font-semibold leading-7">Historial del depósito</h2>

    <p v-if="steps.length === 0" class="mt-3 text-[14px] leading-[22px] text-[#5A5B63]">
      Todavía no hay movimientos registrados para este depósito.
    </p>

    <ol v-else class="mt-5 flex flex-col" role="list">
      <li
        v-for="(step, index) in steps"
        :key="`${step.state}-${step.at}`"
        class="flex gap-4"
        :data-state="step.state"
      >
        <div class="flex flex-col items-center">
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-[13px] font-bold"
            :class="DOT[step.tone]"
            aria-hidden="true"
          >{{ GLYPH[step.tone] }}</span>
          <span
            v-if="index < steps.length - 1"
            class="my-1 w-0.5 flex-1 bg-[#DCDCE0]"
            aria-hidden="true"
          />
        </div>

        <div class="min-w-0 pb-6 last:pb-0">
          <p
            class="text-[15px] font-semibold leading-6"
            :class="step.tone === 'fail' ? 'text-[#B01B1B]' : 'text-[#23242A]'"
          >{{ step.label }}</p>
          <p
            class="tab mt-0.5 text-[13px] leading-5 text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatDate(step.at) }}</p>
          <p
            v-if="step.reasonText"
            class="mt-1 max-w-[56ch] text-[13px] leading-5 text-[#5A5B63]"
          >{{ step.reasonText }}</p>
        </div>
      </li>
    </ol>
  </section>
</template>
