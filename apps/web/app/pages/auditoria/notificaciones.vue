<script setup lang="ts">
import { mayQueryAudit } from '../../lib/audit';
import type { NotificationRow, NotificationStatus } from '../../lib/audit';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';

/**
 * "Centro de notificaciones" — the prototype's `N-01`, adapted rather than
 * copied.
 *
 * The prototype draws a **customer's inbox**: their avisos, with a read/unread
 * dot and a "marcar todas como leídas" button. Three things that screen needs
 * do not exist in this system, and none of them is a small omission:
 *
 * - no route lists a customer's notifications, and the owning service could not
 *   build one — a notification row holds a simulated recipient and a
 *   `correlationId`, and resolving either to a person means reading another
 *   service's tables (§8.2, 2.3), the same wall as TD-037;
 * - nothing anywhere records that somebody read something, so the dot and the
 *   button would be operating on a state the bank does not keep;
 * - D-06 grants "read the audit record **and notifications**" to
 *   `ADMINISTRADOR` and to nobody else.
 *
 * So what got built is the screen those three facts allow: the operational
 * record of what the bank sent, for the role already entitled to it, in the
 * prototype's card idiom. The dot stayed and changed meaning — it marks a
 * delivery still owed something rather than one nobody has opened — and the
 * "mark as read" button is gone rather than faked. Recorded as TD-041.
 *
 * Owned by T-20.
 */
const api = useGatewayApi();
const route = useRoute();
const { role } = useSession();

const mayQuery = computed(() => mayQueryAudit(role.value));

watchEffect(() => {
  if (role.value !== null && !mayQuery.value) {
    navigateTo('/');
  }
});

const notifications = ref<NotificationRow[]>([]);
const omitted = ref(0);

const state = ref<'LOADING' | 'READY' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

const statusFilter = ref<'TODOS' | NotificationStatus>('TODOS');

/** Set when this screen was opened from a flow, and shown so it can be undone. */
const scopedTo = ref<string | null>(null);

const STATUS_ITEMS = [
  { label: 'Todos los estados', value: 'TODOS' },
  { label: 'Pendientes', value: 'PENDING' },
  { label: 'Enviadas', value: 'SENT' },
  { label: 'No enviadas', value: 'FAILED' },
];

/**
 * The banner counts what is on screen. A count over a window nobody can verify
 * would eventually contradict the list beneath it — the same rule the payment
 * monitoring screen follows, and for the same reason.
 */
const failed = computed(
  () => notifications.value.filter((notification) => notification.status === 'FAILED').length,
);

async function load(): Promise<void> {
  state.value = 'LOADING';
  message.value = undefined;

  const result = await api.call<{
    notifications: NotificationRow[];
    omitted: number;
    correlationId?: string;
  }>('/api/audit/notifications', {
    query: {
      ...(statusFilter.value === 'TODOS' ? {} : { status: statusFilter.value }),
      ...(scopedTo.value === null ? {} : { correlationId: scopedTo.value }),
    },
  });

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    correlationId.value = result.error.correlationId;

    return;
  }

  notifications.value = result.data.notifications;
  omitted.value = result.data.omitted;
  correlationId.value = result.data.correlationId ?? result.correlationId;
  state.value = 'READY';
}

onMounted(async () => {
  const fromUrl = route.query.correlationId;

  if (typeof fromUrl === 'string' && fromUrl.length > 0) {
    scopedTo.value = fromUrl;
  }

  if (mayQuery.value) {
    await load();
  }
});

watch(statusFilter, async () => {
  if (mayQuery.value) {
    await load();
  }
});

async function clearScope(): Promise<void> {
  scopedTo.value = null;
  await load();
}

useHead({ title: 'Notificaciones · bonking' });
</script>

<template>
  <section v-if="mayQuery" class="flex flex-col gap-4">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Notificaciones</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Lo que el sistema avisó, con su estado real de
          entrega. Los envíos son simulados: no sale correo de este sistema.
        </p>
      </div>
      <UButton variant="outline" color="neutral" :disabled="state === 'LOADING'" @click="load">
        Actualizar
      </UButton>
    </header>

    <div
      v-if="scopedTo"
      class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#E9E9EC] px-5 py-3"
    >
      <p class="text-[13px] leading-5 text-[#5A5B63]">
        Mostrando solo las notificaciones de una correlación.
        <code
          class="font-mono text-[12px] text-[#23242A]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ scopedTo }}</code>
      </p>
      <div class="flex gap-2">
        <UButton :to="`/auditoria?correlationId=${scopedTo}`" variant="ghost" color="neutral" size="xs">
          Ver el flujo
        </UButton>
        <UButton variant="outline" color="neutral" size="xs" @click="clearScope">
          Ver todas
        </UButton>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <USelect
        v-model="statusFilter"
        :items="STATUS_ITEMS"
        value-key="value"
        class="w-[220px]"
        aria-label="Filtrar por estado de entrega"
      />
      <span v-if="state === 'READY' && omitted > 0" class="text-[13px] text-[#5A5B63]">
        Mostrando {{ notifications.length }}; hay {{ omitted }} más.
      </span>
    </div>

    <!--
      Failed deliveries are worth interrupting for and pending ones are not: one
      is an incident, the other is a job about to run.
    -->
    <div
      v-if="state === 'READY' && failed > 0"
      class="flex gap-4 rounded-2xl bg-[#F7DCD7] px-5 py-4"
      data-testid="notification-failure-banner"
    >
      <span
        class="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-[#B01B1B] text-[13px] font-bold text-white"
        aria-hidden="true"
      >!</span>
      <div>
        <p class="text-[14px] font-semibold leading-5 text-[#8A1010]">
          {{ failed }}
          {{ failed === 1 ? 'notificación no se entregó' : 'notificaciones no se entregaron' }}
          en esta lista
        </p>
        <p class="text-[13px] leading-5 text-[#8A1010]">
          No se reintentan: el canal es simulado y no hay servidor de correo que pueda estar
          temporalmente caído. La operación de negocio no se vio afectada.
        </p>
      </div>
    </div>

    <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
      <USkeleton v-for="index in 4" :key="index" class="h-24 w-full rounded-2xl" />
    </div>

    <template v-else-if="state === 'READY'">
      <div v-if="notifications.length > 0" class="flex flex-col gap-2">
        <AuditNotificationCard
          v-for="notification in notifications"
          :key="notification.notificationId"
          :notification="notification"
        />
      </div>

      <div
        v-else
        class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-14 text-center"
      >
        <h2 class="text-[20px] font-semibold leading-7">
          {{ scopedTo || statusFilter !== 'TODOS' ? 'Ninguna coincide' : 'Todavía no hay notificaciones' }}
        </h2>
        <p class="mx-auto mt-2 max-w-[480px] text-[14px] leading-5 text-[#5A5B63]">
          <template v-if="scopedTo || statusFilter !== 'TODOS'">
            No hay notificaciones que cumplan lo que estás pidiendo. Probá quitando el filtro.
          </template>
          <template v-else>
            Aquí aparecerán los avisos que el sistema genere: transferencias completadas,
            revertidas o fallidas, validaciones de identidad y cambios en las cuentas.
          </template>
        </p>
      </div>
    </template>

    <div v-else class="flex flex-col items-start gap-3">
      <SharedAsyncStateAlert
        class="w-full"
        :state="state as AsyncState"
        :message="message"
        :correlation-id="correlationId"
      />
      <UButton variant="outline" color="neutral" @click="load">Reintentar la consulta</UButton>
    </div>

    <SharedCorrelationIdBadge v-if="correlationId" :correlation-id="correlationId" />
  </section>
</template>
