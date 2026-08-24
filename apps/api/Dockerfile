# syntax=docker/dockerfile:1

# The API as a container image.
#
# ## Production does not use this
#
# SilkGrain deploys to a single Ubuntu VPS: PM2 in cluster mode, Nginx in front, the release
# switched by an atomic symlink. `DEPLOY.md` describes that and depends on nothing here. This
# file exists for two other reasons, and it is worth being clear about them because an image
# nobody runs rots quietly:
#
#   1. CI. A build that only ever happens on one Windows laptop and one Ubuntu box is a build
#      whose dependencies nobody has audited. Building here proves the workspace installs from
#      the committed lockfile alone, on Linux, from nothing.
#   2. A future container host. When the shop outgrows one VPS, this is the artefact, and the
#      awkward parts - a pnpm workspace, two native modules, a bundled entry point - are already
#      solved rather than solved under time pressure.
#
# There is deliberately no production compose file. Two descriptions of the production topology
# is one too many, and `DEPLOY.md` is the one that is true.
#
# Build from the REPOSITORY ROOT, not from this directory:
#
#     docker build -f apps/api/Dockerfile -t silkgrain-api .
#
# The build context has to be the root because `@silkgrain/api` depends on
# `@silkgrain/contracts` through a `workspace:*` link, and pnpm cannot resolve the lockfile
# without every workspace manifest. `COPY apps/api` alone produces an image that fails at
# `pnpm install` if you are lucky and at `import '@silkgrain/contracts'` if you are not.
#
# ## Why the Node and Alpine versions are both pinned
#
# Node 22 is the LTS line the VPS runs and `package.json` engines require >=20.11.0.
#
# The Alpine version is pinned for a reason that is easy to unpick by accident. `sharp` 0.35.3
# does not build from source here - it loads a prebuilt libvips from `@img/sharp-linuxmusl-x64`,
# and that package declares `config.musl: ">=1.2.5"`. Alpine 3.19 ships musl 1.2.4, so an image
# built `FROM node:22-alpine3.19` installs cleanly, passes every layer, and then throws
# "Could not load the sharp module" the first time an administrator uploads a product photo.
# Alpine 3.24 ships musl 1.2.6. If you move this tag, check that number first.
FROM node:22-alpine3.24 AS base

# Corepack reads `packageManager: pnpm@10.34.5` out of the root package.json and fetches exactly
# that version, so the container and the laptop run the same resolver. `npm i -g pnpm` would
# float, and a floating package manager against a frozen lockfile is a build that fails on a day
# nobody changed anything.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# The root `prepare` script is husky, which wants a `.git` that the build context does not carry.
# husky 9 already returns quietly rather than throwing, so this only silences a confusing line -
# but a confusing line in a CI log is how twenty minutes get spent on the wrong thing.
ENV HUSKY=0
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------------------------
# Dependencies. Manifests only, so this layer survives every change to application code.
# ---------------------------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
# Every workspace manifest, not only the API's. `--frozen-lockfile` validates the lockfile
# against all six importers before it installs anything, so a missing manifest is not a smaller
# install - it is ERR_PNPM_OUTDATED_LOCKFILE.
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/

# The whole workspace, including the two SPAs this image never serves. A filtered install would
# save a few minutes of a stage that is thrown away, in exchange for having to reason about which
# transitive devDependencies `--filter @silkgrain/api...` drags in. Only the runtime stage ships.
#
# `sharing=locked` because two CI builds writing one content-addressable store concurrently is a
# race, and the symptom is a corrupt package rather than an error.
RUN --mount=type=cache,id=silkgrain-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ---------------------------------------------------------------------------------------------
# Build. tsup bundles `@silkgrain/*` into dist/server.js (see apps/api/tsup.config.ts), so the
# runtime never needs the workspace symlink tree - only the third-party dependencies.
# ---------------------------------------------------------------------------------------------
FROM deps AS build

COPY . .

# `@silkgrain/api...` is "the API and its dependencies", and pnpm runs them in topological order:
# contracts emits its `dist` first, because tsup resolves `@silkgrain/contracts` through that
# package's `exports` map and would otherwise bundle a directory that does not exist yet.
RUN pnpm --filter "@silkgrain/api..." run build

# A self-contained node_modules holding the API's production dependencies and nothing else -
# no workspace symlinks pointing outside the tree, which is what makes the runtime stage a plain
# `COPY` rather than a second install.
#
# `--legacy` is not optional and not laziness. From pnpm 10, the default `deploy` refuses any
# workspace without `inject-workspace-packages=true`, and turning that on changes how every
# developer's local install links workspace packages - hard copies instead of symlinks, with a
# rebuild needed before a change in contracts is visible to the API. Changing the daily
# development loop to satisfy a CI-only Dockerfile is the wrong way round. If a future pnpm drops
# `--legacy`, the replacement is `pnpm install --prod --frozen-lockfile` into a pruned directory,
# not flipping that flag.
#
# The target must not already exist: deploy refuses a non-empty directory rather than merging.
RUN --mount=type=cache,id=silkgrain-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm --filter @silkgrain/api --prod --legacy --frozen-lockfile \
    --store-dir=/pnpm/store deploy /deploy

