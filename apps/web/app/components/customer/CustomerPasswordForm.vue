<script setup lang="ts">
/**
 * `C-01`'s second form: changing your own password from inside a session.
 *
 * It asks for the **current** password and not only the new one, and that is
 * the security property rather than a formality — a session is not
 * authorisation to replace the credential that creates sessions. Customer
 * Service verifies it; this form only refuses to send without it.
 *
 * The route answers in the same response, so this has three states and not
 * five: idle, sending, and a verdict. There is nothing to poll for.
 */
const props = defineProps<{ customerId: string }>();

const api = useGatewayApi();

const current = ref('');
const next = ref('');
const confirmation = ref('');
const sending = ref(false);
const done = ref(false);
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

/**
 * The browser's copy of the rule, which exists to answer while somebody is
 * typing. The contract's copy is what actually holds — this request can arrive
 * from anywhere the Gateway can be reached.
 */
const localProblem = computed(() => {
  if (next.value.length > 0 && next.value.length < 8) {
    return 'La contraseña nueva necesita al menos 8 caracteres.';
  }

  if (confirmation.value.length > 0 && confirmation.value !== next.value) {
    return 'Las dos contraseñas no coinciden.';
  }

  if (next.value.length > 0 && next.value === current.value) {
    return 'La contraseña nueva tiene que ser distinta de la actual.';
  }

  return null;
});

const canSubmit = computed(
  () =>
    current.value.length > 0 &&
    next.value.length >= 8 &&
    confirmation.value === next.value &&
    next.value !== current.value &&
    !sending.value,
);

function forget(): void {
  current.value = '';
  next.value = '';
  confirmation.value = '';
}

async function submit(): Promise<void> {
  sending.value = true;
  failure.value = null;
  done.value = false;

  const result = await api.call<{ status: string; correlationId: string }>(
    `/api/customers/${props.customerId}/password`,
    {
      method: 'POST',
      body: { currentCredential: current.value, newCredential: next.value },
    },
  );

  sending.value = false;

  if (result.ok) {
    correlationId.value = result.data.correlationId;
    done.value = true;
    // Nothing typed here survives the verdict, in either direction.
    forget();
    return;
  }

  correlationId.value = result.error.correlationId;

  if (result.error.type === 'REPLY_TIMEOUT') {
    failure.value =
      'No recibimos confirmación a tiempo. Tu contraseña PUEDE haber cambiado: intenta ' +
      'iniciar sesión con la nueva antes de volver a intentarlo.';
    forget();
    return;
  }

  failure.value = result.error.message;
  current.value = '';
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-[20px] font-semibold leading-7">Cambiar contraseña</h2>
      <p class="mt-1 text-[14px] text-[#5A5B63]">
        Necesitas la contraseña actual. Nadie más puede cambiarla por ti — ni un cajero ni un
        administrador.
      </p>
    </template>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <UFormField label="Contraseña actual" name="current">
        <UInput
          v-model="current"
          type="password"
          autocomplete="current-password"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField label="Contraseña nueva" name="next" hint="Mínimo 8 caracteres">
        <UInput
          v-model="next"
          type="password"
          autocomplete="new-password"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField label="Confirmar" name="confirmation">
        <UInput
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          class="w-full"
          required
        />
      </UFormField>

      <p v-if="localProblem" class="text-[13px] text-[#B01B1B]" data-testid="password-local-problem">
        {{ localProblem }}
      </p>

      <UAlert
        v-if="done"
        color="success"
        variant="subtle"
        title="Contraseña actualizada"
        description="La próxima vez que inicies sesión usa la contraseña nueva."
        data-testid="password-done"
      />

      <UAlert
        v-if="failure"
        color="error"
        variant="subtle"
        title="No pudimos cambiar la contraseña"
        :description="failure"
        data-testid="password-failure"
      />

      <UButton type="submit" :loading="sending" :disabled="!canSubmit" block>
        Actualizar contraseña
      </UButton>
    </form>

    <template #footer>
      <SharedCorrelationIdBadge :correlation-id="correlationId" />
    </template>
  </UCard>
</template>
