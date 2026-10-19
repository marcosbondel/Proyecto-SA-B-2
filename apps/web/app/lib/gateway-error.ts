/**
 * The seven ways the Gateway reports failure.
 *
 * Five of them describe an asynchronous outcome and are rendered by
 * `SharedAsyncStateAlert`. The other two are the session boundary: they are
 * intercepted before any screen sees them, because "your session ended" and
 * "the bank refused this" are not the same news and must not look alike.
 *
 * `NOT_FOUND` is an eighth, added by T-60: the interbank-contract routes answer
 * a missing (or somebody else's) deposit with it. Left unknown it folded into
 * `INTERNAL_ERROR`, which titled "that deposit does not exist" as "an
 * unexpected error occurred" — and gave the screen no way to tell the two apart.
 */
export type GatewayErrorType =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'BUSINESS_REJECTION'
  | 'NOT_FOUND'
  | 'REPLY_TIMEOUT'
  | 'BROKER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** The six a screen may have to draw, plus the state before any of them. */
export type AsyncState =
  | 'PENDING'
  | 'SUCCESS'
  | 'BUSINESS_REJECTION'
  | 'REPLY_TIMEOUT'
  | 'BROKER_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

/**
 * What a screen that fetches on mount can be showing.
 *
 * `LOADING` is during the request, `READY` is with data on the screen, and the
 * rest are the failures `SharedAsyncStateAlert` draws. It is one named type
 * because six screens spelled this union by hand as `AsyncState` and then
 * assigned `'LOADING'` to it — a value the union never held, which nothing
 * caught because this package had no `typecheck`.
 */
export type LoadState = 'LOADING' | 'READY' | AsyncState;

/**
 * `LoadState` plus the state before anything was asked for.
 *
 * Only for state that waits to be requested rather than fetching on mount —
 * the shared inbox, a command's outcome. A screen that loads in `onMounted`
 * starts at `LOADING` and should use `LoadState`, so that `IDLE` cannot reach
 * an alert that has no entry for it.
 */
export type ScreenState = 'IDLE' | LoadState;

export interface GatewayError {
  readonly type: GatewayErrorType;
  readonly message: string;
  readonly correlationId: string | null;
  readonly failureCode: string | null;
  readonly field: string | null;
}

const KNOWN_TYPES = new Set<GatewayErrorType>([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BUSINESS_REJECTION',
  'NOT_FOUND',
  'REPLY_TIMEOUT',
  'BROKER_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

const FALLBACK_MESSAGE = 'Ocurrió un error inesperado. Intenta de nuevo.';

/**
 * Turns anything a failed request produced into one predictable shape.
 *
 * Three cases arrive here and only one of them is the Gateway's error contract:
 * a proper error body, a response that is not one (a proxy's HTML page, say),
 * and a network failure where there is no response at all. All three become a
 * `GatewayError`, because a screen that has to tell them apart will eventually
 * get it wrong and show a stack trace to a customer.
 *
 * An unrecognised `type` becomes `INTERNAL_ERROR` rather than being passed
 * through. A frontend that breaks on a code it does not know is worse than one
 * that says "something failed" — and the Gateway may well gain a type before
 * this module is next touched.
 */
export function normaliseError(error: unknown): GatewayError {
  const body = bodyOf(error);

  if (body === null) {
    // No response at all: the Gateway was unreachable, which from here is
    // indistinguishable from the broker being down, and has the same advice.
    return {
      type: 'BROKER_UNAVAILABLE',
      message: 'No pudimos comunicarnos con el sistema. No se realizó ningún cambio.',
      correlationId: null,
      failureCode: null,
      field: null,
    };
  }

  const type = KNOWN_TYPES.has(body.type as GatewayErrorType)
    ? (body.type as GatewayErrorType)
    : 'INTERNAL_ERROR';

  return {
    type,
    message: typeof body.message === 'string' && body.message.length > 0
      ? body.message
      : FALLBACK_MESSAGE,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : null,
    failureCode: typeof body.failureCode === 'string' ? body.failureCode : null,
    field: typeof body.field === 'string' ? body.field : null,
  };
}

/** Whether this failure means the session is over rather than the request. */
export function isSessionFailure(error: GatewayError): boolean {
  return error.type === 'UNAUTHENTICATED';
}

/**
 * The state `SharedAsyncStateAlert` should draw for this failure.
 *
 * `UNAUTHENTICATED` alone folds into `INTERNAL_ERROR`: it is the session
 * boundary, intercepted by `useGatewayApi` before a screen ever sees it, so a
 * screen that reaches this function with that type has nothing more specific
 * to say. `FORBIDDEN` is not that — it is a role rule the system enforced
 * correctly, and folding it into "an unexpected error occurred" would title a
 * `403` as though the system had broken. It draws its own state instead.
 */
export function asyncStateFor(error: GatewayError): AsyncState {
  if (error.type === 'UNAUTHENTICATED') {
    return 'INTERNAL_ERROR';
  }

  if (error.type === 'FORBIDDEN') {
    return 'FORBIDDEN';
  }

  // A thing that is not there is the Gateway's own sentence about it, which is a
  // refusal in the alert's vocabulary — not a malfunction.
  if (error.type === 'NOT_FOUND') {
    return 'BUSINESS_REJECTION';
  }

  return error.type;
}

function bodyOf(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  // `$fetch` puts the parsed body on `data`; a plain object is the body itself.
  const candidate = 'data' in error ? (error as { data: unknown }).data : error;

  if (typeof candidate !== 'object' || candidate === null || !('type' in candidate)) {
    return null;
  }

  return candidate as Record<string, unknown>;
}
