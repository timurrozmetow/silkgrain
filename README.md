# SilkGrain

E-commerce platform for importing and selling Central Asian food products — rice, lentils,
grains, dried fruit and spices — across the USA. Ships from Houston, Texas. Serves retail
customers and wholesale buyers from the same catalog.

> Design source of truth: `silkgrain-design-prompt/project/SilkGrain Premium.dc.html`.
> Read [CLAUDE.md](CLAUDE.md) before contributing — it records decisions already made and the
> local environment quirks.

---

## Repository layout

```
apps/
  web/        storefront   — React 18 + Vite 5 + TanStack Router/Query + Zustand
  admin/      admin panel  — same stack, separate build, served under /admin
  api/        backend      — Fastify 4 + Drizzle ORM + MySQL 8 + Redis + BullMQ + Zod
packages/
  ui/         design system: tokens, Tailwind preset, components
  contracts/  Zod schemas + types — one source of truth shared by api and web
  config/     eslint, tsconfig, prettier
docker/       docker-compose.dev.yml (reference topology, used by CI)
scripts/      dev-setup.ps1 — provisions the same services without Docker
silkgrain-design-prompt/   design handoff, read-only
```

Planning documents: [PLAN.md](PLAN.md) (phases and estimates), [QUESTIONS.md](QUESTIONS.md)
(open decisions), [CONTRACTS-DRAFT.md](CONTRACTS-DRAFT.md) (schema approach),
[BACKLOG.md](BACKLOG.md) (deliberately deferred).

---

## Getting started

Requires Node >= 20.11 (developed on 26.4) and pnpm 10.

```bash
pnpm install
cp .env.example .env      # adjust if your ports differ
pnpm setup:services       # MySQL, Redis, Mailpit, MinIO — no Docker needed
pnpm dev
```

|               | URL                   |
| ------------- | --------------------- |
| Storefront    | http://localhost:5173 |
| Admin         | http://localhost:5174 |
| API           | http://localhost:3001 |
| Mailpit inbox | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

### Local services

This machine has no Docker and no administrator rights, so `scripts/dev-setup.ps1` installs
portable binaries into `.services/` (gitignored). Nothing touches the registry, PATH or
Program Files; `-Action remove` deletes every trace.

```powershell
powershell -File scripts/dev-setup.ps1 -Action status
powershell -File scripts/dev-setup.ps1 -Action stop
powershell -File scripts/dev-setup.ps1 -Action start -Only mysql,redis
powershell -File scripts/dev-setup.ps1 -Action remove
```

MySQL runs on **3307**, not 3306 — XAMPP's MariaDB owns 3306 and is left untouched.
`docker/docker-compose.dev.yml` describes the identical topology for CI and for machines
that do have Docker.

---

## Commands

| Command          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm dev`       | every app in watch mode                                           |
| `pnpm build`     | build all packages and apps                                       |
| `pnpm typecheck` | `tsc --noEmit` across the workspace, zero errors required         |
| `pnpm lint`      | ESLint, zero warnings required                                    |
| `pnpm test`      | Vitest                                                            |
| `pnpm test:e2e`  | Playwright                                                        |
| `pnpm format`    | Prettier write                                                    |
| `pnpm verify`    | format check + lint + typecheck + test + build — the release gate |

---

## Ground rules

A few that are easy to violate by accident; the full list is in [CLAUDE.md](CLAUDE.md).

- **Money is integer cents.** No floats in business logic. Formatting happens only in
  `Money.format()` — ESLint blocks `new Intl.NumberFormat` elsewhere.
- **The client never sends a price.** The server recomputes every total from the database.
- **Order status comes from the payment webhook,** never from the redirect.
- **No stubs.** If it does not fit the current phase, it goes to `BACKLOG.md` rather than
  into the codebase as a placeholder.
- **The design bundle is read-only.** Never edit or reformat `silkgrain-design-prompt/`.
