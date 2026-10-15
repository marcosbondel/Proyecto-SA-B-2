<script setup lang="ts">
/**
 * Enviar un depósito al banco pareja (T-47).
 *
 * Igual de delgada que `nueva.vue`, y por el mismo motivo: lo que decide algo
 * está en `TransactionInterbankForm` y en `app/lib/interbank.ts`, donde se
 * puede probar sin un navegador (TD-010).
 *
 * Vive bajo `/transferencias/` y no en una sección propia porque **es** una
 * transferencia: su seguimiento es `/transferencias/[id]`, su historial es
 * `/transferencias`, y separarla habría obligado a duplicar las dos.
 */
useHead({ title: 'Depósito a otro banco · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[680px] flex-col gap-4">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Depósito a otro banco</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Envía dinero a una cuenta de otro banco. Sale de tu cuenta al confirmarlo y vuelve solo si
        el otro banco lo rechaza o no contesta.
      </p>
    </header>

    <TransactionInterbankForm />
  </section>
</template>
