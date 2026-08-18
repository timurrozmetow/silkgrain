# Where the project stands

Updated 2026-07-30. Read this first after any context loss, then `CLAUDE.md` for the rules.

---

## Position

**Branch:** `phase/3-catalog-cart`. `main` has no commits yet — branches merge there once the
owner accepts the work.

| Commit    | What                                                             |
| --------- | ---------------------------------------------------------------- |
| `7b74172` | Phase 0 — monorepo, tooling, local services                      |
| `ef0acbe` | The responsive design handoff, committed unmodified              |
| `bfae409` | Phase 1 — design system                                          |
| `187c166` | Responsive breakpoints wired into tokens and the Tailwind preset |
| `f1db2b8` | The design handoff distilled into docs                           |
| `9c72c97` | Phase 2 — backend core                                           |
| `3696fab` | The responsive schedule and the nutrition-data decision          |
| _HEAD_    | Phase 3 — catalogue and cart API                                 |

**Phases 0 through 3 are complete and verified.** `pnpm verify` exits 0: 208 tests
(43 contracts + 107 api + 58 ui), zero lint warnings, zero type errors. Storefront bundle
110 KB gzip against a 250 KB budget.

Beyond the suite, every new endpoint was also driven against the **real seeded development
database** — all thirty-two products, every sort, every filter, both cart routes and
`/docs/json`. The fixture has no product without nutrition, certifications or reviews; the
seed does, and a response schema is a serialiser, so a mismatch there is a 500 rather than a
type error.

Phase 3 was then put through an adversarial review — six independent passes over the diff,
every finding challenged by three sceptics, twenty of fifty-two surviving. What that changed
is listed in `PLAN.md` under Phase 3. The two that mattered: the sidebar had no way to build
its Weight, Origin or Certification lists, and deactivating a category hid it from the menu
while leaving its products in the grid, in search and in the cart.

**Phase 4 is under way and is _not_ finished.** What exists and is tested:

| Task | State                                                                                   |
| ---- | --------------------------------------------------------------------------------------- |
| 4.1  | Order numbers — `SG-YYYY-NNNNN`, retry on collision. Done, 9 tests.                     |
| 4.3  | Stripe webhook — raw body, signature, idempotency. Done, 19 tests.                      |
| 4.4  | The paid transaction — status, stock, movements, promo redemption. Done, in those 19.   |
| 4.8  | Order lookup, guest and account. Done, 11 tests.                                        |
| 4.7  | Order confirmation over BullMQ, delivered to Mailpit. Done, 6 tests.                    |
| 4.2  | `POST /api/checkout/intent` — **not started.** Needs a real Stripe key (decision D-27). |
| 4.6  | Stripe Tax — **not started.** Needs an account with Tax enabled.                        |
| 4.5  | PayPal — **moved to `BACKLOG.md`** by the owner (decision D-26).                        |

**Everything that does not need a payment credential is finished.** What is left is the two
tasks that call Stripe's API, and they are blocked: `.env` still holds the `.env.example`
placeholders, `STRIPE_SECRET_KEY=sk_test_replace_me` and `STRIPE_WEBHOOK_SECRET=whsec_replace_me`.

That blocks less than it sounds like. Stripe's signature verification is local HMAC, so the
whole webhook contour, the paid transaction and the receipt are built and proved offline — the
tests sign their own events with the SDK. What cannot be proved is the four test-mode card
scenarios in the acceptance criterion, because they require an account. Development boots on
the placeholders; `loadEnv` refuses them under `NODE_ENV=production`.

**To unblock:** Stripe dashboard → Developers → API keys in test mode gives `sk_test_` and
`pk_test_`; `stripe listen --forward-to localhost:3001/api/webhooks/stripe` prints the
`whsec_`. Put all three in `.env` and 4.2 and 4.6 can be finished and verified.

### What is already built for the day the key arrives

Everything on this side of the SDK call, so nothing has to be designed under time pressure.

**`createPendingOrder` in `apps/api/src/modules/checkout/checkout.service.ts` — 12 tests.** This
is all of `POST /api/checkout/intent` except `stripe.paymentIntents.create`: it reprices the cart
through the same `quoteCart` the storefront has been calling, refuses a total the customer never
saw, then writes the order, its line snapshots and both addresses in one transaction with a
freshly allocated number. It leaves the order `pending` and touches no stock, because both of
those belong to the webhook and to nowhere else.

The three rules it holds are the ones `CLAUDE.md` says Phase 4 has to get right, and each has a
test that fails if it slips:

- The order's totals are the quote's totals, to the cent — the third copy of the arithmetic
  agreeing with the other two.
- A stale total is a **409** carrying the fresh quote, never a silent charge. Any server-side
  adjustment counts as stale too, not only a different number: two changes can cancel out.
- The discount is allocated across lines with `Money.allocate`, so the line discounts sum exactly
  to the order's. A lost cent here surfaces later as a reconciliation failure against Stripe.

`CART_PRICE_MISMATCH` was reserved for this and unused; its status moved from 422 to **409**,
which is what the working agreement says a stale total is and what `CheckoutIntentResult`'s
sibling `CheckoutTotalMismatch` was written for.

**So the remaining work behind the key is:** call `paymentIntents.create` with
`quote.totalCents`, hand back `CheckoutIntentResult` with the client secret and publishable key
(the `PaymentHandoff` union already has the shape), mount the Payment Element on a `/checkout`
page, and let the webhook — already built and tested — do the rest. Stripe Tax (4.6) replaces the
estimated `taxCents` at that point, which is decision D-4's plan.

**Phase 5 has started**, because it needs nothing from Stripe until the checkout. Done and
driven in a real browser: the frame (router, layout, announcement bar, sticky header, footer,
scroll restoration, error boundary, 404), the home page's hero, category strip and both
product rails, and `/shop` with URL-driven sorting and pagination.

The header and footer carry **only links to pages that exist**, and grow as the pages land.
The design's nav is five items and one ships. This is deliberate: a header full of links to
pages that are not built looks finished and is not.

The cart drawer and `/cart` are done too, both priced by one hook against
`POST /api/cart/validate`. "Proceed to Checkout" is absent on purpose until `/checkout` exists
in Phase 6.

`/product/$slug` is done: gallery, weight selection, the FDA nutrition panel, the review
histogram and "You May Also Like", all from one request. `ProductCard` grew an optional
`onNavigate` so a card click routes instead of reloading the page, while staying a real anchor.

The search overlay and the mega-menu are done, which finishes task 5.2 except for quick view.
Filter state in the URL is **comma-separated, not an array**: TanStack JSON-encodes an array, so
`?category=rice` beats `?category=%5B%22rice%22%5D` for something meant to be shared.

`/about`, `/help` and `/recipes` are done, so the nav is Shop / Recipes / About / Help — four
of the design's five. Those pages needed four endpoints no phase had claimed: `GET /api/faqs`,
`POST /api/contact`, `GET /api/recipes` and `GET /api/recipes/:slug`, all tested (19 tests).

A recipe's ingredient list reuses `loadProductCards` from the catalogue service, so it carries
the same derived badges, price range and stock state a grid does — and an unpublished product
simply does not come back.

`/shop` now has its sidebar — categories, price, weight, origin, certifications and an
in-stock box — all drawn from the facets Phase 3 built. Nothing in it is hard-coded, which
matters: the mockup's weight list is 1/2/5/10/25/50 lb and this catalogue's is not.

