<script setup lang="ts">
import { NOTIFICATION_STATUS_PRESENTATION, notificationStatusFrom } from '../../lib/audit';
import type { AuditNotification } from '../../lib/audit';
import { formatDate } from '../../lib/money';

/**
 * The notifications one flow produced, as cards.
 *
 * **Two states, not three**, and the missing one is worth knowing about:
 * `audit.query.replied.v1` carries only `sentAt`, so a delivery that failed
 * looks from here exactly like one still pending. T-20 chose not to widen a
 * reply T-05 closed, and put the real `PENDING`/`SENT`/`FAILED` status on the
 * console route instead. Recorded as TD-040, and the card links there rather
 * than guessing.
 *
 * `notificationStatusFrom` is where that reading lives, so this component and
 * the console cannot drift into disagreeing about what a `null` means.
 *
 * Owned by T-20.
 */
defineProps<{ notifications: readonly AuditNotification[]; correlationId: string | null }>();
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-[20px] font-semibold leading-7 text-[#23242A]">Notificaciones</h2>

    <div v-if="notifications.length > 0" class="flex flex-col gap-2">
      <UCard
        v-for="(notification, index) in notifications"
        :key="`${notification.subject}-${String(index)}`"
        data-testid="audit-notification"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[15px] font-semibold leading-6 text-[#23242A]">
              {{ notification.subject }}
            </p>
            <p class="mt-0.5 text-[13px] leading-5 text-[#5A5B63]">
              Canal {{ notification.channel }} · destinatario simulado
            </p>
          </div>

          <div class="flex flex-none flex-col items-end gap-1">
            <UBadge
              :color="NOTIFICATION_STATUS_PRESENTATION[notificationStatusFrom(notification.sentAt)].color"
              variant="subtle"
              size="sm"
            >{{ NOTIFICATION_STATUS_PRESENTATION[notificationStatusFrom(notification.sentAt)].label }}</UBadge>
            <span
              v-if="notification.sentAt"
              class="text-[12px] text-[#75767F]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ formatDate(notification.sentAt) }}</span>
          </div>
        </div>
      </UCard>

      <!--
        The honest caveat, once, under the list rather than on every card. A
        `PENDING` here may be a delivery that failed; only the console knows.
      -->
      <p class="text-[12px] leading-4 text-[#75767F]">
        Una notificación pendiente puede ser también una que no se pudo entregar: esta
        respuesta solo lleva la fecha de envío.
        <ULink
          v-if="correlationId"
          :to="`/auditoria/notificaciones?correlationId=${correlationId}`"
          class="font-semibold underline"
        >Ver el estado real en la consola de notificaciones →</ULink>
      </p>
    </div>

    <div
      v-else
      class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-6 py-8 text-center"
    >
      <p class="text-[14px] leading-5 text-[#5A5B63]">
        Este flujo no generó ninguna notificación. No todas lo hacen: el sistema avisa cuando
        una transferencia termina, se revierte o falla, y cuando cambia algo de la cuenta o de
        la identidad de un cliente — no por cada paso interno.
      </p>
    </div>
  </section>
</template>
