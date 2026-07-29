import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Accordion, AccordionItem } from '../components/Accordion';
import { Breadcrumb } from '../components/Breadcrumb';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Diamond } from '../components/Diamond';
import { EmptyState } from '../components/EmptyState';
import { Eyebrow } from '../components/Eyebrow';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { Tabs } from '../components/Tabs';

const meta = {
  title: 'Navigation & Feedback',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Breadcrumbs: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Shop', href: '/shop' },
          { label: 'Uzbek Devzira Rice' },
        ]}
      />
      <div className="rounded-lg bg-green-deep p-6">
        <Breadcrumb
          tone="dark"
          items={[
            { label: 'Home', href: '/' },
            { label: 'Shop', href: '/shop' },
            { label: 'Rice & Grains' },
          ]}
        />
      </div>
    </div>
  ),
};

export const ProductTabs: Story = {
  render: function Render() {
    const [tab, setTab] = useState('description');
    return (
      <div className="max-w-[840px]">
        <Tabs
          label="Product details"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'description', label: 'Description' },
            { id: 'nutrition', label: 'Nutrition Facts' },
            { id: 'origin', label: 'Origin & Sourcing' },
            { id: 'reviews', label: 'Reviews (142)' },
          ]}
        >
          <p className="text-body leading-[1.75] text-body-muted">
            Devzira is a heritage rice cultivated in the Fergana Valley and aged to develop its
            signature amber stripe. The grains drink up broth and fat without turning sticky.
          </p>
        </Tabs>
      </div>
    );
  },
};

export const Faq: Story = {
  render: function Render() {
    const [open, setOpen] = useState(0);
    const faqs = [
      {
        q: 'Where do you ship from, and how long does it take?',
        a: 'Every order ships from our Houston, TX warehouse within 48 hours. Standard delivery is 3–5 business days anywhere in the continental US.',
      },
      {
        q: 'Are your grains organic and lab-tested?',
        a: 'All products are all-natural, and every batch is lab-tested for purity before it clears import.',
      },
      {
        q: 'What is your return policy?',
        a: 'If anything arrives damaged, contact us within 30 days for a replacement or full refund.',
      },
    ];

    return (
      <div className="max-w-[820px]">
        <Accordion>
          {faqs.map((faq, index) => (
            <AccordionItem
              key={faq.q}
              question={faq.q}
              answer={faq.a}
              open={open === index}
              onToggle={() => {
                setOpen(open === index ? -1 : index);
              }}
            />
          ))}
        </Accordion>
      </div>
    );
  },
};

export const Pages: Story = {
  render: function Render() {
    const [page, setPage] = useState(1);
    return (
      <div className="flex flex-col gap-8">
        <Pagination page={page} pageCount={4} onChange={setPage} />
        <Pagination page={page} pageCount={12} onChange={setPage} />
      </div>
    );
  },
};

export const EmptyStates: Story = {
  render: () => (
    <div className="grid max-w-[900px] grid-cols-2 gap-6">
      <EmptyState
        icon="shopping-cart"
        tone="gold"
        title="Your cart is empty"
        description="Looks like you haven't added any grains yet. The pantry is waiting."
        action={<Button>Start Shopping</Button>}
      />
      <EmptyState
        icon="magnifying-glass"
        tone="green"
        title="No results found"
        description={'We couldn’t find anything for “quinoa flakes.” Try a different search.'}
        action={<Button variant="outline">Browse All Products</Button>}
      />
      <EmptyState
        icon="heart"
        tone="gold"
        title="Nothing saved yet"
        description="Tap the heart on any product to keep it here for later."
        action={<Button>Browse the shop</Button>}
      />
      <EmptyState
        icon="handshake"
        tone="green"
        title="No wholesale requests"
        description="New enquiries from the wholesale form will appear here."
      />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="grid max-w-[900px] grid-cols-3 gap-6">
      {[0, 1, 2].map((index) => (
        <Card key={index} padding="none" className="flex flex-col gap-3 p-4">
          <Skeleton shape="block" height={200} />
          <Skeleton width="45%" height={10} />
          <Skeleton width="80%" height={20} />
          <Skeleton width="100%" />
          <Skeleton width="35%" height={22} />
        </Card>
      ))}
    </div>
  ),
};

export const Markers: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Eyebrow>Pantry favorites</Eyebrow>
      <Eyebrow marker="rule" tracking="wide">
        From Silk Road soil to your spoon
      </Eyebrow>
      <Eyebrow marker="none">Just landed</Eyebrow>
      <div className="rounded-lg bg-green-deep p-6">
        <Eyebrow tone="dark" marker="none">
          Wholesale
        </Eyebrow>
      </div>
      <div className="flex items-center gap-4">
        <Diamond size={6} />
        <Diamond size={7} />
      </div>
    </div>
  ),
};
