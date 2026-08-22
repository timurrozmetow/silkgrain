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

| D-38 | `.gitignore`'s `*.sql` - written for database dumps - was hiding all four Drizzle migrations while their journal and snapshots stayed tracked, so a fresh clone held a manifest pointing at files that did not exist and could neither migrate nor run the API tests. `!apps/api/drizzle/*.sql` negates it. The working agreement already said every migration is committed with the code that needs it; for four migrations it was not, and nothing noticed because the one machine that mattered had them on disk. Found by task 8.7's security pass. |
| D-39 | `trustProxy` is a hop count, never `true`. `true` compiles to trust-everything, which makes `request.ip` the leftmost `X-Forwarded-For` entry - a value the client writes - and every rate limiter keys on exactly that. A rotating header would have handed out a fresh bucket per request and defeated all of them at once, including the ten-per-fifteen-minutes on sign-in that is the back office's only online-guessing defence, since nothing records failed attempts per account. `ip` is also clamped to its `varchar(45)` before insert, because behind a proxy its length is the client's to choose and STRICT_TRANS_TABLES makes an over-long value a 500 rather than a truncation. |
| D-40 | `/ready` reports whether each dependency answered and how long it took, and nothing else. It is the one route that bypasses the scrubbing the error handler does for every 5xx - it catches its own failures and reports them as data - and it is unauthenticated and unthrottled on purpose, so a driver message here is readable by anyone who can reach the port during exactly the incident when it is most useful. The cause goes to the log. Both probes also race a two-second timeout: `maxRetriesPerRequest: null` with ioredis's offline queue is right for BullMQ and wrong for a probe, which would queue rather than reject and leave the route hanging instead of answering `degraded`. |
| D-41 | Every bound that exists to stop a request asking for too much is written once. `perPage` was capped from the start and `page` was not, in six schemas independently, so an OFFSET past what MySQL parses turned a public catalogue request into a 500; `PageNumber` in `packages/contracts/src/pagination.ts` is now the single field. The same reasoning gives `sharp` a `limitInputPixels`: both upload gates measured compressed bytes, and compression is what the dangerous input exploits - a 7000x7000 PNG is 672 KB on the wire and hundreds of megabytes decoded, in the process that also serves the storefront. |
| D-42 | Every page in this app renders an empty state when its data does not arrive, and an empty state is the fastest page in the shop - so a broken page scores BETTER than the page it replaces, and the harness has no way to tell. `scripts/lighthouse.mjs` therefore preflights each URL's backing API resource and refuses to measure rather than reporting a number that points the wrong way. It exists because the warning comment was already there and was ignored anyway: the script measured `/product/devzira-rice` while the seed's slug is `uzbek-devzira-rice`, so every product figure it ever printed - including the ones in STATE.md that Q-46 rested on - was the score of "We do not stock that", at 99 desktop and 87 mobile. The real page measured 74 and 56. |
| D-43 | A placeholder is a promise about height. Three separate defects in this codebase were the same one - the `/help` FAQ skeleton reserved 368px for a 744px list, the recipes featured panel reserved nothing once it stacked, and the product skeleton drew only the gallery and summary while the real page carries provenance, nutrition, reviews and a related rail. Each cost 10 to 18 points of mobile Performance through CLS alone, and the product one was 18.3 points on the page that sells things. A placeholder for only the part above the fold is a promise that the rest of the page does not exist. |
| D-44 | The Lighthouse gate blocks the seed's image hosts, and that is not softening the measurement - it is the only way to have one. Measured across two full matrices on one build, all fourteen cells for pages whose requests stay on localhost were identical to the point; only pages fetching the public internet moved, by at most 3. So the variance the script's own header cited as the reason a gate was impossible belongs to two remote hosts, not to Lighthouse. Thresholds live in `lighthouse-budget.json` as a committed ratchet with a tolerance of 2, regenerated by `--update` and committed with the change that earned them; the gate also prints the distance still to go against PLAN.md's >= 90, so the bar cannot quietly be redefined as whatever was measured. |
| D-45 | Nothing in `apps/api/src/server.ts` may `await` at module scope. PM2's cluster container loads the entry with `require()`, and `require()` of an ES module is fine on Node 22.12 and later unless the graph contains a top-level await - which makes it `ERR_REQUIRE_ASYNC_MODULE`. This file had two, so the first `pm2 start` would have failed with an error that reads like a PM2 bug. Measured, not reasoned: `require()` of the built bundle threw that code and the same module with the awaits inside a function loads. A future import that awaits at module scope reintroduces the failure from a file that looks unrelated. |
| D-46 | `loadDotEnv` walks up looking for `.env` rather than counting `../`. Four levels from `apps/api/src/config/` is the repository root in development; the built entry is `apps/api/dist/server.js`, one directory shallower, so the same four levels landed one directory ABOVE the deployment root - and Node resolves the symlink on the main module, so `current/` never appeared in the path either. The API would have refused to boot on the very first deploy with `loadEnv` naming a missing `DATABASE_URL` rather than a missing file. Walking up is immune to how deep the caller happens to be, which is the property that was wanted all along. |
| D-47 | `pnpm --filter @silkgrain/api db:bootstrap` exists because a freshly migrated production database is missing three things no screen in the back office can create: the first administrator (every route that could create one is behind `team:manage`), `shipping_rates` (the surface is GET and PUT only, because `SHIPPING_METHOD` is closed and `orders.shipping_method` stores a snapshot) and `settings` (`saveSettings` throws `notFound` and then UPDATEs; it never inserts). Only `db:seed` otherwise writes them, and it refuses production for good reason. The first draft of DEPLOY.md documented nine hand-written commands and two blocks of raw SQL instead - a runbook that tells somebody to compose SQL at 2am is a stub with a document's manners. It is idempotent, it refuses to create a second administrator (authority is granted on the Team screen, which writes an audit entry naming who granted it), and it takes no password on the command line because `ps` shows argv to every user on the box. |
| D-48 | The domain is **silkgrain.com**, answering Q-11. Owner's call, 2026-08-21. Everything the placeholder `silkgrain.example` stood in for is now the real name - 64 occurrences across fourteen files, including `server_name`, `CORS_ORIGINS`, the CSP's `media.silkgrain.com`, `robots.txt`'s sitemap line, the seed's contact rows and the `db:bootstrap` defaults - so a grep for the placeholder finds nothing and there is one name to change if it ever changes again. |
| D-49 | The refresh cookie carries **no `Domain` attribute** in production. An empty `COOKIE_DOMAIN` means host-only, and that is the correct value here, not a placeholder: naming the apex widens the cookie in both directions - `silkgrain.com` would send the session to every subdomain, and every subdomain could SET a cookie the apex reads, which `Secure` does not prevent because a sibling over HTTPS can do it too. `media.silkgrain.com` is a real host under the apex the moment images are self-hosted, and `Path=/api/auth` means the cookie it could toss is the session one. The back office is `/admin` on the same origin, so widening buys nothing; the apex goes in here only on the day the panel moves to its own subdomain. `.env.production.example` used to say "set the real host, and no wider", which was self-contradictory once the real host was the apex. A test asserts `Set-Cookie` contains no `Domain=`. |
| D-29 | Blocking a customer revokes every refresh family it holds, and `POST /api/auth/refresh` re-reads `status` before it rotates. Neither existed before task 7.7, because nothing could write that column: the admin contour already re-read its own account on refresh ("a demotion has to take effect at the next refresh") and the customer contour never had to. Without both, a suspended account would keep minting fifteen-minute access tokens for the thirty-day life of its family, and the Block button would be a claim the system does not honour. Registering also refuses a blocked guest row, or the block would be undone by the person it was aimed at. |
| D-30 | The permission matrix is one named table, `ADMIN_PERMISSIONS` in `packages/contracts/src/rbac.ts`, read by the Fastify guards and by the panel. Plain TypeScript, not Zod: it never crosses the wire, because the client derives its permissions from the role its profile already carries. The alternative was a role list at every route plus a hand-written mirror in React — `role === 'owner' || role === 'manager'` in a dozen components — which is the "two hand-maintained copies" the working agreement bans for schemas, and the panel must never draw a control the API will refuse. It is deliberately not a capability layer: no per-user grants, no permissions column, no runtime resolution. Three roles in one shop do not justify the ceremony. |
| D-31 | `GET /api/admin/settings` is owner and manager, not any admin — a reversal of what task 7.7 built. `loadSettings` is an unfiltered `SELECT *` over a table whose own schema comment says a non-public row is where an API key would live, and the seed already carries `ops.notification_email`. Support keeps the half it is actually asked about through a new `GET /api/admin/shipping-rates`, which answers "why was I charged postage" and contains nothing the storefront does not already print. `POST /api/admin/pricing/preview` moves to owner and manager for the mirror-image reason: a preview is not a report, it is step one of a two-step write, and leaving it open would put a screen in reach whose only button is refused. |
| D-32 | The stale-privilege window is fifteen minutes everywhere except `team:manage`, where it is zero. `requirePermission` reads the role from the JWT and touches no database, which is the bargain a short-lived stateless token exists to make: a demotion takes effect when the token next refreshes, and `/auth/admin/refresh` re-reads the row to make sure it does. That bargain fails for exactly one permission — inside the window, a demoted owner could create a second owner account and undo the demotion permanently — so the four `/team` routes use `requireFreshPermission`, which re-reads `admin_users` on every request. Reducing somebody's authority also revokes their refresh families; promoting them does not, because their next refresh re-reads the row anyway. |
| D-33 | Administrators are created, edited and deactivated in the panel, never deleted. There is no DELETE route at any role: deleting an account nulls its `audit_log.admin_user_id`, orphans the wholesale notes it wrote and empties the enquiries it was assigned. `is_active = false` is the terminal action, and the refresh path already honours it. An owner may not change their own role or deactivate themselves, and no change may leave zero active owners — all three are 409, because the request is well-formed and authorised and what is refused is the state it would produce. |
| D-34 | The audit entry is written inside the caller's transaction, by `recordAudit(tx, ...)`. A Fastify hook cannot see the before-image, and that image is the whole point of `before`/`after`; a write after the commit can succeed while the audit fails, leaving a destructive change with no record. So a failed audit write fails the whole action - no try/catch, no best effort - which is only safe because the realistic failure is removed by construction: under `STRICT_TRANS_TABLES` an over-long varchar is an error rather than a truncation, so every string is clamped to its column before it is offered. The precedent for staying _outside_ a transaction is `enqueueEmail`, and it earns that by talking to an independently-failing remote system; a row in the same MySQL on the same connection is not one. |
| D-35 | Every projector in `audit.projectors.ts` is a literal object naming its columns one at a time, never a spread. That is the file's whole security model: a `{...row}` would archive every column a table ever grows, including the next credential somebody adds, and the `audit_log` comment has promised since Phase 2 that a password hash cannot end up there by accident. An allow-list keeps that promise by construction; a deny-list keeps it only until somebody forgets to extend it. `actor_role` and `entity_label` are copied onto the entry for the same reason `actor_name` already was - an entry that needs a join to be legible fails exactly when the joined row is gone. |
| D-36 | One action string per audited write route, and one entry per action the operator performed. A bulk price change over five hundred variants is one entry keyed by SKU, not five hundred rows that would bury every other change; a settings save is one entry for the card that was saved. `POST /wholesale/requests/:id/notes` writes no entry at all: `wholesale_request_notes` is already append-only and carries its author and time, so it _is_ the audit record and logging it would copy the thread into a second place that can disagree. The auth contour is likewise unlogged - `refresh_tokens` already stores every admin session with its ip, user agent and revocation reason. |
| D-37 | The audit list is keyset on `id DESC` with a `before` cursor, and carries no `total` — a departure from D-25, which chose offset because the catalogue's mockup showed numbered pages and because keyset cannot sort by the `MIN(price)` aggregate the cards need. Neither reason survives here: nobody asks for page nine of an audit log, the sort _is_ the primary key, and the table only grows, so an offset scan gets slower every week while a seek does not. Counting the whole table to print a number nobody acts on would be the most expensive query on the screen. The list carries the names of the fields that moved and not their values; the values arrive from `GET /admin/audit/:id` when a row is expanded, which is what keeps a bulk price change over hundreds of SKUs out of every page it appears on. |

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
