<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';
import type { AccountOperation, AccountSummary } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';

/**
 * One account: its balance, its risk of falling asleep, and its statement.
 *
 * The prototype's `show.accountDetail`. Two requests feed it and they are kept
 * separate on purpose: the balance is a request/reply with a five-second
 * ceiling, and the statement is another. Folding them into one call would make
 * a slow statement hide a balance that had already arrived.
 *
 * **The five states criterion 8 requires are all here.** The identifier is
 * validated with no request at all; the wait is a `USkeleton`; a refusal and a
 * timeout are two different alerts, and the timeout offers a retry — safe,
 * because a query changes nothing.
 */
const route = useRoute();
const api = useGatewayApi();
const { role } = useSession();

const accountId = computed(() => String(route.params.id ?? ''));

const account = ref<AccountSummary | null>(null);
const operations = ref<AccountOperation[]>([]);

const balanceState = ref<'LOADING' | 'READY' | AsyncState>('LOADING');
const balanceMessage = ref<string | undefined>(undefined);
const statementState = ref<'LOADING' | 'READY' | AsyncState>('LOADING');
const correlationId = ref<string | null>(null);

/** Local validation, before anything is sent. */
const malformed = computed(() => !isUuidV4(accountId.value));

interface BalanceReply {
  readonly accountId: string;
  readonly balance: { amountMinor: number; currency: string };
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly lastActivityAt: string | null;
  readonly correlationId: string;
}

async function loadBalance(): Promise<void> {
  if (malformed.value) {
    return;
  }

  balanceState.value = 'LOADING';
  balanceMessage.value = undefined;

  const result = await api.call<BalanceReply>(`/api/accounts/${accountId.value}/balance`);

  if (!result.ok) {
    balanceState.value = asyncStateFor(result.error);
    balanceMessage.value = result.error.message;
    correlationId.value = result.error.correlationId ?? correlationId.value;

    return;
  }

  correlationId.value = result.data.correlationId ?? result.correlationId;

  /**
   * The reply carries no `accountType`, `customerId` or `openedAt` — the
   * balance contract has no reason to. What is already on screen is kept and
   * only the three fields the reply owns are replaced, so "Actualizar" refreshes
   * a balance rather than blanking a card.
   */
  account.value = {
    accountId: result.data.accountId,
    customerId: account.value?.customerId ?? '',
    accountType: account.value?.accountType ?? 'MONETARIA',
    balance: result.data.balance,
    status: result.data.status,
    lastActivityAt: result.data.lastActivityAt,
    openedAt: account.value?.openedAt ?? (result.data.lastActivityAt ?? new Date().toISOString()),
  };

  balanceState.value = 'READY';
}

/**
 * The listing is what knows the type and the opening date, so it runs first and
 * the balance query refines it. When the account is not in the list — a teller
 * looking at somebody else's — the balance reply alone is enough to draw the
 * card, with the type falling back to its default.
 */
async function loadContext(): Promise<void> {
  const result = await api.call<{ accounts: AccountSummary[] }>('/api/accounts');

  if (result.ok) {
    const found = result.data.accounts.find((item) => item.accountId === accountId.value);

    if (found !== undefined) {
      account.value = found;
    }
  }
}

async function loadStatement(): Promise<void> {
  if (malformed.value) {
    return;
  }

  statementState.value = 'LOADING';

  const result = await api.call<{ operations: AccountOperation[]; correlationId: string }>(
    `/api/accounts/${accountId.value}/operations`,
  );

  if (!result.ok) {
    statementState.value = asyncStateFor(result.error);

    return;
  }

  operations.value = result.data.operations;
  statementState.value = 'READY';
}

async function refresh(): Promise<void> {
  await Promise.all([loadBalance(), loadStatement()]);
}

const showStatusForm = ref(false);
const statusReason = ref('');
const statusChanging = ref(false);
const statusChangeState = ref<'IDLE' | AsyncState>('IDLE');
const statusChangeMessage = ref<string | undefined>(undefined);

