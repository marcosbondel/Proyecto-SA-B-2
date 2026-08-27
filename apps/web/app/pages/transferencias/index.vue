<script setup lang="ts">
import { isUuidV4 } from '../../lib/account';

/**
 * The module's front door.
 *
 * It is deliberately **not** a list of transfers. The Gateway exposes no route
 * that lists them — `POST /api/transfers` and `GET /api/transfers/:id` are the
 * two, and neither answers "which transfers are mine" — so a table here would
 * be a table that could never hold a row, or worse, one filled from somewhere
 * it should not be. That gap is TD-033.
 *
 * What it does instead is the two things this module can actually do: start a
 * transfer, and look one up by the identifier the `202` handed back. The lookup
 * validates locally and navigates; it sends nothing, because the detail screen
 * is what asks.
 */
const lookup = ref('');
const touched = ref(false);

const problem = computed(() =>
  !touched.value || isUuidV4(lookup.value)
    ? undefined
    : 'Ese identificador no es un UUID v4. Pega el transactionId completo que devolvió el envío.',
);

async function open(): Promise<void> {
  touched.value = true;

  if (!isUuidV4(lookup.value)) {
    return;
  }

  await navigateTo(`/transferencias/${lookup.value.trim()}`);
}

useHead({ title: 'Transferencias · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Transferencias</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Envía dinero entre cuentas y sigue el estado de cada transferencia.
        </p>
      </div>
      <UButton to="/transferencias/nueva" color="primary" size="lg">Nueva transferencia</UButton>
    </header>

    <div class="grid gap-4 md:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="text-[20px] font-semibold leading-7">Enviar dinero</h2>
        </template>

        <p class="text-[14px] leading-[22px] text-[#5A5B63]">
          Una transferencia se hace en varios pasos: se descuenta de la cuenta de origen, se
          procesa el pago y se acredita en la de destino. Si algo falla después del débito, el
          dinero se devuelve automáticamente.
        </p>

        <template #footer>
          <UButton to="/transferencias/nueva" color="primary">Empezar</UButton>
        </template>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-[20px] font-semibold leading-7">Consultar una transferencia</h2>
        </template>

        <form class="flex flex-col gap-3" @submit.prevent="open">
          <UFormField
            label="transactionId"
            name="transactionId"
            :error="problem"
            help="El identificador que devolvió el envío. No hay listado: el Gateway no expone una ruta que liste transferencias."
          >
            <UInput
              v-model="lookup"
              placeholder="00000000-0000-4000-8000-000000000000"
              class="w-full"
              autocomplete="off"
              style="font-variant-numeric: tabular-nums lining-nums"
              data-testid="transfer-lookup"
            />
          </UFormField>

          <UButton type="submit" variant="outline" color="neutral" class="w-fit">
            Ver el estado
          </UButton>
        </form>
      </UCard>
    </div>
  </section>
</template>
