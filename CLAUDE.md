# CLAUDE.md — working agreement for this repository

Read this before touching anything. It records decisions that are already made, so they
don't get re-litigated, and the local quirks that will bite you otherwise.

**Where the work currently stands is in [STATE.md](STATE.md)** — phase, branch, what is
blocked on the owner, and what the next phase does first. Read that too if you are picking the
project up cold.

Rather than re-reading the 227 KB prototype: [docs/design/SCREENS.md](docs/design/SCREENS.md)
distils every screen and names the parts that were never designed, and
[docs/design/catalog.json](docs/design/catalog.json) holds the sixteen products and six
categories verbatim (regenerate with `node scripts/extract-design-data.mjs`).

---

## What this is

SilkGrain — an e-commerce platform importing and selling Central Asian food products
(rice, lentils, grains, dried fruit, spices) in the USA. LLC in Houston, Texas.
Currency USD, interface English, two audiences: retail and wholesale.

---

## Source of truth for design

`silkgrain-design-prompt/for adaptive/SilkGrain Premium.dc.html` — the primary mockup.
All 16 screens live in that one file, switched by `sc-if` flags.

Two bundles were handed over. **The `for adaptive/` one supersedes `project/`**: same design,
plus the responsive layer, plus a mobile nav panel, and it fixes two defects in the older
file (the mega-menu was pasted a second time inside the admin header, and the first hero
slide pulled a photo from Unsplash instead of the Wikimedia one the rest of the deck uses).
`for adaptive/README.md` is the responsive specification and is authoritative for layout
behaviour; `project/` is kept only as history.

Hierarchy when files disagree:

```
for adaptive/README.md (layout behaviour)
  > for adaptive/SilkGrain Premium.dc.html
  > for adaptive/ProductCardPremium.dc.html
  > project/*  (superseded)
  > uploads/silkgrain-design-prompt.md (original brief)
```

Where that README's prose contradicts the mockup's code, the code wins: it lists the Sale
badge as `#FF5A1E` and merges New with Organic, but `ProductCardPremium.dc.html` uses
`Sale #B85C38`, `New #0E6B4A`, `Organic #4C7A5A`. `#FF5A1E` is the accent from the rejected
v2 direction, so the prose is a leftover.

### Responsive rules

Two breakpoints, both max-width: **1024px** (tablet) and **760px** (mobile). Gutters
28 / 22 / 16px. Tablet collapses two-column sections and sidebars, takes product grids from
four columns to three and unpins sticky columns. Mobile goes single-column everywhere except
product grids, which stay two-up. Buttons get a 44px minimum height and form controls a 16px
minimum font size so iOS does not zoom on focus. Admin tables scroll horizontally at a 720px
minimum width rather than collapsing.

The prototype implements all of this with attribute-substring selectors and `!important`,
because its authoring environment allows inline styles only. **Do not port that.** It is
evidence of intent; the implementation uses Tailwind's `tablet:` and `mobile:` variants,
which are wired to these exact breakpoints in the preset.

**Rejected iterations — do not implement:** `SilkGrain Storefront.dc.html` (v1, old palette
`#2E5D3A`/`#C8A84B`/`#F7F2E8`, no mega-menu / search / drawer / quick-view),
`SilkGrain v2.dc.html` (orange Bricolage direction), `SilkGrain Directions.dc.html`
(12 style explorations A–L), `ProductCard.dc.html`, `ProductCardV2.dc.html`.
`SilkGrain Palettes.dc.html` documents the palette choice: variant 3, "bright emerald + gold".

`.dc.html` is a design-tool DSL (`<x-dc>`, `<sc-if>`, `<sc-for>`, `{{ binding }}`,
`style-hover=`). Reproduce the **visual result**, not the prototype's structure. Inline
styles become design tokens and Tailwind classes.

Do not render these files in a browser or screenshot them. Every dimension, colour and rule
is in the source as text.

The bundle is read-only. Never edit, reformat or lint it — it is excluded in
`.prettierignore`, `.gitattributes` and every ESLint config.

---

## Local environment — read this, it is not the standard setup

|            | Spec assumed       | Reality on this machine                 |
| ---------- | ------------------ | --------------------------------------- |
| Database   | MySQL 8            | XAMPP ships **MariaDB 10.4.32** on 3306 |
| Containers | Docker Compose     | **no Docker, no WSL, no admin rights**  |
| Redis      | required by BullMQ | not installed                           |
| Node       | —                  | v26.4.0, npm 11.17.0, pnpm 10.34.5      |

