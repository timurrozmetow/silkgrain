# Observability

What this application tells you when something goes wrong in production, what it does not, and
exactly where an error-reporting SDK would attach on the day somebody creates a project for it
to report to.

Written for task 9.6. It is a specification and an inventory, not a plan to be executed later
in pieces — everything described under "What exists" is in the repository today and was read
out of it, and everything under "Sentry" is deliberately not.

---

## What exists

### The API logs, and the logs are the record

Pino, configured in `apps/api/src/app.ts`. In production the pretty-printing transport is not
registered, so every line is a JSON object on stdout, which PM2 captures to
`~/.pm2/logs/silkgrain-api-{out,error}.log`. There is no other sink, and PM2 rotates nothing on
its own — `pm2 install pm2-logrotate` is part of provisioning, not an optimisation.

Three properties of it are load-bearing and easy to break:

- **`genReqId` is a UUID**, not Fastify's per-process counter. With PM2 in cluster mode the
  counters in each worker collide, and a request id that is not unique is worse than no request
  id: two unrelated requests share a value and the search that was meant to isolate one incident
  returns both. The id is echoed on every error response as `error.requestId`, so a customer can
  quote it and it can be grepped.
- **`redact` covers the headers and bodies that carry credentials** — `authorization`, `cookie`,
  `set-cookie`, and `password` / `newPassword` / `currentPassword` in a body. These reach the
  logger through the standard request serialiser, so without the list they would be persisted in
  plain text on every 4xx from a sign-in route. Anything added to that surface later has to be
  added here too.
- **5xx logs at `error` with the thrown object, 4xx at `warn` with only the code and the
  status** (`apps/api/src/plugins/error-handler.ts`). That split is the whole triage model: a 4xx
  is the client's problem and must not page anyone, a 5xx is an incident. A rule that treated
  them alike would drown the second in the first, because a public catalogue answers a
  continuous trickle of 404s for URLs that never existed.

The response body never carries the internal cause. `classify()` puts it on `failure.internal`,
which is logged and dropped before the reply is built, so a driver message or a stack trace
cannot leave the machine through an API response.

### The two probes

`GET /health` and `GET /ready`, from `apps/api/src/modules/health/health.routes.ts`. Both are
unauthenticated, both have `rateLimit: false`, and both are proxied by Nginx and therefore
public. That is deliberate, and decision D-40 is what makes it safe: neither response contains
a driver message, only whether each dependency answered and how long it took.

`/health` is liveness. It touches nothing external and answers
`{"status":"ok","uptimeSeconds":N}`. A database outage must not make it fail, or an orchestrator
would kill a healthy process and start a restart loop that makes the outage worse.

`/ready` is readiness. It races a `SELECT 1` and a Redis `PING` against a two-second timeout and
answers 200 `ready` or 503 `degraded` with the per-check latency. The timeout exists because
ioredis is configured with `maxRetriesPerRequest: null` and its offline queue on — right for
BullMQ, which must not drop a job because Redis blinked, and wrong for a probe, which would
queue rather than reject and leave the route hanging instead of answering.

### The front ends catch, and then forget

`apps/web/src/routes/root.tsx` and `apps/admin/src/routes/root.tsx` register an `errorComponent`
on the root route. TanStack Router catches a throw from any route component or loader and renders
it: the storefront shows "Something went wrong" with a Try again button, the back office shows
its equivalent. The customer gets somewhere to go and the message stays generic, because an error
from the API layer may quote an internal detail.

Nothing is recorded. The exception is caught by the router, the component renders, and the only
evidence it ever happened is in the browser's own console, on a machine nobody can reach.

**This is the gap.** A React render crash on the product page — a null the types said could not
be null, a browser without some API — is invisible from the server. The API is healthy, the logs
are clean, the page is white, and the first anyone hears about it is a support email.

### What is deliberately not instrumented

No APM, no tracing, no metrics endpoint, no log shipper. One VPS, one API process family, and
PM2's own `pm2 monit` for CPU and memory. Adding a metrics stack to a shop this size buys
dashboards nobody watches; adding error reporting buys the one thing the list above is missing.

---

## Sentry

**It is not installed, and this section is why, plus everything needed to install it in an hour
on the day the decision changes.**

### Why not

Decision D-27 refused to write the Stripe payment adapter because no key existed to run it
against: an SDK call that has never been executed is a stub by this repository's own rule, and a
test around a fake would only make it look otherwise. The same reasoning applies here without
modification. Nobody has created a Sentry organisation, there is no DSN, and question Q-41 —
which lists "Sentry DSN" among the accounts somebody has to open — is unanswered.

