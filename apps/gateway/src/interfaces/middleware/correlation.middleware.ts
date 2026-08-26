import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import type { GatewayRequest } from '../http-request';

import {
  CORRELATION_HEADER,
  IDEMPOTENCY_HEADER,
  correlationIdFrom,
  idempotencyKeyFrom,
} from '../../application/correlation';

/**
 * Gives every request a correlation identifier and an idempotency key before
 * anything else can fail.
 *
 * It runs first for a reason. If correlation were established inside each route
 * handler, a request rejected by a guard or by body parsing would have none —
 * and those are exactly the responses somebody will later be trying to trace.
 * The header is set on the way out too, so a caller can quote it back without
 * having to parse the body of an error.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  public use(request: GatewayRequest, response: Response, next: NextFunction): void {
    request.correlationId = correlationIdFrom(request.headers[CORRELATION_HEADER]);
    request.idempotencyKey = idempotencyKeyFrom(request.headers[IDEMPOTENCY_HEADER]);

    response.setHeader('X-Correlation-Id', request.correlationId);
    next();
  }
}
