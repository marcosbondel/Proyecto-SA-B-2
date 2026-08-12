import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  readonly status: 'ok';
  readonly application: string;
}

/**
 * Liveness endpoint. Health and readiness are the only HTTP surfaces this
 * service exposes; everything else travels over the broker (constitution IV).
 */
@Controller('health')
export class HealthController {
  @Get()
  public check(): HealthStatus {
    return { status: 'ok', application: 'payment-service' };
  }
}
