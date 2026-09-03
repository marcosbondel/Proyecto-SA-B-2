<script setup lang="ts">
/**
 * The entry point of the Clientes module.
 *
 * It is a set of doors rather than a list, and the reason is worth stating: the
 * Gateway reads a customer by id but **lists** none, so a table here would
 * either be empty forever or be invented. What it can offer is the commands
 * that do exist — register, update, review an identity — and a way to reach a
 * specific customer by the number a registration hands back.
 *
 * **The doors depend on who is at them.** The module is open to every role,
 * because the Gateway restricts these routes by *scope* and not by role: a
 * client may read their own record, which is the whole of what this module is
 * for them. It used to offer that client "Registrar un cliente" and a lookup
 * box explaining which route the Gateway does not expose — a teller's task and
 * a developer's note, on a screen a cuentahabiente opens by accident. So the
 * cards are filtered here, in the page, which is `docs/FRONTEND.md`'s rule for
 * exactly this case and leaves the navigation matrix — and its parity with the
 * Gateway — untouched.
 */
const { session, role } = useSession();

const customerId = ref('');

/** Staff register other people and open anybody's file; a client does neither. */
const isStaff = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

/** The Gateway refuses anything that is not a UUID with a `400`. */
const isValidId = computed(() => /^[0-9a-f-]{36}$/i.test(customerId.value.trim()));

async function open(): Promise<void> {
  if (isValidId.value) {
    await navigateTo(`/clientes/${customerId.value.trim()}`);
  }
}

if (role.value === 'CLIENTE') {
  await navigateTo('/perfil');
}

useHead({ title: 'Clientes · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Clientes</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Registro con foto del documento, actualización de datos y revisión de identidad.
      </p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard v-if="isStaff">
        <h2 class="text-[16px] font-semibold">Registrar un cliente</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          Alta en tres pasos con la foto del DPI. El registro dispara el correo de activación:
          la cuenta no puede iniciar sesión hasta que se abra ese enlace.
        </p>
        <template #footer>
          <UButton to="/clientes/nuevo" color="primary">Nuevo cliente</UButton>
        </template>
      </UCard>

      <UCard v-if="isStaff">
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

      <UCard v-if="isStaff">
        <h2 class="text-[16px] font-semibold">Abrir la ficha de un cliente</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          Ingresa el identificador único del cliente (UUID) para consultar o gestionar su expediente bancario.
        </p>
        <form class="mt-3 flex gap-2" @submit.prevent="open">
          <UInput
            v-model="customerId"
            placeholder="Pega aquí el número de cliente"
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
