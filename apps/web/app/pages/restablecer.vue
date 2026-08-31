<script setup lang="ts">
definePageMeta({ layout: 'public' });

/**
 * The reset link, opened — the screen the prototype does not draw and the flow
 * cannot work without.
 *
 * `P-07` and `P-07b` end at "revisa tu correo", which is where a prototype can
 * stop and an implementation cannot: somebody has to be able to type the new
 * password somewhere. The assignment anticipates exactly this — "el estudiante
 * deberá complementar cualquier funcionalidad faltante" (§4.1) — and the shape
 * is taken from `/activar`, the other screen a link in an email opens.
 *
 * The three ways a link fails — invented, already spent, expired — are one
 * message, for the reason `/activar` gives them one: naming which it was would
 * confirm that a link had once been issued for that address.
 *
 * A timeout is **not** a rejection. The password may well have been changed,
 * and sending somebody back to ask for another link they do not need is the
 * worse of the two mistakes.
 */
useHead({ title: 'Nueva contraseña · bonking' });

const api = useGatewayApi();
const route = useRoute();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

const password = ref('');
const confirmation = ref('');
const pending = ref(false);
const done = ref(false);
const failure = ref<string | null>(null);
const timedOut = ref(false);
const correlationId = ref<string | null>(null);

/**
 * Checked here and in the contract, on purpose. The browser's copy exists to
 * answer while somebody is typing; the contract's is what actually holds, since
 * this request can arrive from anywhere the Gateway can be reached.
 */
const localProblem = computed(() => {
  if (password.value.length > 0 && password.value.length < 8) {
    return 'La contraseña necesita al menos 8 caracteres.';
  }

  if (confirmation.value.length > 0 && confirmation.value !== password.value) {
    return 'Las dos contraseñas no coinciden.';
  }

  return null;
});

const canSubmit = computed(
  () =>
    token.value !== '' &&
    password.value.length >= 8 &&
    confirmation.value === password.value &&
    !pending.value,
);

async function submit(): Promise<void> {
  pending.value = true;
  failure.value = null;
  timedOut.value = false;

  const result = await api.call<{ status: string; correlationId: string }>(
    '/api/auth/password-reset/confirm',
    { method: 'POST', body: { resetToken: token.value, credential: password.value } },
  );

  pending.value = false;

  if (result.ok) {
    correlationId.value = result.data.correlationId;
    done.value = true;
    return;
  }

  correlationId.value = result.error.correlationId;

  if (result.error.type === 'REPLY_TIMEOUT') {
    timedOut.value = true;
    return;
  }

  failure.value =
    result.error.type === 'BUSINESS_REJECTION'
      ? 'El enlace para restablecer la contraseña no es válido o ya fue utilizado.'
      : 'No pudimos cambiar la contraseña en este momento. Vuelve a intentarlo en unos minutos.';
}
</script>

<template>
  <UCard>
    <template #header>
      <h1 class="text-[20px] font-semibold leading-7">Nueva contraseña</h1>
      <p v-if="!done" class="mt-1 text-[14px] text-[#5A5B63]">
        Elige una contraseña nueva para tu cuenta. Al guardarla, cualquier otro enlace de
        recuperación deja de funcionar.
      </p>
    </template>

    <UAlert
      v-if="token === ''"
      color="error"
      variant="subtle"
      title="El enlace está incompleto"
      description="Abre el enlace tal como aparece en el correo, o solicita uno nuevo."
      data-testid="reset-missing-token"
    />

    <div v-else-if="done" class="flex flex-col gap-4">
      <UAlert
        color="success"
        variant="subtle"
        title="Tu contraseña quedó cambiada"
        description="Ya puedes iniciar sesión con la contraseña nueva."
        data-testid="reset-done"
      />
    </div>

    <!--
      A timeout keeps the form on screen but does not invite a second attempt at
      the same link: if the first one worked, the link is spent, and retrying
      would show a rejection for a password that did change.
    -->
    <div v-else-if="timedOut" class="flex flex-col gap-4">
      <UAlert
        color="warning"
        variant="subtle"
        title="No recibimos confirmación a tiempo"
        description="Tu contraseña PUEDE haberse cambiado. Intenta iniciar sesión con la nueva
          antes de pedir otro enlace."
        data-testid="reset-timeout"
      />
    </div>

    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <UFormField label="Contraseña nueva" name="password" hint="Mínimo 8 caracteres">
        <UInput
          v-model="password"
          type="password"
          autocomplete="new-password"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField label="Repite la contraseña" name="confirmation">
        <UInput
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          class="w-full"
          required
        />
      </UFormField>

      <p v-if="localProblem" class="text-[13px] text-[#B01B1B]" data-testid="reset-local-problem">
        {{ localProblem }}
      </p>

      <UAlert
        v-if="failure"
        color="error"
        variant="subtle"
        title="No pudimos cambiar la contraseña"
        :description="failure"
        data-testid="reset-failure"
      />

      <UButton type="submit" :loading="pending" :disabled="!canSubmit" block>
        Guardar contraseña
      </UButton>
    </form>

    <template #footer>
      <div class="flex items-center justify-between">
        <NuxtLink to="/login" class="text-[14px] font-semibold text-[#17191F]">
          {{ done ? 'Ir a iniciar sesión' : 'Volver' }}
        </NuxtLink>
        <SharedCorrelationIdBadge :correlation-id="correlationId" />
      </div>
    </template>
  </UCard>
</template>
