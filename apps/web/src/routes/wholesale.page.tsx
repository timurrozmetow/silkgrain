import type { CategoryListResponse, WholesaleRequestInput } from '@silkgrain/contracts';
// The Zod-free subpath: a value import from the barrel would drag the schema layer into the
// storefront bundle. The type import above is erased and costs nothing.
import { BUSINESS_TYPE, VOLUME_BAND } from '@silkgrain/contracts/constants';
import { Button, Card, Field, Icon, Input, Select, Textarea, type IconName } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiPost } from '../lib/api';
import { Seo } from '../lib/seo';

/**
 * The wholesale enquiry page.
 *
 * The form is the page, which is why it is the whole of task 6.6. Its field set is the mockup's
 * (decision D-5): one contact name, no business address. The category chips come from
 * `GET /api/categories` rather than the mockup's hard-coded six, so a new category appears here
 * the moment an editor creates one.
 *
 * Two anti-automation measures ride along, both invisible to a person: a honeypot field a browser
 * leaves alone, and the time the form rendered. The server answers a caught submission exactly as
 * it answers a real one, so nothing here needs to know which happened - and nothing here should,
 * because a client that could tell would be a client a bot could ask.
 */
const SECTION = 'mx-auto max-w-container px-gutter tablet:px-gutter-tablet mobile:px-gutter-mobile';

const STATS: [string, string][] = [
  ['500+', 'Partners'],
  ['30+', 'Products'],
  ['50 lbs', 'Minimum order'],
  ['Custom', 'Packaging'],
];

const BENEFITS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'chart-line-down',
    title: 'Volume pricing',
    body: 'Tiered discounts that scale with your order size — the more you stock, the more you save.',
  },
  {
    icon: 'user-circle',
    title: 'Dedicated account manager',
    body: 'A real person who knows your business, on call for reorders, forecasts and special requests.',
  },
  {
    icon: 'truck',
    title: 'Flexible delivery',
    body: 'Scheduled recurring shipments or on-demand restocks, palletized or carton, on your timeline.',
  },
];

const BUSINESS_TYPE_LABELS: Record<(typeof BUSINESS_TYPE)[number], string> = {
  restaurant: 'Restaurant',
  grocery: 'Grocery or market',
  distributor: 'Distributor',
  meal_kit: 'Meal kit or subscription',
  other: 'Something else',
};

const VOLUME_LABELS: Record<(typeof VOLUME_BAND)[number], string> = {
  '50-200': '50–200 lbs',
  '200-500': '200–500 lbs',
  '500-2000': '500–2,000 lbs',
  '2000+': '2,000+ lbs',
};

