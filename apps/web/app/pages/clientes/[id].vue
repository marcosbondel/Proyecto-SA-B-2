<script setup lang="ts">
import type { IdentityStatus, KycStatus } from '../../lib/customer';

/**
 * One customer: what can be changed, and where their identity stands.
 *
 * The identity status is **read from the system** now. It used to come from a
 * query parameter (`?identidad=`) because the Gateway had no route that
 * returned a customer at all, so this screen could either invent a badge or
 * admit it did not know; it admitted it. `GET /api/customers/{customerId}`
 * arrived with the audit remediation (US6, closing TD-020), and with it the
 * badge, the username and the record itself are facts rather than parameters.
 *
 * The query parameter is still honoured as an override, and only as one: a
 * reviewer producing evidence for the three identity states needs to be able to
 * show all three without three customers in three states. When it is absent —
 * which is every real visit — the answer comes from the service.
 *
 * Changing your own password lives at `/perfil`, not here. This page is also
 * how staff open somebody else's record, and a password box on a screen a
 * teller uses to look at a customer is the wrong affordance even when the
 * service would refuse it.
 */
const api = useGatewayApi();
const route = useRoute();
const { session, role } = useSession();

const customerId = computed(() => String(route.params.id));

const isMe = computed(() => session.value?.customerId === customerId.value);

/** Staff registers a KYC verdict (T-31); a client only ever sees their own. */
const isStaff = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

const STATUSES: readonly string[] = ['PENDING', 'VALIDATED', 'REJECTED'];

interface CustomerRecord {
  readonly username: string;
  readonly identityStatus: IdentityStatus;
  readonly kycStatus: KycStatus;
}

const record = ref<CustomerRecord | null>(null);
const unreadable = ref(false);

onMounted(async () => {
  const result = await api.call<CustomerRecord>(`/api/customers/${customerId.value}`);

  if (result.ok) {
    record.value = result.data;
    return;
  }

  // A client looking at a record that is not theirs is refused by the owning
  // service. The page still renders — the edit form says its own piece — and
  // this panel says what it does not know rather than guessing.
  unreadable.value = true;
});

/**
 * The Fase 2 compliance verdict (T-31): whether this customer may initiate a
 * transfer at all, decided by staff and read by the transfer Saga's own KYC
 * gate — never by anything in this frontend.
 */
const kycSending = ref(false);
const kycError = ref<string | null>(null);

async function decideKyc(status: 'VERIFIED' | 'REJECTED'): Promise<void> {
  kycSending.value = true;
  kycError.value = null;

  const verdict = status === 'VERIFIED' ? 'VALIDATED' : 'REJECTED';
  const result = await api.call<{ correlationId: string }>(
    `/api/customers/${customerId.value}/identity-verdict`,
    { method: 'POST', body: { verdict } },
  );

  kycSending.value = false;

  if (result.ok) {
    if (record.value) {
      record.value = { ...record.value, kycStatus: status, identityStatus: verdict };
    }
  } else {
    kycError.value = result.error.message;
  }
}

const overridden = computed<IdentityStatus | null>(() => {
  const declared = String(route.query.identidad ?? '').toUpperCase();

  return STATUSES.includes(declared) ? (declared as IdentityStatus) : null;
});

const identityStatus = computed<IdentityStatus | null>(
  () => overridden.value ?? record.value?.identityStatus ?? null,
);

const isVerified = computed(
  () => record.value?.kycStatus === 'VERIFIED' || identityStatus.value === 'VALIDATED',
);

const isRejected = computed(
  () => record.value?.kycStatus === 'REJECTED' || identityStatus.value === 'REJECTED',
);

const username = computed(() =>
  isMe.value ? (session.value?.username ?? null) : (record.value?.username ?? null),
);

useHead({ title: 'Ficha de cliente · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">
        {{ isMe ? 'Mi perfil' : 'Ficha de cliente' }}
      </h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Datos personales, estado de la cuenta y revisión del documento.
      </p>
    </header>

    <div class="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
      <CustomerUpdateForm :customer-id="customerId" />

      <div class="flex flex-col gap-4">
        <UCard>
          <h2 class="text-[14px] font-semibold">Estado de Verificación (KYC)</h2>

          <div class="mt-4 flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <UBadge
                v-if="isVerified"
                color="success"
                variant="subtle"
                size="md"
              >
                Verificado
              </UBadge>
              <UBadge
                v-else-if="isRejected"
                color="error"
                variant="subtle"
                size="md"
              >
                Rechazado
              </UBadge>
              <UBadge
                v-else
                color="warning"
                variant="subtle"
                size="md"
              >
                Pendiente de verificación
              </UBadge>
            </div>

            <p class="text-[13px] leading-5 text-[#5A5B63]">
              {{
                isVerified
                  ? 'Expediente e identidad aprobados. El cliente cuenta con acceso habilitado para operar transferencias, pagos y cuentas.'
                  : isRejected
                    ? 'Expediente rechazado. Las transferencias y pagos se encuentran inhabilitados.'
                    : 'Expediente en espera de revisión por un cajero o administrador. Las operaciones de transferencia y pago permanecen bloqueadas.'
              }}
            </p>
          </div>

          <UAlert
            v-if="kycError"
            color="error"
            variant="subtle"
            :description="kycError"
            class="mt-3"
          />

          <div v-if="isStaff && !isVerified" class="mt-4 flex gap-2">
            <UButton
              color="primary"
              size="sm"
              class="flex-1 justify-center"
              :loading="kycSending"
              @click="decideKyc('VERIFIED')"
            >
              Aprobar verificación
            </UButton>
            <UButton
              variant="outline"
              color="error"
              size="sm"
              :loading="kycSending"
              @click="decideKyc('REJECTED')"
            >
              Rechazar
            </UButton>
          </div>

          <div class="mt-5 border-t border-[#E9E9EC] pt-5">
            <div class="text-[12px] text-[#75767F]">Número de cliente</div>
            <div
              class="break-all font-mono text-[12px] font-medium text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ customerId }}</div>
          </div>

          <div v-if="username" class="mt-4">
            <div class="text-[12px] text-[#75767F]">Usuario</div>
            <div
              class="text-[13px] font-semibold text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ username }}</div>
          </div>

          <div v-if="isStaff" class="mt-4">
            <UButton
              :to="`/clientes/validaciones/${customerId}`"
              variant="outline"
              color="neutral"
              size="xs"
              class="w-full justify-center"
            >
              Ver documento de identidad adjunto →
            </UButton>
          </div>
        </UCard>

        <UCard v-if="isMe">
          <h2 class="text-[14px] font-semibold">Cuenta</h2>
          <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
            La contraseña se cambia desde tu perfil, con la contraseña actual.
          </p>
          <UButton to="/perfil" variant="outline" color="neutral" class="mt-3">
            Ir a mi perfil →
          </UButton>
        </UCard>
      </div>
    </div>
  </section>
</template>
