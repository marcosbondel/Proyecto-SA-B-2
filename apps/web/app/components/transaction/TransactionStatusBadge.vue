<script setup lang="ts">
import { STATUS_PRESENTATION } from '../../lib/transaction';
import type { TransactionStatus } from '../../lib/transaction';

/**
 * Where a transfer stands, as one chip.
 *
 * The colour and the wording come from `STATUS_PRESENTATION` — the same table
 * the detail screen reads — so a transfer cannot be "Compensada" in a list and
 * something else on its own page. That table is a plain module and therefore
 * tested, unlike this template (TD-010).
 *
 * The three in-flight states are amber rather than grey for the reason
 * `IdentityStatusBadge` gives `PENDING` amber: they are not "nothing has
 * happened", they are "the money is somewhere in between", and a neutral chip
 * would read as incidental.
 */
const props = withDefaults(
  defineProps<{ status: TransactionStatus; explain?: boolean }>(),
  { explain: false },
);

const presentation = computed(() => STATUS_PRESENTATION[props.status]);
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <UBadge
      :color="presentation.color"
      variant="subtle"
      class="w-fit rounded-full px-2.5 py-1 text-[12px] font-semibold"
      :data-status="status"
    >{{ presentation.label }}</UBadge>

    <p v-if="explain" class="max-w-[46ch] text-[13px] leading-5 text-[#5A5B63]">
      {{ presentation.explanation }}
    </p>
  </div>
</template>
