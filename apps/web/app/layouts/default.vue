<script setup lang="ts">
import { labelForRole, modulesFor } from '../lib/navigation';

/**
 * The shell every module of T-16 to T-20 renders inside.
 *
 * The navigation is **derived** from the role, not hard-coded: `modulesFor`
 * lives in a plain module so it can be tested without a browser, which matters
 * because the frontend has no component-test framework (TD-010). Hiding a
 * module here is a courtesy — it stops the interface offering a button that
 * would fail — and never a control. The Gateway refuses regardless.
 *
 * Layout follows `docs/DESIGN.md`: a fixed rail on desktop, content capped at
 * 1200px, an 8px grid throughout.
 */
const { session, role, end } = useSession();
const { bank } = useAppConfig();

const modules = computed(() => modulesFor(role.value));
const roleLabel = computed(() => (role.value === null ? '' : labelForRole(role.value)));

async function signOut(): Promise<void> {
  end();
  await navigateTo('/login');
}
</script>

<template>
  <div class="min-h-screen bg-[#F6F6F7] text-[#23242A] antialiased">
    <div class="flex min-h-screen">
      <aside
        class="sticky top-0 hidden h-screen w-[248px] shrink-0 self-start flex-col gap-6 overflow-y-auto border-r border-[#DCDCE0] bg-white px-4 py-6 lg:flex"
      >
        <div class="flex items-center gap-3 px-2">
          <span
            class="grid h-9 w-9 place-items-center rounded-lg text-[13px] font-semibold text-white"
            :style="{
              background: bank.primarySheen,
              boxShadow: `inset 0 1px 0 ${bank.primaryHighlight}`,
            }"
          >bk</span>
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
        <header
          class="flex items-center justify-between gap-4 border-b border-[#DCDCE0] bg-white px-6 py-4 lg:hidden"
        >
          <span class="text-[15px] font-bold tracking-tight">bonking</span>
          <nav class="flex flex-wrap gap-2" aria-label="Módulos">
            <NuxtLink
              v-for="module in modules"
              :key="module.to"
              :to="module.to"
              class="rounded-full border border-[#C6C6CC] px-3 py-1 text-[12px] text-[#5A5B63]"
              active-class="border-[#17191F] font-semibold text-[#17191F]"
            >{{ module.label }}</NuxtLink>
          </nav>
        </header>

        <main class="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <slot />
        </main>

        <footer class="px-6 py-4 text-[12px] text-[#75767F]">
          <span v-if="session">{{ session.username }} · {{ roleLabel }}</span>
        </footer>
      </div>
    </div>
  </div>
</template>
