<script setup lang="ts">
import { INTERBANK_STATE_PRESENTATION } from '../../lib/interbank-deposit';
import type { InterbankSendState } from '../../lib/interbank-deposit';

/**
 * Where a deposit to the partner bank stands, as one chip.
 *
 * The wording and the colour come from `INTERBANK_STATE_PRESENTATION`, the same
 * table the detail screen reads, so a deposit cannot be "Esperando al otro
 * banco" in the list and something else on its own page. It is the sibling of
 * `TransactionStatusBadge`, and a separate component on purpose: that one speaks
 * the Saga's six states and this one the deposit's six, and they share names
 * (`PENDING`) while meaning different things.
 *
 * Named with its directory prefix because Nuxt silently renders nothing for a
 * tag that does not match the path (`docs/FRONTEND.md`).
 */
const props = withDefaults(
  defineProps<{ state: InterbankSendState; explain?: boolean }>(),
  { explain: false },
);

const presentation = computed(() => INTERBANK_STATE_PRESENTATION[props.state]);
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <UBadge
      :color="presentation.color"
      variant="subtle"
      class="w-fit rounded-full px-2.5 py-1 text-[12px] font-semibold"
      :data-state="state"
    >{{ presentation.label }}</UBadge>

    <p v-if="explain" class="max-w-[46ch] text-[13px] leading-5 text-[#5A5B63]">
      {{ presentation.explanation }}
    </p>
  </div>
</template>
