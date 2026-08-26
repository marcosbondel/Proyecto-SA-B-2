<script setup lang="ts">
/**
 * The layout for the three screens reachable without a session: sign in,
 * register, and the activation link from the email.
 *
 * No navigation, deliberately. Offering the four modules to somebody who cannot
 * open any of them is an invitation to a redirect.
 */
const { bank } = useAppConfig();
</script>

<template>
  <div class="min-h-screen bg-[#F6F6F7] text-[#23242A] antialiased">
    <div class="mx-auto flex min-h-screen max-w-[440px] flex-col justify-center px-4 py-12">
      <header class="mb-8 flex items-center gap-3">
        <!-- Lacquered obsidian: the one lit object against a matte field. -->
        <span
          class="grid h-9 w-9 place-items-center rounded-lg text-[13px] font-semibold text-white"
          :style="{
            background: bank.primarySheen,
            boxShadow: `inset 0 1px 0 ${bank.primaryHighlight}`,
          }"
        >bk</span>
        <span class="text-[17px] font-bold tracking-tight">bonking</span>
      </header>

      <slot />

      <p class="mt-8 text-center text-[12px] text-[#75767F]">
        Bank USAC · Proyecto de Software Avanzado
      </p>
    </div>
  </div>
</template>
