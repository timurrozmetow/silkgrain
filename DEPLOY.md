# DEPLOY.md — from a bare Ubuntu 24.04 VPS to a working SilkGrain

This document is written twice over: once for somebody who has never deployed this application,
and once for somebody doing it again at 3am with an outage running. The first reader wants to know
_why_ each step is there; the second wants the command and nothing else. Every section therefore
leads with the commands and puts the reasoning beside them, and [When it breaks](#5-when-it-breaks)
is a table you can read in thirty seconds.

Every command here is meant to be pasted as written. There is no "substitute your own value"
anywhere except three variables you set once at the start of [section 3](#3-the-first-deploy-as-deploy)
— your domain, your repository URL and an address for expiry warnings — and everything after that
reads them. Where a value genuinely has to be invented, such as a database password, the document
gives the command that _generates_ it rather than a placeholder to overwrite.

---

## Topology, which is not negotiable

```
one Ubuntu 24.04 VPS
  nginx 1.24            :80 and :443, TLS from Let's Encrypt
    /                 -> /srv/silkgrain/current/apps/web/dist    (static, SPA fallback)
    /admin/           -> /srv/silkgrain/current/apps/admin/dist  (static, SPA fallback)
    /api/ /health /ready -> 127.0.0.1:3001
  pm2                   silkgrain-api, cluster mode, one worker per core
  mysql 8.0             127.0.0.1:3306
  redis 7               127.0.0.1:6379

/srv/silkgrain
  releases/<UTC stamp>/     one unpacked, built commit each
  current -> releases/...   an atomically switched symlink
  shared/
    .env                    the only copy of every secret, 0600, owned by deploy
    backups/                mysqldump output, 14-day local rotation
    logs/                   PM2's stdout and stderr for the API
    repo.git                a bare mirror of the repository
```

No Docker in production. `apps/api/Dockerfile` exists for CI and for the day the shop outgrows one
box; it says so at the top, and nothing below depends on it.

One user, `deploy`, owns everything under `/srv/silkgrain` and runs every deploy, rollback and
backup for the life of the box. `deploy` has no sudo, deliberately: the CI deploy key logs in as
that user, and a key that can become root is a key that can do anything. Root appears in
[section 2](#2-one-time-provisioning-as-root) and in exactly two later steps — installing the Nginx
site and issuing the certificate — both of which are marked.

---

## 1. Before you start

### What you need in hand

| Thing                                                                                                                 | Why, and what fails without it                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A domain, with `A` (and `AAAA`, if the box has IPv6) records for the apex **and** `www`, already resolving to the box | Certbot proves control by answering on port 80 at both names. The committed Nginx site has a `www` → apex redirect block that will not load unless the certificate covers `www`.                                    |
| SSH access to the VPS as `root`, by key                                                                               | All of section 2.                                                                                                                                                                                                   |
| The repository URL, and the ability to add a read-only Deploy Key to it                                               | The box keeps a bare mirror and fetches from it on every deploy.                                                                                                                                                    |
| An SMTP account, with SPF and DKIM published for the sending domain                                                   | Order confirmations and shipping notices. Without SPF/DKIM they land in spam, the customer concludes the order failed, and the first you hear of it is a ticket about a double charge that never happened.          |
| An S3-compatible bucket for product images, and a **second, private** one for database dumps                          | `S3_BUCKET` is opened for anonymous reads by the API itself — product images are public by definition. A dump in that bucket is the whole shop on a guessable URL. `backup-db.sh` refuses when the two names match. |
| A Stripe account with live API keys                                                                                   | **Read the next subsection before you go any further.**                                                                                                                                                             |

Which SMTP provider and which object store is open question Q-41 in `QUESTIONS.md`; nothing in the
code cares, as long as one speaks SMTP and the other speaks S3.

### Deploying without a Stripe account

**You can, and it is a supported configuration rather than a workaround.** Set one line in
`shared/.env`:

```bash
PAYMENTS_ENABLED=false
```

and leave `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `VITE_STRIPE_PUBLISHABLE_KEY` exactly as
`.env.production.example` ships them. The migration runs, the API boots, and you get the whole shop
except a till: catalogue, search, cart, accounts, wholesale enquiries, recipes, the back office.
`POST /api/webhooks/stripe` is **not registered at all**, so it answers 404 like any unknown path.

That last part is the point, and it is decision **D-51**. What people do instead is put the
`replace_me` placeholders into a production `.env` and force it past the check. Do not. Webhook
verification is local HMAC against `STRIPE_WEBHOOK_SECRET`, `whsec_replace_me` is published in this
repository, and an API holding it accepts a forged `payment_intent.succeeded` from anyone who can
read GitHub — orders marked paid, stock decremented, receipts sent to customers who paid nothing.
Inventing a realistic-looking string instead buys nothing either: `POST /api/checkout/intent` is not
written (D-27), so no PaymentIntent exists for a genuine event to refer to.

When the keys arrive, flip `PAYMENTS_ENABLED=true`, fill in the three values, and redeploy.

### The one thing that will waste your evening

**With `PAYMENTS_ENABLED=true` and no real keys, the first deploy stops at the migration** — not at
the API boot, which is later. The exact chain:

- `deploy/deploy.sh` step 5 runs `pnpm db:migrate`, which is `tsx src/db/migrate.ts`.
- `apps/api/src/db/migrate.ts` calls `loadDotEnv()` and then `loadEnv()`.
- `apps/api/src/env.ts` refuses any value containing `replace_me` for `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` or `VITE_STRIPE_PUBLISHABLE_KEY` when `NODE_ENV=production`.
- `.env.production.example` ships all three as `sk_live_replace_me`, `whsec_replace_me` and
  `pk_live_replace_me`, because decision **D-27** says an unverifiable payment adapter is not
  written and nobody has ever run this application against a real Stripe account.

So the deploy stops with:

```
FAILED: the migration failed. Nothing was switched - the old release is still serving - ...
Invalid environment configuration:
  STRIPE_SECRET_KEY: Still the placeholder from .env.example
  STRIPE_WEBHOOK_SECRET: Still the placeholder from .env.example
  VITE_STRIPE_PUBLISHABLE_KEY: Still the placeholder from .env.example
```

Nothing is damaged — the pre-deploy dump has already been taken and `current` was never switched —
but the site does not come up. Either **set `PAYMENTS_ENABLED=false`** as the previous section
describes, or **get the three keys before you begin**. They are Dashboard → Developers → API keys
with test mode off for the secret and publishable pair, and Dashboard → Developers → Webhooks → add
an endpoint at `https://<your domain>/api/webhooks/stripe` for the signing secret. That last one is
not the value `stripe listen` prints in development; they are different secrets for different
endpoints, and a mismatch is a 400 on every event which Stripe retries for three days.

`loadEnv` only rejects the literal substring `replace_me`, so a made-up string would technically get
past it. Do not do that — turn payments off instead. A fictional key leaves the webhook route
mounted and verifying against a secret you invented, which is a lock with a key you have published
to yourself; `PAYMENTS_ENABLED=false` removes the door.

### What you are deploying

`STATE.md` is the honest inventory. In short: the storefront, the back office, the catalogue, the
cart, the order and webhook contour and the admin panel are complete and tested. The checkout page
and Stripe Tax are not, for the reason above. Deploying today gives you a browsable, indexable shop
with a working back office and no till.

### Sizing the box

Two numbers decide this, and both come out of `ecosystem.config.cjs`:

- `instances: 'max'` — one API worker per core.
- `max_memory_restart: '512M'` — four workers is 2 GB of ceiling before MySQL and Redis get any.

Steady state is far below that ceiling, but `pnpm build` on the box compiles two Vite bundles and
runs `tsc`, and that is the peak. **4 GB of RAM and 2–4 cores is comfortable; 2 GB needs swap.**
Changing `instances` is a commit, not a server edit — the file is committed and every release
carries it.

Disk: five releases with their `node_modules`, plus fourteen days of compressed dumps, plus PM2 and
Nginx logs. 40 GB is generous, 20 GB is enough, and `find /srv/silkgrain -maxdepth 2 -type d` plus
`df -h` is how you check.

---

## 2. One-time provisioning, as root

Everything in this section runs once, as `root`, over SSH. It is safe to re-run: every step is
either idempotent or says so.

### 2.1 Time, packages and the base system

```bash
timedatectl set-timezone UTC
```

UTC because release directory names are `date -u` timestamps, `backup-db.sh` stamps its dumps the
same way, and MySQL is configured to `+00:00` below. A box on local time makes "which dump came
before which release" a puzzle at exactly the wrong moment.

```bash
apt-get update
apt-get install -y \
  nginx \
  mysql-server \
  redis-server \
  git curl ca-certificates \
  ufw fail2ban python3-systemd \
  certbot \
  awscli \
  unattended-upgrades
```

Notes on that list, because two of them are not obvious:

- **No build toolchain.** The two native modules, `sharp` and `@node-rs/argon2`, ship prebuilt NAPI
  binaries for linux-x64-gnu and `pnpm-lock.yaml` names both (`@img/sharp-linux-x64@0.35.3`,
  `@node-rs/argon2-linux-x64-gnu@2.0.2`). There is no `build-essential`, no `python3-dev` and no
  `libvips-dev`, and adding them would only hide the day a prebuilt stops being selected.
- **`python3-systemd`** is for fail2ban, below.
- **`awscli`** is needed only by the off-site half of `backup-db.sh`. Both the v1 and v2 clients
  accept the `--endpoint-url` flag on `s3 cp` and `s3api head-object`, which is all the script uses.

```bash
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now unattended-upgrades
```

A box that takes card details and never patches OpenSSL is a worse risk than anything else in this
document. Security updates only, which is the default.

Swap, if the box has under 4 GB:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
printf 'vm.swappiness=10\n' > /etc/sysctl.d/60-silkgrain-swappiness.conf
sysctl --system
```

Swappiness at 10 rather than the default 60: this swap is a backstop for the build peak, not a place
to keep MySQL's buffer pool.

### 2.2 The deploy user

```bash
adduser --disabled-password --gecos "" deploy
```

No password, key-only, and **not** in `sudo`. Check that last part rather than assume it:

```bash
id -nG deploy      # expect: deploy
```

Now authorise your CI. Generate the keypair **on your own machine**, not on the box — the private
half goes into a GitHub secret and should never touch the server:

```bash
# on your workstation
ssh-keygen -t ed25519 -C "silkgrain-ci-deploy" -f ~/.ssh/silkgrain_deploy -N ""
cat ~/.ssh/silkgrain_deploy.pub
```

Then, back on the box as root, paste that public line:

```bash
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
install -o deploy -g deploy -m 0600 /dev/null /home/deploy/.ssh/authorized_keys
nano /home/deploy/.ssh/authorized_keys     # paste the ssh-ed25519 line
```

Harden SSH:

```bash
tee /etc/ssh/sshd_config.d/10-silkgrain.conf >/dev/null <<'CONF'
# Passwords off entirely: every account on this box authenticates by key.
PasswordAuthentication no
KbdInteractiveAuthentication no

# `prohibit-password` and not `no`. Root over a key is how this box is administered, and
# there is no second sudo account in this topology; forbidding root here without creating
# one first would lock the operator out of their own machine. The deploy user, which is the
# one an automated system logs in as, has no sudo at all - that is where the boundary is.
PermitRootLogin prohibit-password
CONF

sshd -t && systemctl restart ssh
```

If you move SSH off port 22, note that Ubuntu 24.04 activates sshd through a socket unit:
`Port` in `sshd_config` is ignored and you have to edit `ListenStream=` in
`systemctl edit ssh.socket`. That number then also goes in the `DEPLOY_SSH_PORT` repository
variable and in the `ufw` rule below.

### 2.3 Firewall — 22, 80, 443, and nothing else

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 3001/tcp
ufw --force enable
ufw status verbose
```

`ufw allow OpenSSH` before `enable`, always — the other order locks you out of a remote box and the
only way back is the provider's console.

The `deny 3001` line is redundant under `default deny incoming` and is written anyway, because it is
one of the three locks `.env.production.example` names on the same fact. The API binds
`127.0.0.1:3001` — pinned in `ecosystem.config.cjs` where a file on the server cannot get it wrong,
and again in `.env` — because `app.ts` sets `trustProxy: 1` in production. If port 3001 were
reachable from the internet, a client could connect straight to it, write its own
`X-Forwarded-For`, and be handed a fresh rate-limit bucket on every request. That defeats every
limiter at once, including the ten-attempts-per-fifteen-minutes on admin sign-in, which is the back
office's only defence against online password guessing.

### 2.4 fail2ban

```bash
tee /etc/fail2ban/jail.local >/dev/null <<'CONF'
[DEFAULT]
# Ubuntu 24.04 does not guarantee /var/log/auth.log - a minimal cloud image has no rsyslog,
# and fail2ban then refuses to start with "Have not found any log file for sshd jail". The
# journal is always there, which is why the backend is named rather than left at `auto`.
backend  = systemd
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
CONF

systemctl enable --now fail2ban
fail2ban-client status sshd
```

With passwords disabled, fail2ban is not what stops a break-in — it cuts the log noise and the
connection load from the constant background scan, and it makes a real, targeted attempt visible in
`fail2ban-client status sshd` instead of buried in the journal. That is worth five minutes.

### 2.5 MySQL 8

Ubuntu 24.04's `mysql-server` is MySQL 8.0.x, which is the line development runs
(`docker/docker-compose.dev.yml` pins 8.0.42), so there is no dialect drift.

`mysql_secure_installation` is deliberately not run: it is interactive, and on this package there is
nothing for it to do. Prove that rather than believe it:

```bash
mysql -e "SELECT user, host, plugin FROM mysql.user;"
mysql -e "SHOW DATABASES;"
```

Expect no anonymous (`''`) user, no `test` database, and `root@localhost` on `auth_socket` — which
is why `mysql` works as root here with no password.

Now the configuration, and this part is load-bearing:

```bash
tee /etc/mysql/mysql.conf.d/zz-silkgrain.cnf >/dev/null <<'CONF'
[mysqld]

# `zz-` so this file sorts after Ubuntu's own mysqld.cnf in the same directory: MySQL reads
# an include directory in alphabetical order and the last assignment to an option wins.

# CLAUDE.md keeps this exact string in three places that must stay identical -
# scripts/dev-setup.ps1, docker/docker-compose.dev.yml and the generated .services/my.ini -
# and this is the fourth. It is stock MySQL 8's own default, written out rather than
# inherited, because inheriting it is how this project once ended up with a development
# server more permissive than any production install.
#
# Two of the six are relied on by application code:
#   STRICT_TRANS_TABLES - an over-long varchar is an error, not a silent truncation. Decision
#     D-34 puts the audit write inside the caller's transaction and accepts that a failed
#     audit fails the whole action, which is only safe because that failure is removed by
#     construction: every string is clamped to its column before it is offered, and if MySQL
#     truncated instead of erroring the clamp would be untested and the log quietly lossy.
#   ONLY_FULL_GROUP_BY - the catalogue's facet queries are grouped, and a permissive server
#     accepts a query that a correct one rejects.
sql_mode = ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION

# No table in apps/api/drizzle/ names a collation of its own; they all inherit the database's,
# which inherits the server's. MySQL 8 defaults to utf8mb4_0900_ai_ci and this project sorts
# on utf8mb4_unicode_ci - the two order differently, and half a dozen tested catalogue queries
# sort by name.
character_set_server = utf8mb4
collation_server     = utf8mb4_unicode_ci

# Every datetime in this schema is UTC. The application never sends a zone.
default_time_zone = '+00:00'

# Loopback only. Nothing outside this box has any business speaking to it.
bind_address = 127.0.0.1
CONF

systemctl restart mysql
mysql -e "SELECT @@sql_mode, @@character_set_server, @@collation_server, @@time_zone\G"
```

Read that output. `sql_mode` must contain both `STRICT_TRANS_TABLES` and `ONLY_FULL_GROUP_BY`; the
collation must be `utf8mb4_unicode_ci`; the zone must be `+00:00`.

Generate the database password and create the schema. The password is written straight to a
root-only file and never echoed, never put in a command line, and never left in shell history:

```bash
install -d -m 0700 /root/silkgrain-bootstrap
( umask 077
  openssl rand -base64 36 | tr '+/' '-_' | tr -d '\n' \
    > /root/silkgrain-bootstrap/mysql-password )
```

`tr '+/' '-_'` matters. Base64's `+` and `/` are legal characters that must be percent-encoded
inside a `mysql://` URL, and `.env.production.example` warns that getting that wrong does not fail
loudly — the URL reparses into a different host and the API tries to connect somewhere that does not
exist. Translating to the URL-safe alphabet keeps all 288 bits and removes the encoding step
entirely. It also keeps `%` out of the password, which matters because `backup-db.sh` percent-decodes
what it finds in the URL.

```bash
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`silkgrain\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'silkgrain'@'127.0.0.1'
  IDENTIFIED BY '$(cat /root/silkgrain-bootstrap/mysql-password)';

-- Scoped to one schema, and not root. A SQL injection that got past Drizzle, or a leaked
-- .env, then reaches this database and not the server. ALL PRIVILEGES rather than a hand-
-- written list because the migrator needs CREATE, ALTER, DROP, INDEX and REFERENCES, and
-- discovering a missing grant halfway through a migration at 3am is not a saving.
-- It does not include GRANT OPTION, and it does not include CREATE DATABASE, which is why
-- the restore-to-a-scratch-database recipe in section 4 needs root.
GRANT ALL PRIVILEGES ON \`silkgrain\`.* TO 'silkgrain'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

mysql -e "SHOW GRANTS FOR 'silkgrain'@'127.0.0.1';"
```

The password reaches `mysql` through a heredoc on stdin, not through `argv`, so it never appears in
`ps auxww`. That is the same reasoning `backup-db.sh` gives for building a 0600 defaults file
instead of passing `-p`.

**Connection arithmetic.** `DATABASE_POOL_SIZE` is a pool _per worker_, and PM2 runs one worker per
core. Total connections are `pool × cores`, plus mysqldump during the nightly backup, plus a second
copy of the fleet for the seconds a zero-downtime reload overlaps. `.env.production.example` gives
the bound; this is it evaluated:

```bash
echo "cores: $(nproc)   pool ceiling: $(( (151 - 30) / ($(nproc) * 2) ))"
```

If that ceiling is 10 or more, leave `DATABASE_POOL_SIZE=10`. If it is less — sixteen cores gives 3
— write the smaller number into `.env` in section 3, or the API starts refusing connections under
exactly the load that caused it.

### 2.6 Redis

```bash
( umask 077
  openssl rand -base64 36 | tr '+/' '-_' | tr -d '\n' \
    > /root/silkgrain-bootstrap/redis-password )

tee -a /etc/redis/redis.conf >/dev/null <<CONF

# ---------------------------------------------------------------- SilkGrain
# Appended rather than edited in place: Redis applies directives in file order and the last
# assignment wins, so a block at the end overrides whatever the distribution shipped, and an
# upgrade that rewrites the packaged section leaves this intact.

bind 127.0.0.1 -::1
protected-mode yes

# LOAD-BEARING. BullMQ keeps job state in Redis, so ANY evicting policy silently discards
# queued order-confirmation and shipping emails under memory pressure: the customer is
# charged, the order is right, the receipt never arrives, and nothing in any log says so.
maxmemory-policy noeviction

# The same reasoning across a restart rather than across memory pressure.
appendonly yes

requirepass "$(cat /root/silkgrain-bootstrap/redis-password)"
CONF

systemctl restart redis-server
REDISCLI_AUTH="$(cat /root/silkgrain-bootstrap/redis-password)" \
  redis-cli CONFIG GET maxmemory-policy appendonly
```

`REDISCLI_AUTH` rather than `redis-cli -a`: the `-a` form puts the password in `argv` where every
user on the box can read it, and prints a warning saying so.

### 2.7 Node, corepack, pnpm and PM2 — as the deploy user

Everything here belongs to `deploy` and none of it needs root. Node comes from nvm, in the deploy
user's home, so upgrading the runtime never touches a system package.

Download the installer and read it before running it. Piping a URL straight into `bash` on the box
that holds the customer table is the one shortcut this document will not take:

```bash
sudo -u deploy -H bash -s <<'BOOTSTRAP'
set -euo pipefail
curl -fsSL -o "$HOME/nvm-install.sh" \
  https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh
BOOTSTRAP

less /home/deploy/nvm-install.sh
```

The tag is pinned. A git tag on that repository does not move, so this fetches the same bytes today
and next year; `install.sh` without a tag is whatever `master` happens to be the minute you run it.

```bash
sudo -u deploy -H bash -s <<'BOOTSTRAP'
set -euo pipefail
bash "$HOME/nvm-install.sh"
rm -f "$HOME/nvm-install.sh"

# THE TRAP THIS AVOIDS, and it is the single most common way a first deploy fails.
#
# nvm's installer appends its block to ~/.bashrc. Every command this deployment runs over
# SSH arrives through `bash -lc` - deploy.yml wraps them that way on purpose - which is a
# LOGIN shell but not an interactive one. Ubuntu's ~/.profile does source ~/.bashrc, and
# Ubuntu's ~/.bashrc returns at its first line when the shell is not interactive. So the
# block nvm wrote is never reached, `node` is not on PATH, and deploy.sh dies at its own
# precondition check naming a binary that is demonstrably installed.
#
# ~/.profile is read by a non-interactive login shell, so the same two lines go here too.
cat >> "$HOME/.profile" <<'PROFILE'

# nvm, for non-interactive login shells (`ssh host bash -lc ...`). The block nvm appended to
# ~/.bashrc is unreachable there: that file returns at its first line when $- has no `i`.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
PROFILE
BOOTSTRAP
```

Now the runtime and the tools:

```bash
sudo -u deploy -H bash -lc '
  set -euo pipefail
  nvm install 22
  nvm alias default 22
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  corepack enable
  corepack prepare pnpm@10.34.5 --activate
  npm install -g pm2
'
```

Node **22**, not 20. `package.json` sets `engines.node >= 20.11.0`, which is the floor rather than
the target; CI runs 22 and `deploy.sh` warns on anything else. `pnpm` comes from corepack at exactly
the version `packageManager` pins, because `deploy.sh` compares the two and refuses a mismatch — a
floating package manager against a frozen lockfile is a build that fails on a day nobody changed
anything.

**Prove the PATH problem is solved.** This is the check, and it is not optional:

```bash
sudo -u deploy -H bash -lc 'node -v; pnpm -v; pm2 -v'
# expect: v22.x.x / 10.34.5 / a pm2 version
```

Log rotation for PM2, which rotates nothing on its own:

```bash
sudo -u deploy -H bash -lc '
  set -euo pipefail
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 14
  pm2 set pm2-logrotate:compress true
  pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
'
```

`ecosystem.config.cjs` sends both streams to files under `shared/logs/`, and pino writes one JSON
object per request in production. Without rotation the disk fills quietly and MySQL is what stops
first.

### 2.8 The directory tree

```bash
install -d -o deploy -g deploy -m 0755 /srv/silkgrain
install -d -o deploy -g deploy -m 0755 /srv/silkgrain/releases
install -d -o deploy -g deploy -m 0755 /srv/silkgrain/shared
install -d -o deploy -g deploy -m 0750 /srv/silkgrain/shared/logs
install -d -o deploy -g deploy -m 0700 /srv/silkgrain/shared/backups

ls -la /srv/silkgrain /srv/silkgrain/shared
```

`repo.git` is deliberately absent: `git clone --mirror` creates it in section 3 and refuses a
directory that already exists.

The modes are not cosmetic. `0755` on the first three is what lets Nginx's workers, which run as
`www-data`, traverse down to the two `dist` directories — a missing execute bit produces a 403 on
every asset and nothing in the error log more helpful than "Permission denied". `0700` on `backups`
is because a dump is the whole shop including password hashes. `0750` on `logs` because pino writes
request paths and client addresses.

Release directories are created by `deploy.sh` under the deploy user's default umask of 022, so they
come out `0755` and inherit the same traversal. There is a check for this in section 3.5.

### 2.9 Make PM2 survive a reboot

Without this the site does not come back after the provider reboots the box, and there is no other
symptom until somebody notices.

Run this as `deploy`. It **prints** a command rather than doing anything:

```bash
sudo -u deploy -H bash -lc 'pm2 startup systemd -u deploy --hp /home/deploy'
```

It ends with one line beginning `sudo env PATH=...`. Copy that line verbatim and run it as root — it
writes a `pm2-deploy.service` unit whose `PATH` includes the nvm bin directory, which is why the
line has to be the one PM2 generated and not one written from memory.

```bash
systemctl is-enabled pm2-deploy      # expect: enabled
```

`pm2 startup` only arranges for the _saved_ process list to be resurrected. `pm2 save` is what
writes that list, and `deploy.sh` runs it at the end of every healthy deploy — only after the health
check passes, because saving a crash-looping process list is saving the outage. So the pair is not
complete until the first deploy succeeds, and section 3.8 verifies it with an actual reboot.

---

## 3. The first deploy, as deploy

### 3.0 The three values that are yours

Set these once in the shell you are about to work in. Everything below reads them, and
`silkgrain.com` stays written out everywhere else in this repository on purpose so that a single
substitution finishes the job.

```bash
DOMAIN=silkgrain.com                                   # your apex domain, no scheme, no www
REPO_URL=git@github.com:silkgrain/silkgrain.git            # `git remote get-url origin` locally
ADMIN_EMAIL=ops@silkgrain.com                          # where certificate expiry warnings go
```

If you have a real domain, replace the first line now — that is the documented substitution, and it
is the only one.

Confirm DNS actually resolves to this box before going near certbot:

```bash
dig +short "$DOMAIN" "www.$DOMAIN"
curl -s https://ifconfig.me; echo
```

Those must agree. Certbot's webroot challenge is Let's Encrypt fetching a file over port 80 at both
names; a stale record is a failed issuance and five failures in an hour is a rate limit.

### 3.1 Let the box fetch the repository

The mirror is fetched on every deploy, so it needs a credential that works unattended. A read-only
GitHub Deploy Key is the smallest thing that does.

```bash
sudo -u deploy -H bash -lc '
  set -euo pipefail
  install -d -m 0700 ~/.ssh
  ssh-keygen -t ed25519 -N "" -C "silkgrain-vps-readonly" -f ~/.ssh/github_silkgrain
  ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
  chmod 600 ~/.ssh/known_hosts
  printf "%s\n" \
    "Host github.com" \
    "  IdentityFile ~/.ssh/github_silkgrain" \
    "  IdentitiesOnly yes" >> ~/.ssh/config
  chmod 600 ~/.ssh/config
  echo; echo "--- add this as a READ-ONLY deploy key on the repository ---"
  cat ~/.ssh/github_silkgrain.pub
'
```

Paste that public line into the repository's Settings → Deploy keys, **without** write access.
`ssh-keyscan` is what stops the first fetch hanging on an interactive host-key prompt that nothing
is there to answer.

```bash
sudo -u deploy -H bash -lc "git clone --mirror '$REPO_URL' /srv/silkgrain/shared/repo.git"
sudo -u deploy -H bash -lc 'git -C /srv/silkgrain/shared/repo.git remote update --prune'
```

The second command is the one `deploy.sh` runs on every deploy. If it works here, it works there.

### 3.2 The environment file

This file is the only copy of every secret the shop has. It lives in `shared/`, never inside a
release, because a release directory is what a rollback swaps — and a rollback that restored a
superseded secret would take the shop down with an authentication failure nobody would think to look
for.

```bash
sudo -u deploy install -m 0600 /dev/null /srv/silkgrain/shared/.env
sudo -u deploy -H bash -lc '
  git -C /srv/silkgrain/shared/repo.git show main:.env.production.example \
    > /srv/silkgrain/shared/.env
'
sudo -u deploy sed -i "s/silkgrain\.example/$DOMAIN/g" /srv/silkgrain/shared/.env
```

Read the two credentials you generated in section 2 and keep them where you can paste them:

```bash
echo "mysql: $(cat /root/silkgrain-bootstrap/mysql-password)"
echo "redis: $(cat /root/silkgrain-bootstrap/redis-password)"
```

Generate the two JWT secrets, which must differ from each other — `loadEnv` refuses them if they are
equal, because a leaked access secret must not be able to mint refresh tokens (decision D-15):

```bash
sudo -u deploy -H bash -lc '
  node -e "console.log(require(\"crypto\").randomBytes(48).toString(\"base64url\"))"
  node -e "console.log(require(\"crypto\").randomBytes(48).toString(\"base64url\"))"
'
```

Now edit the file. Every variable in it carries a comment saying what it does and what breaks if it
is wrong; read them rather than skimming. The markers are `[must differ]` and `[copy]`.

```bash
sudo -u deploy nano /srv/silkgrain/shared/.env
```

The values you must supply, in the order they appear:

| Variable                                                                                                                    | Value                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                              | `mysql://silkgrain:<mysql password>@127.0.0.1:3306/silkgrain`                       |
| `DATABASE_POOL_SIZE`                                                                                                        | `10`, or the smaller ceiling from section 2.5                                       |
| `REDIS_URL`                                                                                                                 | `redis://:<redis password>@127.0.0.1:6379` — note the empty user before the colon   |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                                                                                   | the two generated values, different from each other                                 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`                                                 | the three real keys. See [section 1](#the-one-thing-that-will-waste-your-evening)   |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`                                                       | your provider's. 587 with `SMTP_SECURE=false`, or 465 with `true`, and nothing else |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_URL` | the public media bucket                                                             |
| `BACKUP_S3_BUCKET`                                                                                                          | a **private** bucket, and not `S3_BUCKET`                                           |
| `BACKUP_S3_*` (the other four)                                                                                              | leave empty to reuse the `S3_*` credentials                                         |

The domain-derived lines — `PUBLIC_WEB_URL`, `PUBLIC_ADMIN_URL`, `CORS_ORIGINS`, `COOKIE_DOMAIN`,
`MAIL_FROM_ADDRESS`, `MAIL_REPLY_TO` — were already rewritten by the `sed`. Check them anyway.

Then verify the mode, because `deploy.sh` refuses anything but `600` and the message is easier to
read here than mid-deploy:

```bash
stat -c '%a %U:%G %n' /srv/silkgrain/shared/.env
# expect: 600 deploy:deploy /srv/silkgrain/shared/.env
```

Finally, remove the bootstrap credentials — they are now in one place, which is the point:

```bash
shred -u /root/silkgrain-bootstrap/mysql-password /root/silkgrain-bootstrap/redis-password
rmdir /root/silkgrain-bootstrap
```

### 3.3 Why the first deploy is a manual one

`.github/workflows/deploy.yml` runs `/srv/silkgrain/current/deploy/deploy.sh`. The running release
deploys its successor — which is the right design, because a deploy that exists only inside a CI
runner is a deploy nobody can perform at three in the morning when GitHub is the thing that is down.
It also means there is nothing to run until a release exists. So the first one comes out of the
mirror by hand:

```bash
sudo -u deploy -H bash -lc '
  set -euo pipefail
  install -d -m 0700 /tmp/silkgrain-bootstrap
  git -C /srv/silkgrain/shared/repo.git archive --format=tar main deploy \
    | tar -x -C /tmp/silkgrain-bootstrap
  ls -l /tmp/silkgrain-bootstrap/deploy
'
```

The three scripts are mode `100755` in git and `git archive` preserves that, so they come out
executable.

### 3.4 Run it

```bash
sudo -u deploy -H bash -lc '/tmp/silkgrain-bootstrap/deploy/deploy.sh main'
```

`bash -lc`, not a bare command. A non-interactive, non-login shell reads no profile and `node` is
not on its PATH; this is the same wrapper `deploy.yml` uses for the same reason.

What it does, in order, and why the order is the order — this is `deploy.sh`'s own header condensed,
and it is worth knowing before it fails at step 5:

1. fetch the mirror and resolve `main` to one immutable sha, so a branch that moves mid-deploy
   cannot produce a release built from two commits
2. unpack that sha into `releases/<UTC stamp>` and symlink `shared/.env` into it
3. `pnpm install --frozen-lockfile` and `pnpm build`, still touching nothing that is live
4. **dump the database, before the migration**, because migrations are forward-only (D-17) and the
   dump is the only way back across one
5. `pnpm db:migrate`
6. switch `current` with a single `rename(2)` and `pm2 reload`
7. poll `127.0.0.1:3001/ready`, and put `current` back if it does not come up
8. prune to the last five releases

Expect these two along the way, both benign on a first run:

- `no current release - this is the first deploy`
- `!! BACKUP_S3_BUCKET is not set...` — if you left it empty. The script exits 3, `deploy.sh`
  downgrades that to a warning and carries on, because what the next twenty minutes might need is a
  file on this disk and it is there.

**And expect it to stop at step 5** with the Stripe refusal, unless you have real keys in `.env`.
Nothing is damaged: `current` does not exist, no site went down, and the dump is in
`shared/backups/`. Fix the keys and run the same command again. The failed release directory stays
under `releases/` and is pruned in due course.

On success the last line is `==> [HH:MM:SS] deployed <sha> as <stamp>`. Confirm the API before going
anywhere near Nginx — this proves the application, separately from the web server:

```bash
curl -sS http://127.0.0.1:3001/health; echo
curl -sS http://127.0.0.1:3001/ready;  echo
sudo -u deploy -H bash -lc 'pm2 list'
```

`/health` should be `{"status":"ok","uptimeSeconds":N}`. `/ready` should be `"status":"ready"` with
both `database` and `redis` reporting `"ok":true` and a latency. A 503 with `"status":"degraded"`
names which dependency did not answer, and is a MySQL or Redis problem, not a code one.

### 3.5 Nginx and the certificate — as root

This is the part with the chicken-and-egg in it, so read the whole subsection before running any of
it.

Nginx refuses to start when `ssl_certificate` names a file that is not there, so the two TLS server
blocks cannot be enabled before the certificate exists. Certbot cannot issue the certificate until
Nginx is answering `/.well-known/acme-challenge/` on port 80. `deploy/nginx/silkgrain.conf`
documents the way out at lines 41–52; these are those steps, made mechanical.

**Step one — the bootstrap config.** Keep the file down to its `:80` server block, and disable the
redirect inside it so the ACME location is reachable:

```bash
awk '/^# :443 - www redirects to the apex\.$/ { exit } { print }' \
    /srv/silkgrain/current/deploy/nginx/silkgrain.conf \
  > /tmp/silkgrain-acme.conf

sed -i 's|return 301 https://|# ACME bootstrap, restored in step four: return 301 https://|' \
    /tmp/silkgrain-acme.conf

sed -i "s/silkgrain\.example/$DOMAIN/g" /tmp/silkgrain-acme.conf

install -o root -g root -m 0644 /tmp/silkgrain-acme.conf \
    /etc/nginx/sites-available/silkgrain.conf
ln -sfn /etc/nginx/sites-available/silkgrain.conf /etc/nginx/sites-enabled/silkgrain.conf
rm -f /etc/nginx/sites-enabled/default
```

The `awk` cuts the file at the banner that opens the first TLS block, leaving the header comments,
the `upstream`, the `log_format`, the `map` and the complete `:80` server — checked by the
`nginx -t` below rather than by counting lines.

Removing the distribution's `default` site is not tidiness. `default` owns `default_server` on both
ports, so every request carrying a Host nobody configured — a scanner, a stale DNS record, the raw
IP — is answered by the Ubuntu welcome page rather than by us.

If the box has no IPv6, strip the `listen [::]` lines now, or `bind()` fails with `EAFNOSUPPORT` and
Nginx will not start at all rather than starting without v6:

```bash
ip -6 addr show scope global | grep -q inet6 \
  || sed -i '/listen \[::\]/d' /etc/nginx/sites-available/silkgrain.conf
```

**Step two — the challenge webroot, and reload:**

```bash
install -d -o www-data -g www-data -m 0755 /var/www/certbot
nginx -t && systemctl reload nginx

# The redirect is off, so `/` answers 403 or 404 for the next few minutes. That is expected.
curl -sI "http://$DOMAIN/.well-known/acme-challenge/probe"     # expect: HTTP/1.1 404
```

A 404 from that path is the right answer: it means the location matched and `try_files` found no
such file. A 301 means the redirect is still live and the sed did not take.

**Step three — issue the certificate:**

```bash
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --agree-tos --no-eff-email --non-interactive -m "$ADMIN_EMAIL"

certbot certificates
```

Both names, because the committed config has a `www` → apex server block and Nginx will not load it
without a certificate covering `www`. That block is not tidiness either: `absoluteUrl()` in
`apps/web/src/lib/seo.tsx` builds every canonical, Open Graph URL and JSON-LD id from
`window.location.origin`, so a site reachable at two origins emits two complete sets of canonical
tags, each pointing at itself.

Arrange for renewals to reach Nginx. Certbot writes a new certificate on a timer and does not tell
the web server, so without this the renewal succeeds on day 60 and the site keeps serving the old
leaf — on a box whose only restart is a reboot, potentially past day 90:

```bash
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
tee /etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx.sh >/dev/null <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx.sh

certbot renew --dry-run
systemctl list-timers certbot.timer
```

**Step four — restore the real config.** The full file, from the release, with the same one
substitution:

```bash
install -o root -g root -m 0644 \
    /srv/silkgrain/current/deploy/nginx/silkgrain.conf \
    /etc/nginx/sites-available/silkgrain.conf
sed -i "s/silkgrain\.example/$DOMAIN/g" /etc/nginx/sites-available/silkgrain.conf

ip -6 addr show scope global | grep -q inet6 \
  || sed -i '/listen \[::\]/d' /etc/nginx/sites-available/silkgrain.conf

nginx -t && systemctl reload nginx
```

Copied with `install`, never symlinked into `/srv/silkgrain/current`. That symlink is repointed by
every deploy, so a symlinked config would silently become a different file whenever a release lands
— including on a rollback, which would quietly restore an older config that was never reloaded and
never reviewed. The web server's configuration is not release state, which also means **a change to
`deploy/nginx/silkgrain.conf` in git does not reach the box until somebody re-runs these four
commands.**

**Step five — the one thing the sed can get wrong.** That substitution also rewrote
`media.silkgrain.com` inside the Content-Security-Policy's `img-src`. If your images are served
from a provider hostname rather than a subdomain of yours, it has now written the wrong one, and a
wrong `img-src` is not a visible error — it is a catalogue of blank rectangles and a console nobody
is reading. Compare:

```bash
grep -o "img-src[^;]*" /etc/nginx/sites-available/silkgrain.conf | head -1
grep '^S3_PUBLIC_URL=' /srv/silkgrain/shared/.env
```

The origin in `S3_PUBLIC_URL` must appear in `img-src`. If it does not, fix it and reload:

```bash
sed -i "s|https://media\.$DOMAIN|<the S3_PUBLIC_URL origin>|g" \
    /etc/nginx/sites-available/silkgrain.conf
nginx -t && systemctl reload nginx
```

**Step six — prove Nginx can actually read the files.** The releases are owned by `deploy` and the
workers run as `www-data`; a missing traverse bit anywhere from `/srv` down produces a 403 on every
asset:

```bash
sudo -u www-data test -r /srv/silkgrain/current/apps/web/dist/index.html   && echo "web ok"
sudo -u www-data test -r /srv/silkgrain/current/apps/admin/dist/index.html && echo "admin ok"
```

**Step seven — the acceptance checks.** These are the four the CI workflow runs after every deploy,
plus the two the Nginx config asks to be confirmed by hand:

```bash
curl -fsSL "https://$DOMAIN/health"     && echo
curl -fsSL "https://$DOMAIN/ready"      && echo
curl -fsSLo /dev/null -w '%{http_code}\n' "https://$DOMAIN/"
curl -fsSLo /dev/null -w '%{http_code}\n' "https://$DOMAIN/admin/"

# The one construction in the site config worth confirming rather than reading: `alias`
# plus `try_files` under a deep admin route. 200, with the CSP header present.
curl -sI "https://$DOMAIN/admin/orders/1" | grep -Ei '^(HTTP|content-security-policy)'

# http and www both land on the apex over TLS.
curl -sI "http://$DOMAIN/"      | grep -i '^location'
curl -sI "https://www.$DOMAIN/" | grep -i '^location'

# Source maps are not served. Both builds emit them; the admin's is a complete listing of
# every route, permission check and payload shape.
curl -so /dev/null -w '%{http_code}\n' "https://$DOMAIN/assets/nonexistent.js.map"   # 404
```

### 3.6 The first administrator, the shipping rates and the settings

Three things a freshly migrated database is missing, and none of them can be created from the back
office:

- **The first administrator.** Every route that could create one is behind `team:manage`, which
  requires an administrator. There is no first one.
- **`shipping_rates`.** The admin surface is `GET` and `PUT /:id` with deliberately no `POST` -
  `SHIPPING_METHOD` is a closed enum and `orders.shipping_method` stores a snapshot of the code, so
  rates are edited and retired, never created. With zero rows a checkout has nothing to select and
  `GET /api/settings` computes no free-shipping figure, so the storefront's progress meter is blank.
- **`settings`.** `saveSettings` reads the row, throws `notFound` when it is absent and then
  UPDATEs. It never inserts, so an empty table is a Settings screen on which nothing saves.

`pnpm db:seed` writes all three and refuses production for good reason (D-38): it also writes
thirty-two demo products and three administrators sharing a password published in this repository.

One command covers the gap:

```bash
cd /srv/silkgrain/current

# Interactively - it prompts for all three:
pnpm --filter @silkgrain/api db:bootstrap

# Or unattended. Not on the command line: `ps` shows every argument to every user on the box, and
# the shell keeps the rest in its history. Generate the password rather than inventing one.
BOOTSTRAP_OWNER_EMAIL=you@silkgrain.com BOOTSTRAP_OWNER_NAME='Your Name' BOOTSTRAP_OWNER_PASSWORD="$(openssl rand -base64 24)"   pnpm --filter @silkgrain/api db:bootstrap
```

It prints what it created:

```
bootstrapped mysql://silkgrain:***@127.0.0.1:3306/silkgrain
  owner:          you@silkgrain.com
  shipping rates: 3 created
  settings:       4 created

The catalogue is still empty; add products in the admin panel.
```

Three things worth knowing about it:

- **It is safe to run twice.** Every step checks first, so a half-failed bootstrap is finished by
  running it again rather than by working out which half ran.
- **It will not create a second administrator.** Once one exists it says so and skips. Authority is
  granted on the Team screen after that, because that screen writes an audit entry naming who
  granted it (D-36) and a command line that kept minting owners would bypass the log.
- **It lowercases the email.** `LoginInput` lowercases what is typed and `loginAdmin` matches with
  `eq`, so a row stored with a capital letter is an account nobody can ever sign in to - and the
  failure looks exactly like a wrong password.

Verified against a genuinely empty database before this document was written: migrate, bootstrap,
start the API, and `GET /api/settings` answered `freeShippingFromCents: 7500` computed from the
rate row, `GET /api/products` answered `total: 0`, and the owner signed in with a 200.

Now sign in at `https://silkgrain.com/admin` and add products. The catalogue is empty on
purpose; there is no demo data in production.

Then close that shell, which triggers the `trap` and removes the defaults file:

```bash
exit
```

### 3.7 The nightly backup

`backup-db.sh` rotates fourteen days of local dumps, and a fourteen-day rotation only means anything
if something takes a dump every night. `deploy.sh` takes one before each migration; that is not a
schedule.

```bash
sudo -u deploy -H crontab -e
```

```cron
MAILTO=""
# /usr/local/bin first: cron's default PATH is /usr/bin:/bin, and an aws CLI installed from
# Amazon's own package lands outside it - the dump would then succeed, the upload would be
# skipped with a warning nobody sees, and every backup would live on the disk it was taken
# from.
PATH=/usr/local/bin:/usr/bin:/bin

17 3 * * * /srv/silkgrain/current/deploy/backup-db.sh >> /srv/silkgrain/shared/logs/backup.log 2>&1
```

Both streams go to the log because cron would otherwise try to mail them to a local mailbox nobody
reads. It is a handful of lines a night.

Run it once now rather than finding out at the first restore:

```bash
sudo -u deploy -H bash -lc '/srv/silkgrain/current/deploy/backup-db.sh'
ls -lh /srv/silkgrain/shared/backups/
```

Exit code 0 means dumped, verified and uploaded. Exit code 3 means dumped and verified but the
off-site copy failed, and the reason is on stderr. Anything else means there is no usable dump.

### 3.8 Reboot, on purpose, now

The only honest test of `pm2 startup` plus `pm2 save` is a reboot, and the time to discover it does
not work is now and not after the provider migrates the box.

```bash
reboot
```

Then, from your own machine:

```bash
sleep 60
curl -fsSL "https://$DOMAIN/health"; echo
curl -fsSL "https://$DOMAIN/ready";  echo
```

If that is silent, `ssh` in and read `systemctl status pm2-deploy` and `pm2 list`.

### 3.9 Hand the deploy to CI

`.github/workflows/deploy.yml` runs on a push to `main`, calls the whole CI workflow as a gate,
rescans every blob that ever existed for a leaked credential, deploys over SSH, checks the public
site from outside the box, and rolls back if that check fails.

Repository → Settings → Secrets and variables → Actions:

| Kind     | Name                 | Value                                                                |
| -------- | -------------------- | -------------------------------------------------------------------- |
| Secret   | `DEPLOY_HOST`        | the box's address                                                    |
| Secret   | `DEPLOY_USER`        | `deploy`                                                             |
| Secret   | `DEPLOY_SSH_KEY`     | the whole private half of `~/.ssh/silkgrain_deploy` from section 2.2 |
| Secret   | `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan -p 22 <host>` run on your machine         |
| Variable | `DEPLOY_SSH_PORT`    | `22`, or your port                                                   |
| Variable | `PUBLIC_SITE_URL`    | `https://silkgrain.com` — the apex, over https, no `www`             |

`DEPLOY_KNOWN_HOSTS` is a pinned host key, never `StrictHostKeyChecking=no`: anyone who can answer
on port 22 of that address would otherwise be handed the deploy key and told to install a release.
The value changes when the box is rebuilt, and a rebuild is exactly when a warning is worth reading
rather than clicking through.

`PUBLIC_SITE_URL` must be the apex over https. The workflow follows redirects, so a `www.` or
`http://` value still passes — but the environment link in the GitHub UI would point at the wrong
place.

The workflow references an environment named `production`. Create it under Settings → Environments
if you want a required reviewer standing between a merge and a release.

Then push a no-op commit to `main` and watch the run. It ends with four public health checks and,
before them, a step that reads the sha back out of `current/RELEASE` and fails if the box is serving
anything other than the commit it was given.

---

## 4. Routine operation

### Deploying

Ordinarily: merge to `main` and let the workflow do it.

By hand, when GitHub is the thing that is down, or to put a specific tag on the box:

```bash
ssh deploy@<host> 'bash -lc "/srv/silkgrain/current/deploy/deploy.sh main"'
ssh deploy@<host> 'bash -lc "/srv/silkgrain/current/deploy/deploy.sh v1.4.0"'
ssh deploy@<host> 'bash -lc "/srv/silkgrain/current/deploy/deploy.sh 4fc4260"'
```

The `bash -lc` wrapper is required, not stylistic. `ssh host a b c` joins its arguments and hands
them to a non-interactive, non-login shell, which reads no profile — so `node`, `pnpm` and `pm2` are
not on the PATH and `deploy.sh` dies at its precondition check naming binaries that are installed.

One deploy at a time: `deploy.sh` and `rollback.sh` take the same `flock` on
`shared/deploy.lock`, because a rollback during a deploy is the same collision wearing a different
name.

**The one window to know about at 3am.** Between step 5 and step 6 — the migration and the symlink
switch — the OLD code is serving against the NEW schema, for a few seconds. Additive migrations
survive it. One that drops or renames a column still in use does not. Ship the destructive half of
such a change in the deploy _after_ the one that stops reading the column.

### Rolling back, and the half of it that does not happen

```bash
ssh deploy@<host> 'bash -lc "/srv/silkgrain/current/deploy/rollback.sh --list"'
ssh deploy@<host> 'bash -lc "/srv/silkgrain/current/deploy/rollback.sh"'              # back one
ssh deploy@<host> 'bash -lc "/srv/silkgrain/current/deploy/rollback.sh 20260821113045"'
```

**The database does not come back with the code.** Migrations are forward-only (decision **D-17**):
there are no `down` files, deliberately, because a hand-written `down` is the one piece of SQL
nobody tests until the night it is needed. So a rollback across a schema change leaves old code
reading a schema it was never written for, and the symptoms are silent — a column that no longer
exists, an enum that grew a value, a `NOT NULL` that arrived after the release you just went back
to.

`rollback.sh` compares the drizzle journal of the two releases and **refuses** when they differ. That
refusal is the correct outcome and CI never overrides it: the `--i-have-restored-the-database` flag
is an assertion that a human restored the pre-deploy dump, and nothing in a runner can honestly make
that claim. When it refuses, the sequence is:

```bash
ls -lt /srv/silkgrain/shared/backups | head
# the newest dump is the one taken immediately before the migration you are undoing;
# `dump=` in the release's own RELEASE file names it exactly:
cat /srv/silkgrain/releases/<the release being left>/RELEASE

pm2 stop silkgrain-api
# restore - see below - then:
/srv/silkgrain/current/deploy/rollback.sh <release> --i-have-restored-the-database
```

If the change was genuinely additive and the old code cannot notice it, the same flag is how you say
so. Read the migration first, not this paragraph.

### Backups, and restoring one

Take one on demand — before running SQL by hand, for instance:

```bash
/srv/silkgrain/current/deploy/backup-db.sh --no-upload
```

Check what is there:

```bash
ls -lt /srv/silkgrain/shared/backups | head
gzip -t /srv/silkgrain/shared/backups/<dump>.sql.gz && echo "stream ok"
gzip -dc /srv/silkgrain/shared/backups/<dump>.sql.gz | tail -1     # "-- Dump completed on ..."
```

Anything below that writes to MySQL by hand needs credentials, and a password on the command line is
readable by every user on the box for as long as the command runs. This is the same 0600 defaults
file `backup-db.sh` builds for itself, and `$SG_DEFAULTS` means it for the rest of this section. Run
it as `deploy`, in the shell you are about to work in — the `trap` removes the file when that shell
exits:

```bash
umask 077
SG_DEFAULTS="$(mktemp)"
trap 'rm -f "$SG_DEFAULTS"' EXIT
{
  printf '[client]\nuser=silkgrain\nhost=127.0.0.1\nport=3306\n'
  printf 'password="%s"\n' \
    "$(sed -n 's|^DATABASE_URL=mysql://silkgrain:\([^@]*\)@.*|\1|p' /srv/silkgrain/shared/.env)"
} > "$SG_DEFAULTS"

mysql --defaults-extra-file="$SG_DEFAULTS" silkgrain -e "SELECT 1;"
```

The dump carries no `CREATE DATABASE` and no `USE`, deliberately, so it restores into whatever
database it is pointed at. **Restore into a scratch database first and read it** before anybody
overwrites the live one. That needs `CREATE DATABASE`, which the application's user deliberately does
not have, so it is one of the two later root steps:

```bash
sudo mysql -e "CREATE DATABASE silkgrain_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gzip -dc /srv/silkgrain/shared/backups/<dump>.sql.gz | sudo mysql silkgrain_restore
sudo mysql silkgrain_restore -e "SELECT COUNT(*) FROM orders; SELECT MAX(created_at) FROM orders;"
```

For the real thing, stop the API first — a restore under a live process is a half-read schema:

```bash
pm2 stop silkgrain-api

# Ordinary case: the dump and the live schema have the same tables. mysqldump writes
# DROP TABLE IF EXISTS before each CREATE TABLE, so this replaces every table it carries.
gzip -dc /srv/silkgrain/shared/backups/<dump>.sql.gz \
  | mysql --defaults-extra-file="$SG_DEFAULTS" silkgrain

pm2 start silkgrain-api
```

**Across a migration it is not that simple, and this is the part to get right.** A table the newer
migration created is not in the dump, so it survives the restore — while `__drizzle_migrations`,
which _is_ in the dump, goes back to the older state. The next `pnpm db:migrate` then tries to
create a table that already exists. Drop and recreate the schema instead:

```bash
pm2 stop silkgrain-api
sudo mysql <<'SQL'
DROP DATABASE `silkgrain`;
CREATE DATABASE `silkgrain` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL
gzip -dc /srv/silkgrain/shared/backups/<dump>.sql.gz \
  | mysql --defaults-extra-file="$SG_DEFAULTS" silkgrain
pm2 start silkgrain-api
```

`DROP DATABASE` does not remove privileges granted specifically for that database, so the
`silkgrain` user's grant survives and does not need re-issuing. Verify anyway:
`SHOW GRANTS FOR 'silkgrain'@'127.0.0.1';`.

Nothing in `backup-db.sh` deletes a remote object, and nothing should: a rotation bug that can reach
the off-site copies can delete every backup there has ever been. Expire the `database/` prefix with
a bucket lifecycle rule at the provider.

### Reading the logs

```bash
pm2 logs silkgrain-api --lines 200                    # both streams, live
pm2 logs silkgrain-api --lines 500 --nostream         # a snapshot, for pasting
tail -f /srv/silkgrain/shared/logs/api-error.log
tail -f /var/log/nginx/silkgrain.error.log
tail -f /var/log/nginx/silkgrain.access.log
```

The API's files are under `shared/logs/` because `ecosystem.config.cjs` redirects them there.
Releases are pruned to the last five, and a log file inside one would be deleted with it — which is
to say the logs would disappear exactly when somebody went looking for what the previous release
did.

Two things about the format. Pino writes one JSON object per line in production, but PM2's
`time: true` prefixes each line with a human-readable stamp, so the file is **not** parseable as
NDJSON — that is the right trade for a box where the logs are read with `grep`. And the Nginx access
log is quiet on 2xx and 3xx for assets and probes and loud on everything else, so a line under
`/assets/` in that file is a 404 and usually means a cached `index.html` naming a chunk that was
pruned with an old release.

The two logs join on the request id. Nginx sets `X-Request-ID: $request_id` and the API adopts it,
so:

```bash
grep '<the id>' /var/log/nginx/silkgrain.access.log
grep '<the id>' /srv/silkgrain/shared/logs/api-out.log
```

The same id is what a customer quotes off an error page: the API echoes it as `error.requestId` on
every failure.

The two numbers the access log carries beyond the combined format are worth knowing:
`rt=` is the whole request and `urt=` is the API's share of it. An empty `urt=` means the request
never reached Node, which distinguishes "the API is slow" from "the API is not there" without
opening a second log.

### Rotating a secret

Every one of these is: change it at the source, change it in `/srv/silkgrain/shared/.env`, then

```bash
ssh deploy@<host> 'bash -lc "pm2 reload silkgrain-api --update-env"'
```

The reload is what re-reads the file — a cluster reload replaces each worker with a new process, and
`loadDotEnv()` runs again at its boot. `--update-env` is for the three values PM2 itself supplies
from `ecosystem.config.cjs`.

What each rotation costs:

| Secret                  | Cost                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`     | Every session, customer and administrator, is signed out at once. What you want after a compromise; not what you want on a Tuesday afternoon.                                                                                                     |
| `JWT_REFRESH_SECRET`    | Worse: it keys the HMAC digest every stored refresh token is held under, so every family stops matching. Same visible effect, and unrecoverable rather than merely disruptive.                                                                    |
| Database password       | Change it in MySQL (`ALTER USER 'silkgrain'@'127.0.0.1' IDENTIFIED BY ...`) and in `DATABASE_URL` in the same minute. URL-safe characters only, or percent-encode.                                                                                |
| Redis password          | `requirepass` in `/etc/redis/redis.conf`, `systemctl restart redis-server`, then `REDIS_URL`. Queued email jobs survive because `appendonly` is on.                                                                                               |
| `STRIPE_WEBHOOK_SECRET` | Roll it in the dashboard and here together. A mismatch is a 400 on every event, which Stripe retries for three days — and since an order becomes `paid` only in the webhook, that is three days of charged customers whose orders read `pending`. |
| `S3_PUBLIC_URL`         | **Do not rotate.** `product_images.url` stores the absolute URL built from this at upload time. Change it and every existing row still points at the old host, while deleting one of those images silently does nothing.                          |
| The CI deploy key       | New keypair on your workstation, public half into `/home/deploy/.ssh/authorized_keys`, private half into `DEPLOY_SSH_KEY`, old line removed.                                                                                                      |

---

## 5. When it breaks

Every row here is a failure mode that exists in the scripts as written, not a general troubleshooting
list. `silkgrain.com` is the domain token this repository uses throughout, so read it as yours;
`<host>` is the box's SSH address, which is an argument rather than a token.

| Symptom                                                            | First command                                                                            | Likely cause                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy.sh`: `` `pnpm` is not on PATH for the deploy user ``       | `ssh deploy@host 'bash -lc "which node pnpm pm2"'`                                       | nvm sourced only from `~/.bashrc`, which a non-interactive login shell returns out of at line one. Section 2.7 puts the two lines in `~/.profile` instead.                                             |
| Deploy stops at step 5, `STRIPE_SECRET_KEY: Still the placeholder` | `grep -c replace_me /srv/silkgrain/shared/.env`                                          | `loadEnv` refuses the D-27 placeholders under `NODE_ENV=production`. Nothing was switched; put real keys in and re-run.                                                                                |
| `deploy.sh`: `.env is mode 644, expected 600`                      | `stat -c '%a %U:%G' /srv/silkgrain/shared/.env`                                          | `chmod 600` and `chown deploy:deploy`. The file holds every credential the shop has.                                                                                                                   |
| `deploy.sh`: `pnpm 10.x is installed, package.json pins 10.34.5`   | `ssh deploy@host 'bash -lc "pnpm -v"'`                                                   | A globally installed pnpm shadowing corepack's. `corepack enable && corepack prepare pnpm@10.34.5 --activate`.                                                                                         |
| PM2 shows `errored` with 10 restarts and the site is down          | `pm2 logs silkgrain-api --lines 200`                                                     | `loadEnv` threw at boot and the process never listened. The message names the variable. `min_uptime`/`max_restarts` stopping the loop is correct behaviour, not the fault.                             |
| `/ready` answers 503 `degraded`                                    | `curl -s 127.0.0.1:3001/ready`                                                           | The body names which of MySQL and Redis did not answer within 2s. Not a code problem. The driver's own message is in the API log, deliberately not on the wire (D-40).                                 |
| 502 from Nginx on `/api/` but the static pages load                | `pm2 list; ss -lntp \| grep 3001`                                                        | No worker listening. If `ss` shows `0.0.0.0:3001` rather than `127.0.0.1:3001`, `API_HOST` is wrong and the API is exposed.                                                                            |
| 403 on every asset, "Permission denied" in the Nginx error log     | `sudo -u www-data test -r /srv/silkgrain/current/apps/web/dist/index.html`               | A missing traverse bit between `/srv` and the `dist` directories. `chmod o+x` each level, or put `www-data` in the `deploy` group and use `g+rx`.                                                      |
| `/admin/` is blank with 404s in the browser console                | `curl -sI https://silkgrain.com/admin/orders/1`                                          | The admin's Vite base is `/admin/`; the `alias` + `try_files` block or the `= /admin` redirect is wrong. Expect 200 with a `content-security-policy` header.                                           |
| Every product image is a blank rectangle                           | browser console, then `grep -o 'img-src[^;]*' /etc/nginx/sites-available/silkgrain.conf` | The domain `sed` rewrote `media.silkgrain.com` to a host that is not `S3_PUBLIC_URL`. Section 3.5 step five.                                                                                           |
| `nginx -t`: `unknown directive "brotli"`                           | `ls /etc/nginx/snippets/silkgrain-brotli.conf*`                                          | The snippet exists but `libnginx-mod-brotli` does not. The site includes it as a glob so an absent file is fine; a present file without the module is not.                                             |
| Backup exits 3 every night                                         | `grep '^BACKUP_S3' /srv/silkgrain/shared/.env; command -v aws`                           | Bucket unset, credentials missing, or `aws` outside cron's `PATH`. The dump is fine and local; the off-site copy is not.                                                                               |
| Backup exits 1, "does not end with mysqldump's completion marker"  | `df -h /srv/silkgrain/shared`                                                            | Suspect the disk before the database. A truncated dump is deleted rather than kept, which is why you are seeing an error and not a bad file.                                                           |
| `rollback.sh`: `REFUSED: this rollback crosses a schema change`    | `rollback.sh --list`                                                                     | Working exactly as designed. Restore the pre-deploy dump named in the release's `RELEASE` file, then pass `--i-have-restored-the-database`.                                                            |
| Site does not come back after a reboot                             | `systemctl status pm2-deploy; pm2 list`                                                  | `pm2 startup` never run, or no `pm2 save` since. `deploy.sh` saves after every healthy deploy, so one successful deploy fixes it.                                                                      |
| Certificate expired                                                | `certbot certificates; systemctl list-timers certbot.timer`                              | Either the timer is off, or renewal fails because something now shadows `/.well-known/acme-challenge/`, or it renewed and Nginx was never reloaded (the deploy hook in section 3.5).                   |
| Emails never arrive, nothing in the log                            | `redis-cli CONFIG GET maxmemory-policy`                                                  | Anything but `noeviction` and BullMQ jobs are discarded under memory pressure with no trace. Next suspect: `SMTP_SECURE=true` on port 587, which hangs until the socket times out rather than failing. |
| Rate limiting has stopped working and nothing is in the log        | `curl -sI https://silkgrain.com/api/products \| grep -i ratelimit`                       | A CDN or a second proxy was put in front. `app.ts` sets `trustProxy: 1`; a second hop must be a code change in the same commit, or every limiter buckets on an address the client chooses.             |
| A deploy "succeeded" but the change is not live                    | `cat /srv/silkgrain/current/RELEASE`                                                     | The mirror fetched nothing and the ref resolved to yesterday's commit. CI checks exactly this and fails; by hand, compare `sha=` with what you pushed.                                                 |

---

## 6. Known rough edges

Written down rather than smoothed over, because each of these will cost somebody time and a document
that pretended otherwise would cost them more.

**~~The first deploy cannot complete without Stripe keys.~~ Fixed — `PAYMENTS_ENABLED=false`.** This
paragraph used to say the first deploy was impossible without keys and that the narrower fix, a
migration entry point parsing only the environment it uses, belonged in `BACKLOG.md`. That fix would
have been the wrong one: it would have let the migration through and left the API refusing to boot
one step later, and had somebody forced both past, it would have left the webhook route mounted and
verifying against a published placeholder. The whole shop is a supported deployment without payments
now (D-51), and the route simply does not exist in that mode. See
[Deploying without a Stripe account](#deploying-without-a-stripe-account).

**The TLS bootstrap is a hand edit in a 644-line file.** Section 3.5 makes it mechanical with `awk`
and two `sed`s, and it is still a config produced by cutting a committed one in half at a comment
line. The right answer is a second committed file — `deploy/nginx/silkgrain-bootstrap.conf`, port 80
and the ACME location and nothing else — installed first, replaced by the real site after issuance.
That was not invented here because inventing an artefact in the document that describes the
artefacts is how the two stop agreeing. It is a small, obvious piece of work for whoever does 9.8.

**The bootstrap gap was found while writing this document, and closed rather than documented.**
The first draft of section 3.6 was nine hand-written commands to hash a password and INSERT an
administrator, plus two blocks of raw SQL for `shipping_rates` and `settings` - because no screen in
the back office can create any of the three, and only `pnpm db:seed` otherwise writes them. A
runbook that tells somebody to compose SQL at 2am is a stub with a document's manners, so
`pnpm --filter @silkgrain/api db:bootstrap` exists instead. What remains worth knowing: the command
is the only way those three tables get their first rows, so it is a step nobody can skip and nothing
reminds you about except this document.

**The domain token is not entirely a `sed`.** On the box it is: two files, one substitution each,
exactly as `.env.production.example` and the Nginx site promise. But `silkgrain.com` is also
compiled into the storefront bundle in four places — `apps/web/public/robots.txt` advertises
`https://silkgrain.com/sitemap.xml`, and `hello@silkgrain.com` appears in `SiteFooter.tsx`,
`help.page.tsx` and the `Organization` JSON-LD in `seo.tsx`. Those change with a commit, not with a
command on the server, and they are waiting on Q-8 (real contact details) as much as on Q-11.

**Nginx configuration is not release state, so it does not deploy.** A change to
`deploy/nginx/silkgrain.conf` in git reaches the box only when somebody re-runs section 3.5 step
four by hand. That is the correct trade — a symlinked config would silently change on every deploy
and every rollback — but nothing warns you that the committed file and the installed file have
drifted apart. `diff <(sed "s/$DOMAIN/silkgrain.com/g" /etc/nginx/sites-available/silkgrain.conf)
/srv/silkgrain/current/deploy/nginx/silkgrain.conf` is the check, and it is not automated.

**`sitemap.xml` is a 404 by configuration** while `robots.txt` advertises it, and an unknown path is
answered **200** with the storefront's designed 404 page. Neither is fixable in Nginx: the route
table lives in the JavaScript bundle and is partly data, since `/product/$slug` resolves against the
catalogue. The Nginx site sets out the two real fixes, prerendering and SSR, and both are
architecture decisions rather than tasks in `PLAN.md`.

**Nothing aggregates errors.** `docs/observability.md` is the full inventory: pino to two files, two
probes, and a router that catches every front-end crash and records none of it. A React render crash
on the product page is invisible from the server — the API is healthy, the logs are clean, the page
is white, and the first anyone hears of it is a support email. That document also names the six
places a Sentry SDK attaches on the day a DSN exists.

**Two comments in the repository are stale about how the API finds its environment.** The trailing
note in `ecosystem.config.cjs`, and a paragraph at step 2 of `deploy.sh`, both describe
`loadDotEnv()` counting four directories up from `import.meta.url` and therefore missing
`shared/.env` from the built entry point. That was true and has been fixed:
`apps/api/src/config/dotenv.ts` now walks up looking for the file, so the `.env` symlink `deploy.sh`
places in the release root is what the running API reads, and it works from `src` and from `dist`
alike. The behaviour described in this document is the code's, and the code is what runs — but if
you read either comment first, that is why it disagrees.

**`docs/observability.md` names the wrong log path.** It says PM2 captures to
`~/.pm2/logs/silkgrain-api-{out,error}.log`, which is PM2's default and not what happens here:
`ecosystem.config.cjs` redirects both streams to `/srv/silkgrain/shared/logs/api-{out,error}.log`,
so that releases being pruned cannot take the logs with them. Section 4 uses the real paths.

**Task 9.8 has not been performed.** Every command above was derived by reading the scripts, the
schema and the workflows, and checked against them line by line — but this document has not been
executed end to end on a clean machine. The steps most likely to need adjustment when it is are the
ones that depend on distribution behaviour rather than on this repository: the exact `pm2 startup`
line, whether fail2ban needs the systemd backend on the image you are given, and whether the
`awk` anchor in section 3.5 still matches after the next edit to the Nginx site.
