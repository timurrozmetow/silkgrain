import type { IconProps as PhosphorIconProps } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

import { ICON_REGISTRY, type IconName } from './icon-registry';

export type { IconName };
export { isIconName } from './icon-registry';

export type IconWeight = 'regular' | 'fill' | 'bold' | 'duotone' | 'light' | 'thin';

export interface IconProps extends Omit<PhosphorIconProps, 'weight'> {
  /** Kebab-case Phosphor name, the same string the mockup writes in its CSS class. */
  name: IconName;
  /** Defaults to `regular`, matching the mockup. */
  weight?: IconWeight;
  /**
   * Decorative by default and hidden from assistive tech. Pass a label only when the icon
   * is the sole carrier of meaning, such as a button with no visible text.
   */
  label?: string;
}

/**
 * Icon wrapper over Phosphor.
 *
 * Names come from `icon-registry.ts`, so an unknown icon is a type error at the call site
 * rather than a blank space at runtime.
 */
export function Icon({ name, weight = 'regular', label, ...rest }: IconProps): ReactElement {
  const Glyph = ICON_REGISTRY[name];
  return (
    <Glyph
      weight={weight}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      {...rest}
    />
  );
}
