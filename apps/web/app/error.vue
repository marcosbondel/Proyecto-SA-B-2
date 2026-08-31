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
 */
defineProps<{ readonly error: NuxtError }>();

const { session, role } = useSession();

const roleLabel = computed(() => (role.value === null ? null : labelForRole(role.value)));

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
        Esta pantalla no existe o no tienes permisos
      </h1>

      <p class="mb-6 text-pretty text-[15px] leading-[22px] text-[#5A5B63]">
        <template v-if="roleLabel">
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
