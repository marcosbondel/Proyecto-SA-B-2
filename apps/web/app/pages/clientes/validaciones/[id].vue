<script setup lang="ts">
/**
 * One identity under review — the prototype's `show.validationDetail`.
 *
 * Two panels: the uploaded document on the left, the declared data and the
 * verdict on the right. Both are empty, and deliberately so: there is no route
 * that returns the photo, no route that returns the customer, and no route that
 * publishes the teller's decision. The fields show a dash rather than a name.
 *
 * The approve and reject controls are present and disabled. Hiding them would
 * hide the shape of the work that is missing; enabling them would promise an
 * action that goes nowhere.
 */
const route = useRoute();
const { role } = useSession();

const customerId = computed(() => String(route.params.id));

const rejectOpen = ref(false);

const mayReview = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

watchEffect(() => {
  if (role.value !== null && !mayReview.value) {
    navigateTo('/clientes');
  }
});

const DECLARED_FIELDS = [
  'Nombre completo',
  'Número de documento',
  'Fecha de nacimiento',
  'Dirección',
  'Username',
] as const;

useHead({ title: 'Revisión de identidad · bonking' });
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
              El Gateway deposita la imagen en el almacenamiento de objetos y no expone una ruta
              para leerla.
            </span>
          </span>
        </div>
      </UCard>

      <div class="flex flex-col gap-4">
        <UCard>
          <h2 class="text-[16px] font-semibold">Datos declarados</h2>
          <div class="mt-4 flex flex-col">
            <div
              v-for="field in DECLARED_FIELDS"
              :key="field"
              class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3 first:border-t-0"
            >
              <span class="text-[13px] text-[#75767F]">{{ field }}</span>
              <span class="text-[13px] font-medium text-[#A8A9B2]">—</span>
            </div>
            <div class="flex justify-between gap-4 border-t border-[#E9E9EC] py-3">
              <span class="text-[13px] text-[#75767F]">customerId</span>
              <span
                class="break-all text-right font-mono text-[12px]"
                style="font-variant-numeric: tabular-nums lining-nums"
              >{{ customerId }}</span>
            </div>
          </div>
        </UCard>

        <div class="flex gap-2">
          <UButton color="primary" size="lg" class="flex-1 justify-center" disabled>
            Aprobar identidad
          </UButton>
          <UButton
            variant="outline"
            color="error"
            size="lg"
            :disabled="!mayReview"
            @click="rejectOpen = true"
          >Rechazar</UButton>
        </div>

        <p class="text-[12px] leading-[18px] text-[#75767F]">
          Ninguna de las dos acciones puede enviarse: el veredicto viaja en
          <code class="font-mono">customer.validate-identity.v1</code>, que existe en el catálogo
          de T-05 pero no tiene ruta en el Gateway.
        </p>
      </div>
    </div>

    <UModal v-model:open="rejectOpen" title="Rechazar la identidad">
      <template #body>
        <p class="text-[14px] leading-5 text-[#5A5B63]">
          El cliente recibirá una notificación con el motivo y podrá volver a subir su documento.
          Esta acción no se puede deshacer.
        </p>
        <UFormField class="mt-4" label="Motivo del rechazo" name="reason">
          <UTextarea disabled placeholder="La foto está borrosa o no coincide con los datos." class="w-full" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="rejectOpen = false">Cancelar</UButton>
          <UButton color="error" disabled>Rechazar identidad</UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
