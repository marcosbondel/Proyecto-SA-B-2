import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { catalogByName } from '@bank/contracts';
import { parse, stringify } from 'yaml';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { AlertsController } from '../src/interfaces/alerts.controller';
import { InterbankController } from '../src/interfaces/interbank.controller';
import { AuditController } from '../src/interfaces/audit.controller';
import { DashboardController } from '../src/interfaces/dashboard.controller';
import { NotificationsController } from '../src/interfaces/notifications.controller';
import { AuthController } from '../src/interfaces/auth.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { HealthController } from '../src/interfaces/health.controller';
import { PaymentsController } from '../src/interfaces/payments.controller';
import { TransfersController } from '../src/interfaces/transfers.controller';
import { buildOpenApiDocument } from '../src/openapi/document';
import { ROUTE_MESSAGES } from '../src/openapi/route-messages';
import { buildHarness } from './support/harness';

const CONTRACT = resolve(__dirname, '..', 'openapi', 'gateway.v1.yaml');

/**
 * The document is built from the harness rather than from `AppModule`.
 *
 * It comes entirely from controllers and decorators, and booting the real
 * module would open a broker connection that reconnects forever — leaving Jest
 * with an open handle and the suite hanging. The emitter boots the real module
 * because it exits the process when it is done; a test cannot.
 */
const CONTROLLERS = [
  HealthController,
  AuthController,
  CustomersController,
  AccountsController,
  TransfersController,
  PaymentsController,
  AuditController,
  AlertsController,
  InterbankController,
  NotificationsController,
  DashboardController,
];

interface OpenApiDocument {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components?: { securitySchemes?: Record<string, unknown> };
}

