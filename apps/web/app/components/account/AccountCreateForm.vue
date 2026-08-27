<script setup lang="ts">
import { ACCOUNT_TYPE_PRESENTATION, isUuidV4 } from '../../lib/account';
import type { AccountType } from '../../lib/account';

/**
 * Opening an account, in the three steps the prototype's `show.createAccount`
 * defines: the form, the confirmation, and the result.
 *
 * Three deliberate departures from that prototype, all of them because the
 * system behind it does not have what the picture shows:
 *
 * - **No customer search by DPI.** The Gateway exposes no route that reads a
 *   customer (TD-020), so the box takes the `customerId` a registration handed
 *   back. A search that returned nothing would look broken; a box that says
 *   what it wants does not.
 * - **No initial deposit.** `account.create.v1` carries no amount and criterion
 *   1 says a new account starts at Q 0.00. Offering the field would be offering
 *   a deposit that silently never happens.
 * - **No "identity verified" chip.** Whether this customer's document was
 *   validated is Customer Service's knowledge, and this screen cannot ask.
 *
 * The confirmation step earns its place: opening an account for the wrong
 * `customerId` produces a real account belonging to the wrong person, and
 * nothing in this system deletes one.
 */
const { session, role } = useSession();

const api = useGatewayApi();

const {
  state: outcomeState,
  message: outcomeMessage,
  correlationId,
  accepted,
  isSending,
  canWatch,
  run,
  reset,
} = useAccountOutcome();

type Step = 'FORM' | 'CONFIRM' | 'DONE';

const step = ref<Step>('FORM');
const accountType = ref<AccountType | null>(null);
const forSomebodyElse = ref(false);
const customerId = ref('');
const idempotencyKey = ref('');
const errors = ref<Record<string, string>>({});
const copied = ref(false);

/** A client may only open their own; anyone else has to name the subject. */
const isStaff = computed(() => role.value !== 'CLIENTE');

const subject = computed(() =>
  forSomebodyElse.value ? customerId.value.trim() : (session.value?.customerId ?? ''),
);

/**
 * Checked here so a `400` never has to explain itself.
 *
 * The Gateway refuses the same two things; this is a courtesy, not the
 * enforcement — and it is what criterion 8's "validación local sin request"
 * asks for.
 */
function validate(): boolean {
  const found: Record<string, string> = {};

  if (accountType.value === null) {
    found.accountType = 'Elige el tipo de cuenta.';
  }

  if (forSomebodyElse.value && !isUuidV4(customerId.value)) {
    found.customerId =
      'Escribe el customerId que devolvió el registro. Es un UUID de 36 caracteres.';
  }

  errors.value = found;

  return Object.keys(found).length === 0;
}

function review(): void {
  if (validate()) {
    step.value = 'CONFIRM';
  }
}

async function submit(): Promise<void> {
  await run(() =>
    api.call<{ accountId: string; correlationId: string }>('/api/accounts', {
      method: 'POST',
      body: {
        accountType: accountType.value,
        ...(forSomebodyElse.value ? { customerId: customerId.value.trim() } : {}),
      },
      idempotencyKey: idempotencyKey.value,
    }),
  );

  // `DONE` is where the outcome is *shown*, not a claim that it succeeded —
  // `SharedAsyncStateAlert` renders PENDING, the rejection and the timeout in
  // the same place. Criterion 8: a 202 is never a final success.
  step.value = 'DONE';
}

/** A new intention needs a new key, or the service will treat it as a retry. */
const keyField = useTemplateRef('keyField');

function openAnother(): void {
  reset();
  keyField.value?.renew();
  step.value = 'FORM';
  accountType.value = null;
  customerId.value = '';
  forSomebodyElse.value = false;
  errors.value = {};
}

