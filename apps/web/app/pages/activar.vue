<script setup lang="ts">
import { asyncStateFor } from '../lib/gateway-error';
import type { AsyncState } from '../lib/gateway-error';

definePageMeta({ layout: 'public' });

/**
 * The activation link from the registration email.
 *
 * It shows a verdict because a person clicked it and is waiting. The three
 * rejections — invented, already used, expired — are one message: telling
 * somebody which it was would confirm that a token had once been issued for
 * that address.
 *
 * A timeout is **not** a rejection. Saying "the link failed" when the account
 * may well have activated would send people asking for a new link they do not
 * need.
 */
const api = useGatewayApi();
const route = useRoute();

const state = ref<AsyncState>('PENDING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';

  if (token === '') {
    state.value = 'VALIDATION_ERROR';
    message.value = 'El enlace de activación está incompleto.';
    return;
  }

  const result = await api.call<{ status: string; correlationId: string }>(
    '/api/customers/verify-email',
    { query: { token } },
  );

  if (result.ok) {
    state.value = 'SUCCESS';
    message.value =
      'Tu cuenta está activa. Ya puedes iniciar sesión. Para abrir cuentas bancarias, ' +
      'un cajero debe validar la foto de tu documento.';
    correlationId.value = result.correlationId;
    return;
  }

  // The shared mapping, not a second copy of it: `asyncStateFor` folds
  // UNAUTHENTICATED into `INTERNAL_ERROR` (the session boundary is
  // intercepted before this runs) and gives FORBIDDEN its own honest state —
  // this hand-rolled version used to fold both.
  state.value = asyncStateFor(result.error);
  correlationId.value = result.error.correlationId;
  message.value =
    result.error.type === 'BUSINESS_REJECTION'
      ? 'El enlace de activación no es válido o ya fue utilizado.'
      : undefined;
});
</script>

<template>
  <UCard>
    <template #header>
      <h1 class="text-[20px] font-semibold leading-7">Activación de cuenta</h1>
    </template>

    <SharedAsyncStateAlert :state="state" :message="message" :correlation-id="correlationId" />

    <template #footer>
      <UButton to="/login" variant="ghost" color="neutral">Ir a iniciar sesión</UButton>
    </template>
  </UCard>
</template>
