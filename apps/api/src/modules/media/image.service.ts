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
    pipeline = sharp(input, { failOn: 'error' })
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
  } catch {
    // A file that claimed to be a PNG and is not gets here, not on the sync construction above.
    throw new AppError('VALIDATION_FAILED', 'That file could not be read as an image');
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
