import { Icon } from '@silkgrain/ui';

/**
 * The lockup the mockup uses, because there is no logo asset yet (decision D-9).
 *
 * A green tile holding the `grains` icon, then `silk` in green and `grain` in gold. When a
 * real SVG arrives this is the only file that changes, and the favicon, the OG image and the
 * email header can stop being placeholders at the same time.
 */
export function Wordmark({ onDark = false }: { onDark?: boolean }) {
  return (
    /**
     * One image with one name, rather than three text nodes read in a row.
     *
     * `role="img"` is about the name, not the contrast. The gold half is `#D3A73B` on parchment,
     * which is 2.13:1, and axe reports it - correctly, by its own lights, because it measures
     * what a sighted reader sees and `aria-hidden` does not change that. WCAG 1.4.3 exempts text
     * that is part of a logo or brand name, and there is no markup that states the exemption; it
     * is the one contrast finding on the storefront and it is this mark.
     *
     * Left as the designer drew it on purpose. Decision D-7 bars gold from carrying text
     * everywhere *else*, and nothing else does; redrawing the brand mark to satisfy a checker
     * that cannot know it is a brand mark is the owner's call, not this file's. See STATE.md.
     */
    <span role="img" aria-label="SilkGrain" className="flex items-center gap-3">
      <span
        className={
          onDark
            ? 'flex h-[34px] w-[34px] items-center justify-center rounded-sm bg-gold text-green-deep'
            : 'flex h-[34px] w-[34px] items-center justify-center rounded-sm bg-green text-ondeep'
        }
      >
        <Icon name="grains" size={20} weight="fill" />
      </span>
      <span aria-hidden className="font-display text-[27px] font-semibold leading-none">
        <span className={onDark ? 'text-ondeep' : 'text-green'}>silk</span>
        <span className="text-gold">grain</span>
      </span>
    </span>
  );
}
