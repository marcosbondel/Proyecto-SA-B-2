<script setup lang="ts">
definePageMeta({ layout: 'public' });

/**
 * Sign in.
 *
 * The rejection is **generic on purpose**, and this is the one screen where the
 * Claude Design prototype was deliberately not followed: it shows "tu cuenta aún
 * no está activa" as a state distinct from a wrong password. The ticket's
 * criterion 9 and FR-013 require the three failures to be indistinguishable,
 * so the spec wins and the discrepancy is recorded in the ticket's evidence.
 */
const api = useGatewayApi();
const { start } = useSession();
const route = useRoute();

const email = ref('');
const credential = ref('');
const pending = ref(false);
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

async function submit(): Promise<void> {
  pending.value = true;
  failure.value = null;

  const result = await api.signIn(email.value, credential.value);

  pending.value = false;

  if (!result.ok) {
    correlationId.value = result.error.correlationId;
    // One sentence for every failure. Distinguishing them here would turn this
    // form into an account-enumeration oracle.
    failure.value =
      result.error.type === 'UNAUTHENTICATED'
        ? 'No pudimos iniciar sesión con esos datos.'
        : result.error.message;
    return;
  }

  correlationId.value = result.data.correlationId;

  if (start(result.data.token) === null) {
    failure.value = 'La sesión recibida no es válida.';
    return;
  }

  const next = typeof route.query.next === 'string' ? route.query.next : '/';
  await navigateTo(next);
}
</script>

<template>
  <UCard>
    <template #header>
      <h1 class="text-[20px] font-semibold leading-7">Iniciar sesión</h1>
      <p class="mt-1 text-[14px] text-[#5A5B63]">Accede con el correo con el que te registraste.</p>
    </template>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <UFormField label="Correo" name="email">
        <UInput v-model="email" type="email" autocomplete="username" class="w-full" required />
      </UFormField>

      <UFormField label="Contraseña" name="credential">
        <UInput
          v-model="credential"
          type="password"
          autocomplete="current-password"
          class="w-full"
          required
        />
      </UFormField>

      <UAlert
        v-if="failure"
        color="error"
        variant="subtle"
        title="No pudimos iniciar sesión"
        :description="failure"
        data-testid="login-failure"
      />

      <UButton type="submit" :loading="pending" block>Entrar</UButton>
    </form>

    <template #footer>
      <SharedCorrelationIdBadge :correlation-id="correlationId" />
    </template>
  </UCard>
</template>
