<script setup lang="ts">
import { formatQuetzales } from '../../lib/money';
import { ACCOUNT_TYPE_PRESENTATION, isUuidV4 } from '../../lib/account';
import type { AccountType } from '../../lib/account';

/**
 * Opening an account, in the three steps the prototype's `show.createAccount`
 * defines: the form, the confirmation, and the result.
 *
 * Two deliberate departures from that prototype, both of them because the
 * system behind it does not have what the picture shows:
 *
 * - **No customer search by DPI.** The Gateway exposes no route that reads a
 *   customer (TD-020), so the box takes the `customerId` a registration handed
 *   back. A search that returned nothing would look broken; a box that says
 *   what it wants does not.
 * - **No "identity verified" chip.** Whether this customer's document was
 *   validated is Customer Service's knowledge, and this screen cannot ask.
 *
 * **The initial deposit field (T-27)** only appears for `AHORRO`: it is the
 * one type with a minimum to open (`ACCOUNT_TYPE_PRESENTATION.AHORRO.minimumOpeningDepositMinor`).
 * `MONETARIA` still opens at Q 0.00 with no field to fill in — asking for an
 * amount that gets ignored would be worse than asking for nothing.
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
  run,
  reset,
} = useAccountOutcome();

type Step = 'FORM' | 'CONFIRM' | 'DONE';

const isStaff = computed(() => role.value !== 'CLIENTE');

const step = ref<Step>('FORM');
const accountType = ref<AccountType | null>(null);
const initialDepositMinor = ref<number | null>(null);
const forSomebodyElse = ref(isStaff.value);

/** `null` for MONETARIA (no minimum); the amount for AHORRO. */
const minimumDepositMinor = computed(() =>
  accountType.value === null ? null : ACCOUNT_TYPE_PRESENTATION[accountType.value].minimumOpeningDepositMinor,
);
const customerId = ref(
  typeof route.query.customerId === 'string' ? route.query.customerId.trim() : '',
);
const idempotencyKey = ref('');
const errors = ref<Record<string, string>>({});
const copied = ref(false);

watch(accountType, (val) => {
  // A MONETARIA opening carries no deposit; a stale AHORRO amount left in the
  // field would otherwise ride along in the payload after switching types.
  if (val !== 'AHORRO') {
    initialDepositMinor.value = null;
  }
});

watch(isStaff, (val) => {
  if (val) {
    forSomebodyElse.value = true;
  }
});

interface CustomerIdentityRecord {
  readonly customerId: string;
  readonly identityStatus: 'PENDING' | 'VALIDATED' | 'REJECTED';
  readonly kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

const customerRecord = ref<CustomerIdentityRecord | null>(null);

interface CustomerSummary {
  readonly customerId: string;
  readonly fullName: string;
  readonly documentNumber: string;
  readonly username: string;
  readonly role: string;
  readonly email: string;
  readonly identityStatus?: 'PENDING' | 'VALIDATED' | 'REJECTED';
  readonly kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
  readonly status?: string;
}

const customerList = ref<readonly CustomerSummary[]>([]);
const customerSearchLoading = ref(false);
const staffFetchedCustomer = ref<CustomerIdentityRecord | null>(null);

const customerSelectItems = computed(() =>
  customerList.value.map((c) => {
    const isVerified = c.identityStatus === 'VALIDATED' && c.kycStatus === 'VERIFIED';
    return {
      value: c.customerId,
      label: `${c.fullName} · DPI: ${c.documentNumber} [${isVerified ? '✓ Verificado' : '⚠️ No verificado'}]`,
    };
  }),
);

const selectedCustomer = computed(() =>
  customerList.value.find((c) => c.customerId === customerId.value.trim()) ?? null,
);

watch(customerId, async (id) => {
  const cleanId = id.trim();
  if (isStaff.value && isUuidV4(cleanId)) {
    const inList = customerList.value.find((c) => c.customerId === cleanId);
    if (!inList) {
      const res = await api.call<CustomerIdentityRecord>(`/api/customers/${cleanId}`);
      if (res.ok) {
        staffFetchedCustomer.value = res.data;
      } else {
        staffFetchedCustomer.value = null;
      }
    } else {
      staffFetchedCustomer.value = null;
    }
  }
});

onMounted(async () => {
  if (typeof route.query.customerId === 'string' && route.query.customerId.trim().length > 0) {
    customerId.value = route.query.customerId.trim();
  }
  if (isStaff.value) {
    forSomebodyElse.value = true;
    customerSearchLoading.value = true;
    const res = await api.call<{ customers: CustomerSummary[] }>('/api/customers');
    if (res.ok) {
      customerList.value = res.data.customers.filter((c) => c.role === 'CLIENTE');
    }
    customerSearchLoading.value = false;
  }

  if (role.value === 'CLIENTE' && session.value?.customerId) {
    const res = await api.call<CustomerIdentityRecord>(`/api/customers/${session.value.customerId}`);
    if (res.ok) {
      customerRecord.value = res.data;
    }
  }
});

const isCustomerUnverified = computed(() => {
  if (role.value === 'CLIENTE') {
    return (
      customerRecord.value !== null &&
      (customerRecord.value.identityStatus !== 'VALIDATED' ||
        customerRecord.value.kycStatus !== 'VERIFIED')
    );
  }
  if (isStaff.value) {
    if (selectedCustomer.value) {
      return (
        selectedCustomer.value.identityStatus !== 'VALIDATED' ||
        selectedCustomer.value.kycStatus !== 'VERIFIED'
      );
    }
    if (staffFetchedCustomer.value) {
      return (
        staffFetchedCustomer.value.identityStatus !== 'VALIDATED' ||
        staffFetchedCustomer.value.kycStatus !== 'VERIFIED'
      );
    }
  }
  return false;
});

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

