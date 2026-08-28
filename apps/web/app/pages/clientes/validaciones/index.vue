<script setup lang="ts">
/**
 * The teller's queue of identities waiting for review.
 *
 * The queue is real now: `GET /api/customers/pending-validation` lists everyone
 * whose `identityStatus` is `PENDING`, and a row links to the detail where the
 * teller gives a verdict. Staff only — the owning service returns an empty list
 * to anyone else, which is what the redirect below anticipates as a courtesy.
 */
interface PendingCustomer {
  readonly customerId: string;
  readonly fullName: string;
  readonly email: string;
  readonly registeredAt: string;
}

const { role } = useSession();
const api = useGatewayApi();

const mayReview = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

watchEffect(() => {
  if (role.value !== null && !mayReview.value) {
    navigateTo('/clientes');
  }
});

const pending = ref<PendingCustomer[]>([]);
const omitted = ref(0);
const loading = ref(true);
const failure = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  failure.value = null;

  const result = await api.call<{ customers: PendingCustomer[]; omitted: number }>(
    '/api/customers/pending-validation',
  );

  loading.value = false;

  if (result.ok) {
    pending.value = result.data.customers;
    omitted.value = result.data.omitted;
  } else {
    failure.value = result.error.message;
  }
}

onMounted(load);

useHead({ title: 'Validación de identidad · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Validación de identidad</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Clientes registrados que esperan revisión de su documento.
      </p>
    </header>

    <UAlert
      v-if="failure"
      color="error"
      variant="subtle"
      title="No se pudo cargar la cola"
      :description="failure"
      data-testid="validation-queue-error"
    />

    <p v-else-if="loading" class="text-[14px] text-[#5A5B63]">Cargando…</p>

    <UCard v-else-if="pending.length === 0">
      <div
        class="rounded-2xl border border-dashed border-[#C6C6CC] px-8 py-14 text-center"
        data-testid="validation-queue-empty"
      >
        <h2 class="text-[20px] font-semibold leading-7">No hay identidades por revisar</h2>
        <p class="mx-auto mt-2 max-w-[460px] text-[14px] leading-5 text-[#5A5B63]">
          La cola está al día. Cuando un cliente complete su registro con foto de DPI aparecerá
          aquí para validación.
        </p>
      </div>
    </UCard>

    <UCard v-else>
      <ul class="divide-y divide-[#E9E9EC]" data-testid="validation-queue">
        <li
          v-for="customer in pending"
          :key="customer.customerId"
          class="flex items-center justify-between gap-4 py-3"
        >
          <div>
            <p class="text-[15px] font-medium">{{ customer.fullName }}</p>
            <p class="text-[13px] text-[#75767F]">{{ customer.email }}</p>
          </div>
          <NuxtLink
            :to="`/clientes/validaciones/${customer.customerId}`"
            class="text-[14px] font-semibold text-[#17191F] underline"
          >
            Revisar →
          </NuxtLink>
        </li>
      </ul>

      <p v-if="omitted > 0" class="mt-3 text-[13px] text-[#75767F]">
        y {{ omitted }} más no mostrados.
      </p>
    </UCard>
  </section>
</template>
