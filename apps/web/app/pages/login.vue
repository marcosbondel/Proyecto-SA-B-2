<script setup lang="ts">
import { resolveNextPath } from '../lib/navigation';

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

/**
 * Whether this visit followed a session ending on its own, rather than a
 * plain visit to `/login` — with or without a `?next=`, which by itself means
 * nothing: a shared link or a stale bookmark carries one too, and nobody's
 * session expired to produce it. `useGatewayApi` sets `expired=1` on the one
 * redirect that actually means "your session just ended", so this reads that
 * signal rather than inferring it from `next`.
 *
 * Read once, into a plain value rather than a computed over `route.query`: a
 * normal sign-in from this same form navigates away and never revisits this
 * component, so there is no later moment at which the notice needs to
 * disappear on its own — but a second failed attempt on this page must not
 * lose it either, which a `ref` initialised once and left alone guarantees.
 */
const sessionExpired = ref(route.query.expired === '1');

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

  await navigateTo(resolveNextPath(route.query.next));
}
</script>

<template>
  <UCard>
    <template #header>
      <h1 class="text-[20px] font-semibold leading-7">Iniciar sesión</h1>
      <p class="mt-1 text-[14px] text-[#5A5B63]">Accede con el correo con el que te registraste.</p>
    </template>

    <UAlert
      v-if="sessionExpired"
      class="mb-4"
      color="neutral"
      variant="subtle"
      title="Tu sesión terminó por seguridad"
      description="Vuelve a entrar y te llevamos donde estabas."
      data-testid="session-expired-notice"
    />

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

      <p v-if="failure" class="text-[13px] text-[#75767F]">
        Si te acabas de registrar, recuerda que primero debes activar tu cuenta abriendo el enlace que enviamos a tu correo electrónico.
      </p>

      <UButton type="submit" :loading="pending" block>Entrar</UButton>
    </form>

    <template #footer>
      <div class="flex flex-col gap-4">
        <!-- The prototype's own pairing: sign in, register, or recover. -->
        <div class="flex items-center justify-between border-b border-[#E9E9EC] pb-4">
          <NuxtLink to="/registro" class="text-[14px] font-semibold text-[#17191F]">
            Crear cuenta
          </NuxtLink>
          <NuxtLink to="/recuperar" class="text-[13px] font-semibold text-[#5A5B63] underline">
            ¿Olvidaste tu contraseña?
          </NuxtLink>
        </div>

        <SharedCorrelationIdBadge :correlation-id="correlationId" />
      </div>
    </template>
  </UCard>
</template>
