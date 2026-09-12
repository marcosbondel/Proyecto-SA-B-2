<script setup lang="ts">
import { NOTIFICATION_STATUS_PRESENTATION, SEVERITY_PRESENTATION } from '../../lib/audit';
import type { NotificationRow } from '../../lib/audit';
import { formatDate } from '../../lib/money';

/**
 * One notification in the console, in the prototype's `N-01` card idiom.
 *
 * The prototype's card carries a dot that means *unread* and a card background
 * that changes with it. **This system has no read state** — no service records
 * that anybody opened anything — so reusing the dot for "unread" would be
 * inventing a fact. It carries weight where the prototype carries attention
 * instead: a delivery that has not gone out yet, or that failed, is the row
 * worth looking at, and a delivered one recedes. Recorded as TD-041.
 *
 * The recipient is simulated and derived from the customer the flow was acting
 * for; no mail leaves this system (§4.1). It is shown because a console that
 * lists deliveries without saying who they were for cannot be used to
 * investigate one, and because the route is restricted to `ADMINISTRADOR`.
 *
 * Owned by T-20.
 */
const props = defineProps<{ notification: NotificationRow }>();

const presentation = computed(() => NOTIFICATION_STATUS_PRESENTATION[props.notification.status]);

/** Settled deliveries recede; the ones still owed something stand out. */
const settled = computed(() => props.notification.status === 'SENT');
</script>

<template>
  <article
    class="flex items-start gap-4 rounded-2xl border px-5 py-4"
    :class="settled ? 'border-[#E9E9EC] bg-white' : 'border-[#C3C4CC] bg-[#F0F0F2]'"
    data-testid="notification-card"
  >
    <span
      class="mt-1.5 h-2 w-2 flex-none rounded-full"
      :class="settled ? 'bg-transparent' : 'bg-[#17191F]'"
      aria-hidden="true"
    />

    <div class="min-w-0 flex-1">
      <div class="mb-1 flex flex-wrap items-center gap-2">
        <span
          class="text-[15px] text-[#23242A]"
          :class="settled ? 'font-medium' : 'font-semibold'"
        >{{ notification.subject }}</span>
        <UBadge :color="presentation.color" variant="subtle" size="sm">
          {{ presentation.label }}
        </UBadge>
        <!-- Absent for a notification created before T-30 added the classification. -->
        <UBadge
          v-if="notification.severity"
          :color="SEVERITY_PRESENTATION[notification.severity].color"
          variant="subtle"
          size="sm"
        >{{ SEVERITY_PRESENTATION[notification.severity].label }}</UBadge>
      </div>

      <p class="text-[13px] leading-5 text-[#5A5B63]">
        <code
          class="font-mono text-[12px]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ notification.type }}</code>
        · {{ notification.recipient ?? 'sin destinatario' }}
      </p>

      <p class="mt-1 text-[12px] leading-4 text-[#75767F]">
        {{ presentation.explanation }}
      </p>

      <NuxtLink
        :to="`/auditoria?correlationId=${notification.correlationId}`"
        class="mt-2 inline-block text-[12px] font-semibold text-[#17191F] underline"
      >Ver el flujo completo →</NuxtLink>
    </div>

    <div class="flex flex-none flex-col items-end gap-1 text-right">
      <span
        class="whitespace-nowrap text-[12px] text-[#75767F]"
        style="font-variant-numeric: tabular-nums lining-nums"
      >{{ formatDate(notification.createdAt) }}</span>
      <span
        v-if="notification.processedAt"
        class="whitespace-nowrap text-[11px] text-[#75767F]"
        style="font-variant-numeric: tabular-nums lining-nums"
      >resuelta {{ formatDate(notification.processedAt) }}</span>
    </div>
  </article>
</template>
