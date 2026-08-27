<script setup lang="ts">
import { PROCESSING_STATUS_PRESENTATION, orderedTrail, tintFor } from '../../lib/audit';
import type { AuditEventRow } from '../../lib/audit';
import { formatDate } from '../../lib/money';

/**
 * The trail, as the prototype's `N-02` table draws it.
 *
 * Its five columns are `eventId`, type, source service, timestamp and
 * `correlationId`, plus a "Detalle" button. **The `correlationId` column is
 * gone here and its absence is the point**: in the prototype the table is a
 * global list where every row could belong to a different flow, and here every
 * row belongs to the flow that was asked for — a column repeating the same
 * value nine times is a column that teaches a reader to stop looking at it. The
 * correlation is shown once, above the table, where it can be copied.
 *
 * What took its place is `processingStatus`, which the prototype has no notion
 * of because its events never fail to parse. It is criterion 3 made visible: a
 * message the audit service could not read is the one row worth opening.
 *
 * Ordered here as well as by the service. Not distrust — the difference between
 * a list that happens to arrive sorted and one that is sorted (`orderedTrail`).
 *
 * Owned by T-20.
 */
const props = defineProps<{ events: readonly AuditEventRow[] }>();

const emit = defineEmits<{ inspect: [event: AuditEventRow] }>();

const rows = computed(() => orderedTrail(props.events));

const TINT_CLASS = {
  failure: 'text-[#8A1010]',
  success: 'text-[#186A32]',
  neutral: 'text-[#4A4C57]',
} as const;
</script>

<template>
  <div class="overflow-x-auto rounded-2xl border border-[#DCDCE0] bg-white px-6 pb-4 pt-2">
    <table class="w-full border-collapse">
      <caption class="sr-only">
        Eventos registrados para esta correlación, del más antiguo al más reciente.
      </caption>
      <thead>
        <tr class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
          <th scope="col" class="py-4 pr-4 text-left font-semibold">Momento</th>
          <th scope="col" class="py-4 pr-4 text-left font-semibold">Tipo de evento</th>
          <th scope="col" class="py-4 pr-4 text-left font-semibold">Servicio origen</th>
          <th scope="col" class="py-4 pr-4 text-left font-semibold">eventId</th>
          <th scope="col" class="py-4 pr-4 text-left font-semibold">Registro</th>
          <th scope="col" class="py-4" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="event in rows" :key="event.messageId" data-testid="audit-event-row">
          <td
            class="whitespace-nowrap border-t border-[#E9E9EC] py-3.5 pr-4 text-[12px] text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ formatDate(event.occurredAt) }}</td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <span
              class="text-[13px] font-semibold"
              :class="TINT_CLASS[tintFor(event.messageType)]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ event.messageType }}</span>
            <!--
              The causal link, not the causal *order*. A trail whose first
              message was published while this service was down has no complete
              chain, so the chain is shown per row and the ordering stays the
              clock's.
            -->
            <span
              v-if="event.causationId"
              class="mt-0.5 block font-mono text-[10px] text-[#75767F]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >causado por {{ event.causationId.slice(0, 8) }}…</span>
          </td>

          <td
            class="whitespace-nowrap border-t border-[#E9E9EC] py-3.5 pr-4 text-[12px] text-[#5A5B63]"
          >{{ event.producer }}</td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <code
              class="block break-all font-mono text-[11px] text-[#5A5B63]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ event.messageId }}</code>
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
            <!--
              Absent on a reply from before T-20 added the field. Saying nothing
              is right: claiming "Registrado" for a service that never told us
              would be inventing the one thing this column exists to report.
            -->
            <UBadge
              v-if="event.processingStatus"
              :color="PROCESSING_STATUS_PRESENTATION[event.processingStatus].color"
              variant="subtle"
              size="sm"
              :title="PROCESSING_STATUS_PRESENTATION[event.processingStatus].explanation"
            >{{ PROCESSING_STATUS_PRESENTATION[event.processingStatus].label }}</UBadge>
            <span v-else class="text-[12px] text-[#75767F]">—</span>
          </td>

          <td class="border-t border-[#E9E9EC] py-3.5 text-right">
            <UButton
              variant="outline"
              color="neutral"
              size="xs"
              :aria-label="`Ver el detalle de ${event.messageType}`"
              data-testid="audit-event-detail"
              @click="emit('inspect', event)"
            >Detalle</UButton>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
