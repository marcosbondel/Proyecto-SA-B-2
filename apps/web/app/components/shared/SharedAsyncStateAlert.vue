<script setup lang="ts">
import type { AsyncState } from '../../lib/gateway-error';

/**
 * The five outcomes of an asynchronous operation, plus the wait before them.
 *
 * The copy for pending, success, business rejection and timeout is ported from
 * the Claude Design prototype (`bonking.dc.html`), which wrote it for a person
 * rather than for a log. **Broker unavailable has no prototype entry** — the
 * design defines four states and FR-027 requires five — so it is composed in
 * the same idiom, in the amber family the timeout uses, and recorded as an
 * intentional addition in the ticket's evidence.
 *
 * The distinction that matters most is between the last two. A timeout means
 * the operation is still running and retrying may duplicate intent; an
 * unavailable broker means nothing happened at all and retrying is free. A
 * component that blurred them would cost somebody a duplicated transfer.
 */
const props = defineProps<{
  state: AsyncState | 'PENDING' | 'SUCCESS';
  /** Overrides the default body, e.g. with the message a service returned. */
  message?: string;
  correlationId?: string | null;
}>();

interface Presentation {
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly color: 'neutral' | 'success' | 'warning' | 'error';
}

const PRESENTATION: Record<string, Presentation> = {
  PENDING: {
    label: 'En proceso',
    title: 'Solicitud aceptada, aún no completada',
    body:
      'El sistema recibió tu solicitud y la está procesando de forma asíncrona. ' +
      'No cierres esta pantalla para ver el resultado, o consúltalo después con el identificador de correlación.',
    color: 'warning',
  },
  SUCCESS: {
    label: 'Completada',
    title: 'Operación completada',
    body: 'El sistema confirmó el resultado de la operación.',
    color: 'success',
  },
  BUSINESS_REJECTION: {
    label: 'Rechazada',
    title: 'La operación fue rechazada',
    body: 'Un servicio del sistema no pudo completar la operación con los datos enviados.',
    color: 'error',
  },
  REPLY_TIMEOUT: {
    label: 'Sin confirmación',
    title: 'No pudimos confirmar el resultado',
    body:
      'La operación sigue en el sistema pero no recibimos confirmación en el tiempo esperado. ' +
      'No asumas que falló: guarda el identificador de correlación y actualiza el estado. ' +
      'Reintentar es seguro, la operación es idempotente y no se duplica.',
    color: 'warning',
  },
  BROKER_UNAVAILABLE: {
    label: 'No disponible',
    title: 'El sistema no pudo aceptar la solicitud',
    body:
      'No se realizó ningún cambio: la solicitud nunca llegó a procesarse. ' +
      'Puedes intentarlo de nuevo en unos momentos, sin riesgo de duplicar nada.',
    color: 'warning',
  },
  VALIDATION_ERROR: {
    label: 'Datos inválidos',
    title: 'Revisa los datos enviados',
    body: 'La solicitud no cumple el formato esperado y no se envió al sistema.',
    color: 'error',
  },
  INTERNAL_ERROR: {
    label: 'Error',
    title: 'Ocurrió un error inesperado',
    body: 'Guarda el identificador de correlación y repórtalo si el problema persiste.',
    color: 'error',
  },
};

const presentation = computed(
  () => PRESENTATION[props.state] ?? PRESENTATION.INTERNAL_ERROR!,
);
</script>

<template>
  <UAlert
    :color="presentation.color"
    variant="subtle"
    :title="presentation.title"
    :data-state="state"
  >
    <template #description>
      <p class="text-[14px] leading-[22px]">{{ message ?? presentation.body }}</p>
      <SharedCorrelationIdBadge
        v-if="correlationId"
        class="mt-3"
        :correlation-id="correlationId"
      />
    </template>
  </UAlert>
</template>
