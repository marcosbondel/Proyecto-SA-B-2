<script setup lang="ts">
/**
 * Registration from inside, by somebody who already has a session.
 *
 * It is the same three steps as `/registro` with one addition: the role. A
 * teller registering a colleague, or an administrator seeding an account, needs
 * to say what that person will be — and the public form must never offer that
 * choice, which is why it is a prop and not a query parameter.
 *
 * Neither this page nor the Gateway decides whether this actor may do it.
 * Customer Service owns customers and owns that verdict; the interface simply
 * does not hide the screen from roles that will be refused, because a refusal
 * with a reason is better than a menu that quietly lacks an entry.
 */
useHead({ title: 'Nuevo cliente · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Nuevo cliente</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Registro de nuevo cliente con fotografía del documento de identidad.
      </p>
    </header>

    <CustomerRegisterForm mode="staff" />
  </section>
</template>
