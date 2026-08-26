import { asyncStateFor } from '../lib/gateway-error';
import type { AsyncState } from '../lib/gateway-error';
import { outcomeFromAudit } from '../lib/customer';
import type { GatewayResult } from './useGatewayApi';

/** How often the audit trail is asked, and for how long. */
const POLL_INTERVAL_MS = 1_500;
const POLL_CEILING_MS = 20_000;

/** What a command answers with while it is still only accepted. */
export interface AcceptedCommand {
  readonly correlationId: string;
  readonly customerId?: string;
}

/**
 * The distance between `202 Accepted` and knowing what happened.
 *
 * Every screen in this module sends a command and is told `202`, which means
 * *received*, not *done*. Criterion 8 of the ticket is explicit that the
 * interface must never present that as a completed registration, so the state
 * this composable starts in after a successful send is `PENDING` — never
 * `SUCCESS`.
 *
 * **Only an administrator can be told more.** `GET /api/audit` is the one route
 * decision D-06 restricts by role, and self-service registration happens with
 * no session at all. So the trail is polled when the session allows it and left
 * alone when it does not: asking anyway would produce a `403` that reads like
 * the bank refusing the registration. Everyone else gets the honest version —
 * the command is in the system, the activation email is the next signal — which
 * is exactly what the Claude Design prototype shows in `show.regSent`.
 *
 * A timeout is **not** a failure. Retrying reuses the same idempotency key, so
 * the receiving service recognises the second attempt as the same intention.
 */
export function useCustomerOutcome() {
  const api = useGatewayApi();
  const { role } = useSession();

  const state = ref<'IDLE' | AsyncState>('IDLE');
  const message = ref<string | undefined>(undefined);
  const correlationId = ref<string | null>(null);
  const accepted = ref<AcceptedCommand | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Whether this session is allowed to learn how the command ended. */
  const canWatch = computed(() => role.value === 'ADMINISTRADOR');

  const pending = computed(() => state.value === 'PENDING');

  const isSending = ref(false);

  /**
   * Sends the command and takes over from there.
   *
   * The caller supplies the request rather than its parameters, because the
   * three commands of this module differ in shape — a `multipart` body, a
   * partial `PATCH` — and pushing that difference in here would make one
   * function pretend to be three.
   */
  async function run(send: () => Promise<GatewayResult<AcceptedCommand>>): Promise<void> {
    // A second click while the first request is in flight is not a retry, it is
    // a duplicate. The button is disabled too; this is the guarantee.
    if (isSending.value) {
      return;
    }

    stopWatching();
    isSending.value = true;
    state.value = 'PENDING';
    message.value = undefined;

    const result = await send();

    isSending.value = false;

    if (!result.ok) {
      state.value = asyncStateFor(result.error);
      correlationId.value = result.error.correlationId;
      message.value = result.error.message;
      return;
    }

    accepted.value = result.data;
    correlationId.value = result.data.correlationId;

    if (canWatch.value && correlationId.value !== null) {
      watchTrail(correlationId.value, Date.now());
    }
  }

  /**
   * Asks the audit trail, again, until it answers or the ceiling is reached.
   *
   * `setTimeout` after each reply rather than `setInterval`: a slow answer must
   * not queue a second question behind it, which is how a five-second reply
   * ceiling turns into a queue of overlapping requests.
   */
  function watchTrail(correlation: string, startedAt: number): void {
    timer = setTimeout(async () => {
      const result = await api.auditFor(correlation);

      if (!result.ok) {
        /**
         * A refusal here says nothing about the command. The registration may
         * well have succeeded, so the state stays `PENDING` and the watching
         * simply stops.
         */
        stopWatching();
        return;
      }

      const events = (result.data.events ?? []) as { messageType: string }[];
      const outcome = outcomeFromAudit(events);

      if (outcome === 'SUCCESS') {
        state.value = 'SUCCESS';
        stopWatching();
        return;
      }

      if (outcome === 'BUSINESS_REJECTION') {
        state.value = 'BUSINESS_REJECTION';
        // The trail carries metadata, not payloads, so there is no reason text
        // to show. Saying so beats inventing one.
        message.value =
          'Un servicio rechazó la solicitud. Consulta el rastro de auditoría con el ' +
          'identificador de correlación para ver el detalle.';
        stopWatching();
        return;
      }

      if (Date.now() - startedAt >= POLL_CEILING_MS) {
        state.value = 'REPLY_TIMEOUT';
        stopWatching();
        return;
      }

      watchTrail(correlation, startedAt);
    }, POLL_INTERVAL_MS);
  }

  function stopWatching(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** After a success, when the next attempt is genuinely a new intention. */
  function reset(): void {
    stopWatching();
    state.value = 'IDLE';
    message.value = undefined;
    correlationId.value = null;
    accepted.value = null;
  }

  // A screen closed mid-wait must not keep questioning the Gateway.
  onScopeDispose(stopWatching);

  return { state, message, correlationId, accepted, pending, isSending, canWatch, run, reset };
}
