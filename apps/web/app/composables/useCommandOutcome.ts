import { asyncStateFor } from '../lib/gateway-error';
import type { AsyncState } from '../lib/gateway-error';
import type { AuditEvent, CommandOutcome } from '../lib/customer';
import type { GatewayResult } from './useGatewayApi';

/** How often the audit trail is asked, and for how long. */
const POLL_INTERVAL_MS = 1_500;
const POLL_CEILING_MS = 20_000;

/** What a command answers with while it is still only accepted. */
export interface AcceptedCommand {
  readonly correlationId: string;
  readonly customerId?: string;
  readonly accountId?: string;
}

/** Reads a verdict out of the audit trail, or `null` to keep waiting. */
export type AuditVerdict = (events: readonly AuditEvent[]) => CommandOutcome | null;

/** Reads *why* a rejection happened, or `null` when there is nothing module-specific to say. */
export type RejectionExplainer = (events: readonly AuditEvent[]) => string | null;

/**
 * The distance between `202 Accepted` and knowing what happened.
 *
 * Every command screen in this application sends something and is told `202`,
 * which means *received*, not *done*. Both T-16 and T-17 are explicit that the
 * interface must never present that as a completed operation, so the state this
 * starts in after a successful send is `PENDING` — never `SUCCESS`.
 *
 * **Only an administrator can be told more.** `GET /api/audit` is the one route
 * decision D-06 restricts by role, and self-service registration happens with
 * no session at all. So the trail is polled when the session allows it and left
 * alone when it does not: asking anyway would produce a `403` that reads like
 * the bank refusing the operation. Everyone else gets the honest version — the
 * command is in the system, and here is the correlation to ask with.
 *
 * A timeout is **not** a failure. Retrying reuses the same idempotency key, so
 * the receiving service recognises the second attempt as the same intention.
 *
 * The only thing that differs between modules is *which message names mean
 * success*, so that is the parameter. Everything else — the polling cadence,
 * the ceiling, the role check, the cleanup — is identical, and was duplicated
 * once before this was extracted.
 *
 * `explainRejection` is the one other thing a module may supply: what a
 * `BUSINESS_REJECTION` was actually *about*, read from the same trail. Most
 * callers have nothing more specific to say than the trail's bare presence, so
 * it is optional and the fallback below covers them.
 */
export function useCommandOutcome(verdict: AuditVerdict, explainRejection?: RejectionExplainer) {
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
   * commands of these modules differ in shape — a `multipart` body, a partial
   * `PATCH`, a plain `POST` — and pushing that difference in here would make
   * one function pretend to be four.
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
         * A refusal here says nothing about the command. It may well have
         * succeeded, so the state stays `PENDING` and the watching simply
         * stops.
         */
        stopWatching();
        return;
      }

      const events = (result.data.events ?? []) as AuditEvent[];
      const outcome = verdict(events);

      if (outcome === 'SUCCESS') {
        state.value = 'SUCCESS';
        stopWatching();
        return;
      }

      if (outcome === 'BUSINESS_REJECTION') {
        state.value = 'BUSINESS_REJECTION';
        /**
         * `explainRejection` reads the reason when the module has one to give
         * (e.g. a duplicated email in Clientes). When it does not — or the
         * trail did not carry one — the fallback below still must not send a
         * `CLIENTE` toward a route only `ADMINISTRADOR` may open: this branch
         * only runs once `canWatch` is already `true` (`run` gates
         * `watchTrail` on it), but the advice has to stay correct even if that
         * ever stops being the only session that reaches here.
         */
        message.value =
          explainRejection?.(events) ??
          (canWatch.value
            ? 'Un servicio rechazó la solicitud. Consulta el rastro de auditoría con el ' +
              'código de seguimiento para ver el detalle.'
            : 'Un servicio rechazó la solicitud. Guarda el código de seguimiento y repórtalo ' +
              'si necesitas más detalle.');
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
