<script setup lang="ts">
import type { NuxtError } from '#app';

import { labelForRole } from './lib/navigation';

/**
 * `X-01` — the screen for an address that does not exist, and for one this role
 * may not open.
 *
 * The prototype draws **one screen for both**, and that is the right call
 * rather than a shortcut: telling an unauthorised visitor that a page exists
 * but is not theirs is an enumeration oracle, and the same reasoning that keeps
 * the sign-in failure generic (FR-013) applies to an address. So the heading
 * names both possibilities and the sentence underneath names the role, which is
 * the one fact that is genuinely useful and gives nothing away.
 *
 * Nuxt renders this **outside** the layout, so the shell is not available here
 * — hence the brand mark and the way home, drawn locally.
 *
 * A fatal render or a `5xx` lands on this same page — Nuxt has one error
 * boundary — and must **not** share the 404/403 wording: neither an address
 * nor a role was the problem, and blaming one would be dishonest as well as
 * unhelpful. `isServerError` is the one branch the fusion above does not cover.
 */
const props = defineProps<{ readonly error: NuxtError }>();

const { session, role } = useSession();

const roleLabel = computed(() => (role.value === null ? null : labelForRole(role.value)));

/**
 * Whether this is a server-side failure rather than an address the fusion
 * above deliberately owns.
 *
 * The fusion is right for 404 and 403 — an anti-enumeration choice, not a
 * shortcut — but a 500, or a render that threw before any status was decided,
 * is not the visitor's doing, and telling them the screen "doesn't exist or
 * isn't yours" blames a role or an address for a problem on this side.
 */
const isServerError = computed(() => (props.error?.statusCode ?? 404) >= 500);

/** Signed out, the way home is the sign-in; signed in, it is the landing page. */
const home = computed(() => (session.value === null ? '/login' : '/'));

async function goHome(): Promise<void> {
  // `clearError` is what discards the error state; a plain link would leave the
  // error page mounted under the next route.
  await clearError({ redirect: home.value });
}
</script>

<template>
  <div
    class="grid min-h-screen place-items-center bg-[#F6F6F7] px-4 text-[#23242A] antialiased"
  >
    <div class="mx-auto max-w-[560px] py-16 text-center">
      <div class="mb-8 flex items-center justify-center gap-3">
        <SharedBrandMark :size="34" />
        <span class="text-[15px] font-bold tracking-tight">bonking</span>
      </div>

      <p class="tab text-[64px] font-bold leading-[72px] tracking-[-0.03em] text-[#C3C4CC]">
        {{ error?.statusCode ?? 404 }}
      </p>

      <h1 class="my-2 text-[28px] font-bold leading-9">
        {{ isServerError ? 'Ocurrió un error en el sistema' : 'Esta pantalla no existe o no tienes permisos' }}
      </h1>

      <p class="mb-6 text-pretty text-[15px] leading-[22px] text-[#5A5B63]">
        <template v-if="isServerError">
          No fue algo que hiciste: el sistema tuvo un problema al mostrar esta pantalla. Intenta de
          nuevo en un momento y, si sigue pasando, repórtalo.
        </template>
        <template v-else-if="roleLabel">
          Tu rol actual es {{ roleLabel }}. Algunas vistas están reservadas para otros roles; si
          crees que deberías tener acceso, contacta al administrador del sistema.
        </template>
        <template v-else>
          No hay una sesión abierta en este navegador. Inicia sesión y vuelve a intentarlo.
        </template>
      </p>

      <UButton size="xl" @click="goHome">
        {{ session === null ? 'Ir a iniciar sesión' : 'Volver a mi inicio' }}
      </UButton>
    </div>
  </div>
</template>
