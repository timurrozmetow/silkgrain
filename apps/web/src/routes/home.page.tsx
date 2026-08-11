import type { CategoryListResponse, ProductListResponse } from '@silkgrain/contracts';
import { Eyebrow, Icon, type IconName, isIconName } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { ButtonLink } from '../components/ButtonLink';
import { FeaturedSlider } from '../components/home/FeaturedSlider';
import { Testimonials } from '../components/home/Testimonials';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductGrid';
import { apiGet } from '../lib/api';
import { ORGANIZATION_JSON_LD, Seo } from '../lib/seo';
import { useParallax } from '../lib/use-parallax';

/**
 * The home page.
 *
 * Two sections the mockup draws are deliberately absent: "The Plov Set" needs a bundle entity
 * that does not exist in the data model, and "Subscribe & Save" needs Stripe Subscriptions.
 * Both are in `BACKLOG.md` with an estimate. Rendering either against invented data would put
 * a price on the page that no order could ever honour.
 *
 * The wholesale band is the third, and for a different reason: its call to action goes to
 * `/wholesale`, which Phase 6 builds. A banner linking nowhere is worse than no banner.
 */

const SECTION = 'mx-auto max-w-container px-gutter tablet:px-gutter-tablet mobile:px-gutter-mobile';

function Home() {
  return (
    <>
      <Seo
        title="SilkGrain — Ancient Grains. Modern Table."
        description="Central Asian rice, lentils, dried fruit and spices, bought direct from the families who grow them and shipped fresh from Houston."
        canonicalPath="/"
        jsonLd={ORGANIZATION_JSON_LD}
      />
      <FeaturedSlider />
      <Hero />
      <CategoryStrip />
      <BestSellers />
      <ValueProps />
      <OriginStory />
      <NewArrivals />
      <Testimonials />
    </>
  );
}

