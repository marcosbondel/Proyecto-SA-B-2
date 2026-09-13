<script setup lang="ts">
import { KYC_PRESENTATION } from '../../lib/customer';
import type { KycStatus } from '../../lib/customer';

/**
 * Where a customer stands with the Fase 2 KYC verdict (T-31).
 *
 * Distinct from `IdentityStatusBadge`: that one is Fase 1's document-photo
 * review, which gates opening an account; this one is the compliance verdict
 * that gates initiating a transfer. `PENDING` is amber for the same reason
 * that badge's is — it is the state in which a transfer will be refused, not
 * "nothing has happened yet".
 */
const props = withDefaults(
  defineProps<{ status: KycStatus; explain?: boolean }>(),
  { explain: false },
);

const presentation = computed(() => KYC_PRESENTATION[props.status]);
</script>

<template>
  <div class="flex flex-col gap-2">
    <UBadge
      :color="presentation.color"
      variant="subtle"
      class="w-fit rounded-full px-3 py-1.5 text-[13px] font-semibold"
      :data-kyc-status="status"
    >{{ presentation.label }}</UBadge>

    <p v-if="explain" class="text-[13px] leading-5 text-[#5A5B63]">
      {{ presentation.explanation }}
    </p>
  </div>
</template>
