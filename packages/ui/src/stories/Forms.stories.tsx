import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { Radio } from '../components/Radio';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';

const meta = {
  title: 'Controls/Forms',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextFields: Story = {
  render: () => (
    <div className="grid max-w-[640px] grid-cols-2 gap-5">
      <Field label="First name" required>
        <Input placeholder="John" />
      </Field>
      <Field label="Last name" required>
        <Input placeholder="Carter" />
      </Field>
      <Field label="Email address" required hint="Only used for order updates.">
        <Input type="email" placeholder="you@email.com" />
      </Field>
      <Field label="ZIP" required error="Enter a valid US ZIP code">
        <Input defaultValue="770" />
      </Field>
      <Field label="Search">
        <Input iconLeft="magnifying-glass" placeholder="Search rice, lentils, saffron…" />
      </Field>
      <Field label="Promo code">
        <Input
          placeholder="WELCOME10"
          addonRight={
            <Button size="sm" variant="ghost">
              Apply
            </Button>
          }
        />
      </Field>
      <div className="col-span-2">
        <Field label="Message" hint="Tell us about volumes, timelines or packaging.">
          <Textarea placeholder="…" />
        </Field>
      </div>
      <Field label="Disabled">
        <Input disabled defaultValue="Not editable" />
      </Field>
    </div>
  ),
};

export const Selects: Story = {
  render: () => (
    <div className="grid max-w-[520px] grid-cols-2 gap-5">
      <Field label="State" required>
        <Select
          placeholder="Choose a state"
          options={[
            { value: 'TX', label: 'Texas' },
            { value: 'NY', label: 'New York' },
            { value: 'CA', label: 'California' },
          ]}
        />
      </Field>
      <Field label="Business type" required>
        <Select
          defaultValue="restaurant"
          options={[
            { value: 'restaurant', label: 'Restaurant' },
            { value: 'grocery', label: 'Grocery store' },
            { value: 'distributor', label: 'Distributor' },
            { value: 'meal_kit', label: 'Meal kit' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </Field>
    </div>
  ),
};

export const Checkboxes: Story = {
  render: function Render() {
    const [checked, setChecked] = useState<Record<string, boolean>>({ rice: true, fruits: true });
    const rows = [
      { id: 'rice', label: 'Rice & Grains', count: 24 },
      { id: 'lentils', label: 'Lentils & Legumes', count: 18 },
      { id: 'fruits', label: 'Dried Fruits', count: 12 },
      { id: 'spices', label: 'Spices & Herbs', count: 9 },
    ];

    return (
      <fieldset className="flex w-[260px] flex-col gap-3.5 rounded-lg border border-line-soft bg-surface p-5">
        <legend className="px-1 text-caption font-semibold uppercase tracking-[0.1em] text-gold-dark">
          Categories
        </legend>
        {rows.map((row) => (
          <Checkbox
            key={row.id}
            label={row.label}
            count={row.count}
            checked={checked[row.id] ?? false}
            onChange={(event) => {
              setChecked((current) => ({ ...current, [row.id]: event.target.checked }));
            }}
          />
        ))}
        <Checkbox label="Ready Mixes" count={5} disabled />
      </fieldset>
    );
  },
};

export const ShippingMethods: Story = {
  render: () => (
    <fieldset className="flex w-[440px] flex-col gap-3.5">
      <legend className="mb-2 font-serif text-h3 text-ink">Shipping Method</legend>
      <Radio
        name="ship"
        variant="card"
        label="Standard Shipping"
        description="3–5 business days"
        trailing="FREE"
        defaultChecked
      />
      <Radio
        name="ship"
        variant="card"
        label="Express Shipping"
        description="1–2 business days"
        trailing="$12.99"
      />
      <Radio
        name="ship"
        variant="card"
        label="Overnight"
        description="Next business day"
        trailing="$24.99"
      />
    </fieldset>
  ),
};
