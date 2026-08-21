import type { ContactMessageInput, FaqListResponse } from '@silkgrain/contracts';
import {
  Accordion,
  AccordionItem,
  Button,
  EmptyState,
  Eyebrow,
  Field,
  Icon,
  Input,
  Skeleton,
  Textarea,
} from '@silkgrain/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { apiGet, apiPost, ApiRequestError } from '../lib/api';
import { Seo } from '../lib/seo';
import { usePublicSettings } from '../lib/use-public-settings';

/**
 * Help: the FAQ, then a way to ask something it does not answer.
 *
 * The FAQ arrives grouped and ordered from the server (decision D-21's reasoning applied to
 * content: one place decides the order, so the Help page and the admin panel cannot disagree).
 *
 * The form carries a honeypot and the time it rendered. Both are checked server-side, and a
 * submission that fails either gets the same 201 a real one does - so this page never learns
 * whether a message was stored, which is exactly the point.
 */

const CATEGORY_LABELS: Record<string, string> = {
  ordering: 'Ordering',
  shipping: 'Shipping & delivery',
  products: 'Our products',
  wholesale: 'Wholesale',
  returns: 'Returns & refunds',
};

function Help() {
  return (
    <div className="mx-auto max-w-container px-gutter py-14 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
      <Seo
        title="Help & FAQ — SilkGrain"
        description="Shipping, storage, wholesale and returns, answered. If something is missing, the contact form reaches a person."
        canonicalPath="/help"
      />
      <Eyebrow>Help</Eyebrow>
      <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
        Questions, answered
      </h1>
      <p className="mt-3 max-w-[60ch] text-body text-body-muted">
        Shipping, storage, wholesale and returns. If something is missing, the form at the bottom
        reaches a person.
      </p>

      <div className="mt-12 grid grid-cols-[1fr_420px] items-start gap-16 tablet:grid-cols-1 tablet:gap-10 mobile:mt-8 mobile:gap-8">
        <FaqSection />
        <ContactSection />
      </div>
    </div>
  );
}

