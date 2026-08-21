/**
 * PM2 process definition for the API.
 *
 * The VPS runs exactly one long-lived Node process. Nginx serves both SPAs as static files off
 * disk, so nothing else needs supervising - which is why this file declares a single app rather
 * than a fleet. Without it the API is started by hand, dies with the SSH session that started it,
 * and "deploy" means killing a listener and hoping the next one binds before the first customer
 * notices. With it, `pm2 reload silkgrain-api` replaces the workers one at a time and `pm2 save`
 * plus `pm2 startup` brings them all back after a reboot.
 *
 * ## Why the extension is `.cjs`
 *
 * The root `package.json` declares `"type": "module"`, so a file named `ecosystem.config.js` would
 * be parsed as an ES module and `module.exports` would fail with "module is not defined" - PM2
 * would report a config it could not read, at the exact moment somebody is trying to deploy. PM2
 * loads its config with `require()`, so the file has to be CommonJS, and `.cjs` is the only way to
 * say that inside a `"type": "module"` package without adding a second package.json.
 *
 * It is plain JavaScript and outside every tsconfig program on purpose. `packages/config/eslint/
 * base.js` matches every `.cjs` file with the non-type-aware block - Node globals, no
 * `projectService` - so `module` resolves and ESLint does not go looking for a tsconfig that would
 * not include it. Do not add this file to a tsconfig `include`: that is what would break
 * `pnpm lint`.
 *
 * ## Facts about the deployment this file assumes
 *
 * `/srv/silkgrain/current` is a symlink to the live release under `/srv/silkgrain/releases/`. The
 * switch is atomic (`ln -sfn` + `mv -T`), so `cwd` below always resolves to something.
 *
 * Secrets are NOT here. They live in `/srv/silkgrain/shared/.env`, mode 0600, owned by `deploy`,
 * symlinked into each release - this file is committed to git and a variable added to it is a
 * variable in every clone. The only values set below are the three that decide *where* the process
 * listens, and they are set precisely because they must not depend on a file on the server.
 */

/**
 * Everything the process needs from the environment that is not a secret.
 *
 * `apps/api/src/config/dotenv.ts` calls dotenv with `override: false`, so anything PM2 exports here
 * wins over the shared `.env`. That is what makes `API_HOST` load-bearing rather than decorative:
 * `.env.example` ships `API_HOST=0.0.0.0`, a production `.env` copied from it would bind the API to
 * every interface, and the box's firewall is then the only thing between the internet and an
 * unproxied API - no `X-Forwarded-For` handling, no Nginx rate limits, no TLS. Pinning the loopback
 * address here means that mistake cannot be made in a file nobody reviews.
 *
 * One object shared by `env` and `env_production` deliberately. PM2 applies `env` on a plain
 * `pm2 start` and `env_production` only with `--env production`, and a deploy that forgets the flag
 * would otherwise start the API with `NODE_ENV` unset - which turns off `trustProxy` (so every rate
 * limiter keys on Nginx's own address and one abusive client rate-limits everybody), turns off the
 * secure-cookie check in `loadEnv`, and re-enables the `pino-pretty` transport. Two names, one
 * object, no way for them to drift.
 */
const runtimeEnv = {
  NODE_ENV: 'production',
  // 127.0.0.1 only. Nginx proxies to it; nothing else may reach it.
  API_HOST: '127.0.0.1',
  API_PORT: '3001',
};