function Hero() {
  const parallax = useParallax(0.12);

  return (
    <section
      className={`${SECTION} grid grid-cols-[1.02fr_0.98fr] items-center gap-16 py-20 tablet:gap-10 tablet:py-14 mobile:grid-cols-1 mobile:gap-8 mobile:py-10`}
    >
      <div>
        <div className="flex items-center gap-3">
          <span className="h-px w-10 bg-gold" />
          <Eyebrow>From Silk Road soil to your spoon</Eyebrow>
        </div>
        <h1 className="mt-6 font-display text-[76px] font-medium leading-[1.05] text-ink tablet:text-[56px] mobile:text-[40px]">
          Grains of quiet <em className="italic text-green">provenance</em>
        </h1>
        <p className="mt-6 max-w-[46ch] text-body text-body-muted">
          Devzira rice from the Fergana Valley, apricots dried on the branch, spices ground the week
          they ship. Bought direct from the families who grow them.
        </p>
        <div className="mt-9 flex items-center gap-7 mobile:flex-wrap mobile:gap-4">
          <ButtonLink to="/shop" size="lg" corner="sharp">
            Shop the pantry
          </ButtonLink>
          <Link
            to="/about"
            className="text-bodySm text-green underline underline-offset-4 hover:text-gold-dark"
          >
            Read our story
          </Link>
        </div>
        <dl className="mt-12 flex gap-10 border-t border-line pt-7 mobile:flex-wrap mobile:gap-6">
          {[
            ['40+', 'named farms'],
            ['100%', 'lab-tested'],
            ['48h', 'fresh dispatch'],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="font-mono text-[22px] text-green">{value}</dt>
              <dd className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                {label}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* The photograph is a placeholder tile until real product photography exists (Q-8).
          It carries the mockup's `scrollY * 0.12` parallax, which the hook turns off entirely
          under prefers-reduced-motion rather than merely damping. */}
      <div className="relative" style={{ transform: `translate3d(0, ${String(-parallax)}px, 0)` }}>
        <div className="absolute -left-3 -top-3 h-full w-full border border-gold" aria-hidden />
        <div className="relative flex aspect-[4/5] items-center justify-center bg-gradient-to-br from-gold-pale to-surface shadow-[0_30px_70px_rgba(14,58,42,0.18)]">
          <Icon name="grains" size={96} className="text-green/25" />
        </div>
        <div className="absolute -bottom-6 -left-6 bg-surface px-6 py-4 shadow-panel mobile:-left-2 mobile:-bottom-4">
          <p className="font-mono text-[26px] text-green">12</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Months aged
          </p>
        </div>
      </div>
    </section>
  );
}

function CategoryStrip() {
  const { data } = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
  });

  return (
    <section className={`${SECTION} pb-20 mobile:pb-12`}>
      <div className="grid grid-cols-6 gap-4 tablet:grid-cols-3 mobile:grid-cols-2">
        {(data?.items ?? []).map((category) => (
          <Link
            key={category.slug}
            to="/shop"
            search={{ category: category.slug }}
            className="group flex flex-col items-center gap-3 border border-line bg-surface px-4 py-7 text-center transition-all duration-base hover:-translate-y-[3px] hover:border-green hover:bg-green"
          >
            <Icon
              name={isIconName(category.icon) ? category.icon : 'bowl-food'}
              size={28}
              className="text-green transition-colors group-hover:text-ondeep"
            />
            <span className="text-bodySm text-ink transition-colors group-hover:text-ondeep">
              {category.name}
            </span>
            <span className="font-mono text-[11px] text-muted transition-colors group-hover:text-ondeep-muted">
              {category.productCount}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  linkLabel,
}: {
  eyebrow: string;
  title: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-9 flex items-end justify-between gap-6 mobile:mb-6 mobile:flex-col mobile:items-start mobile:gap-3">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-3 font-serif text-[40px] leading-tight text-ink mobile:text-[28px]">
          {title}
        </h2>
      </div>
      <Link
        to="/shop"
        className="shrink-0 text-bodySm text-green underline underline-offset-4 hover:text-gold-dark"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

function ProductRail({
  eyebrow,
  title,
  sort,
}: {
  eyebrow: string;
  title: string;
  sort: 'bestselling' | 'newest';
}) {
  const { data, isPending } = useQuery({
    queryKey: ['products', 'rail', sort],
    queryFn: ({ signal }) =>
      apiGet<ProductListResponse>(`/products?sort=${sort}&perPage=4`, signal),
  });

  return (
    <section className={`${SECTION} pb-20 mobile:pb-12`}>
      <SectionHeading eyebrow={eyebrow} title={title} linkLabel="View All Products" />
      {isPending ? <ProductGridSkeleton /> : <ProductGrid products={data?.items ?? []} />}
    </section>
  );
}

function BestSellers() {
  return <ProductRail eyebrow="Pantry favorites" title="Best Sellers" sort="bestselling" />;
}

function NewArrivals() {
  return <ProductRail eyebrow="Just landed" title="New Arrivals" sort="newest" />;
}

const VALUES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'handshake',
    title: 'Direct from farmers',
    body: 'We buy from named growers, not brokers, and pay before the harvest ships.',
  },
  {
    icon: 'flask',
    title: 'Lab tested',
    body: 'Every lot is screened for pesticides, heavy metals and moisture before it lands.',
  },
  {
    icon: 'truck',
    title: 'Fast US delivery',
    body: 'Dispatched from Houston within 48 hours, anywhere in the fifty states.',
  },
];

/**
 * The origin story, two columns with a placeholder map tile.
 *
 * Static copy on purpose: it is brand writing, not content an editor changes per deploy, and
 * `/about` is where the long version lives. It ships now because that destination exists - the
 * same test every call to action on this page has to pass.
 */
function OriginStory() {
  return (
    <section className={`${SECTION} py-20 mobile:py-12`}>
      <div className="grid grid-cols-2 items-center gap-14 tablet:gap-10 mobile:grid-cols-1 mobile:gap-8">
        <div>
          <Eyebrow>Where it comes from</Eyebrow>
          <h2 className="mt-3 font-serif text-[40px] leading-tight text-ink mobile:text-[28px]">
            From the Heart of the Silk Road
          </h2>
          <p className="mt-5 text-body text-body-muted">
            The Fergana Valley has grown rice for a thousand years, and the families who farm it
            still sort devzira by hand. We buy from named growers, pay before the harvest ships, and
            bring it to Houston without a broker in between.
          </p>
          <p className="mt-4 text-body text-body-muted">
            Apricots dry on the branch in Samarkand. Spices are ground the week they leave us. What
            reaches your kitchen is what a family in Uzbekistan would cook with themselves.
          </p>
          <Link
            to="/about"
            className="mt-7 inline-flex items-center gap-2 text-bodySm font-semibold text-green hover:text-gold-dark"
          >
            Read our story
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>

        {/* A map tile, as the mockup has it - a placeholder until a real illustration exists. */}
        <div className="relative flex aspect-[5/4] items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-br from-sage-bg to-surface">
          <Icon name="map-trifold" size={72} className="text-green/25" />
          <span className="absolute bottom-5 left-5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Fergana · Samarkand · Bukhara
          </span>
        </div>
      </div>
    </section>
  );
}

function ValueProps() {
  return (
    <section className="bg-surface-alt py-16 mobile:py-12">
      <div
        className={`${SECTION} grid grid-cols-3 gap-12 tablet:gap-8 mobile:grid-cols-1 mobile:gap-8`}
      >
        {VALUES.map((value) => (
          <div key={value.title}>
            <Icon name={value.icon} size={30} className="text-green" />
            <h3 className="mt-4 font-serif text-[22px] text-ink">{value.title}</h3>
            <p className="mt-2 text-bodySm text-body-muted">{value.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Home;