Resolution, agreed with the owner:

- **MySQL 8.0.42 runs on port 3307**, installed as a portable ZIP under `.services/`.
  XAMPP's MariaDB keeps 3306 and is not touched. Dev and production both run MySQL 8.0.x,
  so no dialect drift.
- **Redis, Mailpit and MinIO** are portable Windows binaries under `.services/` too.
  Nothing is written to the registry, PATH or Program Files.
- `docker/docker-compose.dev.yml` is kept accurate and is what CI uses. Ports, credentials
  and versions are identical between it and `scripts/dev-setup.ps1` on purpose.

```powershell
pnpm setup:services                                  # install + start everything
powershell -File scripts/dev-setup.ps1 -Action status
powershell -File scripts/dev-setup.ps1 -Action stop
powershell -File scripts/dev-setup.ps1 -Action remove
```

| Service      | Address                                  | Notes                                                     |
| ------------ | ---------------------------------------- | --------------------------------------------------------- |
| MySQL 8.0.42 | `127.0.0.1:3307`                         | `silkgrain`, `silkgrain_test`                             |
| Redis 7.4.5  | `127.0.0.1:6379`                         | `maxmemory-policy noeviction` — BullMQ must not lose jobs |
| Mailpit      | SMTP `1025`, UI http://localhost:8025    |                                                           |
| MinIO        | S3 `9000`, console http://localhost:9001 | `silkgrain` / `silkgrain-dev-secret`                      |

### Windows gotchas that already cost time

- **PowerShell scripts must be pure ASCII.** Windows PowerShell 5.1 reads BOM-less files as
  ANSI; a UTF-8 em dash becomes bytes it parses as a string delimiter, and the script fails
  with syntax errors pointing at unrelated lines.
- **pnpm 10 blocks lifecycle scripts.** `esbuild` and `unrs-resolver` need theirs; they are
  allow-listed in `pnpm-workspace.yaml` under `onlyBuiltDependencies`. Without that, Vite
  and tsup fail at runtime with a missing platform binary.
- **XAMPP's MariaDB has no `STRICT_TRANS_TABLES`.** Our MySQL instance sets it explicitly.
  Never point the app at 3306.
- **`sql_mode` includes `ONLY_FULL_GROUP_BY`, because stock MySQL 8 does.** It was missing
  until Phase 3, so the local server was more permissive than any production install would be
  and a grouped query could have passed here and failed there. The value is written in three
  places that must stay identical: `scripts/dev-setup.ps1`, `docker/docker-compose.dev.yml`
  and the generated `.services/my.ini`. Changing it needs a MySQL restart.

---

## Stack — fixed, do not change without discussion

```
apps/web      React 18 + Vite 5 + TS + Tailwind + TanStack Router + TanStack Query + Zustand
apps/admin    same stack, separate build, served under /admin
apps/api      Fastify 4 + TS + Drizzle ORM + MySQL 8 + Redis + BullMQ + Zod
packages/ui        components, tokens, Tailwind preset
packages/contracts Zod schemas + types — the single source of truth between api and web
packages/config    eslint, tsconfig, prettier
```

---

## Non-negotiable engineering rules

**Money is integer cents in `BIGINT`.** No `float`, no `decimal`, anywhere in business
logic. The `Money` value object in `packages/contracts` is the only place that formats
currency — ESLint bans `new Intl.NumberFormat` elsewhere. Every API amount is an integer
plus a separate `currency: 'USD'`.

**One Zod schema, two consumers.** Schemas live in `packages/contracts`, feed
`fastify-type-provider-zod` on the backend and `zodResolver` on the frontend. Input and
output schemas are always separate and related by `.pick()` / `.omit()` / `.extend()` —
never two hand-maintained copies. All input schemas are `.strict()`.

**The client never sends a price.** Cart lines carry `variantId` and `qty` only. The server
recomputes everything from the database. A stale total is a 409, never a silent charge.

**Order status comes from the webhook, never the redirect.** The redirect to `/order/:number`
only displays a result. Stock is decremented inside the same transaction that moves the
order to `paid`, in the webhook handler.

