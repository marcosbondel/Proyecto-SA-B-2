<script setup lang="ts">
import {
  filterTrail,
  formatSpan,
  mayQueryAudit,
  messageTypesIn,
  producersIn,
  summariseTrail,
} from '../../lib/audit';
import type { AuditEventRow, AuditNotification } from '../../lib/audit';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';

/**
 * "Auditoría de eventos" — the prototype's `show.audit` (N-02), with its
 * `audit:detail` panel (N-03) as a child component.
 *
 * **The prototype's screen is a global list and this one is not**, and the
 * difference is a property of the system rather than a shortcut. `N-02` draws
 * every event the bank ever published, with a search box and three filters over
 * it. `GET /api/audit` takes a `correlationId` and answers *that flow* — there
 * is no route that lists the trail across correlations, and there should not be
 * casually: the table it would read is the one place in the bank where every
 * service's activity is together, and an unfiltered listing of it is a very
 * different security question from a lookup by an identifier somebody already
 * holds. So the search became the query, and the filters moved to narrowing
 * what came back. Recorded as TD-042.
 *
 * Five states, which is what the ticket asks for and what FR-027 requires:
 * nothing asked yet, loading, an answer with rows, an answer with none, and a
 * failure — including the timeout, which is the expected one while Notification
 * & Audit Service is not running.
 *
 * Owned by T-20.
 */
const api = useGatewayApi();
const route = useRoute();
const router = useRouter();
const { role } = useSession();

const mayQuery = computed(() => mayQueryAudit(role.value));

/**
 * A courtesy, not the defence. The Gateway's `@Roles('ADMINISTRADOR')` refuses
 * the query whether or not this ran — which is the whole point of the parity
 * test.
 */
watchEffect(() => {
  if (role.value !== null && !mayQuery.value) {
    navigateTo('/');
  }
});

const correlationInput = ref('');
const asked = ref<string | null>(null);

const events = ref<AuditEventRow[]>([]);
const notifications = ref<AuditNotification[]>([]);

const state = ref<'IDLE' | 'LOADING' | 'READY' | AsyncState>('IDLE');
const message = ref<string | undefined>(undefined);
const failureCorrelation = ref<string | null>(null);

const producerFilter = ref<'TODOS' | string>('TODOS');
const typeFilter = ref<'TODOS' | string>('TODOS');

const producerItems = computed(() => [
  { label: 'Todos los servicios', value: 'TODOS' },
  ...producersIn(events.value).map((producer) => ({ label: producer, value: producer })),
]);

const typeItems = computed(() => [
  { label: 'Todos los tipos', value: 'TODOS' },
  ...messageTypesIn(events.value).map((messageType) => ({
    label: messageType,
    value: messageType,
  })),
]);

const visible = computed(() =>
  filterTrail(events.value, {
    ...(producerFilter.value === 'TODOS' ? {} : { producer: producerFilter.value }),
    ...(typeFilter.value === 'TODOS' ? {} : { messageType: typeFilter.value }),
  }),
);

const summary = computed(() => summariseTrail(events.value));

/** The event the side panel is showing, or `null` when it is closed. */
const inspected = ref<AuditEventRow | null>(null);

async function query(correlationId: string): Promise<void> {
  state.value = 'LOADING';
  message.value = undefined;
  inspected.value = null;
  producerFilter.value = 'TODOS';
  typeFilter.value = 'TODOS';
  asked.value = correlationId;

  /*
   * The identifier is in the URL, so the answer is linkable. That is not a
   * nicety for this screen in particular: an audit lookup is something people
   * paste to each other in an incident, and a screen whose result cannot be
   * shared makes everybody repeat the search.
   */
  await router.replace({ query: { correlationId } });

  const result = await api.auditFor(correlationId);

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    failureCorrelation.value = result.error.correlationId;
    events.value = [];
    notifications.value = [];

    return;
  }

  events.value = (result.data.events ?? []) as AuditEventRow[];
  notifications.value = (result.data.notifications ?? []) as AuditNotification[];
  state.value = 'READY';
}

/** A correlation in the URL is asked immediately: that is what the link is for. */
onMounted(async () => {
  const fromUrl = route.query.correlationId;

  if (typeof fromUrl === 'string' && fromUrl.length > 0 && mayQuery.value) {
    correlationInput.value = fromUrl;
    await query(fromUrl);
  }
});

useHead({ title: 'Auditoría · bonking' });
</script>

