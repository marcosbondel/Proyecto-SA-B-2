<script setup lang="ts">
import { mayManageAccounts } from '../../lib/account';
import type { AccountStatus, AccountSummary, AccountType } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { formatDate, formatQuetzales } from '../../lib/money';

/**
 * "Gestión de cuentas" — the prototype's `show.adminAccounts`.
 *
 * Restricted **in the page** rather than by a fifth entry in `MODULES`: the
 * four modules are fixed and asserted by a test, and `docs/FRONTEND.md` says a
 * module that needs a role-restricted screen filters here. The decision itself
 * lives in `mayManageAccounts`, so `navigation-parity` can hold it against the
 * Gateway's `@Roles('ADMINISTRADOR')`.
 *
 * The redirect is a courtesy and not the defence. The Gateway refuses the
 * listing and the status change whether or not this ran.
 *
 * **One column of the prototype is missing on purpose.** It shows "Titular" as
 * a person's name; Account Service holds only an opaque `customerId` and cannot
 * read Customer Service to resolve it (§8.2, 2.3). The identifier is shown
 * instead of a name that would have to be invented.
 */
const api = useGatewayApi();
const { role } = useSession();

const mayManage = computed(() => mayManageAccounts(role.value));

watchEffect(() => {
  if (role.value !== null && !mayManage.value) {
    navigateTo('/cuentas');
  }
});

const accounts = ref<AccountSummary[]>([]);
const state = ref<'LOADING' | 'READY' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

const search = ref('');
const statusFilter = ref<'TODOS' | AccountStatus>('TODOS');
const typeFilter = ref<'TODOS' | AccountType>('TODOS');

const STATUS_ITEMS = [
  { label: 'Todos los estados', value: 'TODOS' },
  { label: 'Activa', value: 'ACTIVE' },
  { label: 'Inactiva', value: 'INACTIVE' },
];

const TYPE_ITEMS = [
  { label: 'Todos los tipos', value: 'TODOS' },
  { label: 'Monetaria', value: 'MONETARIA' },
  { label: 'Ahorro', value: 'AHORRO' },
];

/**
 * The search filters what is already on screen; the two dropdowns go to the
 * Gateway. The difference is not arbitrary — the query contract has `status`
 * and `accountType` and has no free-text field, so a search sent to the server
 * would be a parameter nobody reads.
 */
const visible = computed(() => {
  const needle = search.value.trim().toLowerCase();

  return needle.length === 0
    ? accounts.value
    : accounts.value.filter(
        (account) =>
          account.accountId.toLowerCase().includes(needle) ||
          account.customerId.toLowerCase().includes(needle),
      );
});

const atRisk = computed(() =>
  accounts.value.filter(
    (account) => account.status === 'ACTIVE' && account.balance.amountMinor < 5_000,
  ),
);

async function load(): Promise<void> {
  state.value = 'LOADING';
  message.value = undefined;

  const result = await api.call<{ accounts: AccountSummary[]; correlationId: string }>(
    '/api/accounts',
    {
      query: {
        ...(statusFilter.value === 'TODOS' ? {} : { status: statusFilter.value }),
        ...(typeFilter.value === 'TODOS' ? {} : { accountType: typeFilter.value }),
      },
    },
  );

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    correlationId.value = result.error.correlationId;

    return;
  }

  accounts.value = result.data.accounts;
  correlationId.value = result.data.correlationId ?? result.correlationId;
  state.value = 'READY';
}

/** The account whose status is being changed, and the reason for it. */
const target = ref<AccountSummary | null>(null);
const reason = ref('');
const changeState = ref<'IDLE' | AsyncState>('IDLE');
const changeMessage = ref<string | undefined>(undefined);
const changeKey = ref('');
const changing = ref(false);

function beginChange(account: AccountSummary): void {
  target.value = account;
  reason.value = '';
  changeState.value = 'IDLE';
  changeMessage.value = undefined;
  changeKey.value = crypto.randomUUID();
}

async function confirmChange(): Promise<void> {
  if (target.value === null || reason.value.trim().length === 0 || changing.value) {
    return;
  }

  changing.value = true;

  const next: AccountStatus = target.value.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const result = await api.call<{ correlationId: string }>(
    `/api/accounts/${target.value.accountId}/status`,
    {
      method: 'POST',
      body: { status: next, reason: reason.value.trim() },
      idempotencyKey: changeKey.value,
    },
  );

  changing.value = false;

  if (!result.ok) {
    changeState.value = asyncStateFor(result.error);
    changeMessage.value = result.error.message;
    correlationId.value = result.error.correlationId ?? correlationId.value;

    return;
  }

  /**
   * `PENDING`, never `SUCCESS`. The Gateway said `202`: the change is on the
   * broker and has not happened yet. The list is reloaded so the badge tells
   * the truth once it has.
   */
  changeState.value = 'PENDING';
  correlationId.value = result.data.correlationId ?? correlationId.value;

  await load();
}

onMounted(load);

useHead({ title: 'Gestión de cuentas · bonking' });
</script>

