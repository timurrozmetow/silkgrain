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

### PayPal as a second payment provider

Deferred out of Phase 4 by the owner, 2026-07-30 (decision D-26). The mockup puts a PayPal
button on the checkout and in the cart's "or pay with" row; both stay hidden until this lands.

Stripe's Payment Element already covers cards, Apple Pay and Google Pay, which is the large
majority of payments. PayPal adds a second webhook contour with its own signature scheme, its
own idempotency store, and a second place where the captured amount has to be reconciled
against the order before anything is marked paid — that last one is where the money can go
wrong, and it is worth doing once, deliberately, rather than alongside everything else.

Needs `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` from a sandbox app.
The `payments` and `webhook_events` tables already carry a `provider` column, and
`PaymentHandoff` in `packages/contracts` is already a discriminated union with a `paypal`
member, so nothing has to be reshaped to add it.
**Estimate 6–8 h.**

### A session hint cookie, so an anonymous visit stops probing `/auth/refresh`

The storefront asks `/auth/refresh` once on load to find out whether the httpOnly refresh cookie
is still good. For a visitor who has never signed in — most visitors — that is a request that
always answers 401, and the browser logs every one of them as a console error. Lighthouse counts
it under Best Practices; a developer reading the console counts it as noise that is always there.

The client cannot avoid it on its own: the refresh cookie is httpOnly by design, so nothing in
the page can tell whether a session might exist. The fix is a second, deliberately boring cookie
set beside the refresh one — no PII, no token, just a readable marker — cleared on logout, which
the store checks before probing.

Small, but it touches the auth cookie contour, which is worth doing on purpose rather than as a
footnote to a storefront phase.
**Estimate 2–3 h.**

### Account settings — editing a profile and changing a password

The mockup's account sidebar has a Settings entry, and `packages/contracts` already declares
`UpdateProfileInput` and `ChangePasswordInput` for it. Nothing implements them: there is no
`PATCH /api/auth/me` and no `POST /api/auth/password`, so `/account` shows no Settings link
rather than a link to nowhere.

Small and self-contained, but not free: changing a password has to revoke every other refresh
token family so a stolen session dies with the old password, and a changed email has to
re-enter the unverified state rather than silently moving where receipts are sent.
**Estimate 5–7 h.**

### Address book and saved cards

The account menu lists "Addresses" and "Payment Methods". Addresses are currently attached to
orders, not customers, and there is no Stripe Customer object.
Needs `customer_addresses`, Stripe Customer + SetupIntent, and a card management UI.
**Estimate 12–16 h.** Blocked on Q-26.

---

### ~~Responsive layouts~~ — moved back into Phase 5

No longer deferred. The `for adaptive/` handoff turned out to be a complete responsive
specification, and the owner's call on 2026-07-29 (decision D-19) is to write `tablet:` and
`mobile:` classes as each screen is built rather than retrofit them afterwards. That is
8–12 h inside Phase 5 against 30–40 h as a separate pass. Phase 5 acceptance now runs
Lighthouse on mobile as well as desktop.

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

Catalog search is SQL `LIKE` against name, subtitle, blurb and category. Fine for ~75 products;
typo tolerance, synonyms ("kuraga" / "dried apricots") and relevance ranking need MySQL
full-text or Meilisearch. A FULLTEXT index cannot simply be dropped in: its default minimum
word length and stopword list would remove "rice" from its own results.
**Estimate 12–20 h.**

### Body-aware rate limiting, to close the promo-code oracle on `/api/cart/validate`

`POST /api/cart/promo` is limited to 12 attempts per five minutes, because trying a code there
is a guess at a campaign name and the reply says whether the guess landed. `/api/cart/validate`
accepts the same optional code so a stored one can be repriced on page load, and it runs at the
cart budget — a slower version of the same oracle.

Closing it needs a limit that depends on whether the body carries `promoCode`, and
`@fastify/rate-limit` runs on `onRequest`, before the body exists. Two ways out: register the
plugin with `hook: 'preValidation'` (costs body parsing before the limiter, bounded by
`bodyLimit`), or keep a Redis counter of _failed_ promo attempts per address and refuse past a
threshold, which is the better shape because it charges only for guesses that miss. Either
should also share one bucket across both routes.
**Estimate 3–5 h.**

### Search term logging, so "popular searches" are real

The chips in the search overlay come from the best-selling product names, because there is
nothing else true to derive them from. What the overlay actually wants is what customers type:
a `search_queries` table written on every suggest request, aggregated over a rolling window,
with the zero-result terms surfaced in the admin panel — those are a list of products to stock
or synonyms to add. Pairs naturally with full-text search above.
**Estimate 6–10 h.**

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
- Contrast fixes for four design tokens that fail WCAG 4.5:1 (Q-42).
- Per-SKU nutrition data. The seed carries category-level reference values; the real figures
  come from the supplier's certificate of analysis and are entered in the admin product form
  (Q-43, D-20). Required by the FDA before the store takes a real order.
