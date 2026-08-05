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

**Phase 5 has started**, because it needs nothing from Stripe until the checkout. Done and
driven in a real browser: the frame (router, layout, announcement bar, sticky header, footer,
scroll restoration, error boundary, 404), the home page's hero, category strip and both
product rails, and `/shop` with URL-driven sorting and pagination.

The header and footer carry **only links to pages that exist**, and grow as the pages land.
The design's nav is five items and one ships. This is deliberate: a header full of links to
pages that are not built looks finished and is not.

Next in Phase 5: the search overlay, the mega-menu and the cart drawer (5.2), then the product
page and the cart page, then the content pages the nav is waiting on.

`apps/web/src/store/cart.ts` holds variant ids and quantities and nothing else. Every figure
comes from `POST /api/cart/validate`. A cart that cached its own totals would show a stale
price the moment a sale ended, and the checkout would then disagree with it.

Storefront bundle is **172 KB gzip** against the 250 KB budget, up from 110 KB for the router,
the query client and the store. Route-level code splitting is task 8.4.

---

## Blocked on the owner

1. **Phase 2 and Phase 3 acceptance.** Both reported; the process in `CLAUDE-CODE-PROMPT.md`
   says a phase is not left until the owner confirms.
2. **Decisions taken during Phase 2 without waiting** — Q-6, Q-12, Q-13, Q-15, Q-16 are
   answered in place in `QUESTIONS.md` and recorded as D-12…D-18 in `CLAUDE.md`. They shaped
   the schema, so reversing one now costs a migration.
3. **Decisions taken during Phase 3** — D-21…D-25 in `CLAUDE.md`. None costs a migration;
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
apps/web        Vite 5 + React 18. src/App.tsx is a design-system preview page, not the
                storefront; Phase 5 replaces it.
apps/admin      Vite 5 + React 18 shell.
packages/ui     The design system. 22 components, tokens, Tailwind preset, Storybook.
packages/contracts  primitives, errors, enums, Money, pagination, auth, catalog and cart
                    schemas. Checkout, order and wholesale arrive with the phases that serve
                    them; the shape is drafted in CONTRACTS-DRAFT.md.
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
GET  /api/search/suggest      type-ahead plus popular terms
POST /api/cart/validate       reprices a cart; an unusable promo is reported, not thrown
POST /api/cart/promo          the Apply button; an unusable promo is a PROMO_* error
```

Added in Phase 4:

```
GET  /api/orders/:number      guest lookup; the order's email is required as well
GET  /api/account/orders      the signed-in customer's history
GET  /api/account/orders/:num their own order, no email needed
POST /api/webhooks/stripe     the only path to `paid`. Raw body, signature, idempotent
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
