<script setup lang="ts">
import type { AccountSummary } from '../../lib/account';
import { asyncStateFor } from '../../lib/gateway-error';
import type { AsyncState, LoadState } from '../../lib/gateway-error';
import {
  INTERBANK_ACCEPTED_MESSAGE,
  MAX_PARTNER_ACCOUNT,
  interbankProblems,
  interbankRequestBody,
} from '../../lib/interbank';
import { formatQuetzales } from '../../lib/money';

/**
 * Enviar un depósito al banco pareja (T-47, §4.1 — Integración interbancaria).
 *
 * La composición es la de `TransactionTransferForm` —el `T-01` del prototipo—
 * a propósito: el prototipo de Claude Design **no tiene** pantalla
 * interbancaria (sus treinta y cuatro pantallas son de las fases anteriores),
 * así que en vez de inventar una variante nueva esta reutiliza la que ya se
 * comparó contra la referencia. La desviación queda registrada en la evidencia
 * del ticket, que es lo que `docs/DESIGN.md` pide cuando el diseño y el
 * repositorio no cubren el mismo terreno.
 *
 * Qué cambia respecto a una transferencia interna, y por qué se ve distinto:
 *
 * - **El destino no se elige de una lista.** Está en otro banco: no hay
 *   catálogo que pedir y el formato de la cuenta lo decide ese banco, no este.
 *   Se escribe, con el código del banco acordado en el acuerdo de integración.
 * - **El `202` dice menos que en una transferencia interna.** Aquí significa
 *   «la transferencia se aceptó y el débito va a ocurrir», no «el otro banco
 *   recibió el dinero». Esa diferencia es la razón del texto de abajo: alguien
 *   que lea «enviado» da por hecho que llegó, y si el otro banco rechaza, el
 *   dinero vuelve y la expectativa ya era falsa.
 * - **Lo que decide, decide fuera.** Las reglas están en
 *   `app/lib/interbank.ts`, probadas con `node --test` (TD-010). Este archivo
 *   dibuja.
 *
 * Lo que NO hace, igual que su hermano: no comprueba el saldo —es juicio de
 * Account Service bajo bloqueo de fila y cualquier cálculo de aquí estaría
 * viejo antes de dibujarse— y no valida que la cuenta exista en el otro banco,
 * porque no puede saberlo y porque el banco pareja lo dirá en su callback.
 */
const api = useGatewayApi();

const accounts = ref<AccountSummary[]>([]);
const loadState = ref<LoadState>('LOADING');
const loadFailure = ref<string | null>(null);

const sourceAccount = ref('');
const destinationBankCode = ref('');
const destinationAccount = ref('');
const amountQuetzales = ref<number | null>(null);
const idempotencyKey = ref('');

const step = ref<'FORM' | 'REVIEW'>('FORM');
const submitted = ref(false);
const isSending = ref(false);
const state = ref<'IDLE' | AsyncState>('IDLE');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

/** Centavos, que es la única unidad que cruza el borde (`money.ts`). */
const amountMinor = computed(() =>
  amountQuetzales.value === null ? null : Math.round(amountQuetzales.value * 100),
);

const draft = computed(() => ({
  sourceAccount: sourceAccount.value,
  destinationBankCode: destinationBankCode.value,
  destinationAccount: destinationAccount.value,
  amountMinor: amountMinor.value,
}));

const problems = computed(() => interbankProblems(draft.value));
/** Nada en rojo antes del primer intento: avisar de un campo vacío que nadie tocó es ruido. */
const shown = computed(() => (submitted.value ? problems.value : {}));

const source = computed(
  () => accounts.value.find((account) => account.accountId === sourceAccount.value) ?? null,
);

/** Igual que en el formulario de transferencias: tipo, últimos seis y saldo. */
function describe(account: AccountSummary): string {
  const kind = account.accountType === 'MONETARIA' ? 'Monetaria' : 'Ahorro';

  return `${kind} · ···${account.accountId.slice(-6)} · ${formatQuetzales(account.balance.amountMinor)}`;
}

const sourceItems = computed(() =>
  accounts.value.map((account) => ({ label: describe(account), value: account.accountId })),
);