**Webhooks are idempotent.** `event_id` goes into `webhook_events` with a UNIQUE constraint
before processing; a duplicate returns 200 immediately. Signature verification is mandatory.
The Stripe webhook route needs the raw body — `addContentTypeParser` is registered for that
route only.

**Passwords are Argon2id.** Never bcrypt.

**Sessions:** JWT access (15 min, in memory) + refresh (30 days, httpOnly Secure
SameSite=Lax cookie, rotated on use). Refresh tokens are stored hashed in MySQL and can be
revoked.

**SQL only through Drizzle.** No string concatenation. Migrations only via
`drizzle-kit generate`; each migration is committed with the code that needs it.

**No stubs.** Nothing marked `// TODO: implement later` ships as done. If a feature does not
fit the current phase, it is not created at all — it goes to `BACKLOG.md`.

---

## Phase discipline

Work proceeds strictly by the phases in `PLAN.md`. A phase is not left until its acceptance
criteria pass locally, and the result is reported and confirmed before the next one starts.

Open questions live in `QUESTIONS.md`. Items marked `[BLOCK]` block the phase they name.
The proposed shape of `packages/contracts` is in `CONTRACTS-DRAFT.md`.

---

## Decisions taken so far

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | Palette: Premium (`#0E6B4A` / `#D3A73B` / `#F3F0E8`). Storefront and v2 rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-2  | Shipping rates live in the database and are edited in the admin panel. Seed values from the mockup: Standard $7.99, free from $75; Express $12.99; Overnight $24.99.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-3  | Order number format `SG-YYYY-NNNNN` — per-year sequence, zero-padded to five digits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-4  | Tax is shown in the cart as "Estimated Tax" using the default rate; the authoritative figure comes from Stripe Tax once the address is known at checkout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-5  | Wholesale form uses the simplified mockup field set (single contact name, no business address). Columns stay nullable so it can be extended without a migration rewrite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-6  | Local services are portable binaries, not Docker. Dev and prod both on MySQL 8.0.x.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-7  | Nine palette values move on lightness only so every text pair clears WCAG AA. `gold #D3A73B` keeps its mockup value and is fill-and-decoration only: it never carries text on a light surface, and text on a gold fill is `greenDeep`. `CONTRAST_PAIRS` in `packages/ui/src/tokens.ts` is the contract and `tokens.test.ts` enforces it.                                                                                                                                                                                                                                                                                                                                                                              |
| D-8  | ~~Desktop-first at 1280; the responsive pass deferred.~~ **Superseded by D-19** - the responsive work happens inside Phase 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-11 | The responsive handoff arrived after D-8 was taken, and it is a complete specification. Its two breakpoints (1024 / 760), gutters and touch rules are now tokens and Tailwind variants, so Phase 5 markup can carry `tablet:` and `mobile:` classes as it is written rather than being retrofitted. Whether that ships with Phase 5 or after it is the owner's call.                                                                                                                                                                                                                                                                                                                                                  |
| D-9  | No logo asset yet. The wordmark is the mockup's own lockup: `grains` icon in a green tile plus `silk` (green) and `grain` (gold) in Cormorant 600. Favicon, OG image and email header wait for a real SVG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-10 | Icons come from an explicit registry (`packages/ui/src/components/icon-registry.ts`). A namespace import of Phosphor measured 1.1 MB gzip; the registry brings it to 110 KB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-12 | `sale` and `organic` are never stored as badges. `sale` is exactly "the variant has a `compare_at_price_cents`", `organic` is exactly "the product carries the organic certification". Only `bestseller`, `new` and `premium` live in `product_badges`, set by an editor. Answers Q-16.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D-13 | Reviews exist as a moderated table seeded with real copy, but customers cannot submit one until the backlog item lands. The product aggregate is `rating_total` + `review_count`, never a stored average. Answers Q-6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-14 | Every physical quantity is a scaled integer, like money: `weight_value_milli` (value x 1000), `weight_grams` for range filters, nutrition in milligrams. `weight_label` is the designer's string and is what the customer sees. Answers Q-13.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-15 | The refresh token is 48 random bytes, not a JWT, stored as an HMAC-SHA256 digest keyed by `JWT_REFRESH_SECRET`. It rotates on every use, and replaying a rotated token revokes the whole session family. A self-validating JWT would still need the database lookup that makes revocation possible, so it buys nothing.                                                                                                                                                                                                                                                                                                                                                                                               |
| D-16 | Argon2id comes from `@node-rs/argon2`, not the `argon2` package: prebuilt NAPI binaries install on this Windows machine without build tools. Parameters are OWASP's - 19 MiB, t=2, p=1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D-17 | Migrations are forward-only. "Roll back" means `pnpm db:reset` in development and restoring the pre-deploy dump in production. Hand-written `down` migrations are the one piece of SQL nobody tests until the night it is needed. See Q-44.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-18 | There are no `carts` / `cart_items` tables. The cart lives in the client's store and `POST /api/cart/validate` is stateless - nothing in phases 3-6 would write those tables, and a table nothing writes to is a stub.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-19 | The responsive pass ships inline with Phase 5, not after it. `tablet:` and `mobile:` classes are written as each screen is built, and Phase 5 acceptance runs Lighthouse on mobile as well as desktop. **Supersedes D-8 and settles D-11.** Owner's call, 2026-07-29.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-20 | Per-SKU nutrition data is entered by the owner in the admin product form, not imported. The seed's category-level reference values stand in until then, and the Phase 7 product form grows a full Nutrition Facts section. Answers Q-43.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-21 | `GET /api/products` returns one facet per sidebar card - categories, weights, origins, certifications, price bounds - because none of them can be hard-coded on the client: the mockup's weight list is 1/2/5/10/25/50 lb, which is not this catalogue's set. Each facet is computed with its own filter removed, so ticking a value never collapses its own list. The category facet is top level only with children folded in, so the sidebar, the mega-menu and `GET /api/categories` cannot print two different numbers for one category. A value matching nothing stays at zero rather than disappearing, so the sidebar does not reflow as boxes are ticked. Within a facet, values are OR; across facets, AND. |
| D-22 | `shipping_rates.free_above_cents` is the authority on free shipping. The `commerce.free_shipping_threshold_cents` setting is announcement-bar copy only: the checkout charges from the rate row, so the rate row decides. Two copies of one number is one copy too many.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-23 | `POST /api/cart/validate` never fails over a promo code - an unusable one comes back in `promoRejected` and the cart still prices, because a code that expired overnight must not leave a customer unable to see their own items. `POST /api/cart/promo`, the Apply button, throws the matching `PROMO_*` error instead. Per-customer limits are checked whenever an identity is known, and enforced for certain inside the Phase 4 checkout transaction - the only place that reads and writes `promo_redemptions` together.                                                                                                                                                                                         |
| D-24 | The catalogue and cart tests build their own fixture (`apps/api/src/test/fixtures/catalog.ts`), not the seed. The seed's thirty-two products carry pseudo-random ratings and stock, so "the third result is Chungara" would be an assertion about a random number generator. The seed is still exercised, by a pass over every endpoint against the real development database, which has the nulls the fixture does not.                                                                                                                                                                                                                                                                                              |
| D-25 | Cart arithmetic is `taxable = subtotal - discount + shipping`, tax at the default rate on that base, total on top - the same expression the seeded orders use, because Texas taxes shipping. Phase 4's order writer uses it too, or a customer is charged something other than what the cart showed. Pagination is offset, not keyset: the mockup has numbered pages, and keyset cannot sort by the `MIN(price)` aggregate the cards show.                                                                                                                                                                                                                                                                            |
| D-26 | PayPal moves to `BACKLOG.md`; Stripe is the only payment provider in Phase 4. Owner's call, 2026-07-30. Its Payment Element already covers cards, Apple Pay and Google Pay, and PayPal would add a second webhook contour, a second signature scheme and a second place to reconcile a captured amount against an order. The `provider` columns and the `PaymentHandoff` union are already shaped for it, so adding it later reshapes nothing.                                                                                                                                                                                                                                                                        |
| D-27 | An unverifiable payment adapter is not written. The Stripe secret key is still the `.env.example` placeholder, so `POST /api/checkout/intent` and Stripe Tax are not started rather than written blind - a `stripe.paymentIntents.create` nobody has ever run is a stub by the repository's own rule, and a passing test around a fake would only make it look otherwise. Everything reachable without an account _is_ built: signature verification is local HMAC, so the whole webhook contour, the paid transaction and order lookup are done and tested.                                                                                                                                                          |
| D-28 | The admin panel cannot mark an order `refunded`. The transition map allows it and the service refuses it: a refund is money leaving the account, and the only thing that can make that true is the provider. It is recorded by the `charge.refunded` webhook, which is built and tested. A button that wrote the status locally would tell a customer they had been paid back when nothing had left the account - the same class of lie as a client-supplied price. Cancellation is the admin's terminal action, and it returns committed stock with reason `cancellation`.                                                                                                                                           |

