import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { catalogByName } from '@bank/contracts';
import { parse, stringify } from 'yaml';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { AuditController } from '../src/interfaces/audit.controller';
import { AuthController } from '../src/interfaces/auth.controller';
import { CustomersController } from '../src/interfaces/customers.controller';
import { HealthController } from '../src/interfaces/health.controller';
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
  AuditController,
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
   * Eleven paths for fourteen routes: `/api/accounts` carries both the listing
   * and the opening. T-15 fixed nine of them; T-17 added the three the account
   * screens needed and that nothing was publishing.
   */
  it('declares the eleven paths the two tickets fixed', () => {
    expect(Object.keys(committed.paths).sort()).toEqual(
      [
        '/api/accounts',
        '/api/accounts/{accountId}/balance',
        // Added by T-17.
        '/api/accounts/{accountId}/operations',
        '/api/accounts/{accountId}/status',
        '/api/audit',
        '/api/auth/login',
        '/api/customers',
        '/api/customers/verify-email',
        '/api/customers/{customerId}',
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

      expect(functional).toHaveLength(11);

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
     * The five public routes, and only those. If a sixth ever appears here
     * without a bearer requirement, this is where it is noticed.
     */
    it('marks exactly the five public routes as needing no token', () => {
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
          'POST /api/customers',
          'GET /api/customers/verify-email',
        ].sort(),
      );
    });
  });
});
