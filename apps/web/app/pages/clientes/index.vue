<script setup lang="ts">
/**
 * The entry point of the Clientes module.
 *
 * It is a set of doors rather than a list, and the reason is worth stating: the
 * Gateway exposes no route that lists or reads customers, so a table here would
 * either be empty forever or be invented. What it can offer is the two commands
 * that do exist — register, update — and a way to reach a specific customer by
 * the identifier a registration hands back.
 */
const { session, role } = useSession();

const customerId = ref('');

/** The Gateway refuses anything that is not a UUID with a `400`. */
const isValidId = computed(() => /^[0-9a-f-]{36}$/i.test(customerId.value.trim()));

const canValidate = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

async function open(): Promise<void> {
  if (isValidId.value) {
    await navigateTo(`/clientes/${customerId.value.trim()}`);
  }
}

useHead({ title: 'Clientes · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Clientes</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Registro con foto del documento, actualización de datos y estado de la validación de
        identidad.
      </p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard>
        <h2 class="text-[16px] font-semibold">Registrar un cliente</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          Alta en tres pasos con la foto del DPI. El registro dispara el correo de activación:
          la cuenta no puede iniciar sesión hasta que se abra ese enlace.
        </p>
        <template #footer>
          <UButton to="/clientes/nuevo" color="primary">Nuevo cliente</UButton>
        </template>
      </UCard>

      <UCard v-if="session">
        <h2 class="text-[16px] font-semibold">Mis datos</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          Actualiza nombre, dirección o fecha de nacimiento. El correo y el username no se
          modifican.
        </p>
        <template #footer>
          <UButton :to="`/clientes/${session.customerId}`" variant="outline" color="neutral">
            Abrir mi ficha
          </UButton>
        </template>
      </UCard>

      <UCard v-if="canValidate">
        <h2 class="text-[16px] font-semibold">Validación de identidad</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          Clientes registrados que esperan revisión de su documento.
        </p>
        <template #footer>
          <UButton to="/clientes/validaciones" variant="outline" color="neutral">
            Ver la cola
          </UButton>
        </template>
      </UCard>

      <UCard>
        <h2 class="text-[16px] font-semibold">Abrir una ficha</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          Con el <code class="font-mono">customerId</code> que devolvió un registro. No hay
          búsqueda: el Gateway no expone una ruta que liste clientes.
        </p>
        <form class="mt-3 flex gap-2" @submit.prevent="open">
          <UInput
            v-model="customerId"
            placeholder="00000000-0000-4000-8000-000000000000"
            class="flex-1"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
          <UButton type="submit" variant="outline" color="neutral" :disabled="!isValidId">
            Abrir
          </UButton>
        </form>
      </UCard>
    </div>
  </section>
</template>
