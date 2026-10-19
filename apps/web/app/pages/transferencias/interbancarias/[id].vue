<script setup lang="ts">
import { isUuidV4 } from '../../../lib/account';
import { mayQueryAudit } from '../../../lib/audit';
import { asyncStateFor } from '../../../lib/gateway-error';
import type { AsyncState } from '../../../lib/gateway-error';
import {
  INTERBANK_REVERSAL_PRESENTATION,
  INTERBANK_STATE_PRESENTATION,
  explainInterbankReason,
  interbankPollDelay,
  isSettled,
  meaningOfMissingSend,
  reasonTitleFor,
  sagaTransferFor,
} from '../../../lib/interbank-deposit';
import type { InterbankHistoryEntry, InterbankSendView } from '../../../lib/interbank-deposit';
import { formatDate, formatQuetzales } from '../../../lib/money';

/**
 * Un depósito al banco pareja, seguido hasta que deja de moverse (T-60, B10 /
 * TD-090).
 *
 * Es el sucesor, para este caso, de `/transferencias/[id]`: esa pantalla cuenta
 * la Saga y no tiene los seis estados que el otro banco da al depósito. Esta
 * los dibuja, y deja la Saga a un enlace de distancia porque sigue siendo la que
 * cuenta el movimiento del dinero (débito, devolución).
 *
 * Cuatro situaciones, igual que en la Saga, y cada una por una razón:
 *
 * - **Todavía no está escrito.** El `202` sale antes de que Payment tenga la
 *   fila: la Saga primero verifica y debita. Reportar «no existe» un segundo
 *   después de enviar le diría a alguien que su depósito se esfumó, así que
 *   durante veinte segundos se lee «lo estamos registrando» y se sigue
 *   preguntando.
 * - **En curso.** Se pregunta cada dos segundos el primer minuto y cada cinco
 *   después, mientras el estado pueda cambiar (`interbankPollDelay`).
 * - **Terminado.** Se deja de preguntar. `REJECTED` no cuenta como terminado:
 *   todavía falta el `REVERSED` que dice que el dinero volvió.
 * - **Rendida.** A los diez minutos se deja de preguntar y se dice, con un
 *   botón. Un `TIMEOUT` se resuelve en ocho como máximo; si pasó eso, otra
 *   consulta no lo va a arreglar.
 *
 * Un depósito que no aparece después de la gracia no siempre es un error: la
 * verificación o el débito pueden haber cerrado la transferencia antes de que
 * llegara al otro banco. Por eso, si se sabe cuál es la transferencia, se
 * ofrece ir a ella: es la que explica por qué no hubo depósito.
 */
const route = useRoute();
const api = useGatewayApi();
const { role } = useSession();

const interbankTransferId = computed(() => String(route.params.id ?? ''));
const malformed = computed(() => !isUuidV4(interbankTransferId.value));

const send = ref<InterbankSendView | null>(null);
const history = ref<readonly InterbankHistoryEntry[]>([]);
const state = ref<'LOADING' | 'READY' | 'STARTING' | 'MISSING' | 'GAVE_UP' | AsyncState>('LOADING');
const message = ref<string | undefined>(undefined);
const correlationId = ref<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;
/** Sólo la respuesta de la última pregunta cuenta, como en el listado. */
let latest = 0;

const presentation = computed(() =>
  send.value === null ? null : INTERBANK_STATE_PRESENTATION[send.value.state],
);

const reasonText = computed(() => explainInterbankReason(send.value?.reason ?? null));
const reasonTitle = computed(() => (send.value === null ? '' : reasonTitleFor(send.value.state)));
/** Un `TIMEOUT` sin motivo escrito sigue necesitando explicar por qué se espera. */
const showReason = computed(
  () => send.value !== null && reasonText.value !== null && send.value.state !== 'ACCEPTED',
);

const live = computed(() => send.value !== null && !isSettled(send.value.state));

/** La transferencia (Saga) de este depósito, o la que trajo la dirección. */
const sagaTransferId = computed(() => sagaTransferFor(send.value, route.query.transferencia));

const mayAudit = computed(() => mayQueryAudit(role.value));

const STATE_TEXT: Record<'success' | 'warning' | 'error' | 'neutral', string> = {
  success: 'text-[#186A32]',
  warning: 'text-[#7A4F06]',
  error: 'text-[#B01B1B]',
  neutral: 'text-[#23242A]',
};

