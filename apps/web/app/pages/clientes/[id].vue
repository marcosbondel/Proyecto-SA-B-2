<script setup lang="ts">
import type { IdentityStatus } from '../../lib/customer';

/**
 * One customer: what can be changed, and where their identity stands.
 *
 * **Nothing is read from the system, because nothing can be.** The Gateway has
 * eleven routes and none of them returns a customer, so this page shows what
 * the session already knows and refuses to invent the rest. The alternative —
 * filling the boxes with plausible values — would be a screen that looks
 * informative and is fiction.
 *
 * The identity status is taken from the query string (`?identidad=`) so that a
 * link from the validation queue, or a reviewer producing evidence, can show
 * the real badge in each of its three states. Absent, it says it does not know,
 * which is the truthful answer until `GET /api/customers/:id` exists.
 */
const route = useRoute();
const { session } = useSession();

const customerId = computed(() => String(route.params.id));

const isMe = computed(() => session.value?.customerId === customerId.value);

const STATUSES: readonly string[] = ['PENDING', 'VALIDATED', 'REJECTED'];

const identityStatus = computed<IdentityStatus | null>(() => {
  const declared = String(route.query.identidad ?? '').toUpperCase();

  return STATUSES.includes(declared) ? (declared as IdentityStatus) : null;
});

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
              Todavía no se puede consultar. El Gateway no expone una ruta que lea un cliente, así
              que esta pantalla no sabe si la foto del documento ya fue revisada. Llega con el
              backend de T-16.
            </p>
          </div>

          <div class="mt-5 border-t border-[#E9E9EC] pt-5">
            <div class="text-[12px] text-[#75767F]">customerId</div>
            <div
              class="break-all font-mono text-[12px] font-medium text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ customerId }}</div>
          </div>

          <div v-if="isMe && session" class="mt-4">
            <div class="text-[12px] text-[#75767F]">Username</div>
            <div
              class="text-[13px] font-semibold text-[#23242A]"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ session.username }}</div>
          </div>
        </UCard>

        <UCard v-if="isMe">
          <h2 class="text-[14px] font-semibold">Cuenta</h2>
          <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
            La contraseña y el correo los administra Customer Service y todavía no hay ruta para
            cambiarlos desde aquí. El prototipo los incluye; el contrato del Gateway, no.
          </p>
        </UCard>
      </div>
    </div>
  </section>
</template>
