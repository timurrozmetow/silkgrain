import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { Env } from '../../env';

/**
 * Object storage for product images.
 *
 * One place talks to the bucket, so the endpoint credentials and the path-style quirk are known
 * to exactly one file. The API writes over `S3_ENDPOINT`; the browser reads the finished image
 * over `S3_PUBLIC_URL`. Locally those are the same MinIO host, in production the endpoint is
 * internal and the public URL is a CDN - keeping them separate is what lets that be a config
 * change rather than a code one.
 */
export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private ready: Promise<void> | null = null;

  constructor(env: Env) {
    this.bucket = env.S3_BUCKET;
    // No trailing slash, so joining a key is one rule and not two.
    this.publicUrl = env.S3_PUBLIC_URL.replace(/\/+$/, '');
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  /**
   * Creates the bucket if it is missing and opens it for anonymous reads, once per process.
   *
   * A product image is public by definition - the storefront serves it to everyone - so the whole
   * bucket is read-only to the world and writable only through these credentials. The promise is
   * memoised so a burst of uploads on a cold start does not race to create the same bucket.
   */
  private ensureBucket(): Promise<void> {
    this.ready ??= this.provision();
    return this.ready;
  }

  private async provision(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Missing, or not ours to see. Creating it is idempotent enough: a second creator gets a
      // "you already own this" that the catch below swallows.
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
    }

    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicRead',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        }),
      }),
    );
  }

  /** Stores bytes at `key` and returns the URL the browser will fetch them from. */
  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // A processed image is immutable - its key carries a content hash - so the browser may
        // keep it forever. A new upload is a new key, never a mutated one.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicUrl}/${key}`;
  }

  /**
   * Removes the object a stored URL points at.
   *
   * Best-effort: a delete that fails leaves an orphaned object in the bucket, which is cheap and
   * sweepable, whereas letting it throw would block the row deletion the operator actually asked
   * for. The database is the source of truth for what exists; the bucket is a cache of bytes.
   */
  async remove(url: string): Promise<void> {
    const key = this.keyFromUrl(url);
    if (key === null) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      /* orphaned object, swept later; never blocks the row delete */
    }
  }

  /** The object key inside a public URL, or null if the URL is not one of ours. */
  private keyFromUrl(url: string): string | null {
    const prefix = `${this.publicUrl}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
