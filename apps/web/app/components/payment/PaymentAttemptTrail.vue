<script setup lang="ts">
import {
  ERROR_TYPE_PRESENTATION,
  attemptProgress,
  formatDelay,
  isRetrying,
  nextRetryDelayMs,
} from '../../lib/payment';
import type { PaymentAttempt, PaymentSignals } from '../../lib/payment';
import { formatDate } from '../../lib/money';

/**
 * The retry ladder, while it is being climbed and after it is spent.
 *
 * This is the part of the ticket that had nowhere to come from until T-19 added
 * `payment.attempt.failed.v1`: before it, a payment's attempt count existed
 * only on the event that ended the payment, so "se está reintentando" was
 * something no screen could truthfully say and "intentos: 3" was something it
 * could only say once the retrying had stopped.
 *
 * Three things it is careful about:
 *
 * - **It shows a retry as in progress only when one actually is.** `PENDING`
 *   plus a transient failure behind it, which is `isRetrying`. A pending
 *   payment on its first attempt gets no spinner, because inventing motion
 *   where there is none is how an interface loses the right to be believed.
 * - **It counts attempts, not retries.** "Intento 3 de 4" — the ladder has
 *   three rungs and the first try is not one of them.
 * - **The wait is read from the ladder**, so a change to the policy in
 *   `@bank/contracts` shows up here as different text rather than as a lie. The
 *   test in `test/payment.test.mjs` fails the build if the copy drifts.
 *
 * `attempts` is the evidence table Payment Service keeps and is optional: the
 * transfer's status reply does not carry it, so inside a transfer this renders
 * the summary alone. Absent evidence is drawn as absent, never as an empty
 * ladder — "no attempts recorded" and "one clean attempt" are different facts.
 *
 * Owned by T-19.
 */
const props = defineProps<{
  signals: PaymentSignals;
  attempts?: readonly PaymentAttempt[];
}>();

const progress = computed(() => attemptProgress(props.signals));
const retrying = computed(() => isRetrying(props.signals));
const waitMs = computed(() => nextRetryDelayMs(props.signals));
const kind = computed(() =>
  props.signals.errorType === null ? null : ERROR_TYPE_PRESENTATION[props.signals.errorType],
);

/** Nothing to draw: one clean attempt, no failure behind it, no evidence. */
const silent = computed(
  () =>
    progress.value === null &&
    !retrying.value &&
    kind.value === null &&
    (props.attempts ?? []).length === 0,
);
</script>

<template>
  <div v-if="!silent" class="flex flex-col gap-3" data-testid="payment-attempts">
    <div class="flex flex-wrap items-center gap-2">
      <!--
        The one moment the retry policy is visible from outside. It is a live
        state, so it says so — and it says what it is waiting for, because "en
        proceso" for thirty silent seconds reads as a hung screen.
      -->
      <span
        v-if="retrying"
        class="inline-flex items-center gap-2 rounded-full bg-[rgba(180,116,10,.16)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#7A4F06]"
        data-testid="payment-retrying"
      >
        <span class="relative flex h-1.5 w-1.5">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B4740A] opacity-75"
          />
          <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#B4740A]" />
        </span>
        Reintentando
      </span>

      <span
        v-if="progress"
        class="rounded-full border border-[#C6C6CC] px-3 py-1 text-[11px] font-semibold text-[#5A5B63]"
        style="font-variant-numeric: tabular-nums lining-nums"
        data-testid="payment-attempt-count"
      >Intento {{ progress.attempt }} de {{ progress.of }}</span>

      <span
        v-if="kind"
        class="rounded-full border border-[#C6C6CC] px-3 py-1 text-[11px] font-semibold text-[#5A5B63]"
        :data-error-type="signals.errorType"
      >Fallo {{ kind.label.toLowerCase() }}</span>
    </div>

    <p v-if="retrying && waitMs !== null" class="text-[13px] leading-5 text-[#5A5B63]">
      El intento anterior falló. El siguiente sale en {{ formatDelay(waitMs) }}.
      <template v-if="kind">{{ kind.explanation }}</template>
    </p>

    <p v-else-if="kind" class="text-[13px] leading-5 text-[#5A5B63]">
      {{ kind.explanation }}
    </p>

    <p
      v-if="progress?.exhausted && !retrying"
      class="text-[13px] leading-5 text-[#5A5B63]"
    >
      Se agotaron los {{ progress.of }} intentos que permite la política de reintentos.
    </p>

    <!--
      The evidence, when the owning service was asked directly. Oldest first, so
      it reads in the order it happened rather than in the order a list is
      usually sorted.
    -->
    <ol v-if="attempts && attempts.length > 0" class="flex flex-col">
      <li
        v-for="attempt in attempts"
        :key="attempt.attemptNumber"
        class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5"
        data-testid="payment-attempt-row"
      >
        <span class="flex items-baseline gap-2">
          <span
            class="text-[13px] font-medium text-[#23242A]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >Intento {{ attempt.attemptNumber }}</span>
          <span
            class="text-[12px]"
            :class="attempt.result === 'SUCCEEDED' ? 'text-[#186A32]' : 'text-[#8A1010]'"
          >{{ attempt.result === 'SUCCEEDED' ? 'aprobado' : 'falló' }}</span>
          <span v-if="attempt.errorType" class="text-[12px] text-[#75767F]">
            · {{ ERROR_TYPE_PRESENTATION[attempt.errorType].label.toLowerCase() }}
          </span>
        </span>
        <span
          class="text-[12px] text-[#75767F]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ formatDate(attempt.occurredAt) }}</span>
      </li>
    </ol>
  </div>
</template>
