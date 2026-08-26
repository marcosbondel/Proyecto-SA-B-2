<script setup lang="ts">
/**
 * The teller's queue of identities waiting for review.
 *
 * **The screen exists; the data cannot.** The prototype defines this queue
 * (`show.validations`) and the assignment gives the receiving teller the job of
 * validating the document photo, but the Gateway has no route that lists
 * pending customers and none that publishes `customer.validate-identity.v1`.
 * Building the composition now — and saying plainly what is missing — is worth
 * more than a titled placeholder: the moment those routes exist, this page
 * needs rows, not a design.
 *
 * Nothing here fabricates a customer. An empty queue that says why is honest;
 * a table of invented names would be a demo pretending to be a system.
 */
const { role } = useSession();

/**
 * A courtesy redirect, not a control. D-06 restricts this work by scope and the
 * owning service is what refuses; this only avoids offering a screen whose every
 * request would fail.
 */
const mayReview = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

watchEffect(() => {
  if (role.value !== null && !mayReview.value) {
    navigateTo('/clientes');
  }
});

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

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        placeholder="Buscar por nombre o documento"
        disabled
        class="w-[280px]"
        aria-label="Buscar por nombre o documento"
      />
      <USelect
        :items="['Todos los estados', 'Pendiente', 'Aprobado', 'Rechazada']"
        :model-value="'Todos los estados'"
        disabled
        aria-label="Filtrar por estado"
      />
    </div>

    <UCard>
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

    <UAlert
      color="warning"
      variant="subtle"
      title="Esta cola todavía no puede llenarse"
      data-testid="validation-queue-blocked"
    >
      <template #description>
        <p class="text-[13px] leading-[22px]">
          Le faltan dos rutas que el Gateway no expone: una que liste los clientes pendientes de
          validación y otra que publique el veredicto del cajero
          (<code class="font-mono">customer.validate-identity.v1</code> existe en el catálogo de
          T-05, pero nadie lo publica desde HTTP). La composición está construida contra
          <code class="font-mono">bonking.dc.html</code>; las filas llegan con el backend de T-16.
        </p>
      </template>
    </UAlert>
  </section>
</template>