  if (isCustomerUnverified.value) {
    if (role.value === 'CLIENTE') {
      found.accountType =
        'Tu documento de identidad o expediente KYC está pendiente de validación por un cajero o administrador.';
    } else {
      found.customerId =
        'El cliente titular seleccionado no se encuentra verificado (identidad o KYC pendiente). No se le puede abrir una cuenta hasta que sea validado.';
    }
    errors.value = found;
    return false;
  }

  if (accountType.value === null) {
    found.accountType = 'Elige el tipo de cuenta.';
  } else if (
    minimumDepositMinor.value !== null &&
    (initialDepositMinor.value === null || initialDepositMinor.value < minimumDepositMinor.value)
  ) {
    found.initialDeposit = `El depósito inicial debe ser de al menos ${formatQuetzales(minimumDepositMinor.value)}.`;
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
        ...(minimumDepositMinor.value !== null && initialDepositMinor.value !== null
          ? { initialDeposit: { amountMinor: initialDepositMinor.value, currency: 'GTQ' } }
          : {}),
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
  initialDepositMinor.value = null;
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
        <template v-if="minimumDepositMinor !== null">
          La cuenta {{ ACCOUNT_TYPE_PRESENTATION.AHORRO.label.toLowerCase() }} requiere un depósito
          inicial de al menos <strong>{{ formatQuetzales(minimumDepositMinor) }}</strong>.
        </template>
        <template v-else>
          La cuenta se abre con saldo inicial de <strong>Q 0.00</strong>.
        </template>
      </p>
    </template>

    <!-- Step 1 -->
    <form v-if="step === 'FORM'" class="flex flex-col gap-5" @submit.prevent="review">
      <UAlert
        v-if="isCustomerUnverified"
        color="warning"
        variant="subtle"
        :title="isStaff ? 'Cliente no verificado' : 'Validación de identidad requerida'"
        :description="isStaff
          ? 'El cliente titular seleccionado aún no cuenta con su verificación de identidad y KYC completada. No es posible aperturarle cuentas bancarias hasta que sea validado.'
          : 'Tu documento de identificación aún no ha sido aprobado por un cajero receptor o administrador. Debes esperar a que el personal bancario valide tu documento en ventanilla antes de poder abrir cuentas bancarias.'"
      />

      <div>
        <AccountTypeSelector v-model="accountType" />
        <p v-if="errors.accountType" class="mt-2 text-[13px] text-[#B01B1B]">
          {{ errors.accountType }}
        </p>
      </div>

      <div v-if="minimumDepositMinor !== null">
        <SharedMoneyInput
          label="Depósito inicial"
          name="initialDeposit"
          @update:amount-minor="initialDepositMinor = $event"
        />
        <p v-if="errors.initialDeposit" class="mt-2 text-[13px] text-[#B01B1B]">
          {{ errors.initialDeposit }}
        </p>
        <p v-else class="mt-2 text-[13px] text-[#5A5B63]">
          Mínimo {{ formatQuetzales(minimumDepositMinor) }}.
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
          label="Buscar cliente por Nombre o DPI"
          name="customerSearch"
          help="Selecciona de la lista o escribe/pega el UUID abajo."
        >
          <USelectMenu
            v-model="customerId"
            class="w-full"
            value-key="value"
            :items="customerSelectItems"
            :loading="customerSearchLoading"
            placeholder="Selecciona o busca un cliente registrado..."
            :search-input="{ placeholder: 'Buscar por nombre o DPI del cliente...' }"
          />
        </UFormField>

        <UFormField
          label="Número de cliente del titular (UUID)"
          name="customerId"
          :error="errors.customerId"
          help="El identificador único (UUID) de 36 caracteres a quien pertenecerá la cuenta."
        >
          <UInput
            v-model="customerId"
            placeholder="00000000-0000-4000-8000-000000000000"
            class="w-full font-mono"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
        </UFormField>

        <p v-if="selectedCustomer" class="text-[13px] text-[#186A32] font-medium">
          ✓ Cliente: <strong>{{ selectedCustomer.fullName }}</strong> (DPI: {{ selectedCustomer.documentNumber }})
        </p>
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
          :disabled="isCustomerUnverified"
        >
          {{ isCustomerUnverified ? 'Apertura bloqueada (cliente no verificado)' : 'Continuar' }}
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
          >{{ isStaff ? (selectedCustomer ? `${selectedCustomer.fullName} · DPI: ${selectedCustomer.documentNumber} (${customerId.trim()})` : customerId.trim()) : (subject || 'tu propia cuenta') }}</dd>
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
          >{{ formatQuetzales(initialDepositMinor ?? 0) }}</dd>
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
        :description="`La cuenta ha sido procesada y registrada en el sistema bancario con saldo inicial de ${formatQuetzales(initialDepositMinor ?? 0)}.`"
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
