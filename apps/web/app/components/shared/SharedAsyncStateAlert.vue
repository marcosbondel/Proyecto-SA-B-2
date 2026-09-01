<script setup lang="ts">
import type { AsyncState } from '../../lib/gateway-error';

/**
 * The five outcomes of an asynchronous operation, plus the wait before them —
 * and, since then, a sixth: `FORBIDDEN`, a role rejection this component draws
 * as itself rather than folded into `INTERNAL_ERROR`, because a `403` is a
 * rule working, not a system failure.
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
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  state: AsyncState;
  /**
   * Overrides the default body, e.g. with the message a service returned.
   *
   * `null` as well as `undefined`, because every screen holds its failure text
   * in a `ref<string | null>` and passing it straight through is the point.
   */
  message?: string | null;
  correlationId?: string | null;
}>();

const attrs = useAttrs();

/**
 * The retry is offered because a screen listened for it, not because a second
 * flag beside the listener says so.
 *
 * Six screens passed `@retry` to a component that declared no emit and drew no
 * button, so on the dashboard and on `Nuevo pago` a failed load left no way
 * back except reloading the browser. Reading the listener is what makes the
 * offer and the button the same fact: a screen cannot ask for a retry and
 * silently not get one.
 */
const retry = computed(() => attrs.onRetry as (() => void) | undefined);

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
      'No cierres esta pantalla para ver el resultado, o consúltalo después con el código de seguimiento.',
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
      'No asumas que falló: guarda el código de seguimiento y actualiza el estado. ' +
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
  // A 403 is a role rule working as designed, not a system failure — the
  // title has to say that rather than share INTERNAL_ERROR's "algo salió
  // mal", and the colour follows: warning (a rule that stopped you), not
  // error (something broke).
  FORBIDDEN: {
    label: 'No permitido',
    title: 'Tu rol no puede realizar esta acción',
    body: 'Esta operación está reservada a otro rol. No es una falla del sistema.',
    color: 'warning',
  },
  INTERNAL_ERROR: {
    label: 'Error',
    title: 'Ocurrió un error inesperado',
    body: 'Guarda el código de seguimiento y repórtalo si el problema persiste.',
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
      <UButton
        v-if="retry"
        class="mt-3"
        size="xs"
        variant="outline"
        color="neutral"
        data-testid="async-retry"
        @click="retry()"
      >Volver a intentar</UButton>
    </template>
  </UAlert>
</template>
