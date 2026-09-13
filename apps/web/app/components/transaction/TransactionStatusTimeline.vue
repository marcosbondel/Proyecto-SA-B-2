<script setup lang="ts">
import { STATUS_PRESENTATION, timelineFor, traceFor } from '../../lib/transaction';
import type { TransactionStatus, TransitionRow } from '../../lib/transaction';

/**
 * The Saga as a line: `PENDING → DEBITING → PAYMENT_PENDING → COMPLETED`, or
 * the ending it actually reached.
 *
 * Where the nodes stand is decided by `timelineFor` in `app/lib/`, which is a
 * plain function and therefore tested (TD-010). This file only draws it — and
 * that division is the point, because the thing most likely to be wrong here is
 * the claim "the debit succeeded", not the colour of a dot.
 *
 * Two states look similar and must not: a step that is **still coming**
 * animates, a step that will **never come** is struck through. On a transfer
 * that failed at the debit, a pulsing "Pago" node would suggest a payment is
 * being attempted for a transfer that ended thirty seconds ago.
 *
 * `transitions` is the real history (T-28). When it carries rows, they drive
 * the line instead of `timelineFor`'s projection from the current status
 * alone — the same four dots, but naming what actually happened and when,
 * rather than where a transfer of this status usually stands. A transfer this
 * migration predates, or a reply from before the field existed, sends `[]`
 * or nothing at all, and the projection is what the reader sees instead.
 */
const props = defineProps<{
  status: TransactionStatus;
  live?: boolean;
  transitions?: readonly TransitionRow[];
}>();

const trace = computed(() => traceFor(props.transitions ?? []));
const hasTrace = computed(() => trace.value.length > 0);
const steps = computed(() => timelineFor(props.status));
const presentation = computed(() => STATUS_PRESENTATION[props.status]);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('es-GT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DOT: Record<string, string> = {
  done: 'border-[#17191F] bg-[#17191F] text-white',
  current: 'border-[#17191F] bg-white text-[#17191F]',
  pending: 'border-[#C6C6CC] bg-white text-[#A8A9B2]',
  failed: 'border-[#B01B1B] bg-[#B01B1B] text-white',
  skipped: 'border-[#DCDCE0] bg-[#F0F0F2] text-[#A8A9B2]',
};

const LABEL: Record<string, string> = {
  done: 'text-[#23242A]',
  current: 'text-[#23242A]',
  pending: 'text-[#75767F]',
  failed: 'text-[#B01B1B]',
  skipped: 'text-[#A8A9B2] line-through',
};
</script>

<template>
  <section class="rounded-2xl border border-[#DCDCE0] bg-white p-6" data-testid="transfer-timeline">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-[20px] font-semibold leading-7">Avance de la transferencia</h2>
      <UBadge
        :color="presentation.color"
        variant="subtle"
        class="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]"
        :data-status="status"
      >{{ presentation.label }}</UBadge>
    </header>

    <p class="mt-2 text-[14px] leading-[22px] text-[#5A5B63]">{{ presentation.explanation }}</p>

    <!-- The real trace (T-28): what actually happened, in the order it happened. -->
    <ol v-if="hasTrace" class="mt-6 flex flex-col gap-0" role="list" data-testid="transfer-trace">
      <li
        v-for="(step, index) in trace"
        :key="`${step.to}-${step.occurredAt}`"
        class="flex gap-4"
        :data-to="step.to"
      >
        <div class="flex flex-col items-center">
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-[13px] font-bold"
            :class="step.failed
              ? 'border-[#B01B1B] bg-[#B01B1B] text-white'
              : 'border-[#17191F] bg-[#17191F] text-white'"
            aria-hidden="true"
          >{{ step.failed ? '!' : '✓' }}</span>
          <span
            v-if="index < trace.length - 1"
            class="my-1 w-0.5 flex-1 bg-[#17191F]"
            aria-hidden="true"
          />
        </div>

        <div class="pb-6 last:pb-0">
          <p class="text-[15px] font-semibold leading-6" :class="step.failed ? 'text-[#B01B1B]' : 'text-[#23242A]'">
            {{ step.label }}
          </p>
          <p class="mt-0.5 text-[13px] leading-5 text-[#5A5B63]">{{ formatTime(step.occurredAt) }}</p>
        </div>
      </li>
    </ol>

    <!-- No recorded trace (a transfer from before T-28): fall back to the projected line. -->
    <ol v-else class="mt-6 flex flex-col gap-0" role="list">
      <li
        v-for="(step, index) in steps"
        :key="step.key"
        class="flex gap-4"
        :data-step="step.key"
        :data-state="step.state"
      >
        <div class="flex flex-col items-center">
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-[13px] font-bold"
            :class="[
              DOT[step.state],
              step.state === 'current' && live ? 'animate-pulse' : '',
            ]"
            aria-hidden="true"
          >{{ step.state === 'failed' ? '!' : step.state === 'done' ? '✓' : index + 1 }}</span>
          <span
            v-if="index < steps.length - 1"
            class="my-1 w-0.5 flex-1"
            :class="step.state === 'done' ? 'bg-[#17191F]' : 'bg-[#DCDCE0]'"
            aria-hidden="true"
          />
        </div>

        <div class="pb-6 last:pb-0">
          <p class="text-[15px] font-semibold leading-6" :class="LABEL[step.state]">
            {{ step.label }}
            <span class="sr-only">
              — {{
                {
                  done: 'completado',
                  current: 'en proceso',
                  pending: 'pendiente',
                  failed: 'falló',
                  skipped: 'no se alcanzó',
                }[step.state]
              }}
            </span>
          </p>
          <p class="mt-0.5 text-[13px] leading-5 text-[#5A5B63]">{{ step.description }}</p>
        </div>
      </li>
    </ol>
  </section>
</template>
