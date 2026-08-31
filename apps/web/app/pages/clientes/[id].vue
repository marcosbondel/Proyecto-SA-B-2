<script setup lang="ts">
import type { IdentityStatus } from '../../lib/customer';

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
const { session } = useSession();

const customerId = computed(() => String(route.params.id));

const isMe = computed(() => session.value?.customerId === customerId.value);

const STATUSES: readonly string[] = ['PENDING', 'VALIDATED', 'REJECTED'];

interface CustomerRecord {
  readonly username: string;
  readonly identityStatus: IdentityStatus;
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

const overridden = computed<IdentityStatus | null>(() => {
  const declared = String(route.query.identidad ?? '').toUpperCase();

  return STATUSES.includes(declared) ? (declared as IdentityStatus) : null;
});

const identityStatus = computed<IdentityStatus | null>(
  () => overridden.value ?? record.value?.identityStatus ?? null,
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
        Datos administrados por Customer Service.
      </p>
    </header>

    <div class="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
      <CustomerUpdateForm :customer-id="customerId" />

      <div class="flex flex-col gap-4">
        <UCard>
          <h2 class="text-[14px] font-semibold">Validación de identidad</h2>

          <div class="mt-4">
            <IdentityStatusBadge v-if="identityStatus" :status="identityStatus" explain />

            <p v-else class="text-[13px] leading-5 text-[#5A5B63]" data-testid="identity-unknown">
              {{
                unreadable
                  ? 'No puedes consultar la ficha de este cliente, así que esta pantalla no sabe si la foto de su documento ya fue revisada.'
                  : 'Consultando el estado de la validación…'
              }}
            </p>
          </div>

          <div class="mt-5 border-t border-[#E9E9EC] pt-5">
            <div class="text-[12px] text-[#75767F]">customerId</div>
            <div
              class="break-all font-mono text-[12px] font-medium text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ customerId }}</div>
          </div>

          <div v-if="username" class="mt-4">
            <div class="text-[12px] text-[#75767F]">Username</div>
            <div
              class="text-[13px] font-semibold text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ username }}</div>
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
