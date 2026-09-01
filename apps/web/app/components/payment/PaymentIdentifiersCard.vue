<script setup lang="ts">
/**
 * The three identifiers a payment is traced by, each copyable.
 *
 * Straight out of the prototype's "Estado de pago" side panel, with one
 * addition it does not have and this system needs: the `correlationId`. The
 * prototype shows `paymentId` and `transactionId` because those are what a
 * customer quotes; in an event-driven system the identifier that actually finds
 * anything in the audit trail is the correlation the flow was **born** under,
 * and leaving it off would make the panel useless for the one job it is opened
 * for during an incident.
 *
 * Everything is copyable for the reason `SharedCorrelationIdBadge` gives:
 * showing a UUID without a way to copy it makes people transcribe it by hand,
 * which is how the wrong one ends up in a bug report. Tabular figures for the
 * same reason — hexadecimal compared by eye needs its digits to line up.
 *
 * Owned by T-19.
 */
defineProps<{
  paymentId: string;
  transactionId: string;
  correlationId?: string | null;
  providerReference?: string | null;
}>();

const copied = ref<string | null>(null);

async function copy(value: string, key: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  copied.value = key;
  setTimeout(() => {
    if (copied.value === key) {
      copied.value = null;
    }
  }, 1_500);
}
</script>

<template>
  <aside class="rounded-2xl border border-[#DCDCE0] bg-white p-6">
    <h2 class="text-[14px] font-semibold leading-5">Identificadores</h2>

    <div class="mt-4 flex flex-col gap-4">
      <div>
        <p class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">Número del pago</p>
        <div class="mt-1 flex items-start gap-2">
          <code
            class="break-all font-mono text-[13px] font-semibold text-[#23242A]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ paymentId }}</code>
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            class="flex-none"
            :aria-label="copied === 'payment' ? 'Copiado' : 'Copiar el número del pago'"
            @click="copy(paymentId, 'payment')"
          >{{ copied === 'payment' ? 'Copiado' : 'Copiar' }}</UButton>
        </div>
      </div>

      <div>
        <p class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">transactionId asociado</p>
        <div class="mt-1 flex items-start gap-2">
          <code
            class="break-all font-mono text-[13px] text-[#5A5B63]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ transactionId }}</code>
          <UButton
            size="xs"
            variant="outline"
            color="neutral"
            class="flex-none"
            :aria-label="copied === 'transaction' ? 'Copiado' : 'Copiar el número de la transferencia'"
            @click="copy(transactionId, 'transaction')"
          >{{ copied === 'transaction' ? 'Copiado' : 'Copiar' }}</UButton>
        </div>
      </div>

      <div v-if="correlationId">
        <SharedCorrelationIdBadge
          :correlation-id="correlationId"
          label="Código de seguimiento de origen"
        />
      </div>

      <div v-if="providerReference">
        <p class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
          Referencia del proveedor
        </p>
        <code
          class="mt-1 block break-all font-mono text-[13px] text-[#5A5B63]"
          style="font-variant-numeric: tabular-nums lining-nums"
        >{{ providerReference }}</code>
      </div>
    </div>

    <p class="mt-5 border-t border-[#E9E9EC] pt-5 text-[13px] leading-5 text-[#5A5B63]">
      El pago pertenece a una transferencia: los tres identificadores sirven para rastrear el
      flujo completo en auditoría. El que encuentra el rastro es el
      <strong class="font-semibold text-[#23242A]">correlationId de origen</strong>, no el de
      esta consulta.
    </p>
  </aside>
</template>
