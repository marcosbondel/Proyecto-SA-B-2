import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PhotoReference } from '@bank/contracts';

import type { IdentityDocumentReader } from '../../application/ports';

export interface ObjectStorageSettings {
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly region: string;
}

/**
 * Reads back the photo the Gateway parked in MinIO.
 *
 * The bytes travel through object storage rather than through the broker, and
 * that is ADR-012's decision: a five-megabyte base64 payload on a queue is a
 * broker outage waiting for a busy afternoon. What crosses the wire is a
 * reference, and this is the other half of it.
 *
 * `forcePathStyle` is required for MinIO — virtual-host addressing would
 * resolve `bucket.localhost`, which does not exist.
 */
export class S3IdentityDocumentReader implements IdentityDocumentReader {
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

  /**
   * The whole object in memory, which is safe **because** of the ceiling.
   *
   * Five megabytes is the contract's maximum and the Gateway refuses more while
   * the upload is still arriving, so this cannot be asked for an object large
   * enough to matter. Without that ceiling upstream, buffering here would let a
   * caller choose how much memory this process uses.
   */
  public async read(photo: PhotoReference): Promise<Buffer> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: photo.objectKey }),
    );

    if (response.Body === undefined) {
      throw new Error(`Object ${photo.objectKey} has no body.`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }
}
