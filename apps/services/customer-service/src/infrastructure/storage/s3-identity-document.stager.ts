import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PhotoReference } from '@bank/contracts';

import type { IdentityDocumentStager } from '../../application/ports';

export interface ObjectStorageSettings {
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly region: string;
}

/**
 * Writes this service's own stored bytes into the shared transfer buffer, so
 * the Gateway can read them back — the write half of the reverse trip
 * `IdentityDocumentReader` makes for registration, over the same bucket.
 *
 * A fresh key every time, under its own prefix: this is never the object the
 * Gateway originally wrote (that one is long gone, or never existed if the
 * photo arrived on a since-restarted stack), and re-using a name would risk
 * colliding with whatever the write path is doing concurrently. The bucket's
 * own lifecycle rule (`MINIO_RETENTION_HOURS`) expires it; nothing here
 * deletes it, the same way nothing deletes the Gateway's uploads.
 *
 * `forcePathStyle` is required for MinIO, exactly as it is for the reader:
 * virtual-host addressing would resolve `bucket.localhost`, which does not
 * exist.
 */
export class S3IdentityDocumentStager implements IdentityDocumentStager {
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

  public async stage(document: {
    readonly content: Buffer;
    readonly mimeType: 'image/jpeg' | 'image/png';
    readonly sha256: string;
    readonly sizeBytes: number;
  }): Promise<PhotoReference> {
    const objectKey = `identity-review/${randomUUID()}`;

    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: objectKey,
        Body: document.content,
        ContentType: document.mimeType,
        ChecksumSHA256: Buffer.from(document.sha256, 'hex').toString('base64'),
      }),
    );

    return {
      objectKey,
      contentType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
    };
  }
}
