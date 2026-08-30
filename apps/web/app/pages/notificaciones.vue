<script setup lang="ts">
import { notificationLabel, notificationLink } from '../lib/audit';
import { formatDate } from '../lib/money';

/**
 * `N-01` — the notification centre, as an inbox rather than a console.
 *
 * TD-041 recorded three things this screen needed and none of which existed:
 * no route listed a customer's notifications, no row said whose notification it
 * was, and nothing anywhere recorded that somebody had read something. All
 * three are closed — and the first turned out to be information the owning
 * service was already computing to derive the simulated address, and throwing
 * away.
 *
 * **The unread dot means unread.** It used to mean "a delivery still owes
 * something", which was the only meaning the data supported and was not what a
 * dot next to a message means to anybody reading it. Now it is a `read_at`
 * column, and clicking marks it.
 *
 * The staff console is a different screen over the same table, at
 * `/auditoria/notificaciones`: it carries the simulated recipient of every
 * delivery in the system and answers "what has the bank been sending", which is
 * a question for somebody investigating rather than for somebody reading.
 */
const { notifications, unread, state, failure, load, markRead } = useInbox();

const marking = ref(false);

onMounted(() => {
  void load(50);
});

async function markAll(): Promise<void> {
  marking.value = true;
  await markRead();
  marking.value = false;
}

/** Opening one marks it, which is what a person means by opening it. */
async function open(notificationId: string, to: string | null): Promise<void> {
  await markRead([notificationId]);

  if (to !== null) {
    await navigateTo(to);
  }
}

useHead({ title: 'Notificaciones · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Notificaciones</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Lo que el banco te ha comunicado.
        </p>
      </div>
      <UButton
        v-if="unread > 0"
        variant="outline"
        color="neutral"
        :loading="marking"
        @click="markAll"
      >Marcar todas como leídas</UButton>
    </header>

    <UCard>
      <template #header>
        <div class="flex items-center gap-3">
          <h2 class="text-[20px] font-semibold leading-7">Bandeja</h2>
          <UBadge
            v-if="unread > 0"
            color="error"
            variant="subtle"
            class="tab rounded-full px-2.5 py-1 text-[12px] font-bold"
          >{{ unread }} sin leer</UBadge>
        </div>
      </template>

      <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
        <USkeleton v-for="line in 5" :key="line" class="h-14 w-full rounded-xl" />
      </div>

      <SharedAsyncStateAlert
        v-else-if="state !== 'READY'"
        :state="state === 'IDLE' ? 'LOADING' : state"
        :message="failure"
        @retry="load(50)"
      />

      <div
        v-else-if="notifications.length === 0"
        class="py-10 text-center"
        data-testid="inbox-empty"
      >
        <p class="text-[20px] font-semibold leading-7">No tienes notificaciones</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          Cuando hagas una transferencia, abras una cuenta o cambies tus datos, te avisaremos
          aquí.
        </p>
      </div>

      <ul v-else class="flex flex-col">
        <li
          v-for="notification in notifications"
          :key="notification.notificationId"
          class="flex items-start gap-3 border-t border-[#E9E9EC] py-4 first:border-t-0"
          :data-read="notification.readAt === null ? 'unread' : 'read'"
        >
          <!-- The dot is the unread state and nothing else now. -->
          <span
            class="mt-2 h-2 w-2 flex-none rounded-full"
            :class="notification.readAt === null ? 'bg-[#B01B1B]' : 'bg-transparent'"
            :aria-label="notification.readAt === null ? 'Sin leer' : undefined"
          />

          <div class="min-w-0 flex-1">
            <p
              class="text-[15px] leading-6"
              :class="notification.readAt === null ? 'font-semibold text-[#23242A]' : 'text-[#5A5B63]'"
            >{{ notification.subject }}</p>
            <p class="tab mt-0.5 text-[12px] text-[#75767F]">
              {{ notificationLabel(notification.type) }} · {{ formatDate(notification.createdAt) }}
            </p>
          </div>

          <UButton
            v-if="notificationLink(notification)"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="open(notification.notificationId, notificationLink(notification))"
          >Ver →</UButton>
          <UButton
            v-else-if="notification.readAt === null"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="open(notification.notificationId, null)"
          >Marcar leída</UButton>
        </li>
      </ul>
    </UCard>
  </section>
</template>
