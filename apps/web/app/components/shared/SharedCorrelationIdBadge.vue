<script setup lang="ts">
/**
 * The correlation identifier, shown and copyable.
 *
 * It is the diagnostic tool for the whole system: it is what somebody pastes
 * into the audit query to find out how any command actually ended. Showing it
 * without a way to copy it would make people transcribe a UUID by hand, which
 * is how the wrong one ends up in a bug report.
 *
 * Tabular figures, because a hexadecimal string compared by eye needs its
 * digits to line up.
 */
const props = defineProps<{ correlationId: string | null; label?: string }>();

const copied = ref(false);

async function copy(): Promise<void> {
  if (props.correlationId === null) {
    return;
  }

  await navigator.clipboard.writeText(props.correlationId);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1_500);
}
</script>

<template>
  <div v-if="correlationId" class="flex flex-col gap-1">
    <span class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
      {{ label ?? 'correlationId' }}
    </span>
    <span class="flex items-start gap-2">
      <code
        class="break-all font-mono text-[13px] tabular-nums text-[#23242A]"
        style="font-variant-numeric: tabular-nums lining-nums"
      >{{ correlationId }}</code>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :aria-label="copied ? 'Copiado' : 'Copiar correlationId'"
        @click="copy"
      >{{ copied ? 'Copiado' : 'Copiar' }}</UButton>
    </span>
  </div>
</template>