const REVERSAL_EXPLANATION =
  'El otro banco acreditó el depósito después de que aquí ya se había devuelto el dinero. Para que nadie lo reciba dos veces, este banco le pidió que lo revierta.';

async function load(): Promise<void> {
  if (malformed.value) {
    return;
  }

  const mine = ++latest;
  const result = await api.call<{
    send: InterbankSendView;
    history: InterbankHistoryEntry[];
    correlationId: string;
  }>(`/api/interbank/transfers/${interbankTransferId.value}`);

  if (mine !== latest) {
    return;
  }

  if (result.ok) {
    send.value = result.data.send;
    history.value = result.data.history;
    correlationId.value = result.data.send.correlationId;
    message.value = undefined;
    state.value = 'READY';
    schedule();

    return;
  }

  correlationId.value = result.error.correlationId ?? correlationId.value;

  /**
   * Para el Gateway, «no existe» y «no es tuyo» son la misma respuesta, y los
   * primeros segundos tras enviar también lo son. Sólo pasada la gracia, y
   * sólo si nunca se vio el depósito, deja de ser «lo estamos registrando».
   */
  if (result.error.type === 'NOT_FOUND' && send.value === null) {
    if (meaningOfMissingSend(Date.now() - startedAt) === 'STILL_STARTING') {
      state.value = 'STARTING';
      timer = setTimeout(() => void load(), 2_000);

      return;
    }

    state.value = 'MISSING';
    message.value = result.error.message;

    return;
  }

  state.value = asyncStateFor(result.error);
  message.value = result.error.message;
}

/**
 * `setTimeout` tras cada respuesta y no `setInterval`: una respuesta lenta no
 * debe encolar una segunda pregunta detrás, que es como un techo de cinco
 * segundos de espera se vuelve una cola de peticiones.
 */
function schedule(): void {
  stop();

  if (send.value === null) {
    return;
  }

  const delay = interbankPollDelay(send.value.state, Date.now() - startedAt);

  if (delay === null) {
    if (!isSettled(send.value.state)) {
      state.value = 'GAVE_UP';
    }

    return;
  }

  timer = setTimeout(() => void load(), delay);
}

