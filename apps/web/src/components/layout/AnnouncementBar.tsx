import { Diamond } from '@silkgrain/ui';

import { freeShippingLabel, usePublicSettings } from '../../lib/use-public-settings';

/**
 * The strip above the header.
 *
 * The copy comes from `announcement.text` and the threshold from the shipping rates, both through
 * `GET /api/settings`. Decision D-22 makes `shipping_rates.free_above_cents` the authority on free
 * shipping because the checkout charges from it, and this line used to hard-code "$75" - a second
 * copy of the number that could quietly stop being true.
 *
 * The fallback is the second half of the sentence alone rather than a guessed threshold: promising
 * free shipping over an amount nobody has confirmed is worse than not mentioning it.
 */
export function AnnouncementBar() {
  const { data } = usePublicSettings();

  const threshold = freeShippingLabel(data?.freeShippingFromCents);
  const line =
    data?.announcementText ??
    (threshold === null
      ? 'Direct from family farms'
      : `Complimentary shipping over ${threshold} · Direct from family farms`);

  return (
    <div className="bg-green-deep text-ondeep-soft">
      <p className="mx-auto flex max-w-container items-center justify-center gap-3 px-gutter py-2.5 text-[12px] tracking-wide tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:text-[11px]">
        <Diamond />
        <span>{line}</span>
        <Diamond />
      </p>
    </div>
  );
}