/**
 * Sólo los dos estados en los que el resultado es DESCONOCIDO, no los que son
 * un «no».
 *
 * Reintentar un timeout o un broker ausente es seguro porque la clave de
 * idempotencia no cambia; ofrecer el mismo botón ante un rechazo de negocio
 * sería invitar a repetir algo que ya se contestó.
 */
const canRetry = computed(
  () => state.value === 'REPLY_TIMEOUT' || state.value === 'BROKER_UNAVAILABLE',
);

async function load(): Promise<void> {
  loadState.value = 'LOADING';
  loadFailure.value = null;

  const mine = await api.call<{ accounts: AccountSummary[] }>('/api/accounts');

  if (!mine.ok) {
    loadFailure.value = mine.error.message;
    loadState.value = asyncStateFor(mine.error);

    return;
  }

  accounts.value = mine.data.accounts.filter((account) => account.status === 'ACTIVE');
  loadState.value = 'READY';
}

onMounted(() => {
  load();
});

function review(): void {
  submitted.value = true;

  if (Object.keys(problems.value).length > 0) {
    // Nada sale hacia el otro banco cuando la validación local falla.
    state.value = 'VALIDATION_ERROR';
    message.value = 'Revisa los datos marcados. No se envió ninguna solicitud.';

    return;
  }

  state.value = 'IDLE';
  message.value = undefined;
  step.value = 'REVIEW';
}

function correct(): void {
  step.value = 'FORM';
  state.value = 'IDLE';
  message.value = undefined;
}

