<script setup lang="ts">
import { initialsOf, labelForRole, modulesFor } from '../lib/navigation';
import { searchDestinations } from '../lib/search';

/**
 * The shell every signed-in module renders inside.
 *
 * The navigation is **derived** from the role, not hard-coded: `modulesFor`
 * lives in a plain module so it can be tested without a browser, which matters
 * because the frontend has no component-test framework (TD-010). Hiding a
 * module here is a courtesy — it stops the interface offering a button that
 * would fail — and never a control. The Gateway refuses regardless.
 *
 * Layout follows `docs/DESIGN.md`: a fixed rail on desktop, an icon-free
 * compact rail between 768px and 1024px, a slide-over behind a hamburger below
 * that, and content capped at 1200px on an 8px grid throughout.
 */
const { session, role, end } = useSession();
const { bank } = useAppConfig();
const route = useRoute();

const modules = computed(() => modulesFor(role.value));
const roleLabel = computed(() => (role.value === null ? '' : labelForRole(role.value)));
const initials = computed(() => initialsOf(session.value?.username));

const menuOpen = ref(false);
const query = ref('');
const destinations = computed(() => searchDestinations(query.value, role.value));

/**
 * The box says why it found nothing, rather than showing an empty list.
 *
 * "Sin resultados" would be a lie: nothing was searched. What this offers is a
 * jump to an identifier, and text that is not an identifier has nowhere to go.
 */
const searchHint = computed(() =>
  query.value.trim().length === 0 || destinations.value.length > 0
    ? null
    : 'Escribe un identificador completo (UUID) de cuenta, cliente, transferencia o pago.',
);

/** Closing on navigation is what makes the slide-over usable on a phone. */
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
    query.value = '';
  },
);

async function go(to: string): Promise<void> {
  query.value = '';
  await navigateTo(to);
}

async function signOut(): Promise<void> {
  end();
  await navigateTo('/login');
}
</script>

<template>
  <div class="min-h-screen bg-[#F6F6F7] text-[#23242A] antialiased">
    <div class="flex min-h-screen">
      <aside
        class="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-6 self-start overflow-y-auto border-r border-[#DCDCE0] bg-white px-4 py-6 lg:flex"
      >
        <div class="flex items-center gap-3 px-2">
          <SharedBrandMark :size="34" />
          <div>
            <div class="text-[15px] font-bold leading-5 tracking-tight">bonking</div>
            <div
              v-if="roleLabel"
              class="text-[10px] font-medium uppercase tracking-[0.08em] text-[#75767F]"
            >{{ roleLabel }}</div>
          </div>
        </div>

        <nav class="flex flex-col gap-0.5" aria-label="Módulos">
          <NuxtLink
            v-for="module in modules"
            :key="module.to"
            :to="module.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-[#5A5B63] transition-colors hover:bg-[#F0F0F2] hover:text-[#23242A]"
            active-class="bg-[#E9E9EC] font-semibold text-[#17191F]"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-[#C6C6CC]" aria-hidden="true" />
            <span>{{ module.label }}</span>
          </NuxtLink>
        </nav>

        <div class="mt-auto flex flex-col gap-0.5">
          <button
            type="button"
            class="rounded-lg px-3 py-2.5 text-left text-[13px] text-[#75767F] hover:bg-[#F0F0F2]"
            @click="signOut"
          >Cerrar sesión</button>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <!--
          The header is sticky and translucent, as the prototype draws it: the
          content scrolls under it and stays legible through the blur, so the
          identity of the session and the way out are never scrolled away.
        -->
        <header
          class="sticky top-0 z-10 flex items-center gap-3 border-b border-[#DCDCE0] bg-white/90 px-4 py-3 backdrop-blur sm:px-6"
        >
          <UButton
            class="lg:hidden"
            color="neutral"
            variant="outline"
            icon="i-lucide-menu"
            aria-label="Abrir el menú"
            @click="menuOpen = true"
          />

          <div class="relative min-w-0 flex-1 sm:max-w-[420px]">
            <UInput
              v-model="query"
              class="w-full"
              placeholder="Ir a una cuenta, cliente o transferencia…"
              icon="i-lucide-search"
              aria-label="Ir a un identificador"
            />

            <div
              v-if="destinations.length > 0 || searchHint"
              class="absolute left-0 right-0 top-[42px] z-20 rounded-xl border border-[#DCDCE0] bg-white p-1.5 shadow-[0_8px_24px_rgba(23,24,26,.10)]"
            >
              <p v-if="searchHint" class="px-3 py-2 text-[12px] leading-4 text-[#75767F]">
                {{ searchHint }}
              </p>
              <button
                v-for="destination in destinations"
                :key="destination.to"
                type="button"
                class="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#23242A] hover:bg-[#F0F0F2]"
                @click="go(destination.to)"
              >
                {{ destination.label }}
                <span class="tab ml-1 text-[12px] font-normal text-[#75767F]">{{ query.trim() }}</span>
              </button>
            </div>
          </div>

          <div class="flex-1" />

          <UDropdownMenu
            :items="[
              [
                { label: 'Mi perfil', icon: 'i-lucide-user', to: '/perfil' },
                { label: 'Cerrar sesión', icon: 'i-lucide-log-out', color: 'error', onSelect: signOut },
              ],
            ]"
          >
            <button
              type="button"
              class="flex h-[38px] items-center gap-2.5 rounded-full border border-[#DCDCE0] bg-white py-0 pl-1 pr-3"
            >
              <span
                class="grid h-7 w-7 place-items-center rounded-full bg-[#E4E4E8] text-[12px] font-bold text-[#0B0C10]"
              >{{ initials }}</span>
              <span class="hidden text-[13px] font-medium text-[#23242A] sm:inline">
                {{ session?.username ?? 'Sesión' }}
              </span>
            </button>
          </UDropdownMenu>
        </header>

        <main class="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <slot />
        </main>

        <footer class="px-6 py-4 text-[12px] text-[#75767F]">
          <span v-if="session">{{ session.username }} · {{ roleLabel }}</span>
        </footer>
      </div>
    </div>

    <!-- Below 1024px the rail becomes a slide-over rather than a wrapped row of
         pills: the prototype's mobile model, and the only one that keeps the
         navigation from pushing the page's own heading below the fold. -->
    <USlideover v-model:open="menuOpen" side="left" title="Módulos">
      <template #body>
        <div class="flex items-center gap-3 pb-4">
          <SharedBrandMark :size="34" />
          <div>
            <div class="text-[15px] font-bold leading-5 tracking-tight">bonking</div>
            <div
              v-if="roleLabel"
              class="text-[10px] font-medium uppercase tracking-[0.08em] text-[#75767F]"
            >{{ roleLabel }}</div>
          </div>
        </div>

        <nav class="flex flex-col gap-0.5" aria-label="Módulos">
          <NuxtLink
            v-for="module in modules"
            :key="module.to"
            :to="module.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-[#5A5B63] hover:bg-[#F0F0F2]"
            active-class="bg-[#E9E9EC] font-semibold text-[#17191F]"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-[#C6C6CC]" aria-hidden="true" />
            <span>{{ module.label }}</span>
          </NuxtLink>
        </nav>

        <button
          type="button"
          class="mt-4 rounded-lg px-3 py-2.5 text-left text-[13px] text-[#B01B1B] hover:bg-[#F0F0F2]"
          :style="{ color: bank.error }"
          @click="signOut"
        >Cerrar sesión</button>
      </template>
    </USlideover>
  </div>
</template>