describe('the versioned API contract', () => {
  let app: INestApplication;
  let generated: OpenApiDocument;
  let committed: OpenApiDocument;

  beforeAll(async () => {
    app = (await buildHarness(CONTROLLERS)).app;

    generated = buildOpenApiDocument(app) as unknown as OpenApiDocument;
    committed = parse(readFileSync(CONTRACT, 'utf8')) as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Five tickets build against the committed file for weeks. What has to be
   * guaranteed is not that it is right today, but that it cannot stop being
   * right in silence — so the committed bytes are compared with what the code
   * produces, and a route changed without regenerating fails here.
   */
  it('is identical to what the code produces', () => {
    const options = { lineWidth: 100, aliasDuplicateObjects: false };

    expect(stringify(committed, options)).toBe(
      stringify(generated as unknown as Record<string, unknown>, options),
    );
  });

  /**
   * Fourteen paths for seventeen routes: `/api/accounts` carries both the
   * listing and the opening. T-15 fixed nine of them; T-17 added the three the
   * account screens needed and that nothing was publishing; T-19 added the two
   * that let anything ask Payment Service a question at all — before them a
   * payment could be ordered and could answer the Saga, but nobody outside
   * could look one up; T-20 added the notifications console, nested under
   * `/api/audit` because D-06 grants the trail and the notifications together
   * and they are the same record read two ways.
   */
  it('declares the paths the tickets fixed', () => {
    expect(Object.keys(committed.paths).sort()).toEqual(
      [
        '/api/accounts',
        '/api/accounts/{accountId}/balance',
        // Added for the prototype's G-01: which services can be paid, and where
        // each one's collection account is. A service payment is a transfer to
        // it, so there is no separate kind of money movement.
        '/api/accounts/billers',
        // Added by T-17.
        // Added for the prototype's A-05: the deposit window, the only
        // money-moving route that answers synchronously.
        '/api/accounts/{accountId}/deposit',
        '/api/accounts/{accountId}/operations',
        '/api/accounts/{accountId}/status',
        // Added by T-45: the webhook Grafana calls with a shared secret, not a session.
        '/api/alerts/slo',
        '/api/audit',
        '/api/audit/recent',
        // Added by T-20. Not the customer's inbox: that has no domain (TD-041).
        '/api/audit/notifications',
        // Added for the prototype's D-01 and D-02: five services' own counts,
        // composed. The Gateway holds five replies and computes nothing.
        '/api/dashboard',
        /*
         * Las dos de T-47: el cliente manda un depósito al banco pareja, y el
         * banco pareja contesta sobre uno que le mandamos. La de entrada
         * (`deposits`) es de T-46 y es la dirección contraria.
         */
        '/api/interbank/callbacks',
        '/api/interbank/deposits',
        '/api/interbank/transfers',
        // Added by T-60 (B10): a single deposit sent to the partner bank, with its history.
        '/api/interbank/transfers/{interbankTransferId}',
        '/api/auth/login',
        // Added for the prototype's P-07: the password recovery the assignment's
        // flow needs and that no route offered.
        '/api/auth/password-reset',
        '/api/auth/password-reset/confirm',
        '/api/customers',
        '/api/customers/verify-email',
        // Added by the audit remediation (US6): the read path, the teller's
        // pending-validation queue, and the teller's manual identity verdict.
        '/api/customers/pending-validation',
        '/api/customers/{customerId}',
        '/api/customers/{customerId}/identity-verdict',
        // Added by T-31: the broader compliance verdict the transfer Saga's
        // own KYC gate reads, distinct from the document-photo review above.
        '/api/customers/{customerId}/kyc-status',
        // Added by this ticket: the document photo itself, which until now had
        // no read route and left the teller's validation screen with a
        // placeholder instead of the image it asked them to compare.
        '/api/customers/{customerId}/identity-document',
        // Added for the prototype's C-01: changing your own password from
        // inside a session, which needs the current one and which nobody else
        // may do for you.
        '/api/customers/{customerId}/password',
        // Added for the prototype's N-01: a person's own inbox, and the write
        // that marks it read. Top-level rather than nested under /api/audit,
        // because it is a different audience and a different shape from the
        // staff console — no recipient, no delivery status, scoped by identity.
        '/api/notifications',
        '/api/notifications/read',
        // Added by T-19. Read-only: a payment is born from a transfer, never
        // from a route.
        '/api/payments',
        // Added by T-44: the administrator's dial for the simulated provider.
        '/api/payments/simulation',
        '/api/payments/{paymentId}',
        '/api/transfers',
        '/api/transfers/{transactionId}',
        '/health',
        '/ready',
      ].sort(),
    );
  });

  /**
   * Criterion 5 of the ticket, as an assertion rather than a claim: every route
   * names a message that exists in the T-05 catalogue **with that exact name**.
   */
  describe('consistency with the T-05 catalogue', () => {
    it('names only messages the catalogue defines', () => {
      const named = Object.values(committed.paths)
        .flatMap((operations) => Object.values(operations))
        .flatMap((operation) => [
          operation['x-bank-publishes'],
          ...((operation['x-bank-awaits'] as string[] | undefined) ?? []),
        ])
        .filter((name): name is string => typeof name === 'string');

      expect(named.length).toBeGreaterThan(0);

      for (const name of named) {
        expect(catalogByName.has(name)).toBe(true);
      }
    });

    it('leaves no functional route without a message — zero orphans', () => {
      const functional = Object.entries(committed.paths).filter(
        ([path]) => path !== '/health' && path !== '/ready',
      );

      expect(functional).toHaveLength(33);

      for (const [path, operations] of functional) {
        for (const [method, operation] of Object.entries(operations)) {
          expect(operation['x-bank-publishes']).toBeDefined();
          expect(typeof operation['x-bank-publishes']).toBe(`string`);
          void method;
          void path;
        }
      }
    });

    it('keeps the route table itself honest', () => {
      for (const messages of Object.values(ROUTE_MESSAGES)) {
        expect(catalogByName.has(messages.publishes)).toBe(true);

        for (const awaited of messages.awaits ?? []) {
          expect(catalogByName.has(awaited)).toBe(true);
        }
      }
    });

    it('declares the gateway as the producer of everything it publishes', () => {
      for (const messages of Object.values(ROUTE_MESSAGES)) {
        expect(catalogByName.get(messages.publishes)?.producer).toBe('gateway');
      }
    });
  });

  describe('what it says about access', () => {
    it('declares a bearer scheme, since most routes need one', () => {
      expect(committed.components?.securitySchemes).toHaveProperty('session');
    });

    /**
     * The seven public routes, and only those. If an eighth ever appears here
     * without a bearer requirement, this is where it is noticed.
     *
     * T-45's SLO webhook is not among them although the session guards let it
     * through: it declares the `alertWebhook` scheme, because a route that needs a
     * shared secret should not be described as one that needs nothing.
     *
     * The two password-recovery routes are public because they have to be: the
     * whole premise is somebody who cannot sign in. The token in the emailed
     * link is the credential for the second, and the first is deliberately
     * uninformative so being open costs nothing.
     */
    it('marks exactly the seven public routes as needing no token', () => {
      const withoutAuth: string[] = [];

      for (const [path, operations] of Object.entries(committed.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
          if (operation.security === undefined) {
            withoutAuth.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }

      expect(withoutAuth.sort()).toEqual(
        [
          'GET /health',
          'GET /ready',
          'POST /api/auth/login',
          'POST /api/auth/password-reset',
          'POST /api/auth/password-reset/confirm',
          'POST /api/customers',
          'GET /api/customers/verify-email',
        ].sort(),
      );
    });
  });
});