async function submit(): Promise<void> {
  if (isSending.value) {
    return;
  }

  isSending.value = true;
  state.value = 'PENDING';
  message.value = undefined;

  const result = await api.call<{
    transactionId: string;
    interbankTransferId: string;
    correlationId: string;
  }>('/api/interbank/transfers', {
    method: 'POST',
    body: interbankRequestBody(draft.value),
    idempotencyKey: idempotencyKey.value,
  });

  isSending.value = false;

  if (!result.ok) {
    state.value = asyncStateFor(result.error);
    message.value = result.error.message;
    correlationId.value = result.error.correlationId;

    return;
  }

  correlationId.value = result.data.correlationId ?? result.correlationId;

  /**
   * A la pantalla que sigue la transferencia, no a un cartel de éxito. Es la
   * misma de `T-03` y vale sin cambios porque un depósito interbancario **es**
   * una transferencia: sus estados son los de la Saga, y lo que el banco
   * pareja decida se verá ahí como se ve cualquier pago.
   */
  await navigateTo(`/transferencias/${result.data.transactionId}`);
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-[20px] font-semibold leading-7">Depósito a otro banco</h2>
      <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
        Envía dinero a una cuenta del banco con el que este banco tiene convenio. El banco de
        destino tiene que confirmarlo.
      </p>
    </template>

    <div v-if="loadState === 'LOADING'" class="flex flex-col gap-3">
      <USkeleton v-for="line in 4" :key="line" class="h-12 w-full rounded-xl" />
    </div>

    <SharedAsyncStateAlert
      v-else-if="loadState !== 'READY'"
      :state="loadState"
      :message="loadFailure ?? undefined"
      @retry="load"
    />

    <div
      v-else-if="accounts.length === 0"
      class="py-8 text-center"
      data-testid="interbank-no-accounts"
    >
      <p class="text-[18px] font-semibold leading-7">No tienes cuentas activas</p>
      <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
        Para enviar un depósito necesitas al menos una cuenta activa de la que pueda salir.
      </p>
      <UButton to="/cuentas/nueva" class="mt-4" color="primary">Abrir una cuenta</UButton>
    </div>

    <!-- Paso 1: los datos. -->
    <form v-else-if="step === 'FORM'" class="flex flex-col gap-5" @submit.prevent="review">
      <UFormField
        label="Cuenta de origen"
        name="sourceAccount"
        :error="shown.sourceAccount"
        help="De aquí sale el dinero."
      >
        <USelectMenu
          v-model="sourceAccount"
          class="w-full"
          value-key="value"
          data-testid="interbank-source-account"
          :items="sourceItems"
          placeholder="Elige o busca una cuenta de origen..."
          :search-input="{ placeholder: 'Buscar por tipo o número de cuenta...' }"
        />
      </UFormField>

      <UFormField
        label="Código del banco de destino"
        name="destinationBankCode"
        :error="shown.destinationBankCode"
        help="El que acordaron los dos bancos, en mayúsculas. Por ejemplo BANCO_PAREJA."
      >
        <UInput
          v-model="destinationBankCode"
          class="w-full"
          data-testid="interbank-bank-code"
          placeholder="BANCO_PAREJA"
          autocapitalize="characters"
        />
      </UFormField>

      <UFormField
        label="Cuenta de destino en ese banco"
        name="destinationAccount"
        :error="shown.destinationAccount"
        :help="`Tal como la nombra el otro banco, hasta ${MAX_PARTNER_ACCOUNT} caracteres. Este banco no puede comprobar que exista.`"
      >
        <UInput
          v-model="destinationAccount"
          class="w-full"
          data-testid="interbank-destination-account"
          placeholder="La cuenta que te dieron"
        />
      </UFormField>

      <UFormField label="Monto" name="amount" :error="shown.amount" help="En quetzales.">
        <UInput
          v-model.number="amountQuetzales"
          class="w-full"
          type="number"
          min="0.01"
          step="0.01"
          data-testid="interbank-amount"
          placeholder="0.00"
        />
      </UFormField>

      <SharedAsyncStateAlert
        v-if="state !== 'IDLE' && state !== 'PENDING'"
        :state="state"
        :message="message"
        :correlation-id="correlationId"
      />

      <UButton type="submit" color="primary" size="lg" data-testid="interbank-review">
        Revisar el depósito
      </UButton>
    </form>

    <!-- Paso 2: leerlo de vuelta antes de mandarlo. -->
    <div v-else class="flex flex-col gap-5" data-testid="interbank-review-step">
      <div class="rounded-xl border border-[#E9E9EC] p-4">
        <h3 class="text-[16px] font-semibold leading-6">Revisa antes de enviar</h3>

        <dl class="mt-3 flex flex-col gap-3">
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-[13px] text-[#5A5B63]">Sale de</dt>
            <dd class="tab text-[14px] font-medium text-[#23242A]">
              {{ source === null ? sourceAccount : describe(source) }}
            </dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-[13px] text-[#5A5B63]">Banco de destino</dt>
            <dd class="tab text-[14px] font-medium text-[#23242A]">{{ destinationBankCode }}</dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2">
            <dt class="text-[13px] text-[#5A5B63]">Cuenta de destino</dt>
            <dd class="tab text-[14px] font-medium text-[#23242A]">{{ destinationAccount }}</dd>
          </div>
          <div
            class="flex flex-wrap items-baseline justify-between gap-2 border-t border-[#E9E9EC] pt-3"
          >
            <dt class="text-[13px] text-[#5A5B63]">Monto</dt>
            <dd class="tab text-[22px] font-bold leading-7 text-[#23242A]">
              {{ formatQuetzales(amountMinor ?? 0) }}
            </dd>
          </div>
        </dl>
      </div>

      <UAlert
        color="warning"
        variant="subtle"
        title="El otro banco tiene que confirmarlo"
        :description="INTERBANK_ACCEPTED_MESSAGE"
        data-testid="interbank-notice"
      />

      <SharedIdempotencyKeyField v-model="idempotencyKey" />

      <SharedAsyncStateAlert
        v-if="state !== 'IDLE' && state !== 'PENDING'"
        :state="state"
        :message="message"
        :correlation-id="correlationId"
      />

      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          size="lg"
          class="flex-1"
          :loading="isSending"
          :disabled="isSending"
          data-testid="confirm-interbank"
          @click="submit"
        >
          {{ canRetry ? 'Volver a intentar el envío' : 'Confirmar y enviar' }}
        </UButton>
        <UButton variant="ghost" color="neutral" :disabled="isSending" @click="correct">
          Corregir
        </UButton>
      </div>

      <p v-if="canRetry" class="text-[13px] leading-5 text-[#5A5B63]">
        Volver a intentarlo es seguro: el código de la operación no cambia, así que el sistema
        reconoce que es el mismo depósito y no lo duplica.
      </p>
    </div>
  </UCard>
</template>
