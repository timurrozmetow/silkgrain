# Where the project stands

Updated 2026-07-29. Read this first after any context loss, then `CLAUDE.md` for the rules.

---

## Position

**Branch:** `phase/2-backend-core`. `main` has no commits yet — branches merge there once the
owner accepts the work.

| Commit    | What                                                             |
| --------- | ---------------------------------------------------------------- |
| `7b74172` | Phase 0 — monorepo, tooling, local services                      |
| `ef0acbe` | The responsive design handoff, committed unmodified              |
| `bfae409` | Phase 1 — design system                                          |
| `187c166` | Responsive breakpoints wired into tokens and the Tailwind preset |
| `f1db2b8` | The design handoff distilled into docs                           |
| _HEAD_    | Phase 2 — backend core                                           |

**Phases 0, 1 and 2 are complete and verified.** `pnpm verify` exits 0: 142 tests
(43 contracts + 41 api + 58 ui), zero lint warnings, zero type errors. Storefront bundle
110 KB gzip against a 250 KB budget.

**Next: Phase 3 — catalogue and cart API.** See `PLAN.md`.

---

## Blocked on the owner

1. **Phase 2 acceptance.** Reported; the process in `CLAUDE-CODE-PROMPT.md` says a phase is not
   left until the owner confirms.
2. **QUESTIONS.md Q-33 — when the responsive pass happens.** Writing `tablet:` and `mobile:`
   classes while Phase 5 markup is authored costs 8–12 h; retrofitting them across sixteen
   finished screens costs 30–40 h. Recommended: inline.
3. **Q-43 — nutrition label data.** The Nutrition Facts panel is seeded with category-level
   reference values. Real per-SKU figures have to come from the supplier's certificate of
   analysis before the store takes a real order; that is an FDA requirement, not polish.
4. **Decisions taken during Phase 2 without waiting** — Q-6, Q-12, Q-13, Q-15, Q-16 are
   answered in place in `QUESTIONS.md` and recorded as D-12…D-18 in `CLAUDE.md`. They shaped
   the schema, so reversing one now costs a migration.

---

## What exists

```
apps/api        Fastify 4. Plugins, error handler, Drizzle schema (32 tables), migrations,
                seeds, auth, /health, /ready, Swagger on /docs. No business endpoints yet.
apps/web        Vite 5 + React 18. src/App.tsx is a design-system preview page, not the
                storefront; Phase 5 replaces it.
apps/admin      Vite 5 + React 18 shell.
packages/ui     The design system. 22 components, tokens, Tailwind preset, Storybook.
packages/contracts  primitives, errors, enums, Money, pagination, auth schemas. Catalog,
                    cart, checkout, order and wholesale schemas arrive with the phases that
                    serve them; the shape is drafted in CONTRACTS-DRAFT.md.
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
src/modules/health/           /health and /ready
src/test/harness.ts           integration harness against silkgrain_test
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

## Phase 3 plan, concretely

From `PLAN.md`, adjusted for what is now known.

1. `packages/contracts/src/modules/catalog.ts` — `ProductCard` as its own schema with
   `ProductDetail` extending it, so a grid of sixteen cards does not carry nutrition and story.
   `badges` in the output is the derived union: stored editorial badges plus `sale` from
   `compare_at_price_cents` and `organic` from the certification.
2. `GET /api/categories` — tree with counts computed from the database, not the mockup's
   hard-coded 24/18/12/9/7/5.
3. `GET /api/products` — filters (category, origin, certification, weight label, price range
   over variants, badges), sorts (featured, price asc/desc, newest, bestselling by
   `sold_count`), pagination, and the `priceFrom`/`priceTo` aggregate the card shows.
4. `GET /api/products/:slug` — variants, images, nutrition, certifications, published reviews
   with the five-star histogram, and "You May Also Like" from the same category.
5. `GET /api/search/suggest` — six results, name and category, plus popular terms.
6. `POST /api/cart/validate` — recompute everything from `product_variants`. The client sends
   `variantId` and `qty` only; there is no field to put a price in, and the schema is
   `.strict()`, so a forged price is a 422 before any handler runs.
7. Promo codes — percent (basis points), fixed, free shipping; `min_order_cents`,
   `max_discount_cents`, date window, global and per-customer limits against
   `promo_redemptions`.
8. Shipping rates from the database plus the "You're $X away from free shipping" progress.
9. Tests: filtering, sorting, pagination, cart recalculation, a forged price, promo edge cases
   (boundary subtotal, expired, exhausted, per-customer limit).

Acceptance: filtering and cart-recalculation tests green; a forged price returns 422.

---

## Decisions already taken

The table lives in `CLAUDE.md`, D-1 through D-18. In short: Premium palette; shipping rates in
the database; order numbers `SG-YYYY-NNNNN`; estimated tax in the cart with Stripe Tax
authoritative at checkout; the simplified wholesale form; portable local services on MySQL 8;
nine tokens darkened for contrast with gold kept as decoration only; desktop-first with the
responsive pass pending a scheduling call; no logo asset yet; icons from an explicit registry;
derived badges never stored; moderated reviews without customer input yet; scaled integers for
every physical quantity; opaque rotating refresh tokens; `@node-rs/argon2`; forward-only
migrations; no `carts` table.
