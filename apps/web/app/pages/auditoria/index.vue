<script setup lang="ts">
import {
  SEVERITY_PRESENTATION,
  filterTrail,
  formatSpan,
  mayQueryAudit,
  messageTypesIn,
  producersIn,
  summariseTrail,
} from '../../lib/audit';
import type { AuditEventRow, AuditNotification, EventSeverity } from '../../lib/audit';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { formatDate } from '../../lib/money';

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

/**
 * Wraps every state the query can be in (idle, loading, an answer, an
 * error) — see the template. `query()` scrolls here as soon as it starts, so
 * the person who just pressed "Consultar" sees the answer land instead of
 * having to find it below the fold themselves, which is what confused a real
 * reviewer testing this screen.
 */
const resultsAnchor = ref<HTMLElement | null>(null);

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

  await nextTick();
  resultsAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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

interface RecentAuditEvent {
  eventId: string;
  messageType: string;
  producer: string;
  occurredAt: string;
  correlationId: string;
  processingStatus: string;
  consumer: string;
  payload: Record<string, unknown>;
  /** Absent for an event recorded before T-30 added the classification. */
  severity?: EventSeverity;
}

const recentEvents = ref<RecentAuditEvent[]>([]);
const recentTotal = ref(0);
const recentPage = ref(1);
const recentLimit = 10;
const recentLoading = ref(false);
/** `TODOS` shows every row, including the ones recorded before T-30 with no severity at all. */
const severityFilter = ref<'TODOS' | EventSeverity>('TODOS');

const stats = ref<{ infoToday: number; warningToday: number; errorToday: number } | null>(null);

async function loadRecentEvents(page = 1): Promise<void> {
  if (!mayQuery.value) return;
  recentLoading.value = true;
  const severityParam =
    severityFilter.value === 'TODOS' ? '' : `&severity=${severityFilter.value}`;
  const result = await api.call<{
    events: RecentAuditEvent[];
    total: number;
    page: number;
    limit: number;
  }>(`/api/audit/recent?page=${page}&limit=${recentLimit}${severityParam}`);
  recentLoading.value = false;

  if (result.ok) {
    recentEvents.value = result.data.events;
    recentTotal.value = result.data.total;
    recentPage.value = result.data.page;
  }
}

/**
 * Reuses `GET /api/dashboard` rather than adding a route of its own: that is
 * the one endpoint that already composes `audit.stats.query.v1`
 * (`dashboard.use-case.ts`), and no other stats question in this system has a
 * standalone route either — the Gateway asks the five services at once and
 * every section is independently optional, which is what makes this cheap to
 * reuse rather than a reason to duplicate.
 */
async function loadStats(): Promise<void> {
  if (!mayQuery.value) return;
  const result = await api.call<{
    audit?: { infoToday?: number; warningToday?: number; errorToday?: number };
  }>('/api/dashboard');

  if (result.ok && result.data.audit) {
    stats.value = {
      infoToday: result.data.audit.infoToday ?? 0,
      warningToday: result.data.audit.warningToday ?? 0,
      errorToday: result.data.audit.errorToday ?? 0,
    };
  }
}

function inspectRecent(targetCorrelationId: string): void {
  correlationInput.value = targetCorrelationId;
  // query() itself scrolls to the results anchor once it starts — no need
  // for a separate scroll here, and a second one would fight it.
  query(targetCorrelationId);
}

/** A correlation in the URL is asked immediately: that is what the link is for. */
onMounted(async () => {
  const fromUrl = route.query.correlationId;

  if (typeof fromUrl === 'string' && fromUrl.length > 0 && mayQuery.value) {
    correlationInput.value = fromUrl;
    await query(fromUrl);
  }

  await loadRecentEvents(1);
  await loadStats();
});

