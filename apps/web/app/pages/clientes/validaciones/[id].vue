<script setup lang="ts">
import { IDENTITY_PRESENTATION, isMissingDocumentPhoto } from '../../../lib/customer';
import type { IdentityStatus } from '../../../lib/customer';

/**
 * One identity under review — the prototype's `show.validationDetail`.
 *
 * The declared data is loaded from `GET /api/customers/{id}` and the teller's
 * verdict is published through `POST /api/customers/{id}/identity-verdict`
 * (VALIDATED or REJECTED). The photo itself comes from
 * `GET /api/customers/{id}/identity-document`, which answers with the image's
 * own bytes rather than JSON — the response is turned into an object URL and
 * released when this screen is left. All three are staff-only; the owning
 * service re-checks each one.
 */
interface CustomerRecord {
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly username: string;
  readonly identityStatus: IdentityStatus;
}

type DocumentPhotoState = 'LOADING' | 'READY' | 'MISSING' | 'ERROR';

const route = useRoute();
const { role } = useSession();
const api = useGatewayApi();

const customerId = computed(() => String(route.params.id));

const rejectOpen = ref(false);
const record = ref<CustomerRecord | null>(null);
const loadError = ref<string | null>(null);
const sending = ref(false);
const sent = ref<'VALIDATED' | 'REJECTED' | null>(null);

const documentPhotoState = ref<DocumentPhotoState>('LOADING');
const documentPhotoUrl = ref<string | null>(null);
const documentPhotoError = ref<string | null>(null);

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

/**
 * The photo, fetched independently of the declared data above: whichever of
 * the two fails, the other still has something to show.
 */
onMounted(async () => {
  const result = await api.call<Blob>(`/api/customers/${customerId.value}/identity-document`);

  if (result.ok) {
    documentPhotoUrl.value = URL.createObjectURL(result.data);
    documentPhotoState.value = 'READY';
    return;
  }

  if (isMissingDocumentPhoto(result.error.failureCode)) {
    documentPhotoState.value = 'MISSING';
    return;
  }

  documentPhotoError.value = result.error.message;
  documentPhotoState.value = 'ERROR';
});

onBeforeUnmount(() => {
  if (documentPhotoUrl.value !== null) {
    URL.revokeObjectURL(documentPhotoUrl.value);
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
        <img
          v-if="documentPhotoState === 'READY' && documentPhotoUrl"
          :src="documentPhotoUrl"
          alt="Foto del documento de identidad"
          class="mt-4 h-[340px] w-full rounded-2xl bg-[#DCDCE0] object-contain"
          data-testid="document-viewer-image"
        >
        <div
          v-else
          class="mt-4 grid h-[340px] place-items-center rounded-2xl bg-[#DCDCE0] px-6 text-center text-[13px] font-medium text-[#75767F]"
          :data-testid="
            documentPhotoState === 'MISSING'
              ? 'document-viewer-empty'
              : documentPhotoState === 'ERROR'
                ? 'document-viewer-error'
                : 'document-viewer-loading'
          "
        >
          <span v-if="documentPhotoState === 'LOADING'">Cargando la foto…</span>
          <span v-else-if="documentPhotoState === 'MISSING'">
            Este cliente no adjuntó una foto de su documento
            <span class="mt-1 block text-[12px] font-normal">
              Puedes revisar los datos declarados y decidir con esa información.
            </span>
          </span>
          <span v-else>
            No pudimos mostrar la foto
            <span class="mt-1 block text-[12px] font-normal">{{ documentPhotoError }}</span>
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
              <span class="text-[13px] text-[#75767F]">Usuario</span>
              <span class="text-[13px] font-medium">{{ record.username }}</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">Estado de identidad</span>
              <span class="text-[13px] font-medium">
                {{ IDENTITY_PRESENTATION[record.identityStatus].label }}
              </span>
            </div>
          </div>
          <p v-else class="mt-4 text-[13px] text-[#75767F]">Cargando la ficha…</p>
        </UCard>

        <ClientOnly>
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
        </ClientOnly>
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
