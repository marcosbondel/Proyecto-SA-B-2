<script setup lang="ts">
/**
 * One number on a dashboard, and the reason it is a component.
 *
 * A tile whose value is `null` says **"sin dato"** rather than `0`. That
 * distinction is the whole point: a section of the dashboard comes back `null`
 * when the owning service did not answer in time, and a zero drawn for an
 * unanswered question is a wrong number rather than a missing one. On the
 * screen somebody opens when something is wrong, a wrong number is worse.
 */
withDefaults(
  defineProps<{
    readonly label: string;
    /** Already formatted. A tile does not know what a quetzal is. */
    readonly value: string | null;
    readonly hint?: string;
    /** Optional emphasis, for the figures that mean something is happening. */
    readonly tone?: 'neutral' | 'warning' | 'error' | 'success';
    readonly to?: string;
    readonly action?: string;
  }>(),
  { tone: 'neutral', hint: undefined, to: undefined, action: undefined },
);

const TONES: Readonly<Record<string, string>> = {
  neutral: 'text-[#0B0C10]',
  warning: 'text-[#7A4F06]',
  error: 'text-[#8A1010]',
  success: 'text-[#186A32]',
};
</script>

<template>
  <UCard>
    <p class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">{{ label }}</p>

    <p
      v-if="value !== null"
      class="tab mt-1 text-[32px] font-bold leading-10 tracking-[-0.02em]"
      :class="TONES[tone]"
    >{{ value }}</p>

    <!-- Not a zero, and not an empty space either: somebody has to be able to
         tell "nothing happened" from "we could not ask". -->
    <p v-else class="mt-1 text-[20px] font-semibold leading-10 text-[#A8A9B2]">Sin dato</p>

    <p v-if="hint" class="mt-1 text-[13px] leading-5 text-[#5A5B63]">{{ hint }}</p>

    <UButton v-if="to && action" :to="to" variant="ghost" color="neutral" size="xs" class="mt-2">
      {{ action }} →
    </UButton>
  </UCard>
</template>
