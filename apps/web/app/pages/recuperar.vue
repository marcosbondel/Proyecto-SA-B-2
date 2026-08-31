<script setup lang="ts">
definePageMeta({ layout: 'public' });

/**
 * `P-07` — "I forgot my password", and the screen that answers it.
 *
 * The single most important thing about this form is that **it always says the
 * same thing**. `POST /api/auth/password-reset` returns `202` whether or not
 * the address belongs to an account, and this screen shows the confirmation
 * regardless — including for a `BUSINESS_REJECTION`, which this route cannot
 * produce and which, if it somehow did, must not become the oracle the whole
 * flow is built to avoid.
 *
 * The one failure it *does* show is an infrastructure one: a broker that is
 * down or a request that never arrived means no email is coming, and telling
 * somebody to check an inbox that will stay empty is worse than telling them to
 * try again.
 *
 * The prototype says the link lasts twenty-four hours. It lasts **one**:
 * `RESET_TTL_MS` in Customer Service is an hour because this link replaces a
 * credential, and the repository rule wins over the prototype (`docs/DESIGN.md`).
 */
useHead({ title: 'Recuperar contraseña · bonking' });

const api = useGatewayApi();

const email = ref('');
const pending = ref(false);
const sent = ref(false);
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

async function submit(): Promise<void> {
  pending.value = true;
  failure.value = null;

  const result = await api.call<{ correlationId: string }>('/api/auth/password-reset', {
    method: 'POST',
    body: { email: email.value },
  });

  pending.value = false;

  if (result.ok) {
    correlationId.value = result.data.correlationId;
    sent.value = true;
    return;
  }

  correlationId.value = result.error.correlationId;

  /**
   * A rejected *shape* is the visitor's to fix and is safe to report — it says
   * nothing about who banks here. Anything else is ours, and is reported as
   * ours rather than as "that address does not exist".
   */
  if (result.error.type === 'VALIDATION_ERROR') {
    failure.value = 'Escribe una dirección de correo válida.';
    return;
  }

  failure.value =
    'No pudimos registrar tu solicitud en este momento. Vuelve a intentarlo en unos minutos.';
}
</script>

<template>
  <UCard v-if="!sent">
    <template #header>
      <h1 class="text-[20px] font-semibold leading-7">Recuperar contraseña</h1>
      <p class="mt-1 text-[14px] text-[#5A5B63]">
        Te enviaremos un enlace para crear una contraseña nueva.
      </p>
    </template>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <UFormField label="Correo electrónico" name="email">
        <UInput v-model="email" type="email" autocomplete="username" class="w-full" required />
      </UFormField>

      <UAlert
        v-if="failure"
        color="error"
        variant="subtle"
        title="No pudimos enviar el enlace"
        :description="failure"
        data-testid="recover-failure"
      />

      <UButton type="submit" :loading="pending" block>Enviar enlace</UButton>
    </form>

    <template #footer>
      <div class="flex items-center justify-between">
        <NuxtLink to="/login" class="text-[14px] font-semibold text-[#17191F]">Volver</NuxtLink>
        <SharedCorrelationIdBadge :correlation-id="correlationId" />
      </div>
    </template>
  </UCard>

  <UCard v-else>
    <template #header>
      <h1 class="text-[20px] font-semibold leading-7">Correo enviado</h1>
    </template>

    <!--
      Deliberately conditional wording. "Si … está registrado" is not hedging —
      it is the only sentence that is true for every visitor and tells a
      stranger nothing about which addresses bank here.
    -->
    <p class="text-[15px] leading-6 text-[#23242A]">
      Si <strong class="font-semibold">{{ email }}</strong> está registrado, recibirás el enlace en
      unos minutos. Vence en una hora.
    </p>

    <template #footer>
      <div class="flex items-center justify-between">
        <NuxtLink to="/login" class="text-[14px] font-semibold text-[#17191F]">
          Volver a iniciar sesión
        </NuxtLink>
        <SharedCorrelationIdBadge :correlation-id="correlationId" />
      </div>
    </template>
  </UCard>
</template>
