import type { ArgumentsHost, ExceptionFilter} from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

import type { GatewayRequest } from '../http-request';

import { CORRELATION_HEADER } from '../../application/correlation';
import { statusFor } from '../../application/errors/failure-code-table';
import { GatewayError, isGatewayError } from '../../application/errors/gateway-error';

/** The one shape every failure of this API arrives in. */
export interface GatewayErrorBody {
  readonly type: string;
  readonly message: string;
  readonly correlationId: string;
  readonly failureCode?: string;
  readonly field?: string;
}

/**
 * Turns any failure into the documented error contract.
 *
 * Two things it guarantees, and both are asserted by tests rather than trusted:
 *
 * **A `correlationId` on every response, errors included.** An error is exactly
 * when a caller most needs the identifier that lets them ask the audit record
 * what actually happened. Omitting it there is how a system becomes
 * undiagnosable precisely when it breaks.
 *
 * **Nothing about the inside gets out.** No stack trace, no connection string,
 * no bucket name, no internal service name — in any environment, not just
 * production. A debug flag that widens this would be a switch someone
 * eventually flips on the machine that matters.
 */
@Catch()
export class GatewayExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger('gateway');

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<GatewayRequest>();
    const response = context.getResponse<Response>();

    const correlationId = correlationOf(request);
    const error = this.#normalise(exception, correlationId);

    /**
     * Nest's own exceptions keep their own status.
     *
     * Deriving it from the type instead would flatten every 4xx it raises into
     * `400`, so an unroutable path — a genuine `404` — would be reported as a
     * malformed request. The type says what kind of failure it is; the status
     * Nest chose says what happened.
     */
    const status =
      exception instanceof HttpException && !isGatewayError(exception)
        ? exception.getStatus()
        : statusFor(error.type, error.failureCode);

    const body: GatewayErrorBody = {
      type: error.type,
      message: error.message,
      correlationId,
      ...(error.failureCode === undefined ? {} : { failureCode: error.failureCode }),
      ...(error.field === undefined ? {} : { field: error.field }),
    };

    response.setHeader('X-Correlation-Id', correlationId);
    response.status(status).json(body);
  }

  /**
   * Anything that is not already a `GatewayError` becomes an internal error
   * with a generic message, and the real cause goes to the correlated log.
   *
   * That split is the point: the operator gets the detail, the caller gets the
   * fact of failure and the identifier to ask about it.
   */
  #normalise(exception: unknown, correlationId: string): GatewayError {
    if (isGatewayError(exception)) {
      if (exception.type === 'BROKER_UNAVAILABLE' || exception.type === 'INTERNAL_ERROR') {
        this.#logger.error(`[${correlationId}] ${exception.type}: ${exception.message}`);
      }

      return exception;
    }

    if (exception instanceof HttpException) {
      return this.#fromHttpException(exception, correlationId);
    }

    this.#logger.error(
      `[${correlationId}] unhandled: ${exception instanceof Error ? exception.stack : String(exception)}`,
    );

    return GatewayError.internal();
  }

  /**
   * Nest raises its own exceptions before any route code runs — a body that is
   * not JSON, a path that matches nothing, a payload over the size cap, a
   * readiness check that failed. They are already carrying the right status, so
   * the only question is which of the seven types describes them.
   */
  #fromHttpException(exception: HttpException, correlationId: string): GatewayError {
    const status = exception.getStatus();

    switch (status) {
      case 401:
        return GatewayError.unauthenticated();
      case 403:
        return GatewayError.forbidden();
      case 503:
        // The readiness probe found no broker. From a caller's side that is
        // indistinguishable from the broker going down mid-request, and the
        // advice is the same: nothing happened, try again.
        return GatewayError.brokerUnavailable();
      default:
        break;
    }

    if (status >= 500) {
      this.#logger.error(`[${correlationId}] http ${String(status)}: ${exception.message}`);
      return GatewayError.internal();
    }

    if (status === 404) {
      // An unroutable path. Not a malformed request, and not something to
      // dress up as one: the caller asked for something that is not here.
      return new GatewayError('VALIDATION_ERROR', 'La ruta solicitada no existe.');
    }

    // Every other 4xx is the caller's mistake, so the wording is safe to pass
    // on. ValidationPipe puts the useful part in the response body rather than
    // in `message`, which would otherwise read "Bad Request Exception".
    const { message, field } = validationDetailOf(exception);

    return GatewayError.validation(message, field);
  }
}

/**
 * Pulls the readable complaint out of a `ValidationPipe` rejection.
 *
 * `validated()` shapes that rejection itself — `{ message, field }`, both
 * already correct — so this only has to read the two properties back out.
 * The fallback below exists for an `HttpException` that never went through
 * `validated()` at all (Nest's own body-size or JSON-parsing failures, which
 * carry a plain string `message` and no field to name).
 */
function validationDetailOf(exception: HttpException): {
  message: string;
  field: string | undefined;
} {
  const body = exception.getResponse();

  if (typeof body === 'object' && body !== null && 'message' in body) {
    const reported = (body as { message: unknown }).message;
    const field = 'field' in body ? (body as { field: unknown }).field : undefined;

    if (typeof reported === 'string') {
      return { message: reported, field: typeof field === 'string' ? field : undefined };
    }
  }

  return { message: exception.message, field: undefined };
}

/**
 * The correlation identifier the middleware set, or the caller's own header
 * if the failure happened before the middleware ran.
 *
 * The fallback matters: a request rejected by body parsing never reaches the
 * middleware, and that response still needs something to quote.
 */
function correlationOf(request: GatewayRequest | undefined): string {
  if (typeof request?.correlationId === 'string') {
    return request.correlationId;
  }

  const header = request?.headers[CORRELATION_HEADER];
  return typeof header === 'string' ? header : 'unknown';
}
