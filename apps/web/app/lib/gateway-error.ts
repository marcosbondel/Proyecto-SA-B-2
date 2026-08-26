/**
 * The seven ways the Gateway reports failure.
 *
 * Five of them describe an asynchronous outcome and are rendered by
 * `SharedAsyncStateAlert`. The other two are the session boundary: they are
 * intercepted before any screen sees them, because "your session ended" and
 * "the bank refused this" are not the same news and must not look alike.
 */
export type GatewayErrorType =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'BUSINESS_REJECTION'
  | 'REPLY_TIMEOUT'
  | 'BROKER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** The five a screen may have to draw, plus the state before any of them. */
export type AsyncState =
  | 'PENDING'
  | 'SUCCESS'
  | 'BUSINESS_REJECTION'
  | 'REPLY_TIMEOUT'
  | 'BROKER_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

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

/** The state `SharedAsyncStateAlert` should draw for this failure. */
export function asyncStateFor(error: GatewayError): AsyncState {
  return error.type === 'UNAUTHENTICATED' || error.type === 'FORBIDDEN'
    ? 'INTERNAL_ERROR'
    : error.type;
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
