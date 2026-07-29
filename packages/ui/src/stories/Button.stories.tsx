import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../components/Button';

const meta = {
  title: 'Controls/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Shop the pantry' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary', iconRight: 'arrow-right' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Wholesale pricing' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Continue shopping' } };
export const Danger: Story = { args: { variant: 'danger', iconLeft: 'trash', children: 'Remove' } };

export const OnDarkPanel: Story = {
  parameters: { backgrounds: { default: 'greenDeep' } },
  render: () => (
    <div className="flex gap-4">
      <Button variant="light">Shop Devzira</Button>
      <Button variant="goldOutline" iconRight="arrow-right">
        Request wholesale pricing
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const Corners: Story = {
  name: 'Both corner radii',
  render: () => (
    <div className="flex items-center gap-4">
      <Button corner="md">6px — header and cards</Button>
      <Button corner="sharp">3px — hero and drawer</Button>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button>Default</Button>
      <Button loading>Placing order</Button>
      <Button disabled>Sold out</Button>
      <Button fullWidth className="max-w-[240px]">
        Full width
      </Button>
    </div>
  ),
};
