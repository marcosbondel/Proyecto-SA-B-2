<script setup lang="ts">
import type { IdentityStatus, KycStatus } from '../lib/customer';
import { labelForRole } from '../lib/navigation';

/**
 * `C-01` — your own record, and the two things you may do to it.
 *
 * A page of its own rather than a branch inside `/clientes/[id]`, because the
 * two screens have different audiences. That one is also how a teller opens
 * somebody else's record; this one is only ever your own, which is what makes
 * a password form appropriate here and wrong there.
 *
 * **The email is shown and not editable**, and the prototype edits it. The
 * Gateway's `customer.update.v1` carries three fields and email is not among
 * them — deliberately: email is the sign-in identifier (D-05), so changing it
 * changes who can sign in, and doing that without proving control of the new
 * address is an account-takeover path rather than a convenience. Making it
 * editable properly needs a verify-the-new-address flow, which is a spec and
 * not a field. The deviation is recorded in `docs/TECH_DEBT.md` rather than
 * papered over with a box that silently does nothing.
 */
const api = useGatewayApi();
const { session, role } = useSession();

interface CustomerRecord {
  readonly fullName: string;
  readonly email: string;
  readonly address: string;
  readonly username: string;
  readonly identityStatus: IdentityStatus;
  readonly kycStatus: KycStatus;
}

const record = ref<CustomerRecord | null>(null);
const loadFailure = ref<string | null>(null);

const customerId = computed(() => session.value?.customerId ?? null);

const isRefreshing = ref(false);

async function loadProfile(): Promise<void> {
  if (customerId.value === null) {
    return;
  }

  isRefreshing.value = true;
  const result = await api.call<CustomerRecord>(`/api/customers/${customerId.value}`);
  isRefreshing.value = false;

  if (result.ok) {
    record.value = result.data;
    loadFailure.value = null;
    return;
  }

  loadFailure.value = result.error.message;
}

onMounted(() => {
  loadProfile();
  if (import.meta.client) {
    window.addEventListener('focus', loadProfile);
  }
});

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('focus', loadProfile);
  }
});

useHead({ title: 'Mi perfil · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Mi perfil</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Tus datos personales y tu contraseña.
      </p>
    </header>

    <UAlert
      v-if="customerId === null"
      color="error"
      variant="subtle"
      title="No hay sesión"
      description="Inicia sesión para ver tu perfil."
      data-testid="profile-no-session"
    />

    <div v-else class="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div class="flex flex-col gap-4">
        <CustomerUpdateForm :customer-id="customerId" />
        <CustomerPasswordForm :customer-id="customerId" />
      </div>

      <div class="flex flex-col gap-4">
        <UCard>
          <h2 class="text-[14px] font-semibold">Identificación</h2>

          <dl class="mt-4 flex flex-col gap-4">
            <div>
              <dt class="text-[12px] text-[#75767F]">Usuario</dt>
              <dd
                class="text-[13px] font-semibold text-[#23242A]"
                style="font-variant-numeric: tabular-nums lining-nums"
              >{{ record?.username ?? session?.username ?? '—' }}</dd>
            </div>

            <div>
              <dt class="text-[12px] text-[#75767F]">Correo electrónico</dt>
              <dd class="break-all text-[13px] font-medium text-[#23242A]">
                {{ record?.email ?? '—' }}
              </dd>
              <!--
                Stated rather than left as a mystery. A read-only field with no
                explanation reads as an oversight; this one is a decision.
              -->
              <p class="mt-1 text-[12px] leading-4 text-[#75767F]">
                El correo es tu identificador de acceso y no se cambia desde aquí.
              </p>
            </div>

            <div v-if="role">
              <dt class="text-[12px] text-[#75767F]">Rol</dt>
              <dd class="text-[13px] font-medium text-[#23242A]">{{ labelForRole(role) }}</dd>
            </div>

            <div>
              <dt class="text-[12px] text-[#75767F]">Número de cliente</dt>
              <dd
                class="break-all font-mono text-[12px] font-medium text-[#23242A]"
                style="font-variant-numeric: tabular-nums lining-nums"
              >{{ customerId }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <div class="flex items-center justify-between">
            <h2 class="text-[14px] font-semibold">Estado de Verificación (KYC)</h2>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-refresh-cw"
              :loading="isRefreshing"
              @click="loadProfile"
            >
              Actualizar
            </UButton>
          </div>

          <div class="mt-4">
            <CustomerKycStatusBadge
              v-if="record"
              :status="record.kycStatus === 'VERIFIED' || record.identityStatus === 'VALIDATED' ? 'VERIFIED' : record.kycStatus === 'REJECTED' || record.identityStatus === 'REJECTED' ? 'REJECTED' : 'PENDING'"
              explain
            />
            <p v-else class="text-[13px] leading-5 text-[#5A5B63]" data-testid="profile-kyc-unknown">
              {{ loadFailure ?? 'Consultando el estado de la verificación…' }}
            </p>
          </div>

          <p v-if="record?.kycStatus === 'PENDING' || record?.identityStatus === 'PENDING'" class="mt-3 text-[13px] leading-5 text-[#5A5B63]">
            Un cajero receptor o administrador debe verificar tu identidad antes de que puedas realizar transferencias o pagos.
          </p>
          <p v-else-if="record?.kycStatus === 'REJECTED' || record?.identityStatus === 'REJECTED'" class="mt-3 text-[13px] leading-5 text-red-600">
            Tu verificación fue rechazada. Acércate a una agencia bancaria con tu DPI físico para validar tu identidad presencialmente.
          </p>
        </UCard>
      </div>
    </div>
  </section>
</template>
