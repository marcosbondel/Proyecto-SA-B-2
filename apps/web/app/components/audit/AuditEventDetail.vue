<script setup lang="ts">
import {
  PROCESSING_STATUS_PRESENTATION,
  REDACTION_MARKER,
  formatPayload,
  redactedCount,
} from '../../lib/audit';
import type { AuditEventRow } from '../../lib/audit';
import { formatDate } from '../../lib/money';

/**
 * One event, in the side panel the prototype draws as `N-03`.
 *
 * The prototype's version prints the payload as it was published, syntax
 * coloured, on an obsidian card. **This one prints the redaction**, and the
 * difference is the single most important decision in this module.
 *
 * `audit.query.replied.v1` was defined by T-05 with metadata and no payload at
 * all, for a stated reason: this service hears every event in the bank, and a
 * trail of verbatim payloads would reassemble in one screen the personal and
 * financial data that five separate databases exist to keep apart. T-20 added
 * the payload back as an **optional, redacted** field so this screen could
 * exist without that being true — the hiding is computed by the service that
 * owns the record, before the insert, and this component only renders what
 * arrives. A drawer that received the raw payload and hid fields in CSS would
 * be a leak with a stylesheet over it. Recorded as TD-039.
 *
 * So the panel says what was hidden and how many, rather than pretending the
 * message carried less than it did.
 *
 * Owned by T-20.
 */
const props = defineProps<{ event: AuditEventRow | null }>();

const emit = defineEmits<{ close: [] }>();

const payload = computed(() => formatPayload(props.event?.payload));
const hidden = computed(() => redactedCount(props.event?.payload));

const copied = ref(false);

async function copyEventId(): Promise<void> {
  if (props.event === null) {
    return;
  }

  await navigator.clipboard.writeText(props.event.messageId);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1_500);
}

/** Escape closes it, because a panel that traps a keyboard is a panel that traps. */
function onKeydown(keyboard: KeyboardEvent): void {
  if (keyboard.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div
    v-if="event"
    class="fixed inset-0 z-40 flex justify-end bg-[rgba(23,24,26,0.45)] backdrop-blur-[3px]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="audit-detail-title"
    data-testid="audit-event-panel"
    @click.self="emit('close')"
  >
    <div class="h-full w-full max-w-[560px] overflow-auto border-l border-[#DCDCE0] bg-white p-7">
      <div class="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2
            id="audit-detail-title"
            class="text-[18px] font-semibold leading-6 text-[#23242A]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ event.messageType }}</h2>
          <code
            class="mt-1 block break-all font-mono text-[12px] text-[#75767F]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ event.messageId }}</code>
        </div>
        <UButton
          variant="outline"
          color="neutral"
          size="sm"
          aria-label="Cerrar el detalle"
          @click="emit('close')"
        >✕</UButton>
      </div>

      <dl class="mb-6 flex flex-col">
        <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
          <dt class="text-[13px] text-[#75767F]">Servicio origen</dt>
          <dd class="text-[13px] font-medium text-[#23242A]">{{ event.producer }}</dd>
        </div>
        <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
          <dt class="text-[13px] text-[#75767F]">Momento</dt>
          <dd
            class="text-[13px] font-medium text-[#23242A]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatDate(event.occurredAt) }}</dd>
        </div>
        <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
          <dt class="text-[13px] text-[#75767F]">Causado por</dt>
          <dd class="text-right text-[13px] font-medium text-[#23242A]">
            <code
              v-if="event.causationId"
              class="break-all font-mono text-[11px]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ event.causationId }}</code>
            <!--
              A flow's first message has no cause, and saying "ninguno" is
              wrong: the honest statement is that this is where the flow began.
            -->
            <span v-else class="text-[#5A5B63]">Primer mensaje del flujo</span>
          </dd>
        </div>
        <div
          v-if="event.processingStatus"
          class="flex items-start justify-between gap-4 border-t border-[#E9E9EC] py-3"
        >
          <dt class="text-[13px] text-[#75767F]">Registro</dt>
          <dd class="text-right">
            <UBadge
              :color="PROCESSING_STATUS_PRESENTATION[event.processingStatus].color"
              variant="subtle"
              size="sm"
            >{{ PROCESSING_STATUS_PRESENTATION[event.processingStatus].label }}</UBadge>
            <p class="mt-1 max-w-[320px] text-[12px] leading-4 text-[#5A5B63]">
              {{ PROCESSING_STATUS_PRESENTATION[event.processingStatus].explanation }}
            </p>
          </dd>
        </div>
      </dl>

      <h3 class="mb-2 text-[13px] font-semibold text-[#23242A]">Payload</h3>

      <pre
        v-if="payload"
        class="m-0 overflow-auto rounded-xl bg-[#23242A] p-5 font-mono text-[12px] leading-5 text-[#DCDCE0]"
        style="font-variant-numeric: tabular-nums lining-nums"
        data-testid="audit-payload"
      >{{ payload }}</pre>

      <!--
        Nothing survived redaction. Saying so beats an empty `{}`, which a
        reader would take as a statement about the producer rather than about
        this service.
      -->
      <p
        v-else
        class="rounded-xl border border-dashed border-[#C6C6CC] px-5 py-6 text-[13px] leading-5 text-[#5A5B63]"
      >
        Este mensaje no tiene contenido que mostrar. O no llevaba datos, o todos sus campos
        quedaron ocultos por la política de privacidad del servicio de auditoría.
      </p>

      <p v-if="hidden > 0" class="mt-3 text-[12px] leading-4 text-[#75767F]">
        {{ hidden }}
        {{ hidden === 1 ? 'campo aparece' : 'campos aparecen' }}
        como <code class="font-mono">{{ REDACTION_MARKER }}</code>. El servicio de auditoría
        guarda los payloads ya ocultos: nunca almacena el original. Los montos, los documentos
        y los correos viven en la base del servicio que los posee, no aquí.
      </p>

      <div class="mt-6 flex flex-wrap gap-2">
        <UButton variant="outline" color="neutral" class="flex-1" @click="copyEventId">
          {{ copied ? 'eventId copiado' : 'Copiar eventId' }}
        </UButton>
        <UButton variant="ghost" color="neutral" @click="emit('close')">Cerrar</UButton>
      </div>
    </div>
  </div>
</template>
