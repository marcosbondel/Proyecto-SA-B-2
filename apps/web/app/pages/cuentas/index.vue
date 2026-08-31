<script setup lang="ts">
import { mayTakeDeposits, totalBalanceMinor } from '../../lib/account';
import type { AccountSummary } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState } from '../../lib/gateway-error';
import { formatQuetzales } from '../../lib/money';

/**
 * "Mis cuentas" — the prototype's `show.accounts`.
 *
 * The list is whatever `GET /api/accounts` returns, and that is deliberately
 * **not** filtered here: a `CLIENTE` gets their own accounts because Account
 * Service intersects the query with decision D-06, not because this screen
 * asked nicely. Filtering in the browser would be a permission that a devtools
 * console can turn off.
 *
 * An empty list is shown as an empty state and never as an error. It means the
 * same thing whether nothing exists or nothing is visible — which is the point,
 * because a distinguishable answer would be a way to probe for other people's
 * accounts.
 */
const api = useGatewayApi();
const { role } = useSession();

const accounts = ref<AccountSummary[]>([]);
const state = ref<'LOADING' | 'READY' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

const total = computed(() => totalBalanceMinor(accounts.value));

const canManage = computed(() => role.value === 'ADMINISTRADOR');

/**
 * The deposit window is a screen inside this module rather than a navigation
 * entry of its own, which is what `docs/FRONTEND.md` prescribes for a
 * role-restricted screen. The rule lives in `app/lib/account.ts` so a test can
 * assert it against the Gateway's decorator (TD-010).
 */
const canDeposit = computed(() => mayTakeDeposits(role.value));

async function load(): Promise<void> {
  state.value = 'LOADING';
  message.value = undefined;

  const result = await api.call<{ accounts: AccountSummary[]; correlationId: string }>(
    '/api/accounts',
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

onMounted(load);

useHead({ title: 'Cuentas · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Mis cuentas</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Cuentas monetarias y de ahorro asociadas a tu identidad.
        </p>
      </div>

      <div class="flex items-end gap-4">
        <div class="text-right">
          <p class="text-[12px] text-[#75767F]">Total consolidado</p>
          <p
            class="text-[24px] font-bold"
            style="font-variant-numeric: tabular-nums lining-nums"
            data-testid="consolidated-total"
          >{{ formatQuetzales(total) }}</p>
        </div>
        <UButton v-if="canDeposit" to="/cuentas/deposito" variant="outline" color="neutral">
          Depósito
        </UButton>
        <UButton to="/cuentas/nueva" color="primary">Abrir cuenta</UButton>
      </div>
    </header>

    <div v-if="state === 'LOADING'" class="flex flex-col gap-2">
      <USkeleton v-for="row in 3" :key="row" class="h-16 w-full rounded-2xl" />
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

    <AccountList v-else-if="accounts.length > 0" :accounts="accounts" />

    <div
      v-else
      class="rounded-2xl border border-dashed border-[#C6C6CC] bg-white px-8 py-14 text-center"
      data-testid="accounts-empty"
    >
      <h2 class="text-[20px] font-semibold leading-7">No hay cuentas registradas a tu nombre</h2>
      <p class="mx-auto mt-2 max-w-[460px] text-[14px] leading-5 text-[#5A5B63]">
        Cuando abras tu primera cuenta aparecerá aquí con su número y su saldo. Un cajero
        receptor también puede abrirla por ti en ventanilla.
      </p>
      <UButton to="/cuentas/nueva" color="primary" class="mt-6">Abrir la primera cuenta</UButton>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <UButton v-if="canManage" to="/cuentas/administracion" variant="outline" color="neutral">
        Gestión de cuentas
      </UButton>
      <UButton variant="ghost" color="neutral" :disabled="state === 'LOADING'" @click="load">
        Actualizar
      </UButton>
      <SharedCorrelationIdBadge v-if="correlationId" :correlation-id="correlationId" />
    </div>
  </section>
</template>