/** Changing the filter starts a fresh listing, same as clicking "Actualizar". */
watch(severityFilter, () => loadRecentEvents(1));

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

    <!--
      §4.1's classification, at a glance. Today's count per severity, so the
      axis this ticket adds is something a reader sees in one look rather than
      something they have to filter for to notice at all.
    -->
    <div v-if="stats" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <UCard v-for="severity in (['INFO', 'WARNING', 'ERROR'] as const)" :key="severity">
        <p class="text-[13px] text-[#75767F]">{{ SEVERITY_PRESENTATION[severity].label }} hoy</p>
        <p class="mt-1 text-[28px] font-bold leading-9">
          {{ severity === 'INFO' ? stats.infoToday : severity === 'WARNING' ? stats.warningToday : stats.errorToday }}
        </p>
      </UCard>
    </div>

    <!-- Últimos 10 eventos del sistema paginados -->
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-[18px] font-bold text-[#23242A]">Últimos eventos del sistema</h2>
            <p class="text-[13px] text-[#5A5B63]">
              Registro cronológico global con navegación paginada (10 eventos por página).
            </p>
          </div>
          <div class="flex items-center gap-2">
            <USelect
              v-model="severityFilter"
              :items="[
                { label: 'Todas las severidades', value: 'TODOS' },
                { label: 'Info', value: 'INFO' },
                { label: 'Advertencia', value: 'WARNING' },
                { label: 'Error', value: 'ERROR' },
              ]"
              size="sm"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="sm"
              :loading="recentLoading"
              @click="loadRecentEvents(recentPage)"
            >
              Actualizar
            </UButton>
          </div>
        </div>
      </template>

      <p v-if="severityFilter !== 'TODOS'" class="mb-3 text-[12px] text-[#75767F]">
        Filtrando por severidad: no incluye los eventos registrados antes de esta
        clasificación, que no tienen una asignada.
      </p>

      <div v-if="recentLoading && recentEvents.length === 0" class="py-8 text-center text-[#5A5B63]">
        Cargando eventos recientes…
      </div>
      <div v-else-if="recentEvents.length === 0" class="py-8 text-center text-[#75767F]">
        No hay eventos registrados en la base de auditoría.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-[13px]">
          <thead class="border-b border-[#E9E9EC] text-[#75767F]">
            <tr>
              <th class="pb-2 font-medium">Fecha y hora</th>
              <th class="pb-2 font-medium">Tipo de evento</th>
              <th class="pb-2 font-medium">Servicio</th>
              <th class="pb-2 font-medium">Código de seguimiento</th>
              <th class="pb-2 font-medium">Estado</th>
              <th class="pb-2 font-medium">Severidad</th>
              <th class="pb-2 text-right font-medium">Acción</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#E9E9EC]">
            <tr v-for="evt in recentEvents" :key="evt.eventId" class="hover:bg-neutral-50">
              <td class="py-3 font-mono text-[12px] text-[#5A5B63]">
                {{ formatDate(evt.occurredAt) }}
              </td>
              <td class="py-3 font-medium text-[#23242A]">
                <code class="rounded bg-[#F0F0F3] px-1.5 py-0.5 text-[11px] font-mono text-[#23242A]">
                  {{ evt.messageType }}
                </code>
              </td>
              <td class="py-3 text-[#5A5B63]">
                <UBadge variant="subtle" color="neutral" size="sm">{{ evt.producer }}</UBadge>
              </td>
              <td class="py-3 font-mono text-[11px] text-[#75767F]">
                {{ evt.correlationId }}
              </td>
              <td class="py-3">
                <UBadge
                  :color="evt.processingStatus === 'INVALID' ? 'error' : 'success'"
                  variant="subtle"
                  size="sm"
                >
                  {{ evt.processingStatus }}
                </UBadge>
              </td>
              <td class="py-3">
                <UBadge
                  v-if="evt.severity"
                  :color="SEVERITY_PRESENTATION[evt.severity].color"
                  variant="subtle"
                  size="sm"
                  :title="SEVERITY_PRESENTATION[evt.severity].explanation"
                >
                  {{ SEVERITY_PRESENTATION[evt.severity].label }}
                </UBadge>
                <span v-else class="text-[12px] text-[#75767F]">—</span>
              </td>
              <td class="py-3 text-right">
                <UButton
                  variant="outline"
                  color="primary"
                  size="xs"
                  @click="inspectRecent(evt.correlationId)"
                >
                  Ver rastro
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#5A5B63]">
          <div>
            Página <strong>{{ recentPage }}</strong> de <strong>{{ Math.max(1, Math.ceil(recentTotal / recentLimit)) }}</strong>
            ({{ recentTotal }} eventos registrados)
          </div>
          <div class="flex gap-2">
            <UButton
              variant="outline"
              color="neutral"
              size="xs"
              :disabled="recentPage <= 1 || recentLoading"
              @click="loadRecentEvents(recentPage - 1)"
            >
              ← Anterior
            </UButton>
            <UButton
              variant="outline"
              color="neutral"
              size="xs"
              :disabled="recentPage * recentLimit >= recentTotal || recentLoading"
              @click="loadRecentEvents(recentPage + 1)"
            >
              Siguiente →
            </UButton>
          </div>
        </div>
      </template>
    </UCard>

    <!--
      One anchor around every state below, so submitting the form can scroll
      straight to the answer instead of leaving somebody to find it themselves
      below the fold — which is exactly what confused a real reviewer testing
      this screen (T-30 QA).
    -->
    <div ref="resultsAnchor" class="flex flex-col gap-5">
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
    </div>

    <AuditEventDetail :event="inspected" @close="inspected = null" />
  </section>
</template>