Titles, descriptions, canonicals, Open Graph and JSON-LD are done, through one `<Seo>`
component in `apps/web/src/lib/seo.tsx` rather than `react-helmet-async`. Every tag it writes
carries `data-seo` and each render clears the previous set first, so a product's description
cannot survive into the next page — the failure mode of every head manager that only ever adds.

Filtered, sorted and paginated shop views all canonicalise to a bare `/shop`. A search result
and the cart are `noindex,follow`. `sitemap.xml` is still to come and needs a route in Nginx,
which is Phase 9.

`/shop/c/$slug` and quick view are done. The category page is a real landing page with its own
canonical, which is the point of the shop view canonicalising away: this is the page meant to
rank. Sub-category chips come from the tree's `children`, so they appear the moment an editor
creates a branch — the development seed has none, so they do not render there.

Quick view shares the product route's query key, so opening one warms the cache for the full
page and vice versa. It is not a second product page: nutrition, provenance and reviews are
not in it, and "Full details" is how you reach them.

`/wishlist` is done. The store holds slugs, and `GET /api/products?slug=…` — a filter added for
this — turns them into cards in one request, through the same projection every grid uses. So a
wishlist card carries the same derived badges and stock state as a card in the catalogue, and a
product that has since been unpublished simply does not come back, which is also how a stale
entry prunes itself.

Client-side for the same reason the cart is (D-18). The `wishlists` and `wishlist_items` tables
exist for the day a signed-in list should follow someone between devices; nothing writes them
yet, and a table nothing writes to would be a stub.

`/account` is done, and with it **every page Phase 5 owns is built**. (`/track` is listed under
5.8 as well, but task 6.5 claims it alongside `/order/:number`, which is where it belongs — both
read the same guest lookup.) One route wears two
faces: signed out it is a sign-in / sign-up card, signed in it is the dashboard the mockup draws
— sticky profile sidebar, three stat cards, order history with Reorder. The third state matters
as much as the two: while the silent refresh is still deciding whether the refresh cookie is
good, neither shows, so a returning customer never sees the sign-in form flash before their own
name replaces it.

The access token lives in a module variable in `apps/web/src/lib/api.ts`, not in the store and
not in any storage another tab could read (D-15). A guarded call that comes back 401 refreshes
**once** and replays; refreshes are single-flight, because a refresh token rotates on use and
presenting a rotated one revokes the whole session family — two racing refreshes would sign the
customer out, and React 18's double-invoked effect makes that a development certainty, not a
theoretical race.

Grain points, Addresses, Payment Methods, Track Order and Settings are in the mockup's sidebar
and have **no backing model**, so they are not printed as links to nowhere. The dark card
announces the programme instead of inventing a balance. All five are in `BACKLOG.md`.

`GET /api/account/summary` is the one endpoint this needed. `orderCount` counts every order so
it agrees with the list beneath it; `lifetimeSpentCents` counts only `paid`, `processing`,
`shipped` and `delivered` — a pending order was never charged, a cancelled one never was, and a
refunded one was paid back, so none belongs in a total labelled "spent".

**Phase 6's task 6.5 is done** — `/order/:orderNumber` and `/track`, both built on the guest
lookup Phase 4 already tested. They need nothing from Stripe, which is why they came first.

Access is the interesting part. A signed-in customer needs only the number: the session says who
is asking. A guest supplies the email the order was placed with, because order numbers are a
per-year sequence and can be walked — and a wrong email and a number never issued answer
identically, so walking them reveals nothing. The email lives in React state, **never in the
URL**: `?email=` is the API's contract, not the page's, and an address in the address bar ends up
in history and in shared links.

The tracking timeline derives from the order's own timestamps, which `BACKLOG.md` had already
settled as the plan until a carrier integration lands. Four of the mockup's five steps exist in
the data; "Out for Delivery" is a carrier scan event and is not drawn, because a step that never
lights up is worse than four that do. `Packed` shows as reached without a date — the admin moves
an order to `processing` when it is packed and no column records when. A cancelled or refunded
order gets a statement instead of a timeline: it is not moving, and drawing it stalled at the step
it died on says the opposite.

One-click registration on the confirmation screen deliberately does **not** attach the order to
the new account. Claiming orders by email at sign-up would let anyone register with somebody
else's address and inherit their history, and there is no email verification standing in the way
yet; the two belong together and are in `BACKLOG.md` as one item.

**Task 6.6 is done too** — `/wholesale` and `POST /api/wholesale/requests`, 10 tests. The field
set is the mockup's (decision D-5): one contact name, no business address, and the
`wholesale_requests` columns for the rest stay nullable so a longer form needs no migration
rewrite. The category chips come from `GET /api/categories`, not the mockup's fixed six, so a new
category appears in the form the moment an editor creates one. An empty selection stores NULL
rather than `[]`, so "chose nothing" is one shape downstream and not two.

The honeypot and the fill-time check now live in `apps/api/src/lib/form-guards.ts`, shared with
the Help form: two copies of "three seconds is not a reading speed" would eventually disagree
about the number. Three enquiries an hour per address, tighter than Help's five.

With `/wholesale` up, **the nav is the design's full five** and the home page's wholesale band
ships — it had been waiting on exactly this, on the rule that a banner linking nowhere is worse
than no banner.

There is no recipe detail page: the design never drew one (Q-25), and `GET /api/recipes/:slug`
already returns everything it would need.

---

## Phase 7 — the admin panel, started

**Tasks 7.1 and 7.2 are done**: the frame and the dashboard, with `GET /api/admin/dashboard`
behind them and 10 tests. They landed together on purpose — a frame with no screen cannot be
driven, and a dashboard with no frame has nowhere to sit.

`apps/admin` was a Phase 0 scaffold until now: no router, no query client, no session. It has all
three, and its own copy of the transport rather than the storefront's. That is deliberate. The two
authentication contours are separate by design — separate tables, cookies and token audiences —
and the one place that difference lives is the refresh call. A shared client would need a mode
flag, and a mode flag on an auth client is how an admin token ends up on a customer route.

The panel sits behind **one** gate rather than a guard per route: every screen in it reads or
writes shop data, so "signed in" is the floor for all of them, and eight copies of that check is
seven chances to forget one. Sign-in renders in place of the panel instead of at `/login`, which
saves a redirect target read from the URL — a thing to get wrong.

The dashboard's figures are computed on the way out, nothing cached: a dashboard reading a summary
table can disagree with the orders it summarises. **Revenue means the same thing here as on the
customer's lifetime-spend card** — paid, processing, shipped, delivered — because two definitions
of a sale in one codebase is how a shop gets two answers to "how much did we make". A delta
against an empty previous window is **null, not zero**, and the client prints a dash: a first
month shown as "0.0%" is a number an operator would believe.

Days with no sales are filled in before the chart sees them. A `GROUP BY` returns only the days
with rows, and a line drawn through those alone invents a trend across the quiet ones.

The chart is inline SVG in a stretched viewBox — no library, no resize listener, and the stroke is
`vectorEffect="non-scaling-stroke"` so it stays an even hairline rather than thicker vertically
than horizontally.

The top bar deliberately carries no search field, no notification bell and no "Add Product"
button, all three of which the mockup draws. None has anywhere to go yet. A dead control in a back
office is worse than a missing one: an operator clicks it, nothing happens, and they stop trusting
the rest of the screen.

**Task 7.3's API is done**: the migration, the product list and the write path, with 28 tests
across `GET /api/admin/products`, `GET|POST|PUT /api/admin/products/:id`. The form UI is what
remains.

