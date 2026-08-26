import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { accountCreateV1 } from '@bank/contracts';
import { randomUUID } from 'node:crypto';

import { envelopeForRequest } from '../../src/application/request-envelope';
import { MESSAGE_PUBLISHER } from '../../src/application/ports';
import type { MessagePublisherPort } from '../../src/application/ports';
import { Public, Roles } from '../../src/interfaces/guards/route-access.decorator';
import type { GatewayRequest } from '../../src/interfaces/http-request';

/**
 * A stand-in for the real routes, used to test the authorization boundary on
 * its own.
 *
 * User story 2 is about the guards, not about any particular route, and it has
 * to be verifiable before the routes it protects exist. This fixture gives the
 * guards the three shapes they have to handle — public, protected-any-role,
 * protected-one-role — and publishes a real contract so a test can assert that
 * a rejected request published **nothing**.
 */
@Controller('fixture')
export class ProtectedRoutesFixture {
  readonly #publisher: MessagePublisherPort;

  constructor(@Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort) {
    this.#publisher = publisher;
  }

  @Public()
  @Get('open')
  public open(): { readonly reached: true } {
    return { reached: true };
  }

  /** Protected, but restricted by scope downstream rather than by role here. */
  @Get('any-role')
  public anyRole(@Req() request: GatewayRequest): { readonly role: string | undefined } {
    return { role: request.actor?.role };
  }

  /** The shape `GET /api/audit` has: one role, and only one. */
  @Roles('ADMINISTRADOR')
  @Get('admin-only')
  public adminOnly(): { readonly reached: true } {
    return { reached: true };
  }

  /**
   * Publishes with the identity taken from the token, and a subject taken from
   * the body — the actor/subject split the real routes use.
   */
  @Post('publishes')
  public async publishes(
    @Body() body: { readonly customerId?: string },
    @Req() request: GatewayRequest,
  ): Promise<{ readonly accepted: true }> {
    const actor = request.actor;

    await this.#publisher.publish(
      envelopeForRequest(
        {
          accountId: randomUUID(),
          // The subject: whoever this is *about*. Defaults to the actor.
          customerId: body.customerId ?? actor?.customerId,
          accountType: 'MONETARIA',
        },
        accountCreateV1.name,
        // The actor: whoever is *asking*. Always the token, never the body.
        actor === undefined ? null : { customerId: actor.customerId, role: actor.role },
        request.correlationId,
      ),
    );

    return { accepted: true };
  }
}