Installing `@sentry/node` and `@sentry/react` now would produce three things and none of them
good: a `Sentry.init()` reading an empty string, which the SDK treats as "disabled" and which
therefore cannot be distinguished from a working install that has never seen an error; two more
packages in the storefront's first-load budget, which is measured and gated
(`scripts/bundle-budget.mjs`); and a line in `STATE.md` saying error reporting is done. The
third is the harmful one. An observability tool that reports nothing while appearing to report
something is worse than a known gap, because the gap is at least in somebody's head.

`SENTRY_DSN` and `VITE_SENTRY_DSN` do appear in `.env.example`, unset, from Phase 0. They are
read by nothing. `.env.production.example` lists them under "Deliberately absent" for that
reason.

### The variables, when there are values for them

Named now so that the names do not get invented twice.

| Variable                    | Where it is read                 | Secret?                              |
| --------------------------- | -------------------------------- | ------------------------------------ |
| `SENTRY_DSN`                | API, at boot, via `EnvSchema`    | No, but it is a write endpoint       |
| `SENTRY_ENVIRONMENT`        | API and both builds              | No                                   |
| `SENTRY_RELEASE`            | API and both builds              | No                                   |
| `SENTRY_TRACES_SAMPLE_RATE` | API                              | No                                   |
| `VITE_SENTRY_DSN`           | storefront, **at build time**    | No — and it ends up in the bundle    |
| `VITE_SENTRY_ADMIN_DSN`     | back office, **at build time**   | No — and it ends up in the bundle    |
| `SENTRY_AUTH_TOKEN`         | the build, to upload source maps | **Yes.** Never with a `VITE_` prefix |

Three DSNs and not one, because they are three projects: an API 500, a storefront crash and a
back-office crash have different audiences and different urgency, and a single project makes
that distinction a saved search that somebody has to remember to apply.

A DSN is not a credential in the sense a secret key is — it is embedded in every page — but it
is a write endpoint, and a leaked one buys an attacker the ability to fill the quota with noise.
Rate limits and inbound filters in the project settings are the answer, not secrecy.

`SENTRY_RELEASE` must be the same string in all three, or a front-end event and the API event it
caused land under different releases and stop lining up. The deploy already has a natural value:
the release directory name, `/srv/silkgrain/releases/<UTC timestamp>`, which is unique, ordered
and printable in a `git log` lookup. Use it, and export it before `pnpm build` so the bundles
carry it too.

Note `SENTRY_AUTH_TOKEN`'s row. It is a real credential, it belongs only in the build's
environment, and it must never acquire a `VITE_` prefix — Vite substitutes anything so named
into JavaScript that is served to the public.

### Where the hooks go

Six places. Each one is named with the reason it and not somewhere else.

**1. `apps/api/src/plugins/error-handler.ts`, inside the `failure.status >= 500` branch, beside
`request.log.error`.**

That branch already is the classification. Capturing there rather than in a global handler means
4xx never reaches Sentry — a catalogue serving 404s to a crawler would otherwise burn a month's
quota in a day — and it means the capture has the request in scope, so the event can carry:

- `requestId` as a **tag**, not as context. It is the join key between a Sentry event, a pino
  line and a customer's support email, and only a tag is searchable.
- `route` as `request.routeOptions.url`, the parameterised form, so `/product/:slug` groups
  instead of splitting into one issue per product.
- `subjectType` and `subjectId` from `requestContext`, never an email address.

**2. The same file, `beforeSend`.** Everything `app.ts` redacts for pino has to be redacted again
here, because Sentry serialises the request itself and does not know about pino's list:
`authorization` and `cookie` headers, `set-cookie`, and `password` / `newPassword` /
`currentPassword` in a body. Set `sendDefaultPii: false` as well.

The rule from decision D-35 applies to whatever context is attached: name the fields one at a
time, never spread an object. A spread archives every column a table ever grows, including the
next credential somebody adds, and a deny-list holds only until somebody forgets to extend it.

**3. `apps/api/src/plugins/mail.ts`, in the worker's `onError`.** A failed email job is already
the most invisible failure in the system: `enqueueEmail` swallows its own errors on purpose, so
that a receipt that could not be queued does not undo a payment that succeeded. That makes the
log line the only evidence a customer's confirmation never went out.

