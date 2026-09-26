<script setup lang="ts">
import type { AccountSummary } from '../lib/account';
import { totalBalanceMinor } from '../lib/account';
import { alertsFrom, dashboardFor } from '../lib/dashboard';
import type { Dashboard } from '../lib/dashboard';
import { asyncStateFor } from '../lib/gateway-error';
import type { LoadState } from '../lib/gateway-error';
import { formatDate, formatQuetzales } from '../lib/money';
import { labelForRole } from '../lib/navigation';
import type { TransferRow } from '../lib/transaction';

/**
 * `A-01`, `D-01` and `D-02` — where a signed-in visitor lands, and which of the
 * three they get.
 *
 * One route and not three. "Where do I land" must not be a URL somebody can be
 * sent to by mistake, so the role picks the dashboard and `dashboardFor` is a
 * pure function that says which — testable, unlike a `v-if` chain (TD-010).
 *
 * This page used to be a grid of module cards, and it said so in its own
 * comment: "the dashboards the Claude Design prototype draws per role need
 * metrics that only T-16 to T-20 can produce". They exist now — one count query
 * per owning service, because each service is the only one that can count its
 * own rows — and the Gateway holds the five replies at once.
 *
 * **A section that did not answer draws "sin dato", never a zero.** A tile that
 * showed `0` for a question nobody answered would be a wrong number rather than
 * a missing one, on the screen most likely to be open when something is wrong.
 */
const api = useGatewayApi();
const { session, role } = useSession();

const kind = computed(() => dashboardFor(role.value));

const dashboard = ref<Dashboard>({
  customers: null,
  accounts: null,
  transfers: null,
  payments: null,
  audit: null,
});
const accounts = ref<readonly AccountSummary[]>([]);
const recent = ref<readonly TransferRow[]>([]);
const state = ref<LoadState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

async function load(): Promise<void> {
  state.value = 'LOADING';
  failure.value = null;

  /**
   * The client's landing page needs their own money rather than the bank's
   * counts, so it asks for the two things `A-01` draws instead of the
   * dashboard. Staff get the composed counts. Nobody gets both: a client asking
   * for the dashboard would receive five sections of zeroes, which is a round
   * trip to be told nothing.
   */
  if (kind.value === 'CLIENT') {
    const [mine, transfers] = await Promise.all([
      api.call<{ accounts: AccountSummary[]; correlationId: string }>('/api/accounts'),
      api.call<{ transactions: TransferRow[] }>('/api/transfers', { query: { limit: '5' } }),
    ]);

    if (!mine.ok) {
      correlationId.value = mine.error.correlationId;
      failure.value = mine.error.message;
      state.value = asyncStateFor(mine.error);
      return;
    }

    accounts.value = mine.data.accounts;
    recent.value = transfers.ok ? transfers.data.transactions : [];
    correlationId.value = mine.data.correlationId;
    state.value = 'READY';
    return;
  }

  const result = await api.call<Dashboard & { correlationId: string }>('/api/dashboard');

  if (!result.ok) {
    correlationId.value = result.error.correlationId;
    failure.value = result.error.message;
    state.value = asyncStateFor(result.error);
    return;
  }

  dashboard.value = result.data;
  correlationId.value = result.data.correlationId;
  state.value = 'READY';
}

onMounted(load);
watch(kind, (next, previous) => {
  if (next !== previous) {
    void load();
  }
});

const total = computed(() => totalBalanceMinor(accounts.value));
const alerts = computed(() => alertsFrom(dashboard.value));

const greeting = computed(() => `Hola${session.value ? `, ${session.value.username}` : ''}`);

