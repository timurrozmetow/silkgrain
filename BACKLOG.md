# BACKLOG

Things deliberately not built now. Nothing here is a half-finished feature in the codebase —
if it is on this list, it does not exist in the repository at all.

Each entry says why it was deferred and what it would cost. Ordered roughly by expected value.

---

## Drawn in the mockup, deferred by decision

### Product bundles — "The Plov Set"

The homepage shows a three-product set at $49.00 instead of $55.99 with a "Save 12% as a set"
label and an "Add the set" button. There is no bundle entity in the data model or in any phase.

Needs `bundles` + `bundle_items`, its own pricing rule, discount allocation across order lines
(the `Money.allocate` case), and admin CRUD.
**Estimate 16–20 h.** Blocked on QUESTIONS.md Q-3.

### Subscriptions — "Subscribe & Save"

Monthly / every 2 months / quarterly, 10% off every delivery, free shipping, skip or cancel
anytime. This is Stripe Subscriptions plus a management surface in the customer account and
a delivery scheduler.
**Estimate 40–60 h.** Blocked on Q-4.

### Loyalty — "Grain points"

The account page shows a "340 Grain points" card. No earning rules, no redemption, no ledger
anywhere in the spec.
**Estimate 20–28 h.** Blocked on Q-5.

### Referral programme

The confirmation screen offers "give 10% off, get 10% off" with a "Get my link" button.
Needs referral codes, attribution, fraud limits and payout accounting.
**Estimate 16–24 h.** Blocked on Q-5.

### Customer-written reviews

Rating, review count and a 5-star histogram appear on product cards, the catalog, quick view
and the product page, plus a "Write a Review" button. Phase 2 ships a `reviews` table that is
read-only and seeded; accepting user submissions adds moderation, verified-buyer checks
against order history, spam handling and email notifications.
**Estimate 20–26 h.** Blocked on Q-6.

### Address book and saved cards

The account menu lists "Addresses" and "Payment Methods". Addresses are currently attached to
orders, not customers, and there is no Stripe Customer object.
Needs `customer_addresses`, Stripe Customer + SetupIntent, and a card management UI.
**Estimate 12–16 h.** Blocked on Q-26.

---

### Responsive layouts

Deferred by decision: the storefront ships desktop-first at 1280 and the responsive pass comes
later. The handoff contains no mobile mockups, so the small-screen design has to be derived
rather than transcribed - see QUESTIONS.md Q-33 for the layout rules already sketched out.

Breakpoint tokens are already in `packages/ui/src/tokens.ts` and nothing in the components
hard-codes a viewport, so this is additive work rather than a rewrite.
**Estimate 30–40 h**, plus mobile Lighthouse and a second pass over the overlays.

---

## Operational integrations

### Carrier integration (Shippo / EasyPost)

Deferred by the spec itself. Until then the tracking page derives its five steps from order
timestamps, the carrier map is a static image, and the tracking number links out to the
carrier's own site. Real scan events, label purchase and rate shopping all need this.
**Estimate 24–32 h.**

### Inventory sync with the warehouse

BullMQ has a slot reserved for a stock sync job. There is no upstream system to sync with yet.
**Estimate 12–20 h once a source exists.**

### Multi-currency and i18n

Explicitly out of scope: USD and English only. `Money` carries an explicit currency and
`packages/contracts` isolates the literal, so adding a second currency is a contained change
rather than a rewrite.
**Estimate 30–40 h.**

---

## Quality and infrastructure

### Visual regression testing

Storybook plus a screenshot differ would catch drift from the mockup on every change.
Not required by any acceptance criterion.
**Estimate 8–12 h.**

### Full-text search

Catalog search is SQL `LIKE` against name and category. Fine for ~75 products; typo tolerance,
synonyms ("kuraga" / "dried apricots") and relevance ranking need MySQL full-text or
Meilisearch.
**Estimate 12–20 h.**

### Blog / content pages beyond recipes

No mockup exists. Raised as an open question.

### Analytics beyond the admin dashboard

The sidebar has an "Analytics" entry with no mockup behind it. The dashboard covers revenue,
orders, low stock and wholesale pipeline. Cohorts, funnels and LTV are a separate build.
**Estimate 16–24 h.**

---

## Known gaps to close before launch, not features

These are not optional — they are listed so they are not forgotten, and each is owned by a
phase in `PLAN.md`.

- Real product photography. The mockup links to Unsplash, Wikimedia Commons and TheMealDB;
  none of it can ship commercially as-is (Q-8).
- A real logo. The bundled `silkgrain-logo.jpeg` is a 99 KB photo, byte-identical to a
  WhatsApp image in `uploads/`, and is not used anywhere in the mockup (Q-7).
- Real company contact details. The mockup uses `(713) 555-0148` and `2200 Silk Road Blvd`,
  both placeholders (Q-9).
- Privacy Policy, Terms of Service, Shipping Policy, Return Policy (Q-10).
- Mobile layouts. The handoff contains desktop only; the responsive design is being derived,
  not transcribed (Q-33).
- Contrast fixes for four design tokens that fail WCAG 4.5:1 (Q-42).
