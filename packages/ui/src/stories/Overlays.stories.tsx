import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { Modal } from '../components/Modal';
import { PriceTag } from '../components/PriceTag';
import { ToastProvider, useToast } from '../components/Toast';

const meta = {
  title: 'Overlays',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const QuickView: Story = {
  name: 'Modal — quick view',
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Open quick view
        </Button>
        <Modal
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Uzbek Devzira Rice"
          hideTitle
          size="quickView"
        >
          <div className="grid grid-cols-2">
            <div className="min-h-[420px] bg-[linear-gradient(180deg,#FFFFFF_0%,#F1E9DA_100%)]" />
            <div className="flex flex-col gap-3.5 p-9">
              <span className="text-microLabel font-semibold uppercase tracking-[0.12em] text-gold-dark">
                Rice &amp; Grains
              </span>
              <h3 className="font-display text-[34px] font-semibold leading-[1.08] text-ink">
                Uzbek Devzira Rice
              </h3>
              <p className="text-bodySm leading-[1.65] text-muted">
                Aged long-grain rice, the heart of authentic Uzbek plov.
              </p>
              <span className="font-mono text-caption text-muted-soft">
                2 lb · 5 lb · 10 lb · 25 lb
              </span>
              <PriceTag cents={1499} size="lg" />
              <div className="mt-2 flex gap-3">
                <Button corner="sharp" fullWidth>
                  Add to cart
                </Button>
                <Button corner="sharp" variant="outline">
                  Full details
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      </>
    );
  },
};

export const CartDrawer: Story = {
  name: 'Drawer — cart',
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Open cart drawer
        </Button>
        <Drawer
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title={
            <>
              Your Cart <span className="font-mono text-caption text-muted-soft">(3 items)</span>
            </>
          }
          ariaLabel="Your cart"
          footer={
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-bodySm text-muted">Subtotal</span>
                <PriceTag cents={6747} />
              </div>
              <Button corner="sharp" fullWidth>
                Checkout
              </Button>
              <button type="button" className="text-caption font-semibold text-green underline">
                View full cart
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-2 py-3">
            <div className="flex flex-col gap-2 rounded-lg bg-gold-notice px-5 py-4">
              <span className="text-caption font-semibold text-green">
                You&rsquo;re $7.53 away from free shipping
              </span>
              <div className="h-1.5 overflow-hidden rounded-pill bg-surface-alt">
                <span className="block h-full w-[90%] rounded-pill bg-green" />
              </div>
            </div>
            {['Uzbek Devzira Rice', 'Dried Apricots (Kuraga)', 'Plov Spice Mix'].map((name) => (
              <div
                key={name}
                className="flex items-center gap-3.5 border-b border-line-soft py-3.5"
              >
                <span className="h-[58px] w-[58px] shrink-0 rounded-sm bg-[linear-gradient(180deg,#FFFFFF_0%,#F1E9DA_100%)]" />
                <span className="flex flex-1 flex-col">
                  <span className="text-bodySm font-semibold text-ink">{name}</span>
                  <span className="font-mono text-caption text-muted-soft">5 lb · ×2</span>
                </span>
                <PriceTag cents={6500} size="sm" />
              </div>
            ))}
          </div>
        </Drawer>
      </>
    );
  },
};

export const Toasts: Story = {
  render: () => (
    <ToastProvider>
      <ToastButtons />
    </ToastProvider>
  ),
};

function ToastButtons() {
  const { show } = useToast();
  return (
    <div className="flex gap-3">
      <Button
        onClick={() => {
          show('success', 'Uzbek Devzira Rice added to your cart.');
        }}
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          show('info', 'Prices refreshed.');
        }}
      >
        Info
      </Button>
      <Button
        variant="danger"
        onClick={() => {
          show('error', 'That promo code has expired.');
        }}
      >
        Error
      </Button>
    </div>
  );
}
