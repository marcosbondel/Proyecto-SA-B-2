<script setup lang="ts">
import { ACCOUNT_STATUS_PRESENTATION } from '../../lib/account';
import type { AccountStatus } from '../../lib/account';

/**
 * Where an account stands.
 *
 * `INACTIVE` is amber, not grey. It is not "nothing is happening" — it is the
 * state in which no transfer can leave this account, and a neutral chip would
 * read as incidental until somebody's transfer was refused for a reason the
 * interface had shown them and not explained.
 *
 * The colour and the wording come from `ACCOUNT_STATUS_PRESENTATION`, which is
 * a plain module and therefore covered by tests, unlike this template (TD-010).
 */
const props = withDefaults(
  defineProps<{ status: AccountStatus; explain?: boolean }>(),
  { explain: false },
);

const presentation = computed(() => ACCOUNT_STATUS_PRESENTATION[props.status]);
</script>

<template>
  <div class="flex flex-col gap-2">
    <UBadge
      :color="presentation.color"
      variant="subtle"
      class="w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]"
      :data-status="status"
    >{{ presentation.label }}</UBadge>

    <p v-if="explain" class="text-[13px] leading-5 text-[#5A5B63]">
      {{ presentation.explanation }}
    </p>
  </div>
</template>
