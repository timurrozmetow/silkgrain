import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Badge, StatusChip } from '../components/Badge';
import { PriceTag } from '../components/PriceTag';
import { ProductCard, type ProductCardProduct } from '../components/ProductCard';
import { QuantityStepper } from '../components/QuantityStepper';
import { StarRating } from '../components/StarRating';

const meta = {
  title: 'Commerce',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const devzira: ProductCardProduct = {
  slug: 'uzbek-devzira-rice',
  name: 'Uzbek Devzira Rice',
  blurb: 'Aged long-grain rice, the heart of authentic Uzbek plov.',
  categoryName: 'Rice & Grains',
  badges: ['bestseller'],
  rating: 4.9,
  reviewCount: 142,
  stockState: 'in',
  weightLabels: ['2 lb', '5 lb', '10 lb', '25 lb'],
  priceFromCents: 1499,
  fallbackIcon: 'bowl-food',
};

const saffron: ProductCardProduct = {
  slug: 'saffron-threads',
  name: 'Saffron Threads',
  blurb: 'Hand-picked saffron, deep colour and aroma.',
  categoryName: 'Spices & Herbs',
  badges: ['premium', 'new'],
  rating: 5,
  reviewCount: 61,
  stockState: 'low',
  weightLabels: ['1 g', '2 g'],
  priceFromCents: 2400,
  fallbackIcon: 'leaf',
};

const plums: ProductCardProduct = {
  slug: 'dried-black-plums',
  name: 'Dried Black Plums',
  blurb: 'Smoky-sweet dried plums for stews and compote.',
  categoryName: 'Dried Fruits',
  badges: ['sale'],
  rating: 4.6,
  reviewCount: 42,
  stockState: 'out',
  weightLabels: ['1 lb', '2 lb'],
  priceFromCents: 1099,
  compareAtCents: 1225,
  fallbackIcon: 'cherries',
};

export const Cards: Story = {
  name: 'Product card',
  render: () => (
    <div className="grid grid-cols-3 gap-6">
      {[devzira, saffron, plums].map((product) => (
        <ProductCard
          key={product.slug}
          product={product}
          href={`/product/${product.slug}`}
          onQuickView={() => undefined}
          onAddToCart={() => undefined}
          onToggleWishlist={() => undefined}
          wishlisted={product.slug === 'saffron-threads'}
        />
      ))}
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        <Badge tone="bestseller">Bestseller</Badge>
        <Badge tone="new">New</Badge>
        <Badge tone="sale">Sale</Badge>
        <Badge tone="organic">Organic</Badge>
        <Badge tone="premium">Premium</Badge>
      </div>
      <div className="flex flex-wrap gap-3">
        <StatusChip tone="positive">Delivered</StatusChip>
        <StatusChip tone="warning">Processing</StatusChip>
        <StatusChip tone="negative">Cancelled</StatusChip>
        <StatusChip tone="neutral">Draft</StatusChip>
        <StatusChip tone="info">Shipped</StatusChip>
      </div>
    </div>
  ),
};

export const Prices: Story = {
  render: () => (
    <div className="flex items-end gap-12">
      <PriceTag cents={3250} size="lg" unit="per 5 lb" />
      <PriceTag cents={1499} showFrom />
      <PriceTag cents={1099} compareAtCents={1225} />
      <PriceTag cents={899} size="sm" />
    </div>
  ),
};

export const Ratings: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <StarRating value={4.9} reviewCount={142} size="lg" />
      <StarRating value={4.6} reviewCount={42} />
      <StarRating value={3.2} size="sm" compact />
    </div>
  ),
};

export const Quantity: Story = {
  render: function Render() {
    const [small, setSmall] = useState(1);
    const [large, setLarge] = useState(2);
    return (
      <div className="flex items-center gap-8">
        <QuantityStepper size="sm" value={small} onChange={setSmall} label="Cart line quantity" />
        <QuantityStepper value={large} onChange={setLarge} label="Product page quantity" />
        <QuantityStepper value={1} onChange={() => undefined} disabled label="Disabled" />
      </div>
    );
  },
};