A save is **one transaction** covering the product row, its variants, certifications, badges and
nutrition panel. Half a save — new variants beside old certifications — is a state nobody designed
and nobody would think to look for.

Variants are **reconciled, not replaced**: a row named by id is updated, a row without one is
created, a row the payload omits is deleted. Deleting and re-inserting them all would issue new
ids on every save, and an id that changes is an id `order_items` and `wishlist_items` have already
written down. Deleting is safe because `order_items.variant_id` is `ON DELETE SET NULL` and the
line keeps its own snapshot of name, SKU and price.

The route is **PUT rather than PATCH**, deliberately: the form sends the whole product every time,
and a partial body would make "this variant is gone" indistinguishable from "I did not mention it".

Nutrition arrives in **milligrams**, not grams. An FDA label is written in grams for the macros and
milligrams for sodium, so the form multiplies by a thousand before sending — which keeps fractions
out of the request entirely and honours the no-floats rule. `1.5 g` is `1500`, exactly, with no
rounding decision left on the server. The panel refuses saturated fat above total fat and sugars
above carbohydrates, both of which are labels nobody read.

Sending a panel at all sets `source` to `entered`. That is the point of decision D-20: whoever
pressed save is now answerable for those figures, and the seed's category-level averages stay
`reference` until someone types over them.

`publishedAt` is stamped on first activation and never again — re-stamping would push a product
back to the top of "newest" every time somebody fixed a typo. A draft is left undated.

The list is a **separate service from the storefront's**, not the same query with a flag. That one
starts from `PUBLISHED_PRODUCT` and exists to hide what a customer must not see; this one starts
from every product and exists to show an editor everything. A flag that turns the storefront's
safety off is a flag somebody eventually passes by mistake. A test asserts both directions: the
draft is in the admin list and absent from `/api/products`.

Search covers the SKU as well as the name and slug, which the storefront's does not — an editor
looking for a product usually has the SKU in front of them, off a packing slip. The `lowStock`
filter shares the dashboard's definition rather than restating it. `QueryBoolean` is now exported
from contracts and used here: `?lowStock=no` is a 422 rather than a silent `true`, which is the
whole reason that helper exists.

**The nutrition migration is applied** (`0001_free_wraith.sql`): `product_nutrition.source` is
`reference` or `entered`, defaulting to `reference`, so every row the seed wrote is correctly
labelled as a category-level average rather than something read off a packet. Decision D-20 asked
for exactly this, and the list shows it per product — an editor deciding what to verify next can
see which panels are still the seed's.

**Task 7.3 is done**, form and all. `/products/new` and `/products/$id/edit` share one
`ProductForm`: product fields, a variant editor, certification and badge chips, the Nutrition
Facts panel and the SEO block. The client edits dollars and grams; `form-values.ts` is the one
place those become cents and milligrams, so a rounding decision cannot drift into a component.
1.5 g of fat is sent as 1500, exactly. The client validates only what saves an obviously doomed
round trip and surfaces the server's 422/409 messages for the rest — the write path already holds
every real rule and is tested to.

Two things it leans on: the slug auto-fills from the name until an editor edits it by hand (a
published slug is a public address nobody wants silently moved), and the default variant is a
radio group, because "choose exactly one" is what a radio means to a keyboard and a screen reader
both. `PathId` — a coercing sibling of `Id`, since a path segment is always text — is what makes
`/products/:id` validate; `Id` alone rejected every one.

Verified end to end in the browser against the dev database: created a product with a variant and
an entered nutrition panel, confirmed the row stored 690 cents, 1500 mg of fat and `source =
entered`, saw it appear in the storefront once active, edited the price and confirmed the variant
kept its id (750 cents on row 80, not a new row). The test product was deleted afterwards.

**Task 7.4 is done**: product image upload, 10 tests against the real MinIO. A drop or a file
picker sends one image to `POST /api/admin/products/:id/images`, where sharp rotates it upright,
caps it at 1600px on the long edge, strips its metadata (a phone writes GPS into a JPEG; a product
photo has no business carrying where it was taken) and re-encodes it to webp. The object key is a
content hash, so the same bytes land on the same object and a processed image can be cached
forever - the bucket sets a one-year immutable Cache-Control.

`Storage` is the one file that talks to the bucket. It provisions the bucket lazily on first use,
not at boot: the storefront never touches it, and a boot that failed because MinIO was down would
take the shop offline over a feature three admins use. The bucket is opened for anonymous reads
because a product image is public by definition; writes go only through the credentials. The API
writes over `S3_ENDPOINT` and the browser reads over `S3_PUBLIC_URL`, separate so production can
point the second at a CDN without a code change.

Images have their own lifecycle, not the product save's: each upload, reorder and delete is its
own request returning the updated list, because batching would mean holding unsaved binary in the
browser and losing it on a validation error elsewhere in the form. Reordering is left/right
buttons rather than drag-to-sort - a keyboard can reach them. Deleting the primary promotes
whatever is now first, so a product with images always has exactly one. The delete removes the
row first and the object second, best-effort: the database is the source of truth for what
exists, the bucket is a cache of pixels, and an orphaned blob is cheaper than a blocked delete.

`sharp` and `@aws-sdk/client-s3` are new dependencies; `@fastify/multipart` is pinned to the 8.x
line, because 9.x wants Fastify 5 and this is Fastify 4. The image tests need MinIO running, the
same way the email tests need Mailpit - `pnpm setup:services` covers both.

**Task 7.5 is done**: the order list, the order detail, and the four things a person does to an
order - move it along, record what was sent, write down what happened, read what was bought.
16 tests.

The action buttons come from `allowedTransitions`, which the server computes from
`ORDER_STATUS_TRANSITIONS`, so the panel cannot offer a move the API would refuse and adding a
state to the map does not mean editing a list in the UI as well. **`refunded` is deliberately not
reachable from this contour** - not in the buttons, and refused with 409 in the service. A refund
is money leaving the account; it is recorded when the provider reports it, in the
`charge.refunded` webhook that is already built and tested. A button that wrote `refunded` locally
would tell a customer they had been paid back when nothing had left the account, which is the same
class of lie as a client-supplied price. Recorded as D-28.

A status change is one transaction with everything the change implies, and the row is locked for
it: two operators on the same order would otherwise both read `paid`, both find the transition
legal, and both write. Cancelling an order whose stock was already committed returns it to the
shelf with a `cancellation` ledger entry - not `restock`, which is a pallet arriving, and not
`return`, which is a parcel coming back; the goods never left. `sold_count` is reversed too, or
the bestseller sort would keep counting an order nobody received. Cancelling a `pending` order
credits nothing, because nothing was ever decremented.

Carrier and tracking ride along with the status change rather than being a second request: the
moment an operator marks an order shipped is the moment they have the number in hand, and splitting
it would send a customer a shipping notice with nothing to follow. `PUT .../tracking` exists
separately for the ordinary case of fixing a typo on an order that already shipped, which must not
send a second notice.

The shipping notice is a new email job and template. `templates.ts` grew a shared `shell()` so the
second letter is not a second copy of sixty lines of table markup. The notice is short on purpose -
somebody who gets it wants the tracking number, not a second reading of a bill already paid - and
the tracking block is omitted rather than filled with a placeholder when there is no number.

Verified in the browser against the seeded database: opened a processing order, saw exactly
`Mark shipped` and `Cancel order` offered, shipped it with a carrier and number, watched the
timeline stamp and the actions narrow to `Mark delivered`, and read the resulting letter in Mailpit
with the right tracking number and no totals. One defect found and fixed in the doing: the Tracking
panel kept the values it mounted with, so after shipping it showed empty fields - the panels are now
keyed on what they start from. The order was restored to `processing` afterwards.

