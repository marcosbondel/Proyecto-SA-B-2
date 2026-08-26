<script setup lang="ts">
definePageMeta({ layout: 'public' });

/**
 * Self-service registration, in the public zone.
 *
 * `POST /api/customers` is the one command route the Gateway marks `@Public`,
 * because nobody has an account yet when they use it — and `PUBLIC_ROUTES`
 * already reserved this path in T-15. The same form is available to staff at
 * `/clientes/nuevo`; the only difference is who may choose the role.
 */
useHead({ title: 'Crear cuenta · bonking' });
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="text-center">
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Crear cuenta</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Tres pasos. Al terminar te enviamos un correo para activar la cuenta.
      </p>
    </header>

    <CustomerRegisterForm mode="self" />

    <p class="text-center text-[13px] text-[#5A5B63]">
      ¿Ya tienes cuenta?
      <NuxtLink to="/login" class="font-semibold text-[#17191F] underline">Inicia sesión</NuxtLink>
    </p>
  </div>
</template>
