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
    <span className="flex items-center gap-3">
      <span
        className={
          onDark
            ? 'flex h-[34px] w-[34px] items-center justify-center rounded-sm bg-gold text-green-deep'
            : 'flex h-[34px] w-[34px] items-center justify-center rounded-sm bg-green text-ondeep'
        }
      >
        <Icon name="grains" size={20} weight="fill" />
      </span>
      <span className="font-display text-[27px] font-semibold leading-none">
        <span className={onDark ? 'text-ondeep' : 'text-green'}>silk</span>
        <span className="text-gold">grain</span>
      </span>
    </span>
  );
}