<template>
  <section v-if="mayQuery" class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Auditoría de eventos</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          El rastro completo de una operación, por su código de seguimiento.
        </p>
      </div>
      <UButton to="/auditoria/notificaciones" variant="outline" color="neutral">
        Consola de notificaciones
      </UButton>
    </header>

    <UCard>
      <AuditQueryForm
        v-model="correlationInput"
        :busy="state === 'LOADING'"
        @submit="query"
      />
    </UCard>

    <!-- Nothing asked yet. The prototype has no such state; a screen keyed by
         an identifier needs one, because an empty table would read as "no hay
         nada" about a flow nobody named. -->
    <div
      v-if="state === 'IDLE'"
      class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-14 text-center"
      data-testid="audit-idle"
    >
      <h2 class="text-[20px] font-semibold leading-7">Ingresa un código de seguimiento</h2>
      <p class="mx-auto mt-2 max-w-[520px] text-[14px] leading-5 text-[#5A5B63]">
        Cada operación del sistema —un registro, una transferencia, un pago— lleva un
        identificador que la acompaña por los cinco servicios. Con él, esta pantalla arma la
        historia completa: qué se publicó, quién lo publicó, en qué orden y qué se le avisó al
        cliente.
      </p>
    </div>

    <div v-else-if="state === 'LOADING'" class="flex flex-col gap-4">
      <USkeleton class="h-20 w-full rounded-2xl" />
      <USkeleton class="h-64 w-full rounded-2xl" />
    </div>

    <template v-else-if="state === 'READY'">
      <template v-if="events.length > 0 || notifications.length > 0">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-[#E9E9EC] px-5 py-4">
          <span class="text-[13px] text-[#5A5B63]">
            <strong class="font-semibold text-[#23242A]">{{ summary.events }}</strong>
            {{ summary.events === 1 ? 'evento' : 'eventos' }}
          </span>
          <span class="text-[13px] text-[#5A5B63]">
            <strong class="font-semibold text-[#23242A]">{{ summary.producers }}</strong>
            {{ summary.producers === 1 ? 'servicio' : 'servicios' }}
          </span>
          <span v-if="summary.spanMs !== null" class="text-[13px] text-[#5A5B63]">
            duración
            <strong class="font-semibold text-[#23242A]">{{ formatSpan(summary.spanMs) }}</strong>
          </span>
          <!--
            The one number worth interrupting for. A message the audit service
            could not read is criterion 3, and it is exactly the row somebody
            scrolls past.
          -->
          <span
            v-if="summary.invalid > 0"
            class="rounded-full bg-[#F7DCD7] px-3 py-1 text-[13px] font-semibold text-[#8A1010]"
            data-testid="audit-invalid-count"
          >
            {{ summary.invalid }}
            {{ summary.invalid === 1 ? 'mensaje no pudo leerse' : 'mensajes no pudieron leerse' }}
          </span>
          <SharedCorrelationIdBadge
            v-if="asked"
            class="ml-auto"
            :correlation-id="asked"
            label="Código de seguimiento consultado"
          />
        </div>

        <div v-if="events.length > 0" class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="producerFilter"
            :items="producerItems"
            value-key="value"
            class="w-[220px]"
            aria-label="Filtrar por servicio origen"
          />
          <USelect
            v-model="typeFilter"
            :items="typeItems"
            value-key="value"
            class="w-[280px]"
            aria-label="Filtrar por tipo de evento"
          />
          <span
            v-if="visible.length !== events.length"
            class="text-[13px] text-[#5A5B63]"
          >{{ visible.length }} de {{ events.length }}</span>
        </div>

        <AuditEventTable
          v-if="visible.length > 0"
          :events="visible"
          @inspect="inspected = $event"
        />

        <div
          v-else-if="events.length > 0"
          class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-10 text-center"
        >
          <p class="text-[14px] leading-5 text-[#5A5B63]">
            Hay {{ events.length }} eventos en este flujo, pero ninguno coincide con los filtros.
          </p>
        </div>

        <AuditNotificationList :notifications="notifications" :correlation-id="asked" />
      </template>

      <!--
        Nothing found. Three different situations produce this and the service
        cannot tell them apart, so neither does the copy: saying "no existe"
        would be asserting the first one.
      -->
      <div
        v-else
        class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-14 text-center"
        data-testid="audit-empty"
      >
        <h2 class="text-[20px] font-semibold leading-7">Sin registros para esa correlación</h2>
        <p class="mx-auto mt-2 max-w-[520px] text-[14px] leading-5 text-[#5A5B63]">
          Puede significar tres cosas y el sistema no las distingue: que la operación nunca
          existió, que todavía está en curso, o que el servicio de auditoría estaba caído
          cuando pasó. Si acabas de enviar la operación, espera unos segundos y vuelve a
          consultar.
        </p>
        <UButton
          class="mt-6"
          variant="outline"
          color="neutral"
          @click="asked && query(asked)"
        >Consultar de nuevo</UButton>
      </div>
    </template>

    <!--
      Failure. `REPLY_TIMEOUT` is the expected one while Notification & Audit
      Service is not running: the Gateway published the question and nobody
      answered within five seconds.
    -->
    <div v-else class="flex flex-col items-start gap-3">
      <SharedAsyncStateAlert
        class="w-full"
        :state="state as AsyncState"
        :message="message"
        :correlation-id="failureCorrelation"
      />
      <UButton
        variant="outline"
        color="neutral"
        @click="asked && query(asked)"
      >Reintentar la consulta</UButton>
    </div>

    <AuditEventDetail :event="inspected" @close="inspected = null" />
  </section>
</template>
