<script setup lang="ts">
/**
 * Enviar un depósito al banco pareja (T-47).
 *
 * Igual de delgada que `nueva.vue`, y por el mismo motivo: lo que decide algo
 * está en `TransactionInterbankForm` y en `app/lib/interbank.ts`, donde se
 * puede probar sin un navegador (TD-010).
 *
 * Vive bajo `/transferencias/` y no en una sección propia porque **es** una
 * transferencia: su historial general es `/transferencias`, y separarla habría
 * obligado a duplicarlo. Su seguimiento, en cambio, es propio desde T-60: tras
 * enviar se llega a `/transferencias/interbancarias/[id]`, que dibuja los seis
 * estados del depósito, y la lista de todos está en `/transferencias/interbancarias`
 * (TD-090).
 */
useHead({ title: 'Depósito a otro banco · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[680px] flex-col gap-4">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Depósito a otro banco</h1>
        <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
          Envía dinero a una cuenta de otro banco. Sale de tu cuenta al confirmarlo y vuelve solo si
          el otro banco lo rechaza o no contesta.
        </p>
      </div>
      <UButton to="/transferencias/interbancarias" variant="outline" color="neutral">
        Ver depósitos enviados
      </UButton>
    </header>

    <TransactionInterbankForm />
  </section>
</template>
