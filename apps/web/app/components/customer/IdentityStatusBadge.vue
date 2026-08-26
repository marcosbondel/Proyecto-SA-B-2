<script setup lang="ts">
import { IDENTITY_PRESENTATION } from '../../lib/customer';
import type { IdentityStatus } from '../../lib/customer';

/**
 * Where a customer stands with the photo of their document.
 *
 * `PENDING` is amber rather than grey on purpose: it is not "nothing has
 * happened yet", it is the state in which no account can be opened. A neutral
 * chip would read as incidental, and somebody would wait for a validation they
 * were never told they needed.
 *
 * The colour and the wording come from `IDENTITY_PRESENTATION`, which is a
 * plain module and therefore covered by tests, unlike this template (TD-010).
 */
const props = withDefaults(
  defineProps<{ status: IdentityStatus; explain?: boolean }>(),
  { explain: false },
);

const presentation = computed(() => IDENTITY_PRESENTATION[props.status]);
</script>

<template>
  <div class="flex flex-col gap-2">
    <UBadge
      :color="presentation.color"
      variant="subtle"
      class="w-fit rounded-full px-3 py-1.5 text-[13px] font-semibold"
      :data-status="status"
    >{{ presentation.label }}</UBadge>

    <p v-if="explain" class="text-[13px] leading-5 text-[#5A5B63]">
      {{ presentation.explanation }}
    </p>
  </div>
</template>