**4. `apps/api/src/server.ts`, around `app.listen` and in the shutdown path.** A process that
fails to boot logs and exits; without a capture here, a bad deploy that fails on the fifth of
five workers looks like silence. Note that `Sentry.init()` itself must run before `buildApp`, at
the top of `server.ts`, or the plugins it instruments are already registered.

**5. `apps/web/src/main.tsx` and `apps/admin/src/main.tsx`, before `createRoot`.** The init call
and nothing else. The `errorComponent` in each app's `routes/root.tsx` is where an explicit
`captureException` goes — TanStack Router catches the throw in a React error boundary, and an
error a boundary handles does not reach `window.onerror` in a production build, so the automatic
global handler sees nothing. That is the single most important sentence in this section: without
that explicit call, the front-end integration installs cleanly and reports nothing, because the
router is doing its job.

**6. `apps/web/src/lib/api.ts` and `apps/admin/src/lib/api.ts`, in `request()`.** Only for
`status === 0` (the network branch) and `status >= 500`. A 404 for a slug that does not exist is
not an error, and a 401 is a session expiring on schedule.

There is one thing to fix while doing this, and it is small: `ApiRequestError` carries `status`,
`code`, `message` and `details`, but not `requestId`, even though the API sends it in every error
body. Without it the front-end event and the API event for the same failure cannot be joined, and
joining them is most of the value of having both.

### Source maps

Both Vite configs set `sourcemap: true`, so `dist/assets/*.js.map` exists and Nginx serves it —
the storefront's entire source is readable by anyone who asks for it today. That is a decision
nobody has taken; it is a default nobody has looked at.

When Sentry lands, take it deliberately. Either upload the maps at build time with
`SENTRY_AUTH_TOKEN` and stop serving them (`location ~ \.map$ { return 404; }`), which gives
readable stack traces in Sentry and nothing to a stranger, or keep serving them and accept that
the code is public. What must not happen is uploading them _and_ serving them, which is the cost
of both and the benefit of one.

---

## Uptime checking

An external monitor, because a check that runs on the same VPS cannot report that the VPS is
down. Any of the usual services does this; nothing here depends on which.

**Poll `https://silkgrain.com/health` every 60 seconds.** Expect 200 and
`"status":"ok"`. This is the "is the process alive" signal, and it is the one to wake somebody
for. It touches nothing external, so it cannot go red because MySQL is busy.

**Poll `https://silkgrain.com/ready` every 5 minutes.** Expect 200 and `"status":"ready"`.
A 503 with `"status":"degraded"` means the process is alive and one of its dependencies is not;
the response says which, and by how much latency. Do not poll this at the liveness interval:
each request costs a round trip to MySQL and one to Redis, and a monitor checking from six
regions every ten seconds is 2,160 extra queries an hour against a shop that may be serving
nobody at 4am.

**Alert on two consecutive failures, not one.** One failed poll during a PM2 reload is the
reload working — the old worker stops accepting connections while the new one boots — and an
alert that fires on every deploy is an alert people learn to close without reading.

Three more things to watch that are not HTTP checks:

- **Certificate expiry.** Certbot renews on a timer, and the failure mode is silence until the
  day the site stops loading. Most monitors check the leaf's `notAfter`; 14 days is the useful
  threshold, because it is two renewal attempts away from the 30-day mark certbot starts at.
- **Stripe's own endpoint health**, in the dashboard under Developers > Webhooks. Stripe retries
  a failing endpoint for three days and emails about it. Since an order becomes `paid` only in
  the webhook and never on the redirect, a silently failing endpoint means customers who were
  charged and whose orders still read `pending` — and the API side of that is invisible, because
  a signature mismatch is a 400 that the error handler correctly logs at `warn`.
- **Disk.** Pino writes JSON to PM2's logs, `mysqldump` writes to
  `/srv/silkgrain/shared/backups` on a 14-day rotation, and five releases sit under
  `/srv/silkgrain/releases`. None of those is large; all of them grow, and the first symptom of
  a full disk is MySQL refusing to write.

---

## Summary of what is deliberately missing

| Gap                                      | Why                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Error aggregation (Sentry or equivalent) | No DSN, no account, no project. Decision D-27's rule, applied. Recorded in `BACKLOG.md`. |
| Front-end crash reporting                | Same. The router catches them and nothing records them.                                  |
| `requestId` on `ApiRequestError`         | Nothing consumes it yet; it becomes necessary the moment front-end reporting exists.     |
| APM, tracing, metrics                    | One VPS, one process family. Dashboards nobody watches are not observability.            |
| Log shipping and retention               | Two files on the box, rotated by `pm2-logrotate`. Revisit at the second host.            |