<template>
  <section v-if="mayManage" class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Gestión de cuentas</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Todas las cuentas del sistema y el proceso automático de desactivación.
      </p>
    </header>

    <UAlert
      v-if="atRisk.length > 0"
      color="warning"
      variant="subtle"
      :title="`${atRisk.length} ${atRisk.length === 1 ? 'cuenta activa con saldo menor' : 'cuentas activas con saldo menor'} a Q 50.00`"
      data-testid="deactivation-summary"
    >
      <template #description>
        <p class="text-[13px] leading-5">
          El proceso automático de Account Service desactiva las cuentas que llevan seis meses
          sin movimientos con saldo menor a Q 50.00. Estas cumplen ya la condición de saldo; se
          desactivarán al cumplir también la de tiempo.
        </p>
      </template>
    </UAlert>

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="search"
        placeholder="Buscar por número de cuenta o titular"
        class="w-[300px]"
        aria-label="Buscar por número de cuenta o titular"
      />
      <USelect
        v-model="statusFilter"
        :items="STATUS_ITEMS"
        value-key="value"
        aria-label="Filtrar por estado"
        @update:model-value="load"
      />
      <USelect
        v-model="typeFilter"
        :items="TYPE_ITEMS"
        value-key="value"
        aria-label="Filtrar por tipo"
        @update:model-value="load"
      />
    </div>

    <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
      <USkeleton v-for="row in 4" :key="row" class="h-14 w-full rounded-2xl" />
    </div>

    <div v-else-if="state !== 'READY'" class="flex flex-col items-start gap-3">
      <SharedAsyncStateAlert
        class="w-full"
        :state="state"
        :message="message"
        :correlation-id="correlationId"
      />
      <UButton variant="outline" color="neutral" @click="load">Reintentar</UButton>
    </div>

    <div v-else class="overflow-x-auto rounded-2xl border border-[#DCDCE0] bg-white px-6 pb-4 pt-2">
      <table class="w-full border-collapse">
        <thead>
          <tr class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
            <th class="py-4 pr-4 text-left font-semibold">Número</th>
            <th class="py-4 pr-4 text-left font-semibold">Titular (customerId)</th>
            <th class="py-4 pr-4 text-left font-semibold">Tipo</th>
            <th class="py-4 pr-4 text-left font-semibold">Estado</th>
            <th class="py-4 pr-4 text-left font-semibold">Última actividad</th>
            <th class="py-4 pr-4 text-right font-semibold">Saldo</th>
            <th class="py-4" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in visible" :key="account.accountId" data-testid="admin-account-row">
            <td
              class="border-t border-[#E9E9EC] py-3.5 pr-4 font-mono text-[13px] tracking-[0.03em]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ account.accountId }}</td>
            <td
              class="border-t border-[#E9E9EC] py-3.5 pr-4 font-mono text-[13px] text-[#5A5B63]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ account.customerId }}</td>
            <td class="border-t border-[#E9E9EC] py-3.5 pr-4 text-[13px] text-[#5A5B63]">
              {{ account.accountType === 'MONETARIA' ? 'Monetaria' : 'Ahorro' }}
            </td>
            <td class="border-t border-[#E9E9EC] py-3.5 pr-4">
              <AccountStatusBadge :status="account.status" />
            </td>
            <td
              class="border-t border-[#E9E9EC] py-3.5 pr-4 text-[13px] text-[#5A5B63]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ account.lastActivityAt ? formatDate(account.lastActivityAt) : '—' }}</td>
            <td
              class="border-t border-[#E9E9EC] py-3.5 pr-4 text-right text-[14px] font-semibold"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ formatQuetzales(account.balance.amountMinor) }}</td>
            <td class="border-t border-[#E9E9EC] py-3.5 text-right">
              <UButton size="xs" variant="outline" color="neutral" @click="beginChange(account)">
                {{ account.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar' }}
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UCard v-if="target !== null" data-testid="status-change">
      <template #header>
        <h2 class="text-[16px] font-semibold">
          {{ target.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar' }} la cuenta
        </h2>
        <p class="mt-1 break-all font-mono text-[12px] text-[#5A5B63]">{{ target.accountId }}</p>
      </template>

      <form class="flex flex-col gap-4" @submit.prevent="confirmChange">
        <UFormField
          label="Motivo"
          name="reason"
          help="Es el único registro de por qué se hizo este cambio: no hay proceso automático detrás del cual inferirlo."
        >
          <UInput v-model="reason" class="w-full" maxlength="300" />
        </UFormField>

        <SharedAsyncStateAlert
          v-if="changeState !== 'IDLE'"
          :state="changeState"
          :message="changeMessage"
          :correlation-id="correlationId"
        />

        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" @click="target = null">Cancelar</UButton>
          <UButton
            type="submit"
            color="primary"
            :loading="changing"
            :disabled="changing || reason.trim().length === 0"
          >Confirmar</UButton>
        </div>
      </form>
    </UCard>

    <SharedCorrelationIdBadge v-if="correlationId" :correlation-id="correlationId" />
  </section>
</template>