**Task 7.6 is done**: wholesale enquiries, 13 tests. The list carries the queue that actually
matters - the ones nobody has taken - because the difference between an enquiry handled slowly and
one handled never is whether it has an owner. The detail puts status and owner in one row of
controls, since taking an enquiry and marking it contacted is one action to the person doing it,
and `assignedToId: null` hands it back to the pool. Any status may follow any other: unlike an
order there is no money or stock behind it, and an enquiry marked `declined` in error that then
revives is an ordinary Tuesday.

The note thread is append-only - it is a record of a conversation, not a document being drafted -
and each note carries its author's name copied into the row rather than joined, so it still says
who wrote it after that account is deleted. `submitted_ip` is written by the public form and
returned by nothing: it exists for investigating a flood of junk, which is a database question,
not something to print beside somebody's business name. A test asserts it appears in neither the
list nor the detail.

Verified against the seeded five enquiries: filtered to the unassigned pair, opened one, gave it
to Alina Petrova, moved it to `contacted`, added a note and saw it stamped with the author and the
time. The enquiry was restored to `new` and unassigned afterwards.

**Task 7.7 is in progress.** It was specified first, by four parallel design passes over the
schema and the existing services, then attacked from three angles - no-stubs, money and rounding,
what happens when things go wrong - and reconciled into one build plan. That pass is what found
the three holes below and what moved wholesale price tiers out of the task entirely.

**Customers is done**, 17 tests. A read-mostly surface where `status` is the only writable field:
everything else an admin panel usually grows here - reset the password, change the email, toggle
marketing consent - either manufactures a fact only the customer can create or opens a way into
their account, and each is in `BACKLOG.md` by name. Guests are absent because there is no row for
them, and the empty state says where their orders actually are rather than pretending otherwise.

The Block button required fixing three things first, or it would have been a claim the system does
not honour (decision D-29). `POST /api/auth/refresh` never re-read `customers.status`, so a
suspended account would have kept minting fifteen-minute access tokens for the thirty-day life of
its refresh family - the admin contour already re-read its own account there, with a comment saying
why, and the customer contour never had to because nothing could write that column. Blocking now
also revokes every refresh family in the same transaction, so the suspension is immediate rather
than "within fifteen minutes", and registering refuses a blocked guest row, or the block would be
undone by the person it was aimed at simply signing up.

Two smaller repairs came with it. The definition of "money taken and kept" existed as two array
literals in two services that the dashboard's own description claimed agreed; it is now
`EARNED_ORDER_STATUS` in contracts and both copies are gone, so the claim is true by construction.
And the order and wholesale lists built their `LIKE` patterns raw, so a search for `50%` matched
every row - the catalogue's `likePattern` escape existed already and they now use it.

**Settings is done**, 24 tests. A typed registry in `packages/contracts` decides what each key may
hold - `settings.value` stays JSON so a key can change shape without a migration, but nothing is
read or written unparsed. A generic editor over that column is a way to take the shop down: type
`"8.25%"` into the tax rate and every cart quote silently falls back to the default while the panel
shows the value it "saved".

Four keys are registered, not the seven the seed writes. `store.name` and `ops.notification_email`
have no consumer, and `commerce.free_shipping_threshold_cents` is decision D-22 - the checkout
charges from `shipping_rates.free_above_cents`, so the panel offers exactly one editable
free-shipping figure and it is the one in the rate row. An unregistered key is still shown, marked
"no editor", because the row exists and hiding it would be its own kind of lie; a registered key
whose stored value fails its schema is shown as broken with an empty control, so it can be repaired
here rather than only in MySQL.

That is also how D-22 finally got answered rather than restated. `GET /api/settings` computes
`freeShippingFromCents` from the active rates - the lowest live threshold, the same rule the cart's
own progress bar uses - and the storefront reads it. Three components hard-coded "$75": the
announcement bar, the header's mobile drawer and the product page's trust row. All three now read
the figure the checkout charges from, and the seed's duplicate key is gone.

Rates can be edited and retired, never created or deleted: `SHIPPING_METHOD` is a closed enum and
`orders.shipping_method` holds a snapshot of the code, so a deleted rate leaves past orders naming
something that no longer exists. Retiring the last active one is a 409, because a checkout with
nothing to select cannot take an order.

**Promo codes are done**, 24 tests, and they carry the task's only migration - four CHECKs on
`promo_codes` and an index on `orders.promo_code`.

`promo_codes.value` is one integer with three meanings, so the contract never transports it as a
bare `value`: `AdminPromoDiscount` is a discriminated union on type, which makes "a percentage of
1299 cents" unrepresentable rather than merely refused, and is why changing a live code's type is
safe - the payload cannot restate the type without restating the amount in the right unit. The cap
lives inside the `percent` member alone, because `discountFor` applies `max_discount_cents` to
whatever produced the raw figure, fixed codes included - a $20 fixed code capped at $5 would have
the panel printing $20 and the cart taking off $5. That divergence is the fourth CHECK, the one
the spec did not expect: `type = 'percent' OR max_discount_cents IS NULL`.

Nothing here deletes anything a customer has touched. `promo_redemptions.promo_code_id` is
`ON DELETE CASCADE`, so deleting a used code destroys the rows a per-customer limit is counted
from, and a delete-then-recreate resets every such limit without anybody deciding to. There is no
DELETE route; the terminal action is `is_active = false`, which the cart's evaluator already
honours. Renaming is free only while no order has ever named the code, at any status - between
checkout writing `orders.promo_code` and the webhook arriving, `used_count` and the redemption
rows both read zero, so guarding on either would let a rename slip through and leave a pending
order's redemption unrecorded. The check and the write share the paid transaction's own `FOR
UPDATE` lock.

Each code's state is derived on every read, never stored, in the cart evaluator's own branch order

- disabled, scheduled, expired, exhausted, live - so the chip names the same condition a customer
  is being told about. The SQL state filter is the same rule, fed the same clock, and two tests hold
  them together: one asserts every row a filter returns carries that filter's chip, and one asks the
  cart's own `evaluatePromo` whether it agrees about which codes are usable. `used_count` is an
  accounting fact the paid transaction writes and is in no input schema; `.strict()` turns an attempt
  to send it into a 422.

**Bulk pricing is done**, 19 tests, and finishes task 7.7. A two-step machine: a preview that
computes every affected row and writes nothing, then an apply that re-derives the same figures from
locked rows and refuses if anything moved underneath. The client echoes back what it saw as a
precondition, never as an instruction - the server writes only figures it recomputes from its own
rows, which is the admin-side reading of "a stale total is a 409, never a silent charge".

`computeChange` is the whole of the arithmetic and is pure, so most of the rounding proof is a
plain unit test with no database. Rounding is one step, half to even, through
`Money.basisPoints(10_000 + delta)` - the codebase's only percentage rounding, and one step rather
than two because rounding an intermediate the operator never sees can flip the parity half-even
tests: 1005 +10% is 1106 in one step and 1105 in two. The worked example a test pins: +2.5% turns
2500 into 2562 (2562 is even) and 9900 into 10148 (10147 is odd) - two ties rounding opposite ways,
which is exactly what half-up would get wrong, gaining the shop half a cent on every tie forever.

