import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AlertWebhookUseCase } from '../application/routes/alert-webhook.use-case';
import type { ReceivedAlerts } from '../application/routes/alert-webhook.use-case';
import { AlertTokenGuard } from './guards/alert-token.guard';
import { Public } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';

/**
 * The entry for the monitoring stack's SLO alerts (Fase 3, §4.1 — Notification
 * & Audit Service; T-45).
 *
 * Not behind the session: Grafana has none. `@Public()` opens the route to the
 * JWT and role guards, and `AlertTokenGuard` — a shared secret, compared in
 * constant time and refused when unset — is what protects it instead.
 */
@ApiTags('alerts')
@Controller('api/alerts')
export class AlertsController {
  readonly #alerts: AlertWebhookUseCase;

  constructor(@Inject(AlertWebhookUseCase) alerts: AlertWebhookUseCase) {
    this.#alerts = alerts;
  }

  @ApiOperation({
    summary: 'Recibe el webhook de alertas de SLO de Grafana',
    description:
      'Sin sesión: se autentica con `Authorization: Bearer <ALERT_WEBHOOK_TOKEN>`, un secreto ' +
      'compartido que vive en un Secret de Kubernetes, y se rechaza si no hay uno configurado. ' +
      'Publica la alerta en el broker para que Notification & Audit la registre y notifique; ' +
      'responde 202 sin esperar. Cuerpo: el formato de webhook de Grafana (`alerts[]` con ' +
      '`labels.alertname`, `labels.severity`, `annotations.summary`, `annotations.runbook_url`).',
  })
  @Public()
  @UseGuards(AlertTokenGuard)
  @Post('slo')
  @HttpCode(202)
  public async slo(
    @Body() body: unknown,
    @Req() request: GatewayRequest,
  ): Promise<ReceivedAlerts> {
    return await this.#alerts.receive(body, request.correlationId);
  }
}
