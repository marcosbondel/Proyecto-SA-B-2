import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

import { ROUTE_MESSAGES } from './route-messages';

export const OPENAPI_VERSION = '1.0.0';

/**
 * The versioned contract five blocked tickets build against.
 *
 * It is **generated from the code and committed**, not written by hand. A
 * hand-written contract is correct on the day it is written; what has to be
 * true here is that it cannot stop being correct in silence, and a drift test
 * over a generated file gives exactly that.
 *
 * Each route also declares the catalogue message it publishes, under
 * `x-bank-message`. That is what makes criterion 5 — "consistent with the T-05
 * catalogue" — an assertion rather than a claim.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Bank USAC — API Gateway')
    .setDescription(
      'The only external entry point of the system (constitution V). It validates shape, ' +
        'authenticates, authorises by role and publishes onto the broker. It holds no ' +
        'business logic, no database and no HTTP client towards any internal service.',
    )
    .setVersion(OPENAPI_VERSION)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'session',
    )
    // The monitoring stack's door (T-45): a shared secret, not a session. Declared
    // so the contract says what the route needs instead of calling it public.
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'alertWebhook')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  return withMessageNames(document);
}

/**
 * Annotates each operation with the message it puts on the broker.
 *
 * Kept out of the controllers as data rather than a decorator on every handler:
 * the mapping is a property of the API as a whole, and one table is easier to
 * check against the catalogue than eleven scattered annotations.
 */
function withMessageNames(document: OpenAPIObject): OpenAPIObject {
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const key = `${method.toUpperCase()} ${path}`;
      const messages = ROUTE_MESSAGES[key];

      if (messages !== undefined && typeof operation === 'object' && operation !== null) {
        Object.assign(operation, {
          'x-bank-publishes': messages.publishes,
          ...(messages.awaits === undefined ? {} : { 'x-bank-awaits': messages.awaits }),
        });
      }
    }
  }

  return document;
}
