import { serverSpan } from '@bank/observability';
import type { NextFunction, Response } from 'express';

import type { GatewayRequest } from '../http-request';

/** The two levels this middleware writes; `JsonLogger` satisfies it structurally. */
export interface AccessLog {
  info(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

/** Probes are called every few seconds by kubelet and Prometheus; they are not requests worth a line. */
const QUIET_PATHS = /^\/(health|ready|metrics)(\/|$)/;

/** What a route is called when no handler matched it: never the raw URL. */
const UNMATCHED_ROUTE = 'unmatched';

/**
 * One structured line per HTTP request, written when the response is done.
 *
 * Until T-60 the Gateway wrote only its startup lines, so a request that went
 * through it left **nothing in Loki** that carried its `correlationId` — the
 * services behind it logged, the entry point did not, and the first hop of
 * every trace had no log to join to.
 *
 * What the line says, and what it deliberately does not:
 *
 * - `route` is the **template** (`/api/accounts/:accountId/balance`), read from
 *   the router after it matched. The raw URL carries identifiers and a query
 *   string, and the query string of `verify-email` is a working activation
 *   token (§8.3, "Datos sensibles expuestos"); an unmatched request is
 *   `unmatched`, not its path.
 * - `traceId` and `spanId` are those of the HTTP SERVER span, captured when the
 *   request *starts* — the `finish` event does not reliably run inside the
 *   request's context — so the line joins to the trace.
 * - `<500` is `info`, `>=500` is `error`. A 4xx is the caller's mistake and the
 *   gateway working; it must not page anybody.
 *
 * The line is built from fields only, so the logger's own redaction still sits
 * between it and stdout.
 */
export function accessLogMiddleware(
  logger: AccessLog,
): (request: GatewayRequest, response: Response, next: NextFunction) => void {
  return (request, response, next): void => {
    // `originalUrl`, never `path`: mounted by Nest under `*path`, Express hands
    // the middleware a `path` relative to the mount, which is just `/`.
    if (QUIET_PATHS.test(pathOf(request))) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const span = serverSpan()?.spanContext();
    let written = false;

    const write = (aborted: boolean): void => {
      if (written) {
        return;
      }
      written = true;

      const status = response.statusCode;
      const fields: Record<string, unknown> = {
        method: request.method,
        route: routeOf(request),
        status,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        correlationId: request.correlationId,
        ...(request.actor === undefined ? {} : { role: request.actor.role }),
        ...(span === undefined || span.traceId === '' ? {} : { traceId: span.traceId }),
        ...(span === undefined || span.spanId === '' ? {} : { spanId: span.spanId }),
        ...(aborted ? { aborted: true } : {}),
      };

      if (status >= 500) {
        logger.error('http request', fields);
      } else {
        logger.info('http request', fields);
      }
    };

    response.once('finish', () => {
      write(false);
    });
    // The client went away before the response was complete.
    response.once('close', () => {
      write(!response.writableFinished);
    });

    next();
  };
}

function routeOf(request: GatewayRequest): string {
  const template: unknown = (request.route as { path?: unknown } | undefined)?.path;

  return typeof template === 'string' ? `${request.baseUrl}${template}` : UNMATCHED_ROUTE;
}

/** The path of the URL as the client sent it, without the query string. */
function pathOf(request: GatewayRequest): string {
  const url = request.originalUrl;
  const query = url.indexOf('?');

  return query === -1 ? url : url.slice(0, query);
}
