# Where the project stands

Updated 2026-07-29. Read this first after any context loss, then `CLAUDE.md` for the rules.

---

## Position

**Branch:** `phase/0-foundation`. `main` has no commits yet — the branch is merged there once
the owner accepts the work.

| Commit    | What                                                             |
| --------- | ---------------------------------------------------------------- |
| `7b74172` | Phase 0 — monorepo, tooling, local services                      |
| `ef0acbe` | The responsive design handoff, committed unmodified              |
| `bfae409` | Phase 1 — design system                                          |
| `187c166` | Responsive breakpoints wired into tokens and the Tailwind preset |

**Phases 0 and 1 are complete and verified.** `pnpm verify` exits 0: 84 tests, zero lint
warnings, zero type errors. Storefront bundle 110 KB gzip against a 250 KB budget.

**Next: Phase 2 — backend core.** Fastify app, Drizzle schema, migrations, seeds, auth,
Swagger. See `PLAN.md`.

---

## Blocked on the owner

1. **Phase 1 acceptance.** The design system is done and reported; the process in
   `CLAUDE-CODE-PROMPT.md` says a phase is not left until the owner confirms.
2. **QUESTIONS.md Q-33 — when the responsive pass happens.** The specification now exists.
   Writing `tablet:` and `mobile:` classes while Phase 5 markup is authored costs 8–12 h;
   retrofitting them across sixteen finished screens costs 30–40 h. Recommended: do it inline.
3. **Everything in QUESTIONS.md still marked `[ФАЗА 2]`** — Q-6 reviews, Q-12 how many
   products to seed, Q-13 weight units, Q-15 origin, Q-16 badges versus certifications. These
   decide enum shapes, so answers are wanted before the schema is written rather than after.

---

## What exists

```
apps/api        Fastify 4, /health, env validated at boot. Nothing else yet.
apps/web        Vite 5 + React 18. src/App.tsx is a design-system preview page, not the
                storefront; Phase 5 replaces it.
apps/admin      Vite 5 + React 18 shell.
packages/ui     The design system. 22 components, tokens, Tailwind preset, Storybook.
packages/contracts  primitives.ts and errors.ts only. Money, catalog, cart, checkout,
                    order and wholesale schemas are Phase 2+ — the shape is drafted in
                    CONTRACTS-DRAFT.md and not yet approved.
packages/config eslint, prettier, tsconfig bases.
docs/design     SCREENS.md and catalog.json, both distilled from the mockup.
```

### Things worth knowing before touching them

- **One ESLint config, at the repo root.** ESLint 9 resolves a single flat config from the
  working directory, so per-package configs left lint-staged reporting every staged file as
  ignored. Packages have no `lint` script; `pnpm lint` runs once from the root.
- **Icons come from `packages/ui/src/components/icon-registry.ts`.** A namespace import of
  Phosphor measured 1.1 MB gzip. Adding an icon is one line there, and `IconName` is typed
  against the registry so a typo is a compile error.
- **`CONTRAST_PAIRS` in `packages/ui/src/tokens.ts` is a contract**, asserted by
  `tokens.test.ts`. A component cannot introduce a new foreground/background pair without
  declaring it. See decision D-7 for which tokens moved and why gold did not.
- **`PriceTag` formats currency with a local `Intl.NumberFormat`** and an ESLint suppression.
  Phase 2 introduces `Money.format()` in `packages/contracts`; that suppression comes out then.
- **`packages/ui/src/tokens.ts` has only two breakpoints**, 1024 and 760, because that is what
  the handoff specifies. They are Tailwind's `tablet:` and `mobile:` variants, and they replace
  Tailwind's own scale rather than extending it.

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

---

## Design source

`silkgrain-design-prompt/for adaptive/` supersedes `project/`. Its `README.md` is the
responsive specification and is authoritative for layout behaviour.

Rather than re-read the 227 KB prototype:

- `docs/design/SCREENS.md` — every screen's structure, the global chrome, and which parts have
  no design at all.
- `docs/design/catalog.json` — sixteen products, six categories and the demo cart, extracted
  verbatim. Regenerate with `node scripts/extract-design-data.mjs` after any new handoff; the
  diff shows exactly what the designer changed.

---

## Phase 2 plan, concretely

From `PLAN.md`, adjusted for what is now known.

1. Fastify plugins: helmet, cors whitelist, compress, sensible, rate-limit, request-context
   with `requestId`; pino; graceful shutdown.
2. Error handler emitting `{ error: { code, message, details? } }` from the existing
   `ErrorCode` enum and `ERROR_STATUS` map in `packages/contracts/src/errors.ts`.
3. `Money` in `packages/contracts` — the draft in `CONTRACTS-DRAFT.md` §2, including
   `allocate` for splitting a bundle discount across order lines without losing a cent.
4. Drizzle schema: the twenty tables from the brief plus `reviews`, `shipping_rates`,
   `audit_log`, `contact_messages`, `settings`, `faqs`, `tags`. Explicit
   `utf8mb4_unicode_ci`, `BIGINT` for money, a check that stock cannot go negative.
5. Migrations via `drizzle-kit generate`, applied and rolled back against MySQL 8.0.42
   on 3307.
6. Seeds from `docs/design/catalog.json`, extended to 30+ products. Shipping rates seeded from
   decision D-2: Standard $7.99 free from $75, Express $12.99, Overnight $24.99. Promo code
   `WELCOME10`.
7. Auth: Argon2id, JWT access 15 min plus rotating refresh 30 d stored hashed, separate
   customer and admin contexts, hard rate limit on `/auth/*`.
8. `/health` and `/ready`, Swagger UI on `/docs` generated from the Zod schemas.
9. Vitest against `silkgrain_test`, integration tests for the whole auth flow.

Acceptance: migrations apply and roll back, seeds populate, auth tests pass, `/docs` renders.

---

## Decisions already taken

The table lives in `CLAUDE.md`. In short: Premium palette; shipping rates in the database;
order numbers `SG-YYYY-NNNNN`; estimated tax shown in the cart with Stripe Tax authoritative
at checkout; the simplified wholesale form; portable local services on MySQL 8; nine tokens
darkened for contrast with gold kept as decoration only; desktop-first with the responsive
pass pending a scheduling call; no logo asset yet; icons from an explicit registry.
