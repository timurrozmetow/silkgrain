import { Diamond } from '@silkgrain/ui';

/**
 * The strip above the header.
 *
 * The threshold in the copy is decorative. `shipping_rates.free_above_cents` is what the
 * checkout charges from (decision D-22), so this line is marketing that happens to agree with
 * it rather than a second source of the number.
 */
export function AnnouncementBar() {
  return (
    <div className="bg-green-deep text-ondeep-soft">
      <p className="mx-auto flex max-w-container items-center justify-center gap-3 px-gutter py-2.5 text-[12px] tracking-wide tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:text-[11px]">
        <Diamond />
        <span>Complimentary shipping over $75 &middot; Direct from family farms</span>
        <Diamond />
      </p>
    </div>
  );
}