# ---------------------------------------------------------------------------------------------
# Runtime. No pnpm, no corepack, no toolchain, no source.
# ---------------------------------------------------------------------------------------------
FROM node:22-alpine3.24 AS runtime

# Not a default, a requirement. `loadEnv` (apps/api/src/env.ts) refuses the `.env.example` JWT
# placeholders and insists on COOKIE_SECURE under production, and `app.ts` only sets
# `trustProxy: 1` under production. An image that came up in development mode would accept a
# published placeholder secret and key its rate limiters on the proxy's own address.
ENV NODE_ENV=production

# 0.0.0.0 here, and this does NOT contradict the VPS topology.
#
# Under PM2 the API binds 127.0.0.1:3001 because the loopback interface *is* the boundary: Nginx
# and the API share a network stack, so anything else would publish the API to the internet. A
# container has its own network namespace, so binding to loopback would make the port unreachable
# from the proxy and the image would be inert. The boundary moves to the publish flag instead -
# run it as `-p 127.0.0.1:3001:3001`, never `-p 3001:3001`.
ENV API_HOST=0.0.0.0
ENV API_PORT=3001

# The same relative layout as the repository, on purpose. `loadDotEnv` resolves `.env` from
# `import.meta.url`, and the bundled entry point sits one directory deeper than the source file
# the path was written for, so in this image it looks for `/.env` and finds nothing. That is the
# intended outcome: configuration arrives as `--env-file` or `-e`. A secret copied into a layer
# is a secret in every registry that ever pulled the image, and it cannot be rotated by editing
# a file.
WORKDIR /app/apps/api

# Owned by root and only readable by the `node` user, so a compromised process cannot rewrite its
# own code. The `node` user (uid 1000) already exists in the official image; creating another one
# would only give it a different number.
COPY --from=build --chown=root:root /deploy/node_modules ./node_modules
COPY --from=build --chown=root:root /deploy/package.json ./package.json
# From the build stage rather than from /deploy, which also carries a copy: this names the
# artefact tsup actually produced instead of relying on which files pnpm's packing rules chose.
COPY --from=build --chown=root:root /app/apps/api/dist ./dist

# Two native modules ride in that node_modules, and both are prebuilt for linux-musl - verified
# against pnpm-lock.yaml, which carries `@img/sharp-linuxmusl-x64@0.35.3` and
# `@node-rs/argon2-linux-x64-musl@2.0.2`, each tagged `libc: [musl]` so pnpm selects it here and
# the glibc sibling on Ubuntu. Neither has an install or postinstall script, so decision D-16's
# claim - "prebuilt NAPI binaries install without build tools" - holds on musl as well as on
# Windows, and there is no `apk add build-base`, `python3`, `vips-dev` or `libc6-compat` below.
# The arm64 pair is in the lockfile too, so this builds on an Apple Silicon machine unchanged.
#
# One hardware caveat that is not a musl problem: sharp's Linux x64 prebuilt requires an
# x86-64-v2 CPU and throws at load on anything older than roughly 2009. Every current VPS clears
# that; a very old bare-metal host might not, and the error names the microarchitecture.
USER node

EXPOSE 3001

# `/health` and not `/ready`, deliberately. `/ready` probes MySQL and Redis, which is the right
# answer for a load balancer deciding where to send traffic and the wrong one for an orchestrator
# deciding whether to kill the process: a database outage would restart every replica in a loop
# and make the outage worse. That reasoning is already written at the top of
# apps/api/src/modules/health/health.routes.ts; this only has to agree with it.
#
# Exec form so no shell is involved - a shell-form probe would have to quote a URL, and the
# backtick that makes it readable is command substitution to /bin/sh.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Exec form again, so node is PID 1 and receives SIGTERM directly. That matters: server.ts
# installs a SIGTERM handler that drains the MySQL pool and quits Redis, with a 10 s hard timeout
# behind it, and a shell wrapper would swallow the signal and leave the container to be killed
# after the daemon's grace period instead. Node as PID 1 does not reap orphaned children - pass
# `--init` if you ever add something that forks; nothing in this process does today.
#
# Two things this image deliberately cannot do:
#
#   - Run migrations. `pnpm db:migrate` is `tsx src/db/migrate.ts`, and neither tsx nor src ships
#     here. A container host needs migrations as a separate step against the same database before
#     the new revision starts. On the VPS the deploy script runs it directly, which is why this
#     is a container-host problem and not a production one.
#   - Sit behind more than one proxy. `app.ts` sets `trustProxy: 1`, so Fastify takes the last
#     address in X-Forwarded-For and ignores whatever the client wrote to its left. One hop is
#     Nginx. An ingress controller plus a service mesh is two, and the hop count in app.ts must
#     change in the same commit that adds the second one, or every rate limiter starts keying on
#     an address the attacker chooses.
CMD ["node", "dist/server.js"]