function stop(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Preguntar otra vez es gratis: una consulta no cambia nada, así que no necesita clave. */
async function refresh(): Promise<void> {
  stop();
  startedAt = Date.now();
  state.value = send.value === null ? 'LOADING' : 'READY';
  message.value = undefined;
  await load();
}

onMounted(async () => {
  if (malformed.value) {
    state.value = 'VALIDATION_ERROR';

    return;
  }

  startedAt = Date.now();
  await load();
});

// Una pantalla cerrada a media espera no debe seguir preguntándole al Gateway.
onScopeDispose(stop);

useHead({ title: 'Depósito a otro banco · bonking' });
</script>

<template>
  <section class="mx-auto flex w-full max-w-[760px] flex-col gap-4">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">Depósito a otro banco</h1>
        <p
          class="mt-1 break-all font-mono text-[13px] text-[#5A5B63]"
          style="font-variant-numeric: tabular-nums lining-nums"
          data-testid="interbank-id"
        >{{ send?.interbankTransferId ?? interbankTransferId }}</p>
      </div>
      <UButton to="/transferencias/interbancarias" variant="outline" color="neutral">
        Ver todos los depósitos
      </UButton>
    </header>

    <SharedAsyncStateAlert
      v-if="malformed"
      state="VALIDATION_ERROR"
      message="Ese número no tiene el formato correcto, así que no se envió ninguna consulta. Abre el depósito desde la lista o desde el enlace que te dio el envío."
    />

    <template v-else>
      <!-- Aceptado, todavía sin escribir. No es un error, y tampoco un éxito. -->
      <SharedAsyncStateAlert
        v-if="state === 'STARTING'"
        state="PENDING"
        message="El sistema aceptó el depósito y lo está registrando. Esta pantalla se actualiza sola."
        :correlation-id="correlationId"
      />

      <div v-else-if="state === 'LOADING'" class="flex flex-col gap-4" data-testid="interbank-detail-loading">
        <USkeleton class="h-56 w-full rounded-2xl" />
        <USkeleton class="h-40 w-full rounded-2xl" />
      </div>

      <!-- Pasó la gracia y nunca apareció: o no existe, o no es tuyo, o se cerró antes de salir. -->
      <div v-else-if="state === 'MISSING'" class="flex flex-col items-start gap-3" data-testid="interbank-missing">
        <UAlert
          class="w-full"
          color="warning"
          variant="subtle"
          title="No encontramos este depósito"
        >
          <template #description>
            <p class="text-[14px] leading-[22px]">
              No existe un depósito a otro banco con este número, o no es tuyo.
              <template v-if="sagaTransferId">
                Si acabas de enviarlo, puede que la transferencia se haya cerrado antes de llegar
                al otro banco, por ejemplo por una verificación pendiente o por saldo insuficiente.
                La transferencia dice qué pasó.
              </template>
            </p>
            <SharedCorrelationIdBadge v-if="correlationId" class="mt-3" :correlation-id="correlationId" />
          </template>
        </UAlert>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="sagaTransferId"
            :to="`/transferencias/${sagaTransferId}`"
            color="primary"
            data-testid="interbank-saga-link"
          >Ver la transferencia</UButton>
          <UButton variant="outline" color="neutral" @click="refresh">Consultar de nuevo</UButton>
        </div>
      </div>

      <template v-if="send && presentation">
        <!-- El estado primero y grande: es lo único que alguien viene a ver. -->
        <div
          class="rounded-2xl border border-[#DCDCE0] bg-white p-6"
          data-testid="interbank-state"
          :data-state="send.state"
        >
          <p class="text-[12px] uppercase tracking-[0.06em] text-[#75767F]">Estado del depósito</p>
          <p
            class="mt-1 text-[32px] font-bold leading-10 tracking-tight"
            :class="STATE_TEXT[presentation.color]"
            data-testid="interbank-state-label"
          >{{ presentation.label }}</p>
          <p class="mt-2 max-w-[60ch] text-[14px] leading-[22px] text-[#5A5B63]">
            {{ presentation.explanation }}
          </p>
          <p
            v-if="live && state === 'READY'"
            class="mt-3 flex items-center gap-2 text-[13px] text-[#5A5B63]"
            role="status"
            data-testid="interbank-live"
          >
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-[#17191F]" aria-hidden="true" />
            Esta pantalla se actualiza sola.
          </p>

          <p class="mt-6 text-[12px] uppercase tracking-[0.06em] text-[#75767F]">Monto</p>
          <p
            class="mt-1 text-[32px] font-bold leading-10"
            style="font-variant-numeric: tabular-nums lining-nums"
            data-testid="interbank-amount"
          >{{ formatQuetzales(send.amount.amountMinor) }}</p>

          <dl class="mt-4 flex flex-col">
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">Banco de destino</dt>
              <dd class="tab text-[13px] font-medium" data-testid="interbank-bank">{{ send.destinationBankCode }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">Cuenta de destino</dt>
              <dd
                class="break-all font-mono text-[13px] font-medium"
                style="font-variant-numeric: tabular-nums lining-nums"
                data-testid="interbank-account"
              >{{ send.destinationAccount }}</dd>
            </div>
            <div
              v-if="send.originAccount"
              class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5"
            >
              <dt class="text-[13px] text-[#75767F]">Cuenta de origen</dt>
              <dd
                class="break-all font-mono text-[13px] font-medium"
                style="font-variant-numeric: tabular-nums lining-nums"
              >{{ send.originAccount }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">Solicitado</dt>
              <dd class="tab text-[13px]">{{ formatDate(send.createdAt) }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">Entregado al otro banco</dt>
              <dd class="tab text-[13px]">
                {{ send.sentAt ? formatDate(send.sentAt) : 'Todavía no' }}
              </dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5">
              <dt class="text-[13px] text-[#75767F]">El otro banco debía confirmar antes de</dt>
              <dd class="tab text-[13px]">{{ formatDate(send.expiresAt) }}</dd>
            </div>
            <div
              v-if="send.decidedAt"
              class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5"
            >
              <dt class="text-[13px] text-[#75767F]">Respuesta del otro banco</dt>
              <dd class="tab text-[13px]">{{ formatDate(send.decidedAt) }}</dd>
            </div>
            <div
              v-if="send.reversedAt"
              class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5"
            >
              <dt class="text-[13px] text-[#75767F]">El dinero volvió a la cuenta de origen</dt>
              <dd class="tab text-[13px]" data-testid="interbank-reversed-at">{{ formatDate(send.reversedAt) }}</dd>
            </div>
            <div
              v-if="send.attempts > 1"
              class="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#E9E9EC] py-2.5"
            >
              <dt class="text-[13px] text-[#75767F]">Intentos de entrega</dt>
              <dd class="tab text-[13px]">{{ send.attempts }}</dd>
            </div>
          </dl>
        </div>

        <UAlert
          v-if="showReason"
          :color="send.state === 'TIMEOUT' ? 'warning' : 'error'"
          variant="subtle"
          :title="reasonTitle"
          data-testid="interbank-reason"
        >
          <template #description>
            <p class="text-[14px] leading-[22px]">{{ reasonText }}</p>
          </template>
        </UAlert>

        <!-- La rama que el contrato manda alertar: el dinero volvió sin que el otro banco lo confirmara. -->
        <UAlert
          v-if="send.releasedUnverified"
          color="warning"
          variant="subtle"
          title="El dinero volvió sin confirmación del otro banco"
          data-testid="interbank-unverified"
        >
          <template #description>
            <p class="text-[14px] leading-[22px]">
              Si más tarde resulta que el otro banco sí acreditó el depósito, este banco le pedirá
              que lo revierta para que nadie lo reciba dos veces. No tienes que hacer nada.
            </p>
          </template>
        </UAlert>

        <div
          v-if="send.reversal"
          class="rounded-2xl border border-[#DCDCE0] bg-white p-6"
          data-testid="interbank-reversal"
          :data-reversal-state="send.reversal.state"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-[20px] font-semibold leading-7">Reverso pedido al otro banco</h2>
            <UBadge
              :color="INTERBANK_REVERSAL_PRESENTATION[send.reversal.state].color"
              variant="subtle"
              class="rounded-full px-2.5 py-1 text-[12px] font-semibold"
            >{{ INTERBANK_REVERSAL_PRESENTATION[send.reversal.state].label }}</UBadge>
          </div>
          <p class="mt-2 max-w-[60ch] text-[14px] leading-[22px] text-[#5A5B63]">
            {{ REVERSAL_EXPLANATION }}
          </p>
          <p
            class="mt-3 break-all font-mono text-[12px] text-[#75767F]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ send.reversal.reversalId }}</p>
        </div>

        <TransactionInterbankHistory :history="history" />
      </template>

      <!-- Diez minutos sin final. Honesto sobre no saber. -->
      <div v-if="state === 'GAVE_UP'" class="flex flex-col items-start gap-3" data-testid="interbank-gave-up">
        <SharedAsyncStateAlert
          class="w-full"
          state="REPLY_TIMEOUT"
          message="Dejamos de consultar tras diez minutos. El depósito sigue en el sistema: no asumas que falló ni lo repitas. Vuelve a consultar cuando quieras."
          :correlation-id="correlationId"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Consultar de nuevo</UButton>
      </div>

      <div
        v-else-if="!['READY', 'LOADING', 'STARTING', 'MISSING'].includes(state)"
        class="flex flex-col items-start gap-3"
      >
        <SharedAsyncStateAlert
          class="w-full"
          :state="state as AsyncState"
          :message="message"
          :correlation-id="correlationId"
        />
        <UButton variant="outline" color="neutral" @click="refresh">Reintentar la consulta</UButton>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          v-if="live && state === 'READY'"
          variant="ghost"
          color="neutral"
          @click="refresh"
        >Actualizar ahora</UButton>
        <UButton
          v-if="send && sagaTransferId"
          :to="`/transferencias/${sagaTransferId}`"
          variant="outline"
          color="neutral"
          data-testid="interbank-saga-link"
        >Ver la transferencia</UButton>
        <UButton
          v-if="mayAudit && send"
          :to="`/auditoria?correlationId=${send.correlationId}`"
          variant="outline"
          color="neutral"
          data-testid="interbank-audit-link"
        >Ver auditoría</UButton>
        <UButton to="/cuentas" variant="ghost" color="neutral">Ver mis cuentas</UButton>
      </div>

      <!--
        Criterio 9: el código de seguimiento, siempre a la vista. El traceId es el
        del depósito, no el que esta sesión anotó: un depósito abierto desde la
        lista nunca se pidió en esta sesión.
      -->
      <SharedCorrelationIdBadge
        v-if="send"
        :correlation-id="send.correlationId"
        :trace-id="send.traceId"
        label="Código de seguimiento del depósito"
      />
    </template>
  </section>
</template>
