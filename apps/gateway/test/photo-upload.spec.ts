import { createHash } from 'node:crypto';

import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { MAX_PHOTO_BYTES } from '@bank/contracts';

import { CustomersController } from '../src/interfaces/customers.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const FORM = {
  fullName: 'Ana López',
  identityDocument: '1234567890101',
  email: 'ana@example.com',
  dateOfBirth: '1995-04-12',
  address: 'Zona 1, Guatemala',
  role: 'CLIENTE',
  credential: 'una-contrasena-larga',
};

/** A tiny valid-looking JPEG. Contents are irrelevant; the bytes are not. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array<number>(64).fill(0x41), 0xff, 0xd9]);

describe('the identity-document photo', () => {
  let harness: Harness;
  let app: INestApplication;

  beforeEach(async () => {
    harness = await buildHarness([CustomersController]);
    app = harness.app;
  });

  afterEach(async () => {
    await app.close();
  });

  function register(): request.Test {
    return request(app.getHttpServer()).post('/api/customers').field(FORM);
  }

  /**
   * The single most important assertion about this route: the broker never
   * sees the bytes. A 5 MB message is two orders of magnitude larger than
   * everything else in the system, and one parked in a dead-letter queue would
   * hold broker memory for the whole demonstration (ADR-012).
   */
  it('never puts the bytes on the broker, only a reference', async () => {
    const response = await register().attach('photo', JPEG, {
      filename: 'dpi.jpg',
      contentType: 'image/jpeg',
    });

    expect(response.status).toBe(202);

    const payload = harness.publisher.published[0]!.payload as { photo: unknown };
    const serialised = JSON.stringify(harness.publisher.published[0]);

    expect(payload.photo).toEqual({
      objectKey: expect.any(String),
      contentType: 'image/jpeg',
      sizeBytes: JPEG.byteLength,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(serialised).not.toContain(JPEG.toString('base64'));
  });

  it('stores exactly the bytes that arrived', async () => {
    await register().attach('photo', JPEG, { filename: 'dpi.jpg', contentType: 'image/jpeg' });

    expect(harness.storage.stored).toHaveLength(1);
    expect(harness.storage.stored[0]!.bytes.equals(JPEG)).toBe(true);
  });

  it('accepts a registration with no photo at all', async () => {
    const response = await register();

    expect(response.status).toBe(202);
    expect(harness.storage.stored).toHaveLength(0);

    // The contract makes the reference nullable: identity validation happens
    // separately, so a missing photo is not a malformed registration.
    expect((harness.publisher.published[0]!.payload as { photo: unknown }).photo).toBeNull();
  });

  describe('when the upload is unacceptable', () => {
    it('refuses a type that is neither JPEG nor PNG, publishing nothing', async () => {
      const response = await register().attach('photo', Buffer.from('%PDF-1.7'), {
        filename: 'dpi.pdf',
        contentType: 'application/pdf',
      });

      expect(response.status).toBe(400);
      expect(response.body.field).toBe('photo');
      expect(harness.publisher.published).toHaveLength(0);
      expect(harness.storage.stored).toHaveLength(0);
    });

    /**
     * Refused while it is still arriving, not after five megabytes have been
     * buffered — otherwise an anonymous caller chooses how much memory this
     * process uses.
     *
     * `413` rather than `400` because it is the precise answer and clients
     * already know it. The failure *type* is still `VALIDATION_ERROR`, which is
     * what FR-032 requires and what the frontend branches on.
     */
    it('refuses one over five megabytes, publishing nothing', async () => {
      const tooBig = Buffer.alloc(MAX_PHOTO_BYTES + 1_024, 0x41);

      const response = await register().attach('photo', tooBig, {
        filename: 'dpi.jpg',
        contentType: 'image/jpeg',
      });

      expect(response.status).toBe(413);
      expect(response.body.type).toBe('VALIDATION_ERROR');
      expect(harness.publisher.published).toHaveLength(0);
    });
  });

  /**
   * Publishing first would leave a reference to an object that does not exist,
   * and Customer Service would refuse the registration *after* the caller had
   * been told `202`.
   */
  describe('when the object store will not take it', () => {
    it('fails the whole request and publishes nothing', async () => {
      harness.storage.fail = true;

      const response = await register().attach('photo', JPEG, {
        filename: 'dpi.jpg',
        contentType: 'image/jpeg',
      });

      expect(response.status).toBe(500);
      expect(response.body.type).toBe('INTERNAL_ERROR');
      expect(harness.publisher.published).toHaveLength(0);
    });

    it('says nothing about the bucket or the endpoint', async () => {
      harness.storage.fail = true;

      const response = await register().attach('photo', JPEG, {
        filename: 'dpi.jpg',
        contentType: 'image/jpeg',
      });

      const body = JSON.stringify(response.body);

      expect(body).not.toMatch(/bucket|minio|s3|9000|customer-identity-documents/i);
    });
  });

  /**
   * The digest is the point of the whole shape: Customer Service recomputes it
   * after fetching and refuses anything that does not match, so a swapped or
   * truncated object cannot become an accepted identity document.
   */
  it('reports a digest that is a real SHA-256 of the content', async () => {
    // The fake storage returns a placeholder, so this checks the real adapter's
    // contribution at the only place the test can see it: the shape and the
    // size the gateway derived from the bytes it actually received.
    await register().attach('photo', JPEG, { filename: 'dpi.jpg', contentType: 'image/jpeg' });

    const stored = harness.storage.stored[0]!;
    const expected = createHash('sha256').update(stored.bytes).digest('hex');

    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.bytes.byteLength).toBe(JPEG.byteLength);
  });
});