function FaqSection() {
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ['faqs'],
    queryFn: ({ signal }) => apiGet<FaqListResponse>('/faqs', signal),
  });

  if (isPending) {
    /**
     * The skeleton mirrors the loaded shape - a heading and a row per category - rather than
     * being five bars of a convenient height.
     *
     * This is the page's largest layout shift and was worth 0.26 of a 0.263 CLS on mobile:
     * five 64px bars reserve 368px, the real list needs about 744px, and the contact form
     * beside it dropped 376px the moment the answers arrived. Lighthouse weights CLS at a
     * quarter of the performance score, so one mismatched placeholder cost this page fifteen
     * points. `CATEGORY_LABELS` is the same list the response is grouped by, so the estimate
     * tracks the content instead of a number somebody tuned once.
     */
    return (
      <div className="space-y-10">
        {Object.keys(CATEGORY_LABELS).map((category) => (
          <div key={category}>
            <Skeleton className="h-3.5 w-28" />
            <div className="mt-4">
              <Skeleton className="h-[76px] w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon="warning-circle"
        title="The FAQ could not be loaded"
        description="The form beside this still works, so do ask."
      />
    );
  }

  if (data.groups.length === 0) {
    return (
      <EmptyState
        icon="chat-circle-dots"
        tone="green"
        title="Nothing here yet"
        description="Ask us directly and the answer will end up on this page."
      />
    );
  }

  return (
    <div className="space-y-10">
      {data.groups.map((group) => (
        <section key={group.category}>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold-dark">
            {CATEGORY_LABELS[group.category] ?? group.category}
          </h2>
          <Accordion className="mt-4">
            {group.items.map((item) => (
              <AccordionItem
                key={item.id}
                question={item.question}
                answer={<span className="whitespace-pre-line">{item.answer}</span>}
                open={openId === item.id}
                onToggle={() => {
                  // One open at a time: the mockup's accordion, and it keeps the page from
                  // becoming a wall of text after four clicks.
                  setOpenId((current) => (current === item.id ? null : item.id));
                }}
              />
            ))}
          </Accordion>
        </section>
      ))}
    </div>
  );
}

function ContactSection() {
  const { data: settings } = usePublicSettings();

  // Captured once, on mount, and sent with the form. The server refuses anything submitted
  // faster than a person could have read it.
  const renderedAt = useRef(Date.now());
  const [sent, setSent] = useState(false);
  const [fields, setFields] = useState({ name: '', email: '', subject: '', body: '' });

  const mutation = useMutation({
    mutationFn: (input: ContactMessageInput) => apiPost<{ received: true }>('/contact', input),
    onSuccess: () => {
      setSent(true);
    },
  });

  if (sent) {
    return (
      <aside className="border border-line bg-surface p-8">
        <Icon name="check-circle" size={30} className="text-green" />
        <h2 className="mt-4 font-serif text-[24px] text-ink">Message sent</h2>
        <p className="mt-2 text-bodySm text-body-muted">
          We answer within one business day, usually sooner. Check the address you gave us — that is
          where the reply goes.
        </p>
      </aside>
    );
  }

  const tooManyMessages =
    mutation.error instanceof ApiRequestError && mutation.error.code === 'RATE_LIMITED';

  return (
    <aside className="border border-line bg-surface p-8 mobile:p-5">
      <h2 className="font-serif text-[24px] text-ink">Ask us directly</h2>
      <p className="mt-2 text-bodySm text-body-muted">
        Include your order number if it is about an order.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({
            ...fields,
            website: '',
            formRenderedAt: renderedAt.current,
          });
        }}
      >
        <Field label="Your name" required>
          <Input
            value={fields.name}
            required
            maxLength={120}
            autoComplete="name"
            onChange={(event) => {
              setFields((current) => ({ ...current, name: event.target.value }));
            }}
          />
        </Field>

        <Field label="Email" required>
          <Input
            type="email"
            value={fields.email}
            required
            maxLength={254}
            autoComplete="email"
            onChange={(event) => {
              setFields((current) => ({ ...current, email: event.target.value }));
            }}
          />
        </Field>

        <Field label="Subject" required>
          <Input
            value={fields.subject}
            required
            maxLength={200}
            onChange={(event) => {
              setFields((current) => ({ ...current, subject: event.target.value }));
            }}
          />
        </Field>

        <Field label="Message" required hint="At least a sentence, so we can actually help.">
          <Textarea
            value={fields.body}
            required
            minLength={10}
            maxLength={4000}
            rows={5}
            onChange={(event) => {
              setFields((current) => ({ ...current, body: event.target.value }));
            }}
          />
        </Field>

        {/*
          The honeypot. Hidden from people and from assistive technology, irresistible to a bot
          that fills every field it finds. `display: none` rather than an off-screen position,
          because a password manager will happily autofill something merely moved off-screen.
        */}
        <div hidden aria-hidden>
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {mutation.isError && (
          <p className="flex items-start gap-2 text-[13px] text-terracotta" role="alert">
            <Icon name="warning-circle" size={15} className="mt-0.5 shrink-0" />
            {tooManyMessages
              ? 'That is several messages in a short time. Give it an hour, or email us directly.'
              : 'That did not send. Check the fields and try again.'}
          </p>
        )}

        <Button type="submit" fullWidth loading={mutation.isPending}>
          Send message
        </Button>

        {/*
          From `GET /api/settings`, like the footer's copy of the same row. The owner edits
          `store.contact_email` on the Settings screen; a string here would keep printing the old
          address on the one page whose entire purpose is telling somebody how to get in touch.
          The sentence is omitted rather than shown with a placeholder while the value loads -
          the form above it is the primary route anyway, and this is the fallback.
        */}
        {settings?.contactEmail !== null && settings?.contactEmail !== undefined && (
          <p className="text-[12px] text-muted">
            Or write to{' '}
            <a
              href={`mailto:${settings.contactEmail}`}
              className="text-green underline underline-offset-2"
            >
              {settings.contactEmail}
            </a>
            .
          </p>
        )}
      </form>
    </aside>
  );
}

export default Help;