A result that breaks a database rule is `blocked`, not clamped: a price at or below zero, a
compare-at no longer above the price, a `start_sale` on a variant already on sale (the one
irreversible mistake - the true list price would be gone). A blocked row becomes one an operator
deselects rather than a 500 mid-transaction. compare-at moves with the price under every operation,
or a raise silently shrinks the advertised discount until the Sale badge - which by D-12 _is_ the
compare-at - quietly stops being true. Selling under cost is possible but never silent: a below-cost
row needs `allowBelowCost`. The whole apply is one transaction with the rows locked in id order (the
product form writes the same columns), all rows or none, because there is no audit log yet and a
partial apply would be unrecoverable.

Verified in the browser against the dev catalogue: previewed +2.5% across the lentils category and
read the half-even figures ($8.99→$9.21, $9.99→$10.24, $5.50→$5.64), confirmed the preview wrote
nothing, applied to one SKU and saw the row store 564 exactly, then restored it to 550.

**Task 7.8 is under way. The permission matrix is done**, 12 tests.

`ADMIN_PERMISSIONS` in `packages/contracts/src/rbac.ts` is one table with two consumers — the
Fastify guards and, next, the panel (D-30). Nineteen named permissions; every one of the 32 admin
routes now carries exactly one `requirePermission`, and bare `requireAdmin` is gone from
`admin.routes.ts`. `AccessTokenClaims` became a discriminated union on `typ`, so an admin token
without a role is unrepresentable rather than merely unusual — the guard used to carry
`if (!role || ...)`, a branch for a token that should not have been able to exist.

Two gates the earlier phases built were reversed, and both reversals were of the built code rather
than of Q-29's proposal (D-31). `GET /api/admin/settings` is owner and manager, because it is an
unfiltered read of a table whose schema comment says a non-public row is where an API key would
live; support keeps the half it is asked about through a new `GET /api/admin/shipping-rates`.
`POST /api/admin/pricing/preview` joins the apply at owner and manager, because a preview is step
one of a two-step write, not a report. Products gained a gate they never had: a support account
could create, edit and archive the catalogue.

The test that matters is the sweep. It reads the routing table through an `onRoute` hook rather
than a list written beside it — a list would be the second copy this task exists to remove — walks
every registered admin route unauthenticated and asserts 401 on each, then walks every read for
all three roles and asserts the status the table predicts, in one assertion so a failure names
every disagreement at once.

**Order cancellation is now above support**, 3 more tests. `allowedForRole` narrows the transition
list by role, so the buttons the panel draws and the write the API accepts are one list rather than
two that agree today; the check runs before the transaction opens, because a role that may not
cancel should not take a row lock to be told so, and a 403 is a different answer from "that
transition is not allowed". Support keeps everything else about an order — advancing it, fixing the
tracking, writing the internal note — because that is the work a support desk exists to do.
Cancelling is the one action that returns committed stock, reverses `sold_count` and leaves a paid
customer owed money this panel cannot move (D-28), and `cancelled: []` means there is no undo.

`adminActor(request)` replaced the inline narrow the wholesale-notes route was carrying; it is the
one place the actor's id and role are read, and the audit log will hang off it.

**The Team surface is done**, 18 tests. It exists because the matrix needed somewhere to be
administered from: nothing could write `admin_users.role` before it, so the only way to make
somebody a manager was an UPDATE in Studio — D-29's situation exactly, applied to authority rather
than to a customer's account.

Its four routes are the only ones behind `requireFreshPermission`, which re-reads `admin_users` on
every request. Every other permission merely delays inside the fifteen-minute token window;
`team:manage` breaks that bargain, because inside the window a demoted owner could create a second
owner account and undo their demotion permanently (D-32). Reducing authority revokes the target's
refresh families; promoting does not, because their next refresh re-reads the row anyway.

Three guards, all against the same failure — an owner locking the shop out of its own back office.
No changing your own role, no deactivating yourself, and no change that leaves zero active owners,
the last checked under `FOR UPDATE` so two owners cannot demote each other at once. All three are
409: the request is well-formed and authorised, and what is refused is the state it would produce.
There is no DELETE at any role (D-33). Accounts are created with a password the owner sets, because
an email invite needs a token table, an expiry, a public accept page and mail delivery — a feature,
not a guard — and without it a forgotten password is unrecoverable without SQL.

**The audit log writes**, 10 tests, and it carries the task's one migration — `actor_role`,
`entity_label` and two indexes on a table that has existed since migration 0000 with no writer at
all. Seventeen actions over seventeen write routes, one string each.

The entry goes in **inside the caller's transaction** (D-34). A Fastify hook cannot see the
before-image, and that image is the whole point of `before`/`after`; a write after the commit can
succeed while the audit fails, leaving a destructive change with no record. A failed audit write
therefore fails the whole action — no try/catch, no best effort — which is only safe because the
realistic failure is removed by construction: under `STRICT_TRANS_TABLES` an over-long varchar is
an error rather than a truncation, so every string is clamped to its column first. Six services
grew a transaction they did not have, and five moved their before-image read inside one.

Every projector names its columns one at a time, never a spread (D-35). That is the file's whole
security model: a spread would archive every column a table ever grows, including the next
credential somebody adds, and `audit_log`'s comment has promised since Phase 2 that a password hash
cannot end up there by accident. A test asserts no entry body contains `$argon2` or `passwordHash`.

One entry per action the operator performed, not per row touched (D-36). A bulk price change over
five hundred variants is one entry keyed by SKU; a settings save is one entry for the card. Two
routes write nothing on purpose: a wholesale note is already an append-only row with its own author
and time, so it _is_ the audit record, and the auth contour is covered by `refresh_tokens`.

Still to come in 7.8: (nothing can write
`admin_users.role` today, so the matrix is a claim the system cannot yet honour), one migration,
the audit writer and its screen, and the panel's own permission gating. Then the end-to-end
scenario (7.9).

`apps/web/src/store/cart.ts` holds variant ids and quantities and nothing else. Every figure
comes from `POST /api/cart/validate`. A cart that cached its own totals would show a stale
price the moment a sale ended, and the checkout would then disagree with it.

The home page is now the mockup's, less two sections and a band: the featured slider, the hero's
`scrollY * 0.12` parallax, the origin story and the testimonials all landed. The slider's three
slides are the products an editor has ticked as featured, not hard-coded copy, so the front page
changes without a deploy. The mockup's third slide is a `WELCOME10` welcome offer and is not
built: a promo code printed in markup is a promise the database may not keep, and the
announcement bar already carries that message from a setting the owner edits.

Testimonials are **published five-star reviews**, through a new `GET /api/testimonials`. There is
no `testimonials` table on purpose — it would hold a second, unmoderated copy of the reviews the
shop already has. The mockup's "Brooklyn, NY" is dropped for the same reason the Plov Set is:
a review has no city on it, and inventing one invents a customer. The product replaces it, which
the shop does know and which gives the card somewhere to link.

The wholesale band is the one section still missing, and only because its call to action goes to
`/wholesale`, which Phase 6 builds.

The 404 is the designed one — a 140px DM Serif numeral with a gold zero, "This page wandered off
the Silk Road", two ways out — and carries its own `noindex` title. The status code is still 200
until Nginx answers 404 for an unknown path, which is Phase 9.

Cart changes are announced through one polite live region in the layout (`CartAnnouncer`), which
covers every way the cart can change rather than each of them separately. It is silent on the
first render: a cart restored from `localStorage` has not changed.

