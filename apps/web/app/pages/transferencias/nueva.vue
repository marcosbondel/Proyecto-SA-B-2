<script setup lang="ts">
/**
 * Asking for a transfer, from inside a session.
 *
 * The screen itself is thin on purpose: everything that decides anything lives
 * in `TransactionTransferForm` and in `app/lib/transaction.ts`, which is where
 * it can be tested (TD-010).
 */
useHead({ title: 'Nueva transferencia · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[680px] flex-col gap-4">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Nueva transferencia</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Mueve dinero entre dos cuentas. El sistema lo hace en varios pasos y podrás seguirlos.
      </p>
    </header>

    <TransactionTransferForm />
  </section>
</template>
