import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  readonly status: 'ok';
  readonly application: string;
}

/**
 * Liveness endpoint. Health and readiness are the only HTTP surfaces a
 * skeleton exposes; business routes arrive with the service tickets.
 */
@Controller('health')
export class HealthController {
  @Get()
  public check(): HealthStatus {
    return { status: 'ok', application: 'gateway' };
  }
}
