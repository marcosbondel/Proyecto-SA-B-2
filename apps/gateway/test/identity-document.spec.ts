import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { customerIdentityDocumentQueryV1, customerIdentityDocumentRepliedV1 } from '@bank/contracts';

import { CustomersController } from '../src/interfaces/customers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * The document itself: the read `validaciones/[id].vue` had no route for.
 *
 * Two things distinguish this suite from `queries-reply.spec.ts`: the reply
 * the Gateway waits for never carries the bytes (`FOUND` is a `PhotoReference`
 * only), and the response this route sends is not the usual JSON envelope —
 * it is the image itself, with its own `Content-Type`.
 */
const CUSTOMER = '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
const OTHER_STAFF = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('a customer\'s identity-document photo', () => {
  let harness: Harness;
  let app: INestApplication;
  let cashier: string;
  let admin: string;
  let client: string;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController]);
    app = harness.app;
    cashier = `Bearer ${harness.tokens.sign({ customerId: OTHER_STAFF, username: 'ana', role: 'CAJERO_RECEPTOR' })}`;
    admin = `Bearer ${harness.tokens.sign({ customerId: OTHER_STAFF, username: 'root', role: 'ADMINISTRADOR' })}`;
    client = `Bearer ${harness.tokens.sign({ customerId: CUSTOMER, username: 'maria', role: 'CLIENTE' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  function fetchDocument(authorization: string): request.Test {
    return request(app.getHttpServer())
      .get(`/api/customers/${CUSTOMER}/identity-document`)
      .set('Authorization', authorization);
  }

  it('asks the tiny reference query, never the bytes, and serves what it reads back from storage', async () => {
    harness.storage.objects.set('identity-review/abc123', Buffer.from('a pretend jpeg'));
    harness.replier.answerWith(customerIdentityDocumentRepliedV1.name, {
      outcome: 'FOUND',
      photo: {
        objectKey: 'identity-review/abc123',
        contentType: 'image/jpeg',
        sizeBytes: 15,
        sha256: 'a'.repeat(64),
      },
    });

    const response = await fetchDocument(cashier);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(Buffer.from('a pretend jpeg'));
    expect(harness.publisher.lastType).toBe(customerIdentityDocumentQueryV1.name);
  });

  it('lets an administrator read it too', async () => {
    harness.storage.objects.set('identity-review/xyz', Buffer.from('png bytes'));
    harness.replier.answerWith(customerIdentityDocumentRepliedV1.name, {
      outcome: 'FOUND',
      photo: {
        objectKey: 'identity-review/xyz',
        contentType: 'image/png',
        sizeBytes: 9,
        sha256: 'b'.repeat(64),
      },
    });

    const response = await fetchDocument(admin);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
  });

  it('refuses a CLIENTE with 403, and asks the broker nothing', async () => {
    const response = await fetchDocument(client);

    expect(response.status).toBe(403);
    expect(harness.publisher.published).toHaveLength(0);
  });

  it('answers 404 with the reason a customer has no document on file, not a generic error', async () => {
    harness.replier.answerWith(customerIdentityDocumentRepliedV1.name, {
      outcome: 'NOT_FOUND',
      reason: 'IDENTITY_OBJECT_NOT_FOUND',
    });

    const response = await fetchDocument(cashier);

    expect(response.status).toBe(404);
    expect(response.body.type).toBe('BUSINESS_REJECTION');
    expect(response.body.failureCode).toBe('IDENTITY_OBJECT_NOT_FOUND');
  });

  it('answers 404 for an unknown customer, the same shape as no document', async () => {
    harness.replier.answerWith(customerIdentityDocumentRepliedV1.name, {
      outcome: 'NOT_FOUND',
      reason: 'CUSTOMER_NOT_FOUND',
    });

    const response = await fetchDocument(cashier);

    expect(response.status).toBe(404);
    expect(response.body.failureCode).toBe('CUSTOMER_NOT_FOUND');
  });

  it('reports the honest read timeout when nobody answers', async () => {
    harness.replier.staySilent();

    const response = await fetchDocument(cashier);

    expect(response.status).toBe(504);
    expect(response.body.message).toMatch(/no se modificó ningún dato/i);
  });

  it('refuses a malformed customerId as a validation error, asking nothing', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/customers/not-a-uuid/identity-document')
      .set('Authorization', cashier);

    expect(response.status).toBe(400);
    expect(harness.publisher.published).toHaveLength(0);
  });
});
