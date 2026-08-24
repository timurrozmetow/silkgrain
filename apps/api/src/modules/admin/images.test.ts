import type { AdminProductImage } from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import FormData from 'form-data';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, productImages } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Product images, end to end against the real MinIO.
 *
 * A real bucket rather than a mock, for the same reason the email tests use a real Mailpit: the
 * thing worth proving is that sharp re-encodes what it is given and the object lands somewhere the
 * URL can reach, and a fake storage would prove neither. The suite therefore needs `setup:services`
 * to have run, exactly as it already needs MySQL.
 */
describe('product images', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;
  let databaseUrl: string;
  let token: string;

  beforeAll(async () => {
    app = await buildTestApp();
    databaseUrl = testEnv().DATABASE_URL;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixture = await seedCatalogFixture(app.db);
    // The fixture seeds an image for devzira; these tests want a clean slate to count against.
    await app.db.delete(productImages);

    await app.db.insert(adminUsers).values({
      email: 'editor@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Sevara A.',
      role: 'manager',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'editor@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
  });

  const productId = () => fixture.productIds['devzira-rice'];

  /** A real image every time, generated so the test carries no binary fixture. */
  async function pngOf(color: string, size = 64): Promise<Buffer> {
    return sharp({ create: { width: size, height: size, channels: 3, background: color } })
      .png()
      .toBuffer();
  }

  async function upload(
    id: number,
    png: Buffer,
    alt = '',
  ): Promise<{ status: number; images: AdminProductImage[] }> {
    const body = new FormData();
    body.append('file', png, { filename: 'photo.png', contentType: 'image/png' });
    if (alt !== '') body.append('alt', alt);

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/products/${String(id)}/images`,
      remoteAddress: freshAddress(),
      headers: { ...body.getHeaders(), authorization: `Bearer ${token}` },
      payload: body.getBuffer(),
    });
    return {
      status: response.statusCode,
      images: response.json<{ images: AdminProductImage[] }>().images,
    };
  }

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('refuses an upload without an admin session', async () => {
    const body = new FormData();
    body.append('file', await pngOf('#0E6B4A'), { filename: 'x.png', contentType: 'image/png' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/products/${String(productId())}/images`,
      remoteAddress: freshAddress(),
      headers: body.getHeaders(),
      payload: body.getBuffer(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('re-encodes an upload to webp and makes the first image primary', async () => {
    const { status, images } = await upload(productId(), await pngOf('#0E6B4A'), 'Devzira rice');

    expect(status).toBe(201);
    expect(images).toHaveLength(1);
    // The stored object is a webp regardless of what came in.
    expect(images[0]?.url).toMatch(/\.webp$/);
    expect(images[0]?.alt).toBe('Devzira rice');
    expect(images[0]?.width).toBe(64);
    // A product needs a primary and this is the only candidate, so it is chosen without a click.
    expect(images[0]?.isPrimary).toBe(true);

    // The URL the browser would fetch actually serves the bytes.
    const fetched = await fetch(images[0]!.url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toContain('image/webp');
  });

  it('appends later uploads and leaves the primary where it was', async () => {
    await upload(productId(), await pngOf('#0E6B4A'));
    const { images } = await upload(productId(), await pngOf('#D3A73B'));

    expect(images).toHaveLength(2);
    expect(images[0]?.isPrimary).toBe(true);
    expect(images[1]?.isPrimary).toBe(false);
    expect(images[1]?.position).toBe(1);
  });

  it('reorders images and moves the primary in one call', async () => {
    await upload(productId(), await pngOf('#0E6B4A'));
    const two = await upload(productId(), await pngOf('#D3A73B'));
    const [first, second] = two.images;

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/products/${String(productId())}/images`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { order: [second!.id, first!.id], primaryId: second!.id },
    });
    expect(response.statusCode).toBe(200);

    const images = response.json<{ images: AdminProductImage[] }>().images;
    expect(images.map((image) => image.id)).toEqual([second!.id, first!.id]);
    expect(images[0]?.isPrimary).toBe(true);
    expect(images[1]?.isPrimary).toBe(false);
  });

  it('rejects an arrangement that does not list every image exactly once', async () => {
    const one = await upload(productId(), await pngOf('#0E6B4A'));
    await upload(productId(), await pngOf('#D3A73B'));

    // Only one of the two ids: applying it would renumber one row and orphan the other.
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/products/${String(productId())}/images`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { order: [one.images[0]!.id], primaryId: one.images[0]!.id },
    });
    expect(response.statusCode).toBe(422);
  });

  it('promotes the next image when the primary is deleted', async () => {
    await upload(productId(), await pngOf('#0E6B4A'));
    const two = await upload(productId(), await pngOf('#D3A73B'));
    const primary = two.images.find((image) => image.isPrimary);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/products/${String(productId())}/images/${String(primary!.id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const images = response.json<{ images: AdminProductImage[] }>().images;
    expect(images).toHaveLength(1);
    // A product with images always has exactly one primary; the survivor inherits it.
    expect(images[0]?.isPrimary).toBe(true);
  });

  it('sets alt text on one image', async () => {
    const one = await upload(productId(), await pngOf('#0E6B4A'));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/products/${String(productId())}/images/${String(one.images[0]!.id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { alt: 'A bag of red devzira rice' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ images: AdminProductImage[] }>().images[0]?.alt).toBe(
      'A bag of red devzira rice',
    );
  });

  it('will not touch an image that belongs to another product', async () => {
    const one = await upload(productId(), await pngOf('#0E6B4A'));
    const otherProduct = fixture.productIds['green-lentils'];

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/products/${String(otherProduct)}/images/${String(one.images[0]!.id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    // The image is not this product's, so it is a 404 rather than a cross-product delete.
    expect(response.statusCode).toBe(404);
  });

  it('rejects a file that is not an image', async () => {
    const body = new FormData();
    body.append('file', Buffer.from('this is plainly not an image'), {
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/products/${String(productId())}/images`,
      remoteAddress: freshAddress(),
      headers: { ...body.getHeaders(), authorization: `Bearer ${token}` },
      payload: body.getBuffer(),
    });
    expect(response.statusCode).toBe(422);
  });

  it('is a 404 for a product that does not exist', async () => {
    const { status } = await upload(99_999, await pngOf('#0E6B4A'));
    expect(status).toBe(404);
  });

  it('keeps the object while another product still points at it', async () => {
    // The object key is a hash of the processed bytes, so the same photograph uploaded twice is
    // one object with two rows naming it - deduplication, working as designed. Deleting one of
    // them must not take the bytes out from under the other, or the surviving row looks perfectly
    // healthy in the panel while every customer gets a 404 where the picture should be.
    const photo = await pngOf('#B85C38');
    const first = fixture.productIds['devzira-rice'];
    const second = fixture.productIds['chungara-rice'];

    const a = await upload(first, photo);
    const b = await upload(second, photo);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // Same bytes in, same key out - otherwise this test proves nothing.
    expect(a.images[0]?.url).toBe(b.images[0]?.url);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/products/${String(first)}/images/${String(a.images[0]?.id ?? 0)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(removed.statusCode).toBe(200);

    // The second product's image must still be fetchable, which is the whole point.
    const url = b.images[0]?.url ?? '';
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
  });

  it('refuses an image by its pixel count, not only by its byte count', async () => {
    // Both size gates on this route measure compressed bytes, and compression is what makes a
    // large image small: this 7000x7000 PNG is well under the 12 MB limit on the wire and about
    // 200 MB once decoded. The API serves the storefront from the same process, so without a
    // pixel ceiling a handful of these would take the shop down rather than the back office.
    const wide = await pngOf('#0E6B4A', 7000);
    expect(wide.length).toBeLessThan(12 * 1024 * 1024);

    const body = new FormData();
    body.append('file', wide, { filename: 'huge.png', contentType: 'image/png' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/products/${String(productId())}/images`,
      remoteAddress: freshAddress(),
      headers: { ...body.getHeaders(), authorization: `Bearer ${token}` },
      payload: body.getBuffer(),
    });

    expect(response.statusCode).toBe(422);
    // And it says which of the two things went wrong. Telling somebody their perfectly valid
    // photograph "could not be read" sends them hunting for a corrupt file that does not exist.
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/pixels/i);
  });
});
