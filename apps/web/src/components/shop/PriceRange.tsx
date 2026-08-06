import { Money } from '@silkgrain/contracts/money';
import { useEffect, useState } from 'react';

/**
 * The dual-handle price slider, with the two boxed values the mockup draws beneath it.
 *
 * Two overlapping `<input type="range">` rather than a custom pointer implementation: they
 * come with keyboard support, `aria-valuenow` and a native thumb on touch, none of which is
 * worth rewriting. The upper track is only clickable on its right half and the lower on its
 * left, so the handles cannot swap places and neither becomes unreachable.
 *
 * Committing on release rather than on every pixel: dragging a slider that refetches on each
 * frame is a slider that fights back.
 */
export function PriceRange({
  minCents,
  maxCents,
  valueMin,
  valueMax,
  onCommit,
}: {
  minCents: number;
  maxCents: number;
  valueMin: number | undefined;
  valueMax: number | undefined;
  onCommit: (next: { min?: number; max?: number }) => void;
}) {
  const [low, setLow] = useState(valueMin ?? minCents);
  const [high, setHigh] = useState(valueMax ?? maxCents);

  // The bounds move when another filter changes, and a handle outside them would be stranded.
  useEffect(() => {
    setLow(valueMin ?? minCents);
    setHigh(valueMax ?? maxCents);
  }, [valueMin, valueMax, minCents, maxCents]);

  const span = Math.max(maxCents - minCents, 1);
  const leftPercent = ((low - minCents) / span) * 100;
  const rightPercent = ((high - minCents) / span) * 100;

  const commit = (nextLow: number, nextHigh: number) => {
    onCommit({
      // A handle left at the end of its track is not a filter, so it is left out of the URL.
      ...(nextLow > minCents ? { min: nextLow } : {}),
      ...(nextHigh < maxCents ? { max: nextHigh } : {}),
    });
  };

  const step = 100;

  return (
    <div>
      <div className="relative h-6">
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        <span
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-green"
          style={{ left: `${String(leftPercent)}%`, right: `${String(100 - rightPercent)}%` }}
        />
        <input
          type="range"
          aria-label="Minimum price"
          min={minCents}
          max={maxCents}
          step={step}
          value={low}
          onChange={(event) => {
            setLow(Math.min(Number(event.target.value), high - step));
          }}
          onPointerUp={() => {
            commit(low, high);
          }}
          onKeyUp={() => {
            commit(low, high);
          }}
          className="pointer-events-none absolute inset-x-0 top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-green [&::-webkit-slider-thumb]:bg-surface"
        />
        <input
          type="range"
          aria-label="Maximum price"
          min={minCents}
          max={maxCents}
          step={step}
          value={high}
          onChange={(event) => {
            setHigh(Math.max(Number(event.target.value), low + step));
          }}
          onPointerUp={() => {
            commit(low, high);
          }}
          onKeyUp={() => {
            commit(low, high);
          }}
          className="pointer-events-none absolute inset-x-0 top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-green [&::-webkit-slider-thumb]:bg-surface"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <output className="flex-1 rounded-sm border border-line bg-parchment px-3 py-2 text-center font-mono text-[12px] text-ink">
          {Money.fromCents(low).format()}
        </output>
        <span className="text-muted">&ndash;</span>
        <output className="flex-1 rounded-sm border border-line bg-parchment px-3 py-2 text-center font-mono text-[12px] text-ink">
          {Money.fromCents(high).format()}
        </output>
      </div>
    </div>
  );
}
