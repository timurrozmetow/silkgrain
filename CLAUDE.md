# CLAUDE.md — working agreement for this repository

Read this before touching anything. It records decisions that are already made, so they
don't get re-litigated, and the local quirks that will bite you otherwise.

---

## What this is

SilkGrain — an e-commerce platform importing and selling Central Asian food products
(rice, lentils, grains, dried fruit, spices) in the USA. LLC in Houston, Texas.
Currency USD, interface English, two audiences: retail and wholesale.

---

## Source of truth for design

`silkgrain-design-prompt/project/SilkGrain Premium.dc.html` — the primary mockup.
All 16 screens live in that one file, switched by `sc-if` flags.

Hierarchy when files disagree:

```
SilkGrain Premium.dc.html  >  ProductCardPremium.dc.html  >  uploads/silkgrain-design-prompt.md
```

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

| #   | Decision                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Palette: Premium (`#0E6B4A` / `#D3A73B` / `#F3F0E8`). Storefront and v2 rejected.                                                                                        |
| D-2 | Shipping rates live in the database and are edited in the admin panel. Seed values from the mockup: Standard $7.99, free from $75; Express $12.99; Overnight $24.99.     |
| D-3 | Order number format `SG-YYYY-NNNNN` — per-year sequence, zero-padded to five digits.                                                                                     |
| D-4 | Tax is shown in the cart as "Estimated Tax" using the default rate; the authoritative figure comes from Stripe Tax once the address is known at checkout.                |
| D-5 | Wholesale form uses the simplified mockup field set (single contact name, no business address). Columns stay nullable so it can be extended without a migration rewrite. |
| D-6 | Local services are portable binaries, not Docker. Dev and prod both on MySQL 8.0.x.                                                                                      |

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

`pnpm verify` is the gate for Phase 8 and must exit 0.

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