| D-29 | Blocking a customer revokes every refresh family it holds, and `POST /api/auth/refresh` re-reads `status` before it rotates. Neither existed before task 7.7, because nothing could write that column: the admin contour already re-read its own account on refresh ("a demotion has to take effect at the next refresh") and the customer contour never had to. Without both, a suspended account would keep minting fifteen-minute access tokens for the thirty-day life of its family, and the Block button would be a claim the system does not honour. Registering also refuses a blocked guest row, or the block would be undone by the person it was aimed at. |
| D-30 | The permission matrix is one named table, `ADMIN_PERMISSIONS` in `packages/contracts/src/rbac.ts`, read by the Fastify guards and by the panel. Plain TypeScript, not Zod: it never crosses the wire, because the client derives its permissions from the role its profile already carries. The alternative was a role list at every route plus a hand-written mirror in React — `role === 'owner' || role === 'manager'` in a dozen components — which is the "two hand-maintained copies" the working agreement bans for schemas, and the panel must never draw a control the API will refuse. It is deliberately not a capability layer: no per-user grants, no permissions column, no runtime resolution. Three roles in one shop do not justify the ceremony. |
| D-31 | `GET /api/admin/settings` is owner and manager, not any admin — a reversal of what task 7.7 built. `loadSettings` is an unfiltered `SELECT *` over a table whose own schema comment says a non-public row is where an API key would live, and the seed already carries `ops.notification_email`. Support keeps the half it is actually asked about through a new `GET /api/admin/shipping-rates`, which answers "why was I charged postage" and contains nothing the storefront does not already print. `POST /api/admin/pricing/preview` moves to owner and manager for the mirror-image reason: a preview is not a report, it is step one of a two-step write, and leaving it open would put a screen in reach whose only button is refused. |

