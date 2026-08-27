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
    <SharedAsyncStateAlert
      v-if="malformed"
      state="VALIDATION_ERROR"
      message="Ese identificador no es un UUID v4, así que no se envió ninguna consulta. Abre la cuenta desde la lista o pega el accountId completo."
    />

    <template v-else>
      <div v-if="account === null && balanceState === 'LOADING'" class="flex flex-col gap-4">
        <USkeleton class="h-52 w-full rounded-3xl" />
        <USkeleton class="h-40 w-full rounded-2xl" />
      </div>

      <BalanceCard
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
