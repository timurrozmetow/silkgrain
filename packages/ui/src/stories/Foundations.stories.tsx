import type { Meta, StoryObj } from '@storybook/react';
import type { ReactElement } from 'react';

import { AA_NORMAL, contrastRatio } from '../color';
import { CONTRAST_PAIRS, color, motion, radius, shadow, text } from '../tokens';

const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Swatch({ name, value }: { name: string; value: string }): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-12 w-12 shrink-0 rounded-md border border-line"
        style={{ background: value }}
      />
      <span className="flex flex-col">
        <span className="text-bodySm font-semibold text-ink">{name}</span>
        <span className="font-mono text-caption text-muted">{value}</span>
      </span>
    </div>
  );
}

export const Palette: Story = {
  render: () => (
    <div className="bg-parchment p-10">
      <h2 className="mb-6 font-serif text-h2 text-ink">Palette</h2>
      <div className="grid grid-cols-4 gap-5">
        {Object.entries(color).map(([name, value]) => (
          <Swatch key={name} name={name} value={value} />
        ))}
      </div>
    </div>
  ),
};

export const TypeScale: Story = {
  render: () => (
    <div className="bg-parchment p-10">
      <h2 className="mb-8 font-serif text-h2 text-ink">Type scale</h2>
      <div className="flex flex-col gap-7">
        {Object.entries(text).map(([name, entry]) => (
          <div key={name} className="flex items-baseline gap-6 border-b border-line-soft pb-5">
            <span className="w-32 shrink-0 font-mono text-caption text-muted">{name}</span>
            <span
              className={
                entry.family === 'display'
                  ? 'font-display'
                  : entry.family === 'serif'
                    ? 'font-serif'
                    : entry.family === 'mono'
                      ? 'font-mono'
                      : 'font-sans'
              }
              style={{
                fontSize: entry.size,
                lineHeight: entry.lineHeight,
                letterSpacing: entry.tracking,
                fontWeight: entry.weight,
              }}
            >
              Grains of quiet provenance
            </span>
            <span className="ml-auto shrink-0 font-mono text-caption text-muted-soft">
              {entry.size} / {String(entry.weight)}
            </span>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const Contrast: Story = {
  name: 'Contrast contract',
  render: () => (
    <div className="bg-parchment p-10">
      <h2 className="mb-2 font-serif text-h2 text-ink">Contrast contract</h2>
      <p className="mb-7 max-w-[640px] text-bodySm text-muted">
        Every combination the storefront uses, checked against WCAG 2.1. The same list is asserted
        in <span className="font-mono">tokens.test.ts</span>, so a regression fails the build rather
        than shipping.
      </p>
      <table className="w-full max-w-[900px] border-collapse text-bodySm">
        <thead>
          <tr className="border-b border-line text-left text-caption uppercase tracking-[0.06em] text-muted">
            <th className="py-2">Usage</th>
            <th className="py-2">Sample</th>
            <th className="py-2">Ratio</th>
            <th className="py-2">Required</th>
          </tr>
        </thead>
        <tbody>
          {CONTRAST_PAIRS.map((pair) => {
            const ratio = contrastRatio(pair.foreground, pair.background);
            return (
              <tr key={`${pair.usage}-${pair.background}`} className="border-b border-line-soft">
                <td className="py-2.5 pr-4 text-body">{pair.usage}</td>
                <td className="py-2.5 pr-4">
                  <span
                    className="inline-block rounded-sm px-3 py-1.5"
                    style={{ color: pair.foreground, background: pair.background }}
                  >
                    Devzira rice 4.9
                  </span>
                </td>
                <td className="py-2.5 pr-4 font-mono text-body">{ratio.toFixed(2)}:1</td>
                <td className="py-2.5 font-mono text-muted">
                  {pair.level === AA_NORMAL ? '4.5 (text)' : '3.0 (non-text)'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ),
};

export const Surfaces: Story = {
  name: 'Radius, shadow, motion',
  render: () => (
    <div className="bg-parchment p-10">
      <h2 className="mb-6 font-serif text-h2 text-ink">Radius</h2>
      <div className="mb-12 flex gap-5">
        {Object.entries(radius).map(([name, value]) => (
          <div key={name} className="flex flex-col items-center gap-2">
            <span
              className="h-20 w-20 border border-line bg-surface"
              style={{ borderRadius: value }}
            />
            <span className="font-mono text-caption text-muted">
              {name} {value}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mb-6 font-serif text-h2 text-ink">Shadow</h2>
      <div className="mb-12 flex flex-wrap gap-8">
        {Object.entries(shadow).map(([name, value]) => (
          <div key={name} className="flex flex-col items-center gap-3">
            <span className="h-20 w-32 rounded-lg bg-surface" style={{ boxShadow: value }} />
            <span className="font-mono text-caption text-muted">{name}</span>
          </div>
        ))}
      </div>

      <h2 className="mb-6 font-serif text-h2 text-ink">Motion</h2>
      <dl className="grid max-w-[560px] grid-cols-2 gap-x-8 gap-y-2 text-bodySm">
        {Object.entries(motion.duration).map(([name, value]) => (
          <div key={name} className="flex justify-between border-b border-line-soft py-1.5">
            <dt className="text-body">{name}</dt>
            <dd className="font-mono text-muted">{value}</dd>
          </div>
        ))}
        {Object.entries(motion.easing).map(([name, value]) => (
          <div key={name} className="flex justify-between border-b border-line-soft py-1.5">
            <dt className="text-body">{name}</dt>
            <dd className="font-mono text-caption text-muted">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  ),
};
