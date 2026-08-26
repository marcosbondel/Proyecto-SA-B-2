<script setup lang="ts">
import { labelForRole, modulesFor } from '../lib/navigation';

/**
 * Where a signed-in visitor lands.
 *
 * Deliberately thin: the dashboards the Claude Design prototype draws per role
 * need metrics that only T-16 to T-20 can produce. What T-15 can honestly show
 * is who you are and which modules are yours.
 */
const { session, role } = useSession();
const modules = computed(() => modulesFor(role.value));
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">
        Hola{{ session ? `, ${session.username}` : '' }}
      </h1>
      <p v-if="role" class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Estás operando como {{ labelForRole(role) }}.
      </p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard v-for="module in modules" :key="module.to">
        <h2 class="text-[20px] font-semibold leading-7">{{ module.label }}</h2>
        <p class="mt-1 text-[14px] text-[#5A5B63]">
          Módulo disponible para tu rol.
        </p>
        <template #footer>
          <UButton :to="module.to" variant="ghost" color="neutral">Abrir →</UButton>
        </template>
      </UCard>
    </div>
  </section>
</template>