module.exports = {
  apps: [
    {
      name: 'silkgrain-api',

      /**
       * `node dist/server.js` from `apps/api`, as tsup emits it (ESM, bundled, sourcemapped).
       *
       * `cwd` is the `current` symlink and not a release path: a release path baked in here would
       * be stale the moment the next deploy lands, and `pm2 reload` would faithfully restart the
       * old code.
       *
       * Beware when reading paths in this process: Node resolves the symlink on the main module
       * unless `--preserve-symlinks-main` is passed, so `import.meta.url` inside the running
       * server reports the real `releases/<timestamp>/...` path rather than `current/...`. See the
       * `.env` note at the bottom of this file - it is the one place that has bitten us.
       */
      cwd: '/srv/silkgrain/current/apps/api',
      script: 'dist/server.js',

      /**
       * Cluster mode across the cores.
       *
       * The API is I/O bound - MySQL, Redis, SMTP - so the win is not raw CPU, it is that one
       * worker blocked in `sharp` resizing an uploaded product image does not stall every other
       * request, and that `pm2 reload` has somewhere to send traffic while a worker is replaced.
       *
       * Two things scale with this number and both have a ceiling on the far side:
       *   - `DATABASE_POOL_SIZE` connections per worker. instances x pool must stay under MySQL's
       *     `max_connections` (default 151), or the box runs out of connections under load and
       *     every worker starts failing at once.
       *   - the BullMQ email worker in `plugins/mail.ts` runs in *every* instance at concurrency 5,
       *     so this is also instances x 5 simultaneous SMTP sends and instances extra Redis
       *     connections. Fine on a four-core box; check the provider's rate limit before growing.
       *
       * Rate limiting is unaffected: `securityPlugin` is given the Redis client in production, so
       * the counters are shared rather than per-instance.
       */
      exec_mode: 'cluster',
      instances: 'max',

      /**
       * PM2 must not kill the process before the process has finished killing itself.
       *
       * `apps/api/src/server.ts` handles SIGTERM by closing the server, draining the MySQL pool and
       * quitting Redis, with its own 10 s hard timeout behind it (`SHUTDOWN_TIMEOUT_MS`). A
       * `kill_timeout` under 10 s would mean PM2 sends SIGKILL first and that whole path never runs
       * - in-flight requests are cut, and the app's own timeout, the thing that guarantees the port
       * is released, never fires. 15 s leaves five seconds of headroom for the process to log the
       * timeout and exit on its own terms. Raise `SHUTDOWN_TIMEOUT_MS` and this must move with it.
       */
      kill_timeout: 15_000,

      /**
       * Deliberately false: the server does not signal readiness and this file will not pretend it
       * does. There is no `process.send('ready')` anywhere in `apps/api/src` - setting `wait_ready`
       * would make PM2 wait for a message that never arrives and then force the reload after
       * `listen_timeout` anyway, turning every deploy into a fixed stall.
       *
       * What this costs, honestly: PM2 treats a new worker as available as soon as it is forked,
       * which is a second or two before Fastify has registered its plugins and connected to MySQL
       * and Redis. With more than one instance the reload is rolling and the siblings keep serving,
       * so the exposure is latency rather than errors. On a single-core box, where `'max'` is one
       * worker, the gap is real. Closing it is three lines - `process.send?.('ready')` after
       * `app.listen()` resolves, then `wait_ready: true` and a `listen_timeout` here.
       */
      wait_ready: false,

      /**
       * A backstop against a leak, not a tuning knob.
       *
       * `sharp` decodes uploaded images off-heap and the pool holds prepared statements, so steady
       * state is well under this; a worker sitting at 512 MB is a worker that is not giving memory
       * back. Restarting it is better than the kernel's OOM killer choosing a victim, which on this
       * box could as easily be MySQL. If it trips regularly, that is a leak to find rather than a
       * number to raise - four workers at 512 MB is already 2 GB before MySQL and Redis get any.
       */
      max_memory_restart: '512M',

      /**
       * Restart policy.
       *
       * `min_uptime` is what separates "crashed once under load" from "cannot start at all": a
       * process that dies inside 30 s did not stay up, so it counts towards `max_restarts` rather
       * than resetting the counter. After 10 such failures PM2 stops trying and leaves the app
       * `errored`, which is the correct outcome - the usual cause is a bad `.env` or an unreachable
       * database, and a silent restart loop hides that behind a process list that looks busy.
       * `exp_backoff_restart_delay` stops the loop hammering MySQL while it is down.
       */
      autorestart: true,
      min_uptime: '30s',
      max_restarts: 10,
      exp_backoff_restart_delay: 200,

      /**
       * Never watch files in production. A watcher here would restart every worker the moment a
       * deploy started writing into the release directory, halfway through the copy.
       */
      watch: false,

      /**
       * Logs go to `shared/`, not into the release.
       *
       * Releases are pruned to the last five; log files inside one would be deleted with it, which
       * is to say the logs would disappear exactly when somebody went looking for what the previous
       * release did. `merge_logs` keeps all instances in one pair of files rather than one pair per
       * worker id - a request handled by worker 3 is not something anybody knows in advance.
       *
       * PM2 does not rotate these. `pm2 install pm2-logrotate` is part of the provisioning
       * checklist; without it the disk fills quietly and MySQL is what stops first.
       */
      out_file: '/srv/silkgrain/shared/logs/api-out.log',
      error_file: '/srv/silkgrain/shared/logs/api-error.log',
      merge_logs: true,

      /**
       * Timestamps on every line.
       *
       * Note the trade-off, because it is not free: in production Fastify's pino logger already
       * emits one JSON object per line with its own `time` field, and `time: true` prefixes each
       * line with a human-readable stamp, so the file is no longer parseable as NDJSON. That is the
       * right way round for a box where the logs are read with `pm2 logs` and `grep` at 3am. If
       * these are ever shipped to something that parses JSON, turn this off - the timestamp is
       * already in the payload.
       */
      time: true,

      /**
       * Stack traces that name TypeScript lines.
       *
       * tsup emits `dist/server.js.map`; without this a production stack trace points at a column
       * in a 9000-line bundle. Node's own flag rather than PM2's `source_map_support`, which
       * injects a CommonJS module into an ESM entry point.
       */
      node_args: ['--enable-source-maps'],
      source_map_support: false,

      env: runtimeEnv,
      env_production: runtimeEnv,
    },
  ],
};

/**
 * Known trap, recorded here because this is the file somebody opens when the API will not start.
 *
 * `loadDotEnv()` resolves the shared `.env` by walking up four directories from `import.meta.url`.
 * That is correct from the source tree (`apps/api/src/config/dotenv.ts` -> repository root) and
 * wrong from the build: `apps/api/dist/server.js` is one directory shallower, so the same
 * expression lands one level *above* the deployment root. Node then resolves the `current` symlink
 * on the main module, so what the running process actually reads is
 * `/srv/silkgrain/releases/.env` - not `/srv/silkgrain/current/.env`, which is where the topology
 * puts it.
 *
 * The symptom is unambiguous and immediate: `loadEnv()` throws on the first missing variable and
 * PM2 shows ten restarts and an `errored` app. It does not start half-configured.
 *
 * The fix belongs in `dotenv.ts` - path arithmetic that differs between `src` and `dist` will keep
 * doing this - not in an extra symlink here. Until it lands, no arrangement of this file makes the
 * process find its environment, because dotenv is reading a path PM2 has no say in.
 */