function Wholesale() {
  return (
    <>
      <Seo
        title="Wholesale — SilkGrain"
        description="Central Asian rice, lentils, dried fruit and spices at wholesale volumes, direct from the growers and shipped from Houston."
        canonicalPath="/wholesale"
      />
      <Hero />
      <Benefits />
      <EnquiryForm />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-green-deep">
      {/* The gold zig-zag edge from the mockup, drawn rather than imported: two crossing
          repeating gradients at 1px, which is what the prototype does inline. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg,#D3A73B 0 1px,transparent 1px 7px),repeating-linear-gradient(-45deg,#D3A73B 0 1px,transparent 1px 7px)',
        }}
      />
      <div className={`${SECTION} relative py-20 text-center mobile:py-12`}>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold">Wholesale</p>
        <h1 className="mx-auto mt-4 max-w-[24ch] font-display text-[56px] font-medium leading-[1.06] text-ondeep tablet:text-[44px] mobile:text-[32px]">
          Partner with SilkGrain
        </h1>
        <p className="mx-auto mt-5 max-w-[58ch] text-body text-ondeep-muted">
          The same grains we sell by the bag, by the pallet. Bought direct from named growers,
          lab-tested by the lot, and shipped from Houston.
        </p>

        <dl className="mx-auto mt-12 grid max-w-[760px] grid-cols-4 gap-8 border-t border-white/15 pt-8 tablet:gap-6 mobile:grid-cols-2 mobile:gap-5">
          {STATS.map(([value, label]) => (
            <div key={label}>
              <dt className="font-mono text-[26px] text-gold mobile:text-[22px]">{value}</dt>
              <dd className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ondeep-muted">
                {label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Benefits() {
  return (
    <section className={`${SECTION} py-16 mobile:py-10`}>
      <div className="grid grid-cols-3 gap-6 tablet:gap-5 mobile:grid-cols-1">
        {BENEFITS.map((benefit) => (
          <Card key={benefit.title} padding="md">
            <span className="flex h-[50px] w-[50px] items-center justify-center rounded-md bg-gold-pale text-gold-dark">
              <Icon name={benefit.icon} size={25} />
            </span>
            <h2 className="mt-4 font-display text-[24px] font-semibold text-ink">
              {benefit.title}
            </h2>
            <p className="mt-2 text-bodySm text-body-muted">{benefit.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

type FormState = 'idle' | 'sending' | 'sent';

function EnquiryForm() {
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet<CategoryListResponse>('/categories', signal),
  });

  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<string>('restaurant');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [volume, setVolume] = useState<string>('50-200');
  const [chosen, setChosen] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);

  /**
   * When the form appeared, for the server's fill-time check.
   *
   * A ref rather than state: it must not change on re-render, and nothing renders from it.
   */
  const renderedAt = useRef(Date.now());
  const sentRef = useRef<HTMLDivElement>(null);

  // Moving focus to the confirmation is the only way a screen-reader user learns the form is gone.
  useEffect(() => {
    if (state === 'sent') sentRef.current?.focus();
  }, [state]);

  function toggleCategory(slug: string) {
    setChosen((current) =>
      current.includes(slug) ? current.filter((entry) => entry !== slug) : [...current, slug],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'sending') return;

    if (businessName.trim().length < 2) {
      setError('Tell us the name of the business.');
      return;
    }
    if (contactName.trim().length < 2) {
      setError('Tell us who to reply to.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }

    setState('sending');
    setError(null);
    try {
      const payload = {
        businessName: businessName.trim(),
        businessType,
        contactName: contactName.trim(),
        email: email.trim(),
        ...(phone.trim().length > 0 ? { phone: phone.trim() } : {}),
        monthlyVolumeBand: volume,
        ...(chosen.length > 0 ? { categoriesOfInterest: chosen } : {}),
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
        website: honeypot,
        formRenderedAt: renderedAt.current,
      } as unknown as WholesaleRequestInput;

      await apiPost('/wholesale/requests', payload);
      setState('sent');
    } catch {
      setState('idle');
      // Deliberately not specific: the server rejects a body it does not like with a 422 whose
      // details name internal field paths, and a phone that failed a regex is not worth spelling
      // out field by field on a form this short.
      setError('That did not go through. Please check the details and try again.');
    }
  }

  if (state === 'sent') {
    return (
      <section className={`${SECTION} pb-20 mobile:pb-12`}>
        <Card padding="lg" className="mx-auto max-w-[880px] text-center">
          {/* Focusable only programmatically, so it never becomes a tab stop of its own. */}
          <div ref={sentRef} tabIndex={-1} className="outline-none">
            <span className="mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-pill bg-sage-bg text-green">
              <Icon name="check-circle" size={34} weight="fill" />
            </span>
            <h2 className="mt-6 font-serif text-[32px] text-ink mobile:text-[26px]">
              Enquiry received
            </h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-body text-body-muted">
              We will come back to you within one business day, at {email}.
            </p>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section className={`${SECTION} pb-20 mobile:pb-12`}>
      <Card padding="lg" className="mx-auto max-w-[880px]">
        <h2 className="font-serif text-[30px] text-ink mobile:text-[24px]">
          Request wholesale pricing
        </h2>
        <p className="mt-1.5 text-bodySm text-muted">
          Tell us about your business and we will send a tailored quote.
        </p>

        <form
          className="mt-7 flex flex-col gap-5"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          {error !== null && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-terracotta/40 bg-terracotta-bg px-3.5 py-3 text-bodySm text-terracotta"
            >
              <Icon name="warning-circle" size={18} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-5 mobile:grid-cols-1">
            <Field label="Business name" required>
              <Input
                value={businessName}
                autoComplete="organization"
                onChange={(event) => {
                  setBusinessName(event.target.value);
                }}
              />
            </Field>

            <Field label="Business type" required>
              <Select
                value={businessType}
                options={BUSINESS_TYPE.map((type) => ({
                  value: type,
                  label: BUSINESS_TYPE_LABELS[type],
                }))}
                onChange={(event) => {
                  setBusinessType(event.target.value);
                }}
              />
            </Field>

            <Field label="Contact name" required>
              <Input
                value={contactName}
                autoComplete="name"
                onChange={(event) => {
                  setContactName(event.target.value);
                }}
              />
            </Field>

            <Field label="Email" required>
              <Input
                type="email"
                value={email}
                autoComplete="email"
                iconLeft="envelope-simple"
                placeholder="you@business.com"
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </Field>

            <Field label="Phone" hint="Optional, but it is the fastest way to a quote.">
              <Input
                type="tel"
                value={phone}
                autoComplete="tel"
                iconLeft="phone"
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </Field>

            <Field label="Estimated monthly volume" required>
              <Select
                value={volume}
                options={VOLUME_BAND.map((band) => ({
                  value: band,
                  label: VOLUME_LABELS[band],
                }))}
                onChange={(event) => {
                  setVolume(event.target.value);
                }}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="text-caption font-medium text-body-muted">
              Products of interest
            </legend>
            {/* From the category tree, not the mockup's fixed six: a new category should appear
                here without anybody remembering to edit this file. */}
            <div className="mt-2.5 flex flex-wrap gap-2.5">
              {(categories?.items ?? []).map((category) => {
                const active = chosen.includes(category.slug);
                return (
                  <button
                    key={category.slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      toggleCategory(category.slug);
                    }}
                    className={`inline-flex items-center gap-2 rounded-pill px-4 py-2 text-bodySm transition-colors mobile:min-h-11 ${
                      active
                        ? 'border-[1.5px] border-green bg-sage-bg font-semibold text-green'
                        : 'border border-line bg-white text-body-muted hover:border-green'
                    }`}
                  >
                    {active && <Icon name="check" weight="bold" size={12} />}
                    {category.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field label="Message">
            <Textarea
              rows={4}
              value={notes}
              placeholder="Tell us about your needs, timelines, or packaging requirements…"
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </Field>

          {/* The honeypot. Hidden from sight and from assistive tech, and left alone by both. */}
          <div aria-hidden className="hidden">
            <label htmlFor="wholesale-website">Website</label>
            <input
              id="wholesale-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => {
                setHoneypot(event.target.value);
              }}
            />
          </div>

          <Button
            type="submit"
            size="lg"
            fullWidth
            iconRight="paper-plane-tilt"
            loading={state === 'sending'}
          >
            Submit wholesale request
          </Button>

          <p className="flex items-center justify-center gap-2 text-caption text-muted">
            <Icon name="clock" size={14} />
            We will get back to you within 1 business day.
          </p>
        </form>
      </Card>
    </section>
  );
}

export default Wholesale;
