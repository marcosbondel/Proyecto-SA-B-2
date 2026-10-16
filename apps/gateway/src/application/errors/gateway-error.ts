import type { FailureCode } from '@bank/contracts';

/**
 * The seven ways a request can fail, as one closed set.
 *
 * Five of them are the failure modes the frontend has to tell apart in order to
 * say anything true to a person: whether the request was wrong, whether a
 * service said no, whether nobody answered, whether the system could not accept
 * the request at all, or whether something broke. The other two are the
 * authentication boundary, which the session layer handles and which must never
 * be confused with a business rejection.
 *
 * Deliberately **no HTTP here.** This type is what the application layer
 * throws; turning it into a status code is the interface layer's job, and
 * keeping the two apart is what stops a status-code decision from quietly
 * becoming a business decision.
 */
export type GatewayErrorType =
  /** The request does not match its declared shape. Nothing was published. */
  | 'VALIDATION_ERROR'
  /** No token, a bad signature, or an expired one. Nothing was published. */
  | 'UNAUTHENTICATED'
  /** A valid token whose role the route does not admit. Nothing was published. */
  | 'FORBIDDEN'
  /** A service considered the request and said no. It carries their code. */
  | 'BUSINESS_REJECTION'
  /** Nobody answered in time. **The operation was not cancelled.** */
  | 'REPLY_TIMEOUT'
  /** The message could not be published. Nothing happened. */
  | 'BROKER_UNAVAILABLE'
  /** Anything else. Says as little as possible. */
  | 'INTERNAL_ERROR'
  /*
   * Los tres que el **contrato interbancario oficial** exige y el resto del
   * Gateway no necesitaba (T-56). Se añaden como tipos y no como rechazos de
   * negocio porque no los decide ningún servicio: los decide el contrato, y
   * sus códigos HTTP son parte de él.
   */
  /** No hay registro de ese identificador en este banco. `404`. */
  | 'NOT_FOUND'
  /** El mismo identificador con contenido distinto. `409`. */
  | 'IDEMPOTENCY_CONFLICT'
  /** Llegó después de `expiresAt`; no se procesa. `422`. */
  | 'EXPIRED';

/**
 * The five the frontend renders as asynchronous outcomes.
 *
 * `UNAUTHENTICATED` and `FORBIDDEN` are absent on purpose: the session layer
 * intercepts them before any screen sees them, because "your session ended" and
 * "the bank refused this" are not the same news.
 */
export const ASYNC_FAILURE_TYPES = [
  'VALIDATION_ERROR',
  'BUSINESS_REJECTION',
  'REPLY_TIMEOUT',
  'BROKER_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const satisfies readonly GatewayErrorType[];

/**
 * Whether the question that timed out changes state or only reads it.
 *
 * `replyTimeout` is the only place this matters: a command left the Saga in
 * flight, so the honest thing to say is "we don't know yet, and it may still
 * land." A read started nothing — there is no operation to be uncertain
 * about, only a question nobody answered — so telling a caller their balance
 * lookup "was not cancelled" is not wrong so much as it is an answer to a
 * question they never asked.
 */
export type ReplyKind = 'command' | 'read';

export interface GatewayErrorDetails {
  /** Which field the caller got wrong. Only meaningful for a validation error. */
  readonly field?: string;
  /** The owning service's own code, passed through untouched. */
  readonly failureCode?: FailureCode;
}

/**
 * One failure, in the shape every route reports failure in.
 *
 * The message is written for a person to read. It must never carry a stack
 * trace, a connection string, a credential, a bucket name or the name of an
 * internal service — an error page is not a place to publish the topology.
 */
export class GatewayError extends Error {
  public readonly type: GatewayErrorType;
  public readonly field: string | undefined;
  public readonly failureCode: FailureCode | undefined;

  constructor(type: GatewayErrorType, message: string, details: GatewayErrorDetails = {}) {
    super(message);
    this.name = 'GatewayError';
    this.type = type;
    this.field = details.field;
    this.failureCode = details.failureCode;
  }

  static validation(message: string, field?: string): GatewayError {
    return new GatewayError('VALIDATION_ERROR', message, { field });
  }

  static unauthenticated(message = 'Credenciales inválidas o sesión no válida.'): GatewayError {
    return new GatewayError('UNAUTHENTICATED', message);
  }

  /**
   * No existe registro de ese identificador, que en el contrato interbancario
   * **es una respuesta y no un fallo**: significa «nunca lo recibí», y es lo
   * que hace al banco emisor pasar de consultar a cancelar.
   */
  static notFound(message: string, field?: string): GatewayError {
    return new GatewayError('NOT_FOUND', message, { field });
  }

  /** El mismo identificador con contenido distinto: `409` por contrato. */
  static idempotencyConflict(message: string, field?: string): GatewayError {
    return new GatewayError('IDEMPOTENCY_CONFLICT', message, { field });
  }

  /**
   * Llegó después de `expiresAt`.
   *
   * `422` y no `400`: la solicitud es sintácticamente perfecta y llegó tarde,
   * que son dos cosas distintas y el banco emisor las trata distinto — un
   * `400` le diría que su mensaje está mal construido y lo mandaría a revisar
   * su código en vez de su reloj.
   */
  static expired(message: string, field?: string): GatewayError {
    return new GatewayError('EXPIRED', message, { field });
  }

  static forbidden(message = 'Tu rol no tiene permitido realizar esta operación.'): GatewayError {
    return new GatewayError('FORBIDDEN', message);
  }

  /**
   * A service considered the request and refused it.
   *
   * The code travels through untouched: reinterpreting it would make the
   * gateway an author of the verdict instead of its courier.
   */
  static businessRejection(failureCode: FailureCode, message: string): GatewayError {
    return new GatewayError('BUSINESS_REJECTION', message, { failureCode });
  }

  /**
   * Nobody answered within the ceiling.
   *
   * The wording is load-bearing, and it forks on `kind` because a command and
   * a read are not the same kind of silence. For a command, the Saga carries
   * on, the audit record is being written, and the result is still knowable —
   * saying "it failed" would be a lie that costs money. For a read, nothing
   * was ever in flight to begin with: there is no operation to reassure
   * anyone about, only a question worth asking again.
   */
  static replyTimeout(kind: ReplyKind = 'command'): GatewayError {
    if (kind === 'read') {
      return new GatewayError(
        'REPLY_TIMEOUT',
        'No pudimos completar la consulta a tiempo. Vuelve a intentarlo: no se modificó ningún dato.',
      );
    }

    return new GatewayError(
      'REPLY_TIMEOUT',
      'No recibimos confirmación en el tiempo esperado. La operación NO fue cancelada: ' +
        'consulta su resultado con el código de seguimiento.',
    );
  }

  static brokerUnavailable(): GatewayError {
    return new GatewayError(
      'BROKER_UNAVAILABLE',
      'El sistema no pudo aceptar la solicitud en este momento. No se realizó ningún cambio; ' +
        'puedes intentarlo de nuevo.',
    );
  }

  static internal(message = 'Ocurrió un error inesperado.'): GatewayError {
    return new GatewayError('INTERNAL_ERROR', message);
  }
}

export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}
