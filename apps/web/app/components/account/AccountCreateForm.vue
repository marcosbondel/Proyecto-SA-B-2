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
const route = useRoute();
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

const isStaff = computed(() => role.value !== 'CLIENTE');

const step = ref<Step>('FORM');
const accountType = ref<AccountType | null>(null);
const forSomebodyElse = ref(isStaff.value);
const customerId = ref(
  typeof route.query.customerId === 'string' ? route.query.customerId.trim() : '',
);
const idempotencyKey = ref('');
const errors = ref<Record<string, string>>({});
const copied = ref(false);

watch(isStaff, (val) => {
  if (val) {
    forSomebodyElse.value = true;
  }
});

interface CustomerIdentityRecord {
  readonly customerId: string;
  readonly identityStatus: 'PENDING' | 'VALIDATED' | 'REJECTED';
}

const customerRecord = ref<CustomerIdentityRecord | null>(null);

onMounted(async () => {
  if (typeof route.query.customerId === 'string' && route.query.customerId.trim().length > 0) {
    customerId.value = route.query.customerId.trim();
  }
  if (isStaff.value) {
    forSomebodyElse.value = true;
  }

  if (role.value === 'CLIENTE' && session.value?.customerId) {
    const res = await api.call<CustomerIdentityRecord>(`/api/customers/${session.value.customerId}`);
    if (res.ok) {
      customerRecord.value = res.data;
    }
  }
});

const isIdentityPending = computed(
  () =>
    role.value === 'CLIENTE' &&
    customerRecord.value !== null &&
    customerRecord.value.identityStatus !== 'VALIDATED',
);

const subject = computed(() =>
  isStaff.value || forSomebodyElse.value ? customerId.value.trim() : (session.value?.customerId ?? ''),
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

  if (isIdentityPending.value) {
    found.accountType =
      'Tu documento de identidad está pendiente de validación por un cajero o administrador.';
    errors.value = found;
    return false;
  }

  if (accountType.value === null) {
    found.accountType = 'Elige el tipo de cuenta.';
  }

  if (isStaff.value) {
    if (!isUuidV4(customerId.value)) {
      found.customerId =
        'Como personal bancario debes indicar el identificador (UUID) de 36 caracteres del cliente titular.';
    }
  } else if (forSomebodyElse.value && !isUuidV4(customerId.value)) {
    found.customerId =
      'Escribe el número de cliente que devolvió el registro. Son 36 caracteres.';
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
        ...(isStaff.value || forSomebodyElse.value ? { customerId: customerId.value.trim() } : {}),
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
  forSomebodyElse.value = isStaff.value;
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
        La cuenta se abre con saldo inicial de <strong>Q 0.00</strong>.
      </p>
    </template>

    <!-- Step 1 -->
    <form v-if="step === 'FORM'" class="flex flex-col gap-5" @submit.prevent="review">
      <UAlert
        v-if="isIdentityPending"
        color="warning"
        variant="subtle"
        title="Validación de identidad requerida"
        description="Tu documento de identificación aún no ha sido aprobado por un cajero receptor o administrador. Debes esperar a que el personal bancario valide tu documento en ventanilla antes de poder abrir cuentas bancarias."
      />

      <div>
        <AccountTypeSelector v-model="accountType" />
        <p v-if="errors.accountType" class="mt-2 text-[13px] text-[#B01B1B]">
          {{ errors.accountType }}
        </p>
      </div>

      <div v-if="isStaff" class="flex flex-col gap-3 rounded-2xl bg-[#F6F6F8] p-4 border border-[#E9E9EC]">
        <div>
          <h3 class="text-[14px] font-semibold text-[#23242A]">Titular de la cuenta</h3>
          <p class="text-[12px] text-[#5A5B63]">
            El personal bancario (cajeros y administradores) solo puede abrir cuentas para clientes registrados.
          </p>
        </div>

        <UFormField
          label="Número de cliente del titular (UUID)"
          name="customerId"
          :error="errors.customerId"
          help="El identificador de cliente (UUID) de 36 caracteres a quien pertenecerá la cuenta."
        >
          <UInput
            v-model="customerId"
            placeholder="00000000-0000-4000-8000-000000000000"
            class="w-full font-mono"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
        </UFormField>
      </div>

      <p v-else class="text-[13px] leading-5 text-[#5A5B63]">
        La cuenta se abrirá a tu nombre. Solo el personal del banco puede abrir cuentas para
        otras personas.
      </p>

      <SharedIdempotencyKeyField ref="keyField" v-model="idempotencyKey" />

      <ClientOnly>
        <UButton
          type="submit"
          color="primary"
          size="lg"
          block
          :disabled="isIdentityPending"
        >
          {{ isIdentityPending ? 'Apertura bloqueada (requiere validación de cajero)' : 'Continuar' }}
        </UButton>
      </ClientOnly>
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
          >{{ isStaff ? customerId.trim() : (subject || 'tu propia cuenta') }}</dd>
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
        v-if="!accepted?.accountId"
        :state="outcomeState === 'IDLE' ? 'PENDING' : outcomeState"
        :message="outcomeMessage"
        :correlation-id="correlationId"
      />

      <UAlert
        v-else
        color="success"
        variant="subtle"
        title="¡Cuenta bancaria creada exitosamente!"
        description="La cuenta ha sido procesada y registrada en el sistema bancario con saldo inicial de Q 0.00."
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
            :aria-label="copied ? 'Copiado' : 'Copiar el número de cuenta'"
            @click="copyAccountId"
          >{{ copied ? 'Copiado' : 'Copiar' }}</UButton>
        </div>
        <p class="mt-3 border-t border-[#DCDCE0] pt-3 text-[13px] leading-5 text-[#5A5B63]">
          Guarda este identificador: es con lo que se consulta el saldo, se reciben depósitos en ventanilla y se realizan transferencias.
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
