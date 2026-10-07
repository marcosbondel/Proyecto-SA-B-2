<script setup lang="ts">
/**
 * The correlation identifier, shown and copyable — and, when the Gateway sent
 * one, the trace it ran under.
 *
 * It is the diagnostic tool for the whole system: it is what somebody pastes
 * into the audit query to find out how any command actually ended. Showing it
 * without a way to copy it would make people transcribe a UUID by hand, which
 * is how the wrong one ends up in a bug report.
 *
 * **The trace id is looked up, not passed in** (T-45). Every screen already hands
 * this badge the correlation id of the operation it started; `useGatewayApi`
 * remembers the `X-Trace-Id` of every response by that same id, so the one badge
 * shows both on every screen without any screen being told about traces. The
 * second line appears only when there is a trace to show: with no SDK behind the
 * Gateway the badge is exactly what it was.
 *
 * Tabular figures, because a hexadecimal string compared by eye needs its
 * digits to line up.
 */
const props = defineProps<{ correlationId: string | null; label?: string }>();

const { traceOf } = useTraces();

const traceId = computed(() => traceOf(props.correlationId));

const copied = ref<'correlation' | 'trace' | null>(null);

async function copy(which: 'correlation' | 'trace'): Promise<void> {
  const value = which === 'correlation' ? props.correlationId : traceId.value;

  if (value === null) {
    return;
  }

  await navigator.clipboard.writeText(value);
  copied.value = which;
  setTimeout(() => {
    copied.value = null;
  }, 1_500);
}
</script>

<template>
  <div v-if="correlationId" class="flex flex-col gap-3" data-testid="correlation-badge">
    <div class="flex flex-col gap-1">
      <span class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
        {{ label ?? 'Código de seguimiento' }}
      </span>
      <span class="flex items-start gap-2">
        <code
          class="break-all font-mono text-[13px] tabular-nums text-[#23242A]"
          style="font-variant-numeric: tabular-nums lining-nums"
          data-testid="correlation-id"
        >{{ correlationId }}</code>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :aria-label="copied === 'correlation' ? 'Copiado' : 'Copiar el código de seguimiento'"
          @click="copy('correlation')"
        >{{ copied === 'correlation' ? 'Copiado' : 'Copiar' }}</UButton>
      </span>
    </div>

    <div v-if="traceId" class="flex flex-col gap-1">
      <span
        class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]"
        title="El identificador de la traza técnica de esta operación, para buscarla en Grafana."
      >
        Traza
      </span>
      <span class="flex items-start gap-2">
        <code
          class="break-all font-mono text-[13px] tabular-nums text-[#23242A]"
          style="font-variant-numeric: tabular-nums lining-nums"
          data-testid="trace-id"
        >{{ traceId }}</code>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :aria-label="copied === 'trace' ? 'Copiado' : 'Copiar el identificador de la traza'"
          @click="copy('trace')"
        >{{ copied === 'trace' ? 'Copiado' : 'Copiar' }}</UButton>
      </span>
    </div>
  </div>
</template>
