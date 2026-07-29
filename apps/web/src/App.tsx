import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Diamond,
  EmptyState,
  Eyebrow,
  Field,
  Icon,
  Input,
  Pagination,
  PriceTag,
  ProductCard,
  QuantityStepper,
  Radio,
  Select,
  Skeleton,
  StarRating,
  StatusChip,
  Tabs,
  Textarea,
} from '@silkgrain/ui';
import { useState, type ReactElement } from 'react';

/**
 * Design system preview.
 *
 * Phase 1 has no routing and no data yet, so this page exists to render every component
 * against the real tokens and fonts. Phase 5 replaces it with the storefront.
 */
export function App(): ReactElement {
  const [qty, setQty] = useState(2);
  const [tab, setTab] = useState('description');
  const [page, setPage] = useState(1);

  return (
    <main className="mx-auto max-w-container px-7 py-16">
      <a href="#components" className="sg-skip-link">
        Skip to components
      </a>

      <header className="flex flex-col gap-5 pb-14">
        <Eyebrow marker="rule" tracking="wide">
          From Silk Road soil to your spoon
        </Eyebrow>
        <h1 className="font-display text-hero font-medium text-ink">
          Grains of quiet <span className="italic text-green">provenance</span>
        </h1>
        <p className="max-w-[470px] text-bodyLg text-muted">
          Aged devzira rice, heirloom lentils and sun-dried fruit &mdash; from named farms across
          Central Asia, shipped fresh from Houston.
        </p>
      </header>

      <div id="components" className="flex flex-col gap-14">
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" iconRight="arrow-right">
              Shop the pantry
            </Button>
            <Button variant="outline">Wholesale pricing</Button>
            <Button variant="ghost">Continue shopping</Button>
            <Button variant="danger" iconLeft="trash">
              Remove
            </Button>
            <Button variant="primary" loading>
              Placing order
            </Button>
            <Button variant="primary" disabled>
              Sold out
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg" corner="sharp">
              Large, sharp corner
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-green-deep p-6">
            <Button variant="light">Shop Devzira</Button>
            <Button variant="goldOutline" iconRight="arrow-right">
              Request wholesale pricing
            </Button>
          </div>
        </Section>

        <Section title="Badges and chips">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="bestseller">Bestseller</Badge>
            <Badge tone="new">New</Badge>
            <Badge tone="sale">Sale</Badge>
            <Badge tone="organic">Organic</Badge>
            <Badge tone="premium">Premium</Badge>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <StatusChip tone="positive">Delivered</StatusChip>
            <StatusChip tone="warning">Processing</StatusChip>
            <StatusChip tone="negative">Cancelled</StatusChip>
            <StatusChip tone="neutral">Draft</StatusChip>
            <StatusChip tone="info">Shipped</StatusChip>
          </div>
        </Section>

        <Section title="Price, rating, quantity">
          <div className="flex flex-wrap items-end gap-10">
            <PriceTag cents={3250} size="lg" unit="per 5 lb" />
            <PriceTag cents={1499} compareAtCents={1899} showFrom />
            <StarRating value={4.9} reviewCount={142} />
            <QuantityStepper value={qty} onChange={setQty} label="Quantity of Devzira rice" />
          </div>
        </Section>

        <Section title="Forms">
          <div className="grid max-w-[720px] grid-cols-2 gap-5">
            <Field label="Email address" required hint="We only use it for order updates.">
              <Input type="email" placeholder="you@email.com" />
            </Field>
            <Field label="ZIP" required error="Enter a valid US ZIP code">
              <Input defaultValue="770" />
            </Field>
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
              <Field label="Message">
                <Textarea placeholder="Tell us about your needs, timelines or packaging requirements." />
              </Field>
            </div>
          </div>

          <div className="mt-6 flex gap-16">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-caption font-medium text-body-muted">Categories</legend>
              <Checkbox name="cat" label="Rice &amp; Grains" count={24} defaultChecked />
              <Checkbox name="cat" label="Lentils &amp; Legumes" count={18} />
              <Checkbox name="cat" label="Dried Fruits" count={12} />
              <Checkbox name="cat" label="Ready Mixes" count={5} disabled />
            </fieldset>

            <fieldset className="flex w-[420px] flex-col gap-3">
              <legend className="mb-2 text-caption font-medium text-body-muted">
                Shipping method
              </legend>
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
          </div>
        </Section>

        <Section title="Product card">
          <div className="grid grid-cols-4 gap-6">
            <ProductCard
              href="/product/uzbek-devzira-rice"
              onQuickView={() => undefined}
              onAddToCart={() => undefined}
              onToggleWishlist={() => undefined}
              product={{
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
              }}
            />
            <ProductCard
              href="/product/saffron-threads"
              onQuickView={() => undefined}
              onAddToCart={() => undefined}
              onToggleWishlist={() => undefined}
              wishlisted
              product={{
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
              }}
            />
            <ProductCard
              href="/product/dried-black-plums"
              onAddToCart={() => undefined}
              product={{
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
              }}
            />
            <Card padding="none" className="flex flex-col gap-3 p-4">
              <Skeleton shape="block" height={180} />
              <Skeleton width="60%" />
              <Skeleton width="90%" />
              <Skeleton width="40%" />
            </Card>
          </div>
        </Section>

        <Section title="Navigation">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/' },
              { label: 'Shop', href: '/shop' },
              { label: 'Uzbek Devzira Rice' },
            ]}
          />
          <div className="mt-6 max-w-[840px]">
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
              <p className="text-body text-body-muted">
                Devzira is a heritage rice cultivated in the Fergana Valley and aged to develop its
                signature amber stripe.
              </p>
            </Tabs>
          </div>
          <div className="mt-8">
            <Pagination page={page} pageCount={12} onChange={setPage} />
          </div>
        </Section>

        <Section title="Empty states">
          <div className="grid grid-cols-2 gap-6">
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
              description={'We couldn’t find anything for “quinoa flakes.”'}
              action={<Button variant="outline">Browse All Products</Button>}
            />
          </div>
        </Section>

        <Section title="Marker and icons">
          <div className="flex items-center gap-6">
            <Diamond />
            <Diamond size={6} />
            <Icon name="grains" weight="fill" size={28} className="text-green" />
            <Icon name="bowl-food" size={28} className="text-sage" />
            <Icon name="cherries" size={28} className="text-sage" />
            <Icon name="cooking-pot" size={28} className="text-sage" />
            <Icon name="handshake" size={28} className="text-sage" />
          </div>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactElement | ReactElement[] }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line-soft pt-10">
      <h2 className="font-serif text-h2 text-ink">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