Storefront's first paint is **162 KB gzip** against the 250 KB budget, plus the route's own chunk
— 4.5 KB for the home page. Route-level splitting and taking Zod out of the bundle brought that
down from 198 KB; the details are under Lighthouse below.

### Lighthouse — measured, and one criterion not met

`pnpm lighthouse` runs the whole matrix: eleven screens, desktop and mobile, against the
**built** bundle behind `vite preview` on :4173. Never the dev server — an unminified module
graph measures nothing anybody loads. `pnpm lighthouse --block-third-party` repeats it with the
seed's image hosts blocked, which separates what this code costs from what the fixture costs.

| Category       | Result                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility  | **95–97 on all eleven screens, both form factors.** Criterion met.                                                                                                                                              |
| SEO            | **100** on every public page. 66 on `/cart`, `/wishlist`, `/account` and the 404, from a single failing audit — `is-crawlable`. Those four are deliberately `noindex`, so the low score is the correct outcome. |
| Performance    | Pages without the seed's third-party images: **desktop 97–100, mobile 87–89.** Pages with them: desktop 89–99, mobile 71–88, swinging ten points between runs. **The ≥90 mobile bar is not met anywhere.**      |
| Best practices | **96**, except 73 on the pages that load third-party images — their cookies are the whole finding.                                                                                                              |

**The number is not stable, and that is itself a finding.** Three full matrix runs on the same
build: every page without third-party images repeated to the point (cart 89/89, about 89/89,
wishlist 88/88, product 87/87, account 82/82), while home went 85 → 71, shop 86 → 73 and recipes
88 → 80 — purely on how `themealdb.com` and Unsplash felt that minute. Blocked, on the final
build, they read home 80, shop 84, category 86, recipes 88. Until images are self-hosted (task
**7.4**) this metric cannot be measured reliably, never mind hit a threshold.

Three optimisations were done rather than deferred. The main chunk went from **198 KB gzip to
162 KB**, and mobile CLS on `/help` from 0.263 to 0.004.

- **Zod was in the storefront bundle** — 146 KB of sources, for two constant arrays. A value
  import from the `@silkgrain/contracts` barrel pulls the whole schema layer; type imports are
  erased and cost nothing, which is why it went unnoticed. `@silkgrain/contracts/constants` is a
  third entry point beside `money`, Zod-free by construction, and the storefront reads
  `CART_LINE_MAX_QTY` and `PRODUCT_SORT` from there. −17 KB gzip.
- **Route-level splitting** (task **8.4**, pulled forward). Each route is now a definition file
  plus a `<name>.page.tsx` behind `lazyRouteComponent`, so a visitor downloads the page they
  asked for: 1.2–4.9 KB gzip a page against 36 KB for all of them. −32 KB gzip off first paint.
  `validateSearch` stays in the definition — it runs before the component's chunk is fetched —
  and the two pages that read their own route use `getRouteApi(id)` rather than importing the
  route object, which would be a cycle with the lazy import.
- **A skeleton that lied about its height.** `/help` scored 73 on mobile against 87–89 for its
  peers, consistently, across every run. Not the bundle: **CLS 0.263**, where every other page
  reads 0.005. The FAQ placeholder was five 64px bars reserving 368px for a list that needs 744,
  so the contact form beside it dropped 376px the moment the answers arrived. Lighthouse weights
  CLS at a quarter of the score, so one mismatched placeholder cost the page fifteen points. The
  skeleton now mirrors the loaded shape — a heading and a row per FAQ category, from the same
  list the response is grouped by — and `/help` reads 86–87 with CLS 0.004.

What is left is not bundle size. Splitting removed 32 KB and FCP did not move: under the mobile
preset's 4× CPU throttle a client-rendered page paints nothing until the framework boots, and the
main chunk holds 910 KB of sources of which 421 KB is `react-dom`, `router-core`, `query-core` and
`react-router` before a line of ours, plus 278 KB of icon registry the header and cards need
immediately. **≥90 on mobile needs prerendering or SSR**, which is an architecture decision and
not a task in the plan. The seed's third-party images are the other half — `/shop` pulls 3.4 MB
from `themealdb.com`, `/recipes` 887 KB from Unsplash — and own images with resize and webp is
task **7.4**.

That leaves **Q-46** for the owner: accept Phase 5 with the mobile bar carried into Phase 8
alongside 7.4, or treat prerendering as its own decision.

### The 1440 / 1024 / 760 pass

The other half of Phase 5's acceptance — every screen checked at three widths — is done, driven
in the browser rather than eyeballed. Eleven screens × three widths, measuring what the
responsive handoff actually specifies: horizontal overflow, gutter, product-grid columns, sticky
behaviour, touch-target height and form-control font size.

What it confirmed: no horizontal overflow anywhere, gutters exactly 28 / 22 / 16, product grids
4 → 3 → 2, sticky columns unpinned at 1024 and below.

What it caught — and every one of these had shipped:

- **Form controls were 14px on mobile.** iOS Safari zooms the page when a field under 16px takes
  focus and never zooms back; the handoff makes 16px a rule. `controlClasses` now carries
  `mobile:text-[16px]`, which covers every `Input`, `Textarea` and `Select` at once.
- **Six kinds of touch target were under the 44px floor**: the `sm` button (36px), the product
  card's wishlist heart (34), its Quick view pill (35) and Add to Cart (39), FAQ accordion rows
  (30), pagination numbers (40) and the slider's indicators — 3px, the worst of them, now a
  44px hit area around an unchanged 3px rule. **No component in `packages/ui` had used the
  `mobile:` variant before this**: the responsive layer had been written per page, and the shared
  components were the gap that left.
- **`/shop` rendered a four-up grid**; the mockup's catalogue is `repeat(3,1fr)` with a 22px gap,
  because the 260px sidebar has already taken its share of the row. The gap is now paired with
  the column count — 24px at four across, 22px at three — so the two cases cannot drift.

Task 5.4's **grid / list toggle is not built**, deliberately. The mockup draws the two icon
buttons but never draws a list: every screen in the prototype renders the grid, so the row
layout, what it shows that a card does not, and how it behaves at 760px are all undesigned. It is
in `BACKLOG.md` with that reasoning. A control that changes nothing is worse than an absent one.

Three real defects came out of the Lighthouse run and are fixed: the four overlay panels kept their controls
in the tab order while closed (`aria-hidden` hides from a screen reader and does nothing to Tab —
see `packages/ui/src/a11y.ts`), the add-to-cart button's accessible name did not contain its own
visible label, and `EmptyState` hard-coded an `h3` that skipped a level under a page's `h1`.

The one remaining contrast finding is the wordmark's gold half at 2.13:1. It is a brand lockup,
which WCAG 1.4.3 exempts and no markup can declare — `aria-hidden` does not help, because the
rule measures what a sighted reader sees. Left as the designer drew it; changing the mark is the
owner's call. Decision D-7 bars gold from carrying text everywhere else, and nothing else does.

---

## Blocked on the owner

1. **Phase 2 and Phase 3 acceptance.** Both reported; the process in `CLAUDE-CODE-PROMPT.md`
   says a phase is not left until the owner confirms.
2. **Q-46 — Phase 5's mobile Performance bar.** A11y, SEO and desktop Performance all pass. 8.4
   was pulled forward and done, which took mobile from 62–87 to 70–89; the rest is the seed's
   third-party images (task 7.4) and the cost of booting a client-rendered app, which only
   prerendering or SSR changes. Accept the phase and carry the mobile bar into Phase 8, or treat
   prerendering as its own decision? Numbers and a recommendation are in `QUESTIONS.md`.