useHead({ title: 'Inicio · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">{{ greeting }}</h1>
      <p v-if="role" class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Estás operando como {{ labelForRole(role) }}.
      </p>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Kevin Pozuelos el mejor auxiliar de SA
      </p>
    </header>

    <div v-if="state === 'LOADING'" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <USkeleton v-for="tile in 4" :key="tile" class="h-28 w-full rounded-2xl" />
    </div>

    <SharedAsyncStateAlert
      v-else-if="state !== 'READY'"
      :state="state"
      :message="failure"
      @retry="load"
    />

    <!-- A-01 — the client's own money, not the bank's counts. -->
    <template v-else-if="kind === 'CLIENT'">
      <UCard>
        <p class="text-[12px] uppercase tracking-[0.04em] text-[#75767F]">Total consolidado</p>
        <p class="tab mt-1 text-[48px] font-bold leading-[56px] tracking-[-0.02em] text-[#0B0C10]">
          {{ formatQuetzales(total) }}
        </p>
        <p class="mt-1 text-[13px] text-[#5A5B63]">
          {{ accounts.length }} cuenta{{ accounts.length === 1 ? '' : 's' }}
        </p>

        <template #footer>
          <div class="flex flex-wrap gap-3">
            <UButton to="/transferencias/nueva">Transferir</UButton>
            <UButton to="/pagos/nuevo" variant="outline" color="neutral">Pagar un servicio</UButton>
            <UButton to="/cuentas" variant="ghost" color="neutral">Mis cuentas →</UButton>
          </div>
        </template>
      </UCard>

      <div v-if="accounts.length === 0" class="py-8 text-center" data-testid="dashboard-empty">
        <p class="text-[20px] font-semibold leading-7">Todavía no tienes cuentas</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          Un cajero puede abrirte una cuenta monetaria o de ahorro. Necesita que tu identidad esté
          verificada.
        </p>
        <UButton to="/cuentas/nueva" color="primary" class="mt-6">Abrir una cuenta</UButton>
      </div>

      <UCard v-else>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-[20px] font-semibold leading-7">Movimientos recientes</h2>
            <UButton to="/transferencias" variant="ghost" color="neutral" size="xs">
              Ver todo →
            </UButton>
          </div>
        </template>

        <p v-if="recent.length === 0" class="py-6 text-center text-[14px] text-[#5A5B63]">
          Aún no hay transferencias.
        </p>
        <TransactionHistoryTable v-else :rows="recent" :show-accounts="true" />
      </UCard>
    </template>

    <!-- D-01 — the teller's shift. -->
    <template v-else-if="kind === 'TELLER'">
      <div class="grid gap-4 sm:grid-cols-3">
        <SharedStatTile
          label="Validaciones pendientes"
          :value="dashboard.customers ? String(dashboard.customers.pendingValidation) : null"
          hint="Identidades esperando el veredicto de un cajero."
          tone="warning"
          to="/clientes/validaciones"
          action="Revisar la cola"
        />
        <SharedStatTile
          label="Cuentas creadas hoy"
          :value="dashboard.accounts ? String(dashboard.accounts.openedToday) : null"
          to="/cuentas/nueva"
          action="Crear cuenta"
        />
        <SharedStatTile
          label="Depósitos del día"
          :value="
            dashboard.accounts
              ? `${String(dashboard.accounts.depositsToday)} · ${formatQuetzales(dashboard.accounts.depositedToday.amountMinor)}`
              : null
          "
          hint="Efectivo recibido en ventanilla."
          tone="success"
          to="/cuentas/deposito"
          action="Registrar depósito"
        />
      </div>
    </template>

    <!-- D-02 — the system, from an administrator's chair. -->
    <template v-else-if="kind === 'ADMIN'">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SharedStatTile
          label="Clientes registrados"
          :value="dashboard.customers ? String(dashboard.customers.registered) : null"
          :hint="
            dashboard.customers
              ? `${String(dashboard.customers.pendingValidation)} sin validar`
              : undefined
          "
        />
        <SharedStatTile
          label="Cuentas activas"
          :value="dashboard.accounts ? String(dashboard.accounts.active) : null"
          :hint="
            dashboard.accounts ? `${String(dashboard.accounts.inactive)} inactivas` : undefined
          "
        />
        <SharedStatTile
          label="Transferencias hoy"
          :value="dashboard.transfers ? String(dashboard.transfers.today) : null"
          :hint="
            dashboard.transfers
              ? `${String(dashboard.transfers.completedToday)} completadas`
              : undefined
          "
        />
        <SharedStatTile
          label="Pagos procesados"
          :value="dashboard.payments ? String(dashboard.payments.today) : null"
          :hint="
            dashboard.payments
              ? `${String(dashboard.payments.succeededToday)} exitosos`
              : undefined
          "
        />
      </div>

      <UCard>
        <template #header>
          <h2 class="text-[20px] font-semibold leading-7">Estados de operaciones</h2>
        </template>

        <div v-if="dashboard.transfers" class="grid gap-6 sm:grid-cols-3">
          <div>
            <p class="tab text-[32px] font-bold leading-10 text-[#186A32]">
              {{ dashboard.transfers.completedToday }}
            </p>
            <p class="text-[13px] text-[#5A5B63]">Completadas hoy</p>
          </div>
          <div>
            <p class="tab text-[32px] font-bold leading-10 text-[#7A4F06]">
              {{ dashboard.transfers.inFlight }}
            </p>
            <!-- Not scoped to today, and it says so: a transfer stuck since
                 yesterday is the one worth seeing. -->
            <p class="text-[13px] text-[#5A5B63]">En proceso (todas, no solo hoy)</p>
          </div>
          <div>
            <p class="tab text-[32px] font-bold leading-10 text-[#8A1010]">
              {{ dashboard.transfers.failedToday + dashboard.transfers.compensatedToday }}
            </p>
            <p class="text-[13px] text-[#5A5B63]">
              Fallidas y compensadas hoy
            </p>
          </div>
        </div>
        <p v-else class="py-6 text-center text-[14px] text-[#A8A9B2]">
          Transaction Service no respondió a tiempo.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-[20px] font-semibold leading-7">Alertas operativas</h2>
            <UButton to="/auditoria" variant="ghost" color="neutral" size="xs">
              Ir a auditoría →
            </UButton>
          </div>
        </template>

        <p
          v-if="alerts.length === 0"
          class="py-6 text-center text-[14px] text-[#5A5B63]"
          data-testid="no-alerts"
        >Nada que reportar en este momento.</p>

        <ul v-else class="flex flex-col">
          <li
            v-for="alert in alerts"
            :key="alert.title"
            class="flex items-start gap-3 border-t border-[#E9E9EC] py-4 first:border-t-0"
          >
            <span
              class="mt-1.5 h-2 w-2 flex-none rounded-full"
              :class="{
                'bg-[#B01B1B]': alert.severity === 'HIGH',
                'bg-[#B4740A]': alert.severity === 'MEDIUM',
                'bg-[#75767F]': alert.severity === 'LOW',
              }"
            />
            <div class="min-w-0 flex-1">
              <p class="text-[15px] font-semibold leading-6">{{ alert.title }}</p>
              <p class="mt-0.5 max-w-[70ch] text-[13px] leading-5 text-[#5A5B63]">
                {{ alert.detail }}
              </p>
            </div>
            <UButton :to="alert.to" variant="ghost" color="neutral" size="xs">Ver →</UButton>
          </li>
        </ul>
      </UCard>

      <UCard v-if="dashboard.audit">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="tab text-[32px] font-bold leading-10">{{ dashboard.audit.eventsToday }}</p>
            <p class="text-[13px] text-[#5A5B63]">Eventos registrados hoy</p>
          </div>
          <p v-if="dashboard.audit.lastEventAt" class="text-[13px] text-[#75767F]">
            Último: <span class="tab font-medium text-[#23242A]">{{
              dashboard.audit.lastEventType
            }}</span> · {{ formatDate(dashboard.audit.lastEventAt) }}
          </p>
        </div>
      </UCard>
    </template>

    <footer v-if="state === 'READY'" class="flex items-center justify-between">
      <UButton variant="ghost" color="neutral" @click="load">Actualizar</UButton>
      <SharedCorrelationIdBadge :correlation-id="correlationId" />
    </footer>
  </section>
</template>
