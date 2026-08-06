import { Eyebrow, Icon, type IconName } from '@silkgrain/ui';
import { createRoute } from '@tanstack/react-router';

import { ButtonLink } from '../components/ButtonLink';

import { rootRoute } from './root';

/**
 * The About page.
 *
 * Gradient hero, a two-column founder story, three value cards, a dark stats band and a
 * closing pair of calls to action - the mockup's structure. There is no team section, which
 * the original brief asked for and the design dropped; inventing one would mean inventing
 * people.
 *
 * Every figure in the stats band is the company's own copy, not a computed number. When any of
 * them becomes something the database knows, it should come from there instead.
 */

const SECTION = 'mx-auto max-w-container px-gutter tablet:px-gutter-tablet mobile:px-gutter-mobile';

const VALUES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'handshake',
    title: 'We buy direct, and we pay early',
    body: 'Every lot comes from a named farm we have visited. Growers are paid before the harvest ships, which is what lets them plant the varieties nobody else will.',
  },
  {
    icon: 'flask',
    title: 'Nothing ships untested',
    body: 'Pesticides, heavy metals and moisture, screened on arrival in Houston. A lot that fails goes back, however long the customer has been waiting.',
  },
  {
    icon: 'leaf',
    title: 'Whole ingredients only',
    body: 'No colouring, no sulphur on the apricots, no anti-caking agents in the spice mixes. If it is on the label it is because it is in the bag.',
  },
];

const STATS = [
  ['2018', 'Founded in Houston'],
  ['40+', 'Named partner farms'],
  ['3', 'Countries sourced'],
  ['50k+', 'Orders shipped'],
] as const;

function About() {
  return (
    <>
      <section className="bg-gradient-to-b from-gold-pale to-parchment py-20 mobile:py-12">
        <div className={SECTION}>
          <Eyebrow>Our story</Eyebrow>
          <h1 className="mt-4 max-w-[26ch] font-display text-[54px] font-medium leading-[1.08] text-ink tablet:text-[42px] mobile:text-[32px]">
            The Silk Road never stopped trading
          </h1>
          <p className="mt-6 max-w-[62ch] text-body text-body-muted">
            It just stopped being visible. The rice in a Tashkent plov, the apricots dried on a
            Fergana rooftop, the cumin ground the morning it is used — all of it still moves between
            the same valleys and the same families. SilkGrain is the short version of that route:
            from the grower to Houston to your kitchen, with nobody in between adding a month and a
            markup.
          </p>
        </div>
      </section>

      <section
        className={`${SECTION} grid grid-cols-2 gap-16 py-20 tablet:gap-10 mobile:grid-cols-1 mobile:gap-8 mobile:py-12`}
      >
        <div>
          <h2 className="font-serif text-[34px] leading-tight text-ink mobile:text-[26px]">
            It started with a bag that was not what it said
          </h2>
          <div className="mt-5 space-y-4 text-body text-body-muted">
            <p>
              In 2018 our founder bought &ldquo;Devzira rice&rdquo; from three different importers
              and got three different things, none of them Devzira. The variety is real, the
              provenance is checkable, and the market was full of bags that traded on a name nobody
              was verifying.
            </p>
            <p>
              So we went the other way round: find the farms first, agree what a lot has to test at,
              and only then work out how to get it here. That order of operations is the whole
              company. It is also why our catalogue is small — we sell what we can stand behind, and
              adding a product means finding someone to grow it properly.
            </p>
            <p>
              Today that is forty-odd farms across Uzbekistan, Kazakhstan and Tajikistan, a
              warehouse in Houston, and a standing rule that anything we would not cook with does
              not go on the shelf.
            </p>
          </div>
        </div>

        {/* Placeholder tile: real photography is a launch requirement, not a design one (Q-8). */}
        <div className="relative">
          <div className="absolute -right-3 -top-3 h-full w-full border border-gold" aria-hidden />
          <div className="relative flex aspect-[4/5] items-center justify-center bg-gradient-to-br from-surface to-gold-pale shadow-[0_30px_70px_rgba(14,58,42,0.18)]">
            <Icon name="map-trifold" size={88} className="text-green/20" />
          </div>
        </div>
      </section>

      <section className="bg-surface-alt py-16 mobile:py-12">
        <div
          className={`${SECTION} grid grid-cols-3 gap-10 tablet:gap-7 mobile:grid-cols-1 mobile:gap-8`}
        >
          {VALUES.map((value) => (
            <article key={value.title}>
              <Icon name={value.icon} size={30} className="text-green" />
              <h3 className="mt-4 font-serif text-[21px] leading-snug text-ink">{value.title}</h3>
              <p className="mt-2 text-bodySm text-body-muted">{value.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-green-deep py-14 mobile:py-10">
        <dl
          className={`${SECTION} grid grid-cols-4 gap-8 tablet:grid-cols-2 mobile:grid-cols-2 mobile:gap-6`}
        >
          {STATS.map(([value, label]) => (
            <div key={label}>
              <dt className="font-mono text-[34px] leading-none text-gold mobile:text-[26px]">
                {value}
              </dt>
              <dd className="mt-2 text-[13px] text-ondeep-muted">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={`${SECTION} py-20 text-center mobile:py-12`}>
        <h2 className="mx-auto max-w-[24ch] font-serif text-[32px] leading-tight text-ink mobile:text-[24px]">
          Start with the rice everyone argues about
        </h2>
        <div className="mt-8 flex justify-center gap-4 mobile:flex-col">
          <ButtonLink to="/shop" size="lg" corner="sharp">
            Shop the pantry
          </ButtonLink>
          <ButtonLink to="/help" size="lg" corner="sharp" variant="outline">
            Ask us anything
          </ButtonLink>
        </div>
      </section>
    </>
  );
}

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: About,
});
