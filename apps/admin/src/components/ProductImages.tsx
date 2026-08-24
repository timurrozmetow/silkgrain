import type { AdminProductImage } from '@silkgrain/contracts';
import { Icon } from '@silkgrain/ui';
import { useRef, useState, type DragEvent } from 'react';

import { ApiRequestError, apiDelete, apiPatch, apiPut, apiUpload } from '../lib/api';

/**
 * A product's images, managed in place.
 *
 * Only on the edit form: an image belongs to a product row, and there is nothing to attach one to
 * until the product exists. So images have their own lifecycle — each upload, reorder and delete is
 * its own request that returns the whole updated list — rather than riding along in the product
 * save. Batching them would mean holding unsaved binary in the browser and losing it on a validation
 * error elsewhere in the form.
 *
 * Order and primary are one concern here, as they are on the server: the first image leads, and
 * "make primary" moves an image to the front. Reordering is left/right rather than drag-to-sort —
 * two buttons a keyboard can reach, against a drag interaction it cannot.
 */
export function ProductImages({
  productId,
  initial,
}: {
  productId: number;
  initial: AdminProductImage[];
}) {
  const [images, setImages] = useState<AdminProductImage[]>(initial);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const base = `/admin/products/${String(productId)}/images`;

  async function run(action: () => Promise<{ images: AdminProductImage[] }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setImages(result.images);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (files === null) return;
    // One at a time, in order, so the positions the server assigns match what was dropped.
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        setError(`${file.name} is not an image.`);
        continue;
      }
      const body = new FormData();
      body.append('file', file);

      await run(() => apiUpload<{ images: AdminProductImage[] }>(base, body));
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(event.dataTransfer.files);
  }

  function arrange(next: AdminProductImage[], primaryId: number) {
    void run(() =>
      apiPut<{ images: AdminProductImage[] }>(base, {
        order: next.map((image) => image.id),
        primaryId,
      }),
    );
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    const primary = images.find((image) => image.isPrimary) ?? images[0] ?? moved;
    arrange(next, primary.id);
  }

  function makePrimary(id: number) {
    arrange(images, id);
  }

  function remove(id: number) {
    void run(() => apiDelete<{ images: AdminProductImage[] }>(`${base}/${String(id)}`));
  }

  function saveAlt(id: number, alt: string) {
    void run(() => apiPatch<{ images: AdminProductImage[] }>(`${base}/${String(id)}`, { alt }));
  }

  return (
    <div>
      {error !== null && (
        <p role="alert" className="mb-3 text-caption font-medium text-terracotta">
          {error}
        </p>
      )}

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- drop target; the
          button inside is the keyboard path to the same file picker. */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-green bg-sage-bg' : 'border-admin-border bg-admin-bg'
        }`}
      >
        <Icon name="package" size={24} className="text-admin-muted" />
        <p className="text-bodySm text-body-muted">
          Drop images here, or{' '}
          <button
            type="button"
            className="font-semibold text-green underline"
            onClick={() => fileInput.current?.click()}
          >
            choose files
          </button>
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-admin-muted">
          Re-encoded to webp · first image leads
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void uploadFiles(event.target.files);
            // Let the same file be chosen again after a delete.
            event.target.value = '';
          }}
        />
      </div>

      {images.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-4 tablet:grid-cols-2 mobile:grid-cols-1">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="overflow-hidden rounded-lg border border-admin-border bg-white"
            >
              <div className="relative aspect-square bg-admin-bg">
                <img
                  src={image.url}
                  alt={image.alt}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {image.isPrimary && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-pill bg-green px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-white">
                    <Icon name="check" weight="bold" size={10} />
                    Primary
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 p-3">
                <input
                  defaultValue={image.alt}
                  placeholder="Describe the image"
                  aria-label="Alt text"
                  className="w-full rounded-md border border-admin-border bg-white px-2.5 py-1.5 text-caption text-ink outline-none focus:border-green"
                  onBlur={(event) => {
                    if (event.target.value !== image.alt) saveAlt(image.id, event.target.value);
                  }}
                />

                <div className="flex items-center gap-1">
                  <IconButton
                    label="Move left"
                    icon="arrow-left"
                    disabled={busy || index === 0}
                    onClick={() => {
                      move(index, -1);
                    }}
                  />
                  <IconButton
                    label="Move right"
                    icon="arrow-right"
                    disabled={busy || index === images.length - 1}
                    onClick={() => {
                      move(index, 1);
                    }}
                  />
                  {!image.isPrimary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        makePrimary(image.id);
                      }}
                      className="ml-1 text-caption text-green hover:underline disabled:opacity-40"
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      remove(image.id);
                    }}
                    aria-label="Delete image"
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-terracotta hover:bg-terracotta-bg disabled:opacity-40"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: 'arrow-left' | 'arrow-right';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-admin-border text-body-muted hover:border-green hover:text-green disabled:opacity-30"
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