3. **Decisions taken during Phase 2 without waiting** — Q-6, Q-12, Q-13, Q-15, Q-16 are
   answered in place in `QUESTIONS.md` and recorded as D-12…D-18 in `CLAUDE.md`. They shaped
   the schema, so reversing one now costs a migration.
4. **Decisions taken during Phase 3** — D-21…D-25 in `CLAUDE.md`. None costs a migration;
   D-22 is the one worth a glance, because it makes `commerce.free_shipping_threshold_cents`
   decorative and the shipping rate row authoritative.

Answered on 2026-07-29, nothing left to ask:

- **Q-33 — the responsive pass ships inline with Phase 5** (D-19, supersedes D-8). Every screen
  is written with `tablet:` and `mobile:` classes from the start, and Phase 5 acceptance runs
  Lighthouse on mobile as well as desktop. The backlog entry is gone; Phase 5 stays at 70–90 h.
- **Q-43 — nutrition data is entered in the admin panel** (D-20). The seed's category-level
  reference values stand in until then. Phase 7's product form grows a full Nutrition Facts
  section and a migration marking which rows were entered by hand; task 7.3 goes 10 h → 12 h.

---

## What exists

```
apps/api        Fastify 4. Plugins, error handler, Drizzle schema (32 tables), migrations,
                seeds, auth, the catalogue and cart API, /health, /ready, Swagger on /docs.
apps/web        Vite 5 + React 18 + TanStack Router/Query + Zustand. The storefront: the
                frame, home, /shop, /shop/c/$slug, /product/$slug, /cart and the drawer,
                /about, /help, /recipes, /wishlist, /account.
apps/admin      Vite 5 + React 18 shell.
packages/ui     The design system. 22 components, tokens, Tailwind preset, Storybook.
packages/contracts  primitives, errors, enums, Money, pagination, auth, catalog, cart,
                    checkout and order schemas. Wholesale arrives with Phase 6; the shape is
                    drafted in CONTRACTS-DRAFT.md.
packages/config eslint, prettier, tsconfig bases.
docs/design     SCREENS.md and catalog.json, both distilled from the mockup.
```

### The API, briefly

```
src/app.ts                    buildApp(env) - returns an un-listened instance for inject()
src/env.ts                    Zod-validated at boot; only variables the code reads
src/plugins/                  error-handler, request-context, database, redis, security, auth, swagger
src/db/schema/                catalog, orders, customers, wholesale, content, system + columns.ts
src/db/{migrate,reset,seed}   forward-only migrations, a guarded drop, a deterministic seed
src/modules/auth/             routes, service, tokens
src/modules/catalog/          query (filters and sorts), service (four reads), routes
src/modules/cart/             cart, promo and shipping services, routes
src/modules/orders/           order numbers, the settlement transaction, reads, routes
src/modules/webhooks/         Stripe events: raw body, signature, idempotency
src/modules/mail/             mailer, templates, the BullMQ queue and its worker
src/modules/health/           /health and /ready
src/lib/settings.ts           reads a value the owner edits in the admin panel
src/test/harness.ts           integration harness against silkgrain_test
src/test/fixtures/catalog.ts  the hand-written test catalogue (decision D-24)
```

Endpoints as of Phase 3:

```
GET  /api/categories          tree with counts computed from the database
GET  /api/products            filters, sorts, offset pagination, one facet per sidebar card
GET  /api/products/:slug      variants, nutrition, reviews with histogram, related
GET  /api/testimonials        published five-star reviews for the home page (Phase 5)
GET  /api/search/suggest      type-ahead plus popular terms
POST /api/cart/validate       reprices a cart; an unusable promo is reported, not thrown
POST /api/cart/promo          the Apply button; an unusable promo is a PROMO_* error
```

Added in Phase 4:

```
GET  /api/faqs                published entries, grouped in the enum's order
GET  /api/recipes             newest first; the newest is `featured` and not repeated
GET  /api/recipes/:slug       one recipe, with the products it uses
POST /api/contact             the Help form; honeypot and fill-time checked, silently
GET  /api/orders/:number      guest lookup; the order's email is required as well
GET  /api/account/orders      the signed-in customer's history
GET  /api/account/orders/:num their own order, no email needed
GET  /api/account/summary     the account page's stat cards: order count, lifetime spend
POST /api/webhooks/stripe     the only path to `paid`. Raw body, signature, idempotent
```

Added in Phase 6:

```
POST /api/wholesale/requests  the enquiry form; same guards as /api/contact, 3 an hour
```

Added in Phase 7:

```
GET  /api/admin/dashboard     KPIs, a 30-day revenue series, low stock, recent orders
GET  /api/admin/products      every product, drafts included; search covers the SKU
GET  /api/admin/products/:id  everything the form edits, cost price and panel source included
POST /api/admin/products      create, one transaction
PUT  /api/admin/products/:id  replace and reconcile variants; an omitted variant is deleted
POST   /api/admin/products/:id/images            upload one image; re-encoded to webp
PUT    /api/admin/products/:id/images            reorder and choose the primary
PATCH  /api/admin/products/:id/images/:imageId   set alt text
DELETE /api/admin/products/:id/images/:imageId   delete; primary passes on
GET    /api/admin/orders                         list; q matches number or email
GET    /api/admin/orders/:orderNumber            detail, with allowedTransitions
POST   /api/admin/pricing/preview               compute a bulk price change; writes nothing
POST   /api/admin/pricing/apply                 apply it, all rows or none, on locked rows
GET    /api/admin/promos                         promo codes, each with its derived state
GET    /api/admin/promos/:id                     one code with its latest redemptions
POST   /api/admin/promos                         create
PUT    /api/admin/promos/:id                     replace; 409 on renaming a used code
PATCH  /api/admin/promos/:id/active              the kill switch; there is no DELETE
GET    /api/settings                             public: announcement, contact, free-ship figure
GET    /api/admin/settings                       settings and shipping rates, one read
PUT    /api/admin/settings                       a partial batch; all keys land or none
PUT    /api/admin/shipping-rates/:id             edit or retire; 409 on the last active one
GET    /api/admin/customers                      account holders; guests have no row
GET    /api/admin/customers/:id                  one customer and their ten latest orders
PATCH  /api/admin/customers/:id/status           suspend or restore; revokes the sessions
GET    /api/admin/wholesale/requests             enquiries; `unassigned` is the real queue
GET    /api/admin/wholesale/requests/:id         one enquiry with its note thread
PATCH  /api/admin/wholesale/requests/:id         status, owner, or both
POST   /api/admin/wholesale/requests/:id/notes   append a note, stamped with its author
GET    /api/admin/users                          the team, for the assignee picker
PATCH  /api/admin/orders/:orderNumber/status     move it along; 409 on an illegal move
PUT    /api/admin/orders/:orderNumber/tracking   correct the tracking, send nothing
PUT    /api/admin/orders/:orderNumber/note       the internal note
```

`apps/admin` now carries the dashboard, the product list and the product form — router, query
client, session store and its own transport, all added in Phase 7.

```

```

Registration order in `buildApp` is load-bearing and commented there: error handler first,
request context before auth, **Swagger before the routes** (it collects the document through
an `onRoute` hook, so a route registered earlier is a route it never sees).

### Things worth knowing before touching them

- **One ESLint config, at the repo root.** ESLint 9 resolves a single flat config from the
  working directory, so per-package configs left lint-staged reporting every staged file as
  ignored. Packages have no `lint` script; `pnpm lint` runs once from the root.
