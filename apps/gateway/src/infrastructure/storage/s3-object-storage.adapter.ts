import { createHash, randomUUID } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PhotoReference } from '@bank/contracts';

import { GatewayError } from '../../application/errors/gateway-error';
import type { ObjectStoragePort, PhotoUpload } from '../../application/ports';

const EXTENSION: Record<PhotoUpload['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export interface ObjectStorageSettings {
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly region: string;
}

/**
 * Parks the identity-document photo in MinIO and returns only its reference.
 *
 * The digest is computed here, over the exact bytes that are uploaded, and
 * Customer Service recomputes it after fetching. That round trip is what makes
 * a swapped or truncated object unable to become an accepted identity
 * document — without it, the reference would be a claim nobody checks.
 *
 * `forcePathStyle` is required for MinIO: virtual-host addressing would resolve
 * `bucket.localhost`, which does not exist.
 */
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(settings: ObjectStorageSettings) {
    this.#bucket = settings.bucket;
    this.#client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.accessKey,
        secretAccessKey: settings.secretKey,
      },
    });
  }

  public async put(upload: PhotoUpload): Promise<PhotoReference> {
    const objectKey = `${randomUUID()}.${EXTENSION[upload.contentType]}`;
    const sha256 = createHash('sha256').update(upload.bytes).digest('hex');

    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: objectKey,
          Body: upload.bytes,
          ContentType: upload.contentType,
          ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        }),
      );
    } catch {
      // The SDK's error names the bucket and the endpoint. Neither is the
      // caller's business, and an error page is not a place to publish the
      // topology (FR-028). The correlated log keeps the detail.
      throw GatewayError.internal('No se pudo procesar la imagen del documento.');
    }

    return {
      objectKey,
      contentType: upload.contentType,
      sizeBytes: upload.bytes.byteLength,
      sha256,
    };
  }

  public async get(objectKey: string): Promise<Buffer> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: objectKey }),
      );

      if (response.Body === undefined) {
        throw new Error(`Object ${objectKey} has no body.`);
      }

      return Buffer.from(await response.Body.transformToByteArray());
    } catch {
      // Same reasoning as `put`: the SDK's error names the bucket and the
      // endpoint, and neither belongs in a response a browser renders.
      throw GatewayError.internal('No se pudo leer la imagen del documento.');
    }
  }
}
