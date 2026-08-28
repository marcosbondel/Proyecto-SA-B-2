<script setup lang="ts">
/**
 * One identity under review — the prototype's `show.validationDetail`.
 *
 * The declared data is loaded from `GET /api/customers/{id}` and the teller's
 * verdict is published through `POST /api/customers/{id}/identity-verdict`
 * (VALIDATED or REJECTED). Both are staff-only; the owning service re-checks.
 * The document image itself still has no read route, so that panel stays a
 * placeholder — a separate, deferred piece.
 */
interface CustomerRecord {
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly username: string;
  readonly identityStatus: string;
}

const route = useRoute();
const { role } = useSession();
const api = useGatewayApi();

const customerId = computed(() => String(route.params.id));

const rejectOpen = ref(false);
const record = ref<CustomerRecord | null>(null);
const loadError = ref<string | null>(null);
const sending = ref(false);
const sent = ref<'VALIDATED' | 'REJECTED' | null>(null);

const mayReview = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

watchEffect(() => {
  if (role.value !== null && !mayReview.value) {
    navigateTo('/clientes');
  }
});

onMounted(async () => {
  const result = await api.call<CustomerRecord & { outcome: string }>(
    `/api/customers/${customerId.value}`,
  );

  if (result.ok) {
    record.value = result.data;
  } else {
    loadError.value = result.error.message;
  }
});

async function decide(verdict: 'VALIDATED' | 'REJECTED'): Promise<void> {
  sending.value = true;

  const result = await api.call<{ correlationId: string }>(
    `/api/customers/${customerId.value}/identity-verdict`,
    { method: 'POST', body: { verdict } },
  );

  sending.value = false;
  rejectOpen.value = false;

  if (result.ok) {
    sent.value = verdict;
  } else {
    loadError.value = result.error.message;
  }
}
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Revisión de identidad</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Compara la foto del documento con los datos declarados.
        </p>
      </div>
      <UButton to="/clientes/validaciones" variant="ghost" color="neutral">Volver a la cola</UButton>
    </header>

    <UAlert
      v-if="sent"
      color="success"
      variant="subtle"
      :title="sent === 'VALIDATED' ? 'Identidad aprobada' : 'Identidad rechazada'"
      description="El veredicto se envió. El cliente saldrá de la cola cuando se procese."
      data-testid="verdict-sent"
    />
    <UAlert
      v-else-if="loadError"
      color="error"
      variant="subtle"
      title="Ocurrió un problema"
      :description="loadError"
    />

    <div class="grid items-start gap-4 lg:grid-cols-2">
      <UCard>
        <h2 class="text-[16px] font-semibold">Documento cargado</h2>
        <div
          class="mt-4 grid h-[340px] place-items-center rounded-2xl bg-[#DCDCE0] px-6 text-center text-[13px] font-medium text-[#75767F]"
          data-testid="document-viewer-empty"
        >
          <span>
            La foto no puede mostrarse todavía
            <span class="mt-1 block text-[12px] font-normal">
              El Gateway deposita la imagen en el almacenamiento de objetos y aún no expone una ruta
              para leerla.
            </span>
          </span>
        </div>
      </UCard>

      <div class="flex flex-col gap-4">
        <UCard>
          <h2 class="text-[16px] font-semibold">Datos declarados</h2>
          <div v-if="record" class="mt-4 flex flex-col" data-testid="validation-declared">
            <div class="flex justify-between gap-4 py-3">
              <span class="text-[13px] text-[#75767F]">Nombre completo</span>
              <span class="text-[13px] font-medium">{{ record.fullName }}</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">Número de documento</span>
              <span class="text-[13px] font-medium">{{ record.identityDocument }}</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">Fecha de nacimiento</span>
              <span class="text-[13px] font-medium">{{ record.dateOfBirth }}</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">Dirección</span>
              <span class="text-[13px] font-medium">{{ record.address }}</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">Username</span>
              <span class="text-[13px] font-medium">{{ record.username }}</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">Estado de identidad</span>
              <span class="text-[13px] font-medium">{{ record.identityStatus }}</span>
            </div>
          </div>
          <p v-else class="mt-4 text-[13px] text-[#75767F]">Cargando la ficha…</p>
        </UCard>

        <div class="flex gap-2">
          <UButton
            color="primary"
            size="lg"
            class="flex-1 justify-center"
            :loading="sending"
            :disabled="!mayReview || sent !== null"
            @click="decide('VALIDATED')"
          >
            Aprobar identidad
          </UButton>
          <UButton
            variant="outline"
            color="error"
            size="lg"
            :disabled="!mayReview || sent !== null"
            @click="rejectOpen = true"
          >Rechazar</UButton>
        </div>
      </div>
    </div>

    <UModal v-model:open="rejectOpen" title="Rechazar la identidad">
      <template #body>
        <p class="text-[14px] leading-5 text-[#5A5B63]">
          El cliente recibirá una notificación y podrá volver a subir su documento. Esta acción no
          se puede deshacer.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="rejectOpen = false">Cancelar</UButton>
          <UButton color="error" :loading="sending" @click="decide('REJECTED')">
            Rechazar identidad
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