---

## Commands

```bash
pnpm install            # install workspace
pnpm setup:services     # provision and start MySQL, Redis, Mailpit, MinIO
pnpm dev                # run every app in watch mode
pnpm typecheck          # tsc --noEmit everywhere, zero errors required
pnpm lint               # eslint, zero warnings required
pnpm test               # vitest
pnpm build              # build everything
pnpm verify             # format:check + lint + typecheck + test + build
```

Database, run from `apps/api`:

```bash
pnpm db:generate        # drizzle-kit generate - the only way a migration is ever written
pnpm db:migrate         # apply everything the journal has not recorded yet
pnpm db:reset           # drop every table and re-apply. Refuses any database but silkgrain*
pnpm db:seed            # catalogue, content and demo commerce. Refuses a non-empty database
pnpm db:studio          # drizzle-kit studio
```

`pnpm verify` is the gate for Phase 8 and must exit 0.

The API tests are integration tests against `silkgrain_test` on the same MySQL 8 instance, not
against a mock. Every rule worth testing — the CHECK that stock cannot go negative, the unique
index that makes webhooks idempotent, `STRICT_TRANS_TABLES` refusing a truncated value — exists
only in MySQL, so `pnpm test` needs `pnpm setup:services` to have run.

---

## Conventions

- Conventional Commits, enforced by commitlint. Allowed scopes: `api`, `web`, `admin`, `ui`,
  `contracts`, `config`, `db`, `docs`, `ci`, `deps`, `repo`.
- TypeScript `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  `any` and `@ts-ignore` are lint errors; `@ts-expect-error` requires a description.
- Type-aware ESLint applies to `.ts`/`.tsx` only. Config files are plain JS and outside every
  tsconfig program.
- Every package typechecks with `tsc --noEmit`; emit is done by tsup (packages, api) or Vite
  (web, admin).
- Imports are extensionless — everything is bundled, and `moduleResolution: "Bundler"`
  resolves them.
- Never commit: `.env`, database dumps, `node_modules`, `uploads/`, `.services/`.
