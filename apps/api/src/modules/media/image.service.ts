import { createHash } from 'node:crypto';

import sharp from 'sharp';
import type { OutputInfo, Sharp } from 'sharp';

import { AppError } from '../../lib/errors';

/**
 * Turning whatever an editor drops into one web-ready image.
 *
 * Every upload becomes a single webp, capped at 1600px on its long edge and stripped of metadata.
 * webp because it is a third the bytes of the JPEG a phone produces for the same quality, the cap
 * because nobody needs a 6000px product photo on a card, and the metadata strip because a camera
 * writes GPS coordinates into a JPEG and a product photo has no business carrying where it was
 * taken. `.rotate()` first, so a portrait shot taken sideways is not served sideways.
 *
 * The key is the content hash: the same bytes uploaded twice land on the same object, and a
 * processed image can be cached forever because its address changes only when its content does.
 */

const MAX_EDGE = 1600;
const WEBP_QUALITY = 82;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export interface ProcessedImage {
  key: string;
  body: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new AppError('VALIDATION_FAILED', 'The uploaded file was empty');
  if (input.length > MAX_INPUT_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'That image is over 12 MB; please resize it first');
  }

  let pipeline: Sharp;
  try {
    pipeline = sharp(input, {
      failOn: 'error',
      /**
       * A ceiling on pixels, not only on bytes.
       *
       * Both gates above this one measure the *compressed* size, and compression is exactly what
       * the dangerous input exploits: a highly repetitive 16000x16000 PNG is a few tens of
       * kilobytes on the wire and roughly 400 MB once libvips decodes it. The API serves the
       * storefront from this same process, so exhausting it takes the shop down and not just the
       * back office. 40 MP is far more than a 1600px webp can ever need.
       *
       * The refusal arrives from `toBuffer`, not from this constructor - a Buffer is not decoded
       * until the pipeline runs - so it is the second catch below that turns it into a 422.
       * Measured, not assumed: a 7000x7000 PNG is 672 KB on the wire and is rejected there.
       */
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY });
  } catch {
    throw new AppError('VALIDATION_FAILED', 'That file is not an image sharp can read');
  }

  let body: Buffer;
  let info: OutputInfo;
  try {
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    body = result.data;
    info = result.info;
  } catch (error) {
    // A file that claimed to be a PNG and is not gets here, not on the sync construction above.
    // So does an image past `limitInputPixels`, and the two need different words: telling somebody
    // their perfectly valid 50-megapixel photograph "could not be read" sends them looking for a
    // corrupt file that does not exist.
    const message = error instanceof Error ? error.message : '';
    throw new AppError(
      'VALIDATION_FAILED',
      message.includes('pixel limit')
        ? 'That image has too many pixels; please resize it below 40 megapixels'
        : 'That file could not be read as an image',
    );
  }

  const hash = createHash('sha256').update(body).digest('hex').slice(0, 32);

  return {
    key: `products/${hash}.webp`,
    body,
    contentType: 'image/webp',
    width: info.width,
    height: info.height,
  };
}