async function copyAccountId(): Promise<void> {
  if (accepted.value?.accountId === undefined) {
    return;
  }

  await navigator.clipboard.writeText(accepted.value.accountId);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1_500);
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-[20px] font-semibold leading-7">Abrir una cuenta</h2>
      <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
        La cuenta se abre con saldo <strong>Q 0.00</strong>. La apertura es asíncrona: al
        enviarla el sistema la acepta, todavía no la completa.
      </p>
    </template>

    <!-- Step 1 -->
    <form v-if="step === 'FORM'" class="flex flex-col gap-5" @submit.prevent="review">
      <div>
        <AccountTypeSelector v-model="accountType" />
        <p v-if="errors.accountType" class="mt-2 text-[13px] text-[#B01B1B]">
          {{ errors.accountType }}
        </p>
      </div>

      <div v-if="isStaff" class="flex flex-col gap-3">
        <UCheckbox v-model="forSomebodyElse" label="La cuenta es para otro cliente" />

        <UFormField
          v-if="forSomebodyElse"
          label="customerId del titular"
          name="customerId"
          :error="errors.customerId"
          help="El identificador que devolvió el registro. No hay búsqueda: el Gateway no expone una ruta que liste clientes."
        >
          <UInput
            v-model="customerId"
            placeholder="00000000-0000-4000-8000-000000000000"
            class="w-full"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
        </UFormField>
      </div>

      <p v-else class="text-[13px] leading-5 text-[#5A5B63]">
        La cuenta se abrirá a tu nombre. Solo el personal del banco puede abrir cuentas para
        otras personas.
      </p>

      <SharedIdempotencyKeyField ref="keyField" v-model="idempotencyKey" />

      <UButton type="submit" color="primary" size="lg" block>Continuar</UButton>
    </form>

    <!-- Step 2: the confirmation, because nothing here deletes an account -->
    <div v-else-if="step === 'CONFIRM'" class="flex flex-col gap-4">
      <h3 class="text-[20px] font-semibold leading-7">Confirma la apertura</h3>

      <dl class="flex flex-col">
        <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
          <dt class="text-[13px] text-[#75767F]">Titular</dt>
          <dd
            class="break-all text-right font-mono text-[13px] font-medium"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ subject || 'tu propia cuenta' }}</dd>
        </div>
        <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
          <dt class="text-[13px] text-[#75767F]">Tipo de cuenta</dt>
          <dd class="text-[13px] font-medium">
            {{ accountType ? ACCOUNT_TYPE_PRESENTATION[accountType].label : '' }}
          </dd>
        </div>
        <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
          <dt class="text-[13px] text-[#75767F]">Saldo inicial</dt>
          <dd
            class="text-[13px] font-semibold"
            style="font-variant-numeric: tabular-nums lining-nums"
          >Q 0.00</dd>
        </div>
      </dl>

      <div class="flex gap-2">
        <UButton variant="outline" color="neutral" :disabled="isSending" @click="step = 'FORM'">
          Volver
        </UButton>
        <UButton
          color="primary"
          class="flex-1"
          :loading="isSending"
          :disabled="isSending"
          @click="submit"
        >Crear la cuenta</UButton>
      </div>
    </div>

    <!-- Step 3: the outcome, whatever it turned out to be -->
    <div v-else class="flex flex-col gap-4">
      <SharedAsyncStateAlert
        :state="outcomeState === 'IDLE' ? 'PENDING' : outcomeState"
        :message="outcomeMessage"
        :correlation-id="correlationId"
      />

      <div
        v-if="accepted?.accountId"
        class="rounded-2xl bg-[#F0F0F2] p-5"
        data-testid="new-account-id"
      >
        <p class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">accountId</p>
        <div class="mt-1.5 flex flex-wrap items-center gap-2.5">
          <code
            class="break-all font-mono text-[16px] font-bold tracking-[0.02em]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ accepted.accountId }}</code>
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            :aria-label="copied ? 'Copiado' : 'Copiar el accountId'"
            @click="copyAccountId"
          >{{ copied ? 'Copiado' : 'Copiar' }}</UButton>
        </div>
        <p class="mt-3 border-t border-[#DCDCE0] pt-3 text-[13px] leading-5 text-[#5A5B63]">
          Guarda este identificador: es con lo que se consulta el saldo y se envían
          transferencias.
          <template v-if="!canWatch">
            Tu sesión no puede leer el rastro de auditoría, así que la pantalla no confirmará el
            resultado — ábrelo abajo para verlo.
          </template>
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="accepted?.accountId"
          :to="`/cuentas/${accepted.accountId}`"
          color="primary"
        >Ver la cuenta</UButton>
        <UButton variant="outline" color="neutral" @click="openAnother">Abrir otra cuenta</UButton>
        <UButton to="/cuentas" variant="ghost" color="neutral">Volver a Cuentas</UButton>
      </div>
    </div>
  </UCard>
</template>