- **`no-misused-promises` has `checksVoidReturn.properties: false` for `apps/api`.** Fastify's
  route-option hook types default to the callback overload returning `void`, so a correct
  async guard passed to `onRequest` is otherwise reported as a misused promise.
- **Icons come from `packages/ui/src/components/icon-registry.ts`.** A namespace import of
  Phosphor measured 1.1 MB gzip.
- **`CONTRAST_PAIRS` in `packages/ui/src/tokens.ts` is a contract**, asserted by
  `tokens.test.ts`. A component cannot introduce a new foreground/background pair without
  declaring it. See D-7.
- **`Money` is exported on its own subpath**, `@silkgrain/contracts/money`, so the browser can
  format a price without pulling Zod and every schema into the bundle. `PriceTag` uses it, and
  it is the only place in the repository allowed to construct an `Intl.NumberFormat`.
- **The seed refuses a non-empty database and `db:reset` refuses a database not named
  `silkgrain*`.** Both are deliberate; a mistyped `DATABASE_URL` cannot empty something else.
- **Two failures found by the Phase 2 tests, both fixed, both worth remembering:** throwing out
  of a Drizzle transaction rolls back the revocation the rejection was there to perform, and
  `@fastify/rate-limit` _throws_ whatever `errorResponseBuilder` returns, so returning a plain
  object produces a 500 instead of a 429.
- **Catalogue filters are `EXISTS` subqueries, never conditions on a joined variant row.** A
  join would multiply the product by its matching variants and turn the price aggregate into
  the aggregate of the _filtered_ ones, so a card filtered to "under $20" would advertise a
  range ending at $20 instead of its real one. `catalog.query.ts` says so at the top.
- **A list is assembled in two steps**: one query decides which products and in what order,
  then `IN (...)` queries fetch variants, images, badges and certifications. `loadCards` returns
  them in the id query's order — re-sorting there would silently discard the sort.
- **`z.coerce.boolean()` is `Boolean(value)`.** `?inStock=false` arrived as the string `"false"`,
  which is truthy, so the filter switched itself on. `QueryBoolean` in
  `packages/contracts/src/modules/catalog.ts` accepts the two words and rejects everything else.
  Any future query-string boolean uses it.
- **`availableQty` is capped at `CART_LINE_MAX_QTY`, deliberately.** An endpoint reporting
  "1,483 in stock" hands a competitor the inventory position; capped, it still tells the
  quantity stepper where to stop.
- **`PUBLISHED_PRODUCT` in `catalog.query.ts` is the one definition of "in the catalogue"**,
  and it now covers `categories.is_active` as well as `products.status`. Every query using it
  must join `categories`; it is a list of conditions rather than one combined `SQL` so call
  sites spread it instead of asserting that `and()` returned something.
- **A `requestAnimationFrame` throttle must not store the frame id as its "pending" flag.**
  `frame = requestAnimationFrame(() => { frame = 0; … })` reads correctly and deadlocks the
  moment a frame runs synchronously: the callback clears the variable, then the assignment
  overwrites it with the id, and every later event takes the early return forever. The parallax
  hook holds a separate boolean set _before_ the request. Found by driving the real page — the
  transform never moved, and the first suspect (a hidden tab, where rAF genuinely never fires)
  was only half the story.
- **A route with its own `config.rateLimit` gets an independent bucket**, it does not add to
  the global 300/min. That is why `/api/cart/promo` sets 12 per five minutes explicitly, and
  why two routes sharing a concern do not share a budget unless they share a key.

---

## Local services

Provisioned by `scripts/dev-setup.ps1` into `.services/` (gitignored). No Docker, no admin
rights, nothing written to the registry or PATH.

| Service      | Address                                | Credentials                                                               |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------- |
| MySQL 8.0.42 | `127.0.0.1:3307`                       | `root` / `silkgrain_dev_only`, databases `silkgrain` and `silkgrain_test` |
| Redis 7.4.5  | `127.0.0.1:6379`                       | none, `maxmemory-policy noeviction`                                       |
| Mailpit      | SMTP 1025, UI http://localhost:8025    | none                                                                      |
| MinIO        | S3 9000, console http://localhost:9001 | `silkgrain` / `silkgrain-dev-secret`                                      |

```powershell
pnpm setup:services
powershell -File scripts/dev-setup.ps1 -Action status
powershell -File scripts/dev-setup.ps1 -Action stop
```

XAMPP's MariaDB stays on 3306 and is not used by this project. Never point the app at it: it
runs without `STRICT_TRANS_TABLES`, so bad data is truncated instead of rejected.

`.env` is gitignored and already exists on this machine with real JWT secrets. Seeded admin
accounts are `owner@silkgrain.local`, `manager@…`, `support@…`, password `SilkGrainDev!2026` —
development only, printed by `pnpm db:seed`.

---

## Design source

`silkgrain-design-prompt/for adaptive/` supersedes `project/`. Its `README.md` is the
responsive specification and is authoritative for layout behaviour.

Rather than re-read the 227 KB prototype:

- `docs/design/SCREENS.md` — every screen's structure, the global chrome, and which parts have
  no design at all.
- `docs/design/catalog.json` — sixteen products, six categories, the demo cart, six recipes,
  five FAQ entries, five wholesale enquiries and seven demo orders, extracted verbatim.
  Regenerate with `node scripts/extract-design-data.mjs` after any new handoff; the diff shows
  exactly what the designer changed.

---

## What Phase 4 has to get right

Orders and payments. The full task list is in `PLAN.md`; these are the three things that will
bite, and two of them are contracts Phase 3 has already fixed.

1. **The order's totals must be the cart's totals.** `taxable = subtotal − discount + shipping`,
   tax at the default rate on that base (decision D-25). `cart.service.ts` and the seeded orders
   in `db/seed/index.ts` already agree; the checkout writer is the third place that has to, and
   the moment it does not, a customer is charged something other than what the cart showed.
2. **Per-customer promo limits become authoritative in the checkout transaction.** The cart only
   checks them when it happens to know who is asking (decision D-23). The transaction that marks
   an order paid is the one place that reads and writes `promo_redemptions` together, so it is
   the only place the limit can actually be enforced. `promo.service.ts` says so where it gives
   up.
3. **Stock is decremented in the same transaction that moves the order to `paid`, inside the
   webhook.** Not on the redirect. The `product_variants_stock_nonneg` CHECK is there to make an
   oversell impossible even if a code path forgets to look.

The cart already hands checkout everything it needs: `CartQuote` carries the priced lines, the
discount, the selected shipping option and every option's price, so `POST /api/checkout/intent`
recomputes rather than re-derives.

---

## Decisions already taken

The table lives in `CLAUDE.md`, D-1 through D-25. In short: Premium palette; shipping rates in
the database; order numbers `SG-YYYY-NNNNN`; estimated tax in the cart with Stripe Tax
authoritative at checkout; the simplified wholesale form; portable local services on MySQL 8;
nine tokens darkened for contrast with gold kept as decoration only; the responsive pass inline
with Phase 5; no logo asset yet; icons from an explicit registry; derived badges never stored;
moderated reviews without customer input yet; scaled integers for every physical quantity;
opaque rotating refresh tokens; `@node-rs/argon2`; forward-only migrations; no `carts` table;
nutrition entered by hand in the admin panel; facets computed with their own filter removed;
the shipping rate row rather than a setting as the free-shipping authority; a cart that never
fails over a promo code; a hand-written test catalogue; and the cart's arithmetic as the
contract Phase 4 must match.