function beginStatusChange(): void {
  showStatusForm.value = true;
  statusReason.value =
    account.value?.status === 'ACTIVE'
      ? 'Desactivación administrativa de la cuenta'
      : 'Reactivación de la cuenta';
  statusChangeState.value = 'IDLE';
  statusChangeMessage.value = undefined;
}

async function confirmStatusChange(): Promise<void> {
  if (!account.value || !statusReason.value.trim() || statusChanging.value) {
    return;
  }

  statusChanging.value = true;
  const next = account.value.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const result = await api.call<{ correlationId: string }>(
    `/api/accounts/${account.value.accountId}/status`,
    {
      method: 'POST',
      body: {
        status: next,
        reason: statusReason.value.trim(),
      },
    },
  );

  statusChanging.value = false;

  if (!result.ok) {
    statusChangeState.value = asyncStateFor(result.error);
    statusChangeMessage.value = result.error.message;
    correlationId.value = result.error.correlationId ?? correlationId.value;

    return;
  }

  showStatusForm.value = false;
  account.value = {
    ...account.value,
    status: next,
  };

  // Wait 450ms for account-service to commit the status before querying balance
  await new Promise((resolve) => setTimeout(resolve, 450));
  await refresh();
  if (account.value) {
    account.value = {
      ...account.value,
      status: next,
    };
  }
}

watch(accountId, async (newId) => {
  if (isUuidV4(newId)) {
    await loadContext();
    await refresh();
  }
});

onMounted(async () => {
  if (malformed.value) {
    balanceState.value = 'VALIDATION_ERROR';
    statementState.value = 'VALIDATION_ERROR';

    return;
  }

  await loadContext();
  await refresh();
});

