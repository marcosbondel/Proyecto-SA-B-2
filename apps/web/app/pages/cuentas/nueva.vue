<script setup lang="ts">
/**
 * Opening an account, from inside a session.
 *
 * The screen itself is thin on purpose: everything that decides anything lives
 * in `AccountCreateForm` and in `app/lib/account.ts`, which is where it can be
 * tested (TD-010).
 */
useHead({ title: 'Abrir cuenta · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[680px] flex-col gap-4">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Abrir una cuenta</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Elige el tipo y confirma. Nace activa, con el saldo inicial que corresponda a su tipo.
      </p>
    </header>

    <AccountCreateForm />
  </section>
</template>
