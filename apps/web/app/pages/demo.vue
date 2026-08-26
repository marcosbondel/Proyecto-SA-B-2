<script setup lang="ts">
import type { AsyncState } from '../lib/gateway-error';
import { formatQuetzales } from '../lib/money';

definePageMeta({ layout: 'public' });

/**
 * Every shared piece, in every state, without a broker.
 *
 * This is the page a developer of T-16 to T-20 opens before writing a screen,
 * and the page the ticket's evidence screenshots. It is deliberately reachable
 * without a session: the components it shows are not privileged, and requiring
 * sign-in to look at a component gallery would be friction for no gain.
 *
 * The five states are all here on purpose. The one most likely to be forgotten
 * in a real screen is `BROKER_UNAVAILABLE`, because it is the only one with no
 * entry in the Claude Design prototype.
 */
const STATES: readonly { state: AsyncState; caption: string }[] = [
  { state: 'PENDING', caption: 'Aceptada, todavía sin confirmar. Un 202 llega aquí, no a éxito.' },
  { state: 'SUCCESS', caption: 'Confirmada por una consulta de estado o por auditoría.' },
  { state: 'BUSINESS_REJECTION', caption: 'Un servicio la consideró y dijo que no.' },
  { state: 'REPLY_TIMEOUT', caption: 'Nadie contestó en cinco segundos. NO significa que falló.' },
  { state: 'BROKER_UNAVAILABLE', caption: 'No se pudo aceptar. No pasó nada; reintentar es gratis.' },
];

const SAMPLE_CORRELATION = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

const amount = ref<number | null>(1250);
const amountMinor = ref<number | null>(125_000);
const idempotency = ref('');
const keyField = useTemplateRef<{ renew: () => void }>('keyField');
</script>

<template>
  <div class="mx-auto flex w-full max-w-[760px] flex-col gap-8">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Componentes compartidos</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Lo que T-15 entrega para que T-16 a T-20 no lo resuelvan cinco veces.
      </p>
    </header>

    <section class="flex flex-col gap-3">
      <h2 class="text-[20px] font-semibold leading-7">Los cinco estados asíncronos</h2>
      <div v-for="entry in STATES" :key="entry.state" class="flex flex-col gap-1">
        <SharedAsyncStateAlert :state="entry.state" :correlation-id="SAMPLE_CORRELATION" />
        <p class="text-[12px] text-[#75767F]">{{ entry.caption }}</p>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-[20px] font-semibold leading-7">Identificador de correlación</h2>
      <UCard>
        <SharedCorrelationIdBadge :correlation-id="SAMPLE_CORRELATION" />
      </UCard>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-[20px] font-semibold leading-7">Monto en quetzales</h2>
      <UCard>
        <SharedMoneyInput v-model="amount" @update:amount-minor="amountMinor = $event" />
        <p class="mt-3 text-[13px] text-[#5A5B63]">
          Se envía como
          <code class="font-mono">amountMinor: {{ amountMinor ?? '—' }}</code>
          y se muestra como
          <strong style="font-variant-numeric: tabular-nums lining-nums">
            {{ amountMinor === null ? '—' : formatQuetzales(amountMinor) }}
          </strong>.
        </p>
        <p class="mt-1 text-[12px] text-[#75767F]">
          Prueba con 0.001 o con 1.234: el campo los rechaza en vez de redondearlos.
        </p>
      </UCard>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-[20px] font-semibold leading-7">Clave de idempotencia</h2>
      <UCard>
        <SharedIdempotencyKeyField ref="keyField" v-model="idempotency" />
        <template #footer>
          <UButton variant="ghost" color="neutral" @click="keyField?.renew()">
            Nueva intención (renovar clave)
          </UButton>
        </template>
      </UCard>
    </section>
  </div>
</template>