useHead({ title: 'Cuenta · bonking' });
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- Breadcrumb navigation to easily switch tabs/pages in Cuentas -->
    <div class="flex items-center justify-between gap-3 text-[13px] text-[#5A5B63] pb-2 border-b border-[#E9E9EC]">
      <nav class="flex items-center gap-2">
        <NuxtLink to="/cuentas" class="font-medium text-primary-600 hover:text-primary-700 transition-colors">
          ← Volver a Cuentas
        </NuxtLink>
        <span>/</span>
        <span class="font-mono text-[#23242A]">···{{ accountId.slice(-8) }}</span>
        <span v-if="account?.holderName" class="text-[#75767F]">({{ account.holderName }})</span>
      </nav>
      <div v-if="role === 'ADMINISTRADOR'" class="flex items-center gap-2">
        <UButton to="/cuentas/administracion" size="xs" variant="outline" color="neutral">
          Gestión de cuentas
        </UButton>
      </div>
    </div>
    <SharedAsyncStateAlert
      v-if="malformed"
      state="VALIDATION_ERROR"
      message="Ese número no tiene el formato correcto, así que no se envió ninguna consulta. Abre la cuenta desde la lista o pega el número de cuenta completo."
    />

    <template v-else>
      <div v-if="account === null && balanceState === 'LOADING'" class="flex flex-col gap-4">
        <USkeleton class="h-52 w-full rounded-3xl" />
        <USkeleton class="h-40 w-full rounded-2xl" />
      </div>

      <!--
        `AccountBalanceCard` and not `BalanceCard`: Nuxt registers a component
        under its directory prefix, so the file `components/account/BalanceCard.vue`
        is `AccountBalanceCard`. Written without the prefix, Vue resolved nothing
        and rendered nothing — silently, with no console error and no type error —
        so this screen showed a movements table with no balance above it, ever.
      -->
      <AccountBalanceCard
        v-else-if="account !== null"
        :account="account"
        :refreshing="balanceState === 'LOADING'"
        @refresh="refresh"
      />

      <div
        v-if="balanceState !== 'READY' && balanceState !== 'LOADING'"
        class="flex flex-col items-start gap-3"
      >
        <SharedAsyncStateAlert
          class="w-full"
          :state="balanceState"
          :message="balanceMessage"
          :correlation-id="correlationId"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Reintentar</UButton>
      </div>

      <AccountDeactivationWarning v-if="account !== null" :account="account" />

      <div
        v-if="account !== null"
        class="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#E9E9EC] bg-white p-5 shadow-sm"
      >
        <div>
          <p class="text-[14px] font-semibold text-[#1B1B1F]">
            Estado actual:
            <span :class="account.status === 'ACTIVE' ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold'">
              {{ account.status === 'ACTIVE' ? 'ACTIVA' : 'DESACTIVADA' }}
            </span>
          </p>
          <p class="mt-1 text-[13px] text-[#5A5B63]">
            {{ account.status === 'ACTIVE'
              ? 'La cuenta se encuentra operativa. Puedes desactivarla si deseas suspender sus operaciones y transferencias.'
              : 'La cuenta se encuentra desactivada. Puedes reactivarla de inmediato para volver a operar.' }}
          </p>
        </div>
        <UButton
          size="sm"
          :variant="account.status === 'ACTIVE' ? 'outline' : 'solid'"
          :color="account.status === 'ACTIVE' ? 'error' : 'primary'"
          @click="beginStatusChange"
        >
          {{ account.status === 'ACTIVE' ? 'Desactivar cuenta' : 'Activar cuenta' }}
        </UButton>
      </div>

      <UCard v-if="showStatusForm && account !== null" class="mt-2" data-testid="customer-status-change">
        <template #header>
          <h3 class="text-[16px] font-semibold">
            {{ account.status === 'ACTIVE' ? 'Desactivar' : 'Activar' }} cuenta
          </h3>
          <p class="mt-1 break-all font-mono text-[12px] text-[#5A5B63]">{{ account.accountId }}</p>
        </template>

        <form class="flex flex-col gap-4" @submit.prevent="confirmStatusChange">
          <UFormField
            label="Motivo"
            name="statusReason"
            help="Indica la justificación del cambio de estado."
          >
            <UInput v-model="statusReason" class="w-full" maxlength="300" />
          </UFormField>

          <SharedAsyncStateAlert
            v-if="statusChangeState !== 'IDLE'"
            :state="statusChangeState"
            :message="statusChangeMessage"
            :correlation-id="correlationId"
          />

          <div class="flex gap-2">
            <UButton variant="outline" color="neutral" @click="showStatusForm = false">Cancelar</UButton>
            <UButton
              type="submit"
              :color="account.status === 'ACTIVE' ? 'error' : 'primary'"
              :loading="statusChanging"
              :disabled="statusChanging || statusReason.trim().length === 0"
            >
              {{ account.status === 'ACTIVE' ? 'Confirmar desactivación' : 'Confirmar activación' }}
            </UButton>
          </div>
        </form>
      </UCard>

      <div v-if="account !== null" class="mt-4 flex flex-col gap-3">
        <h2 class="text-[20px] font-semibold leading-7">Movimientos</h2>

        <USkeleton v-if="statementState === 'LOADING'" class="h-40 w-full rounded-2xl" />

        <SharedAsyncStateAlert
          v-else-if="statementState !== 'READY'"
          :state="statementState"
          message="No pudimos cargar los movimientos. El saldo de arriba sigue siendo válido."
          :correlation-id="correlationId"
        />

        <AccountOperationsTable
          v-else-if="operations.length > 0"
          :operations="operations"
        />

        <div
          v-else
          class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-12 text-center"
          data-testid="operations-empty"
        >
          <p class="text-[14px] leading-5 text-[#5A5B63]">
            Esta cuenta todavía no tiene movimientos. Aparecerán aquí en cuanto reciba o envíe
            una transferencia.
          </p>
        </div>
      </div>

      <SharedCorrelationIdBadge v-if="correlationId" :correlation-id="correlationId" />
    </template>
  </section>
</template>
