#!/usr/bin/env bash
#
# Deploy a git ref to the VPS, or leave the site exactly as it was.
#
# The failure this exists to prevent is the half-landed deploy: new code serving against a schema
# that was never migrated, or a `current` symlink pointing at a release that cannot boot, with no
# dump taken from before the migration and nothing to go back to. Every step below is ordered so
# that the site is either fully on the old release or fully on the new one, and so that the one
# irreversible act - the migration - happens after a backup and before anything is switched.
#
#   deploy.sh <git-ref>
#
# Run as `deploy`, never as root. The ref is anything `git rev-parse` accepts in the mirror:
# a branch, a tag, or a commit sha.
#
# What it does, in order, and why the order is the order:
#
#   1. fetch the ref into the shared mirror and resolve it to one immutable commit sha
#   2. unpack that sha into releases/<UTC timestamp> and link shared/.env into it
#   3. install with a frozen lockfile and build - still touching nothing that is live
#   4. dump the database (backup-db.sh) BEFORE the migration, because a forward-only migration
#      (D-17) has no `down` and the dump is the only way back across one
#   5. `pnpm db:migrate`
#   6. switch `current` atomically and `pm2 reload`
#   7. poll /ready, and if it does not come up, put `current` back and reload again
#   8. prune to the last 5 releases
#
# `pnpm db:seed` appears nowhere in this file and must never be added: it writes the demo
# catalogue and an owner account whose password is published in this repository. It refuses to run
# under NODE_ENV=production for that reason, and this script does not test that refusal.
#
# The window between step 5 and step 6 is real and worth knowing about at 3am: for those seconds
# the OLD code is serving against the NEW schema. Additive migrations survive it; one that drops
# or renames a column in use does not. Ship the destructive half of such a change in the deploy
# AFTER the one that stops reading the column.

set -euo pipefail

# ---------------------------------------------------------------------------------------------
# The topology. These constants also appear in rollback.sh, backup-db.sh, the Nginx site and the
# PM2 ecosystem file; they are repeated rather than sourced from a shared library on purpose,
# because a library is one more file that has to be present and correct on the server during the
# incident when you least want to be debugging one.
# ---------------------------------------------------------------------------------------------
APP_ROOT=/srv/silkgrain
RELEASES="${APP_ROOT}/releases"
SHARED="${APP_ROOT}/shared"
CURRENT="${APP_ROOT}/current"
ENV_FILE="${SHARED}/.env"
MIRROR="${SHARED}/repo.git"
LOCK_FILE="${SHARED}/deploy.lock"

PM2_APP=silkgrain-api
# The ecosystem file ships with the code (task 9.1). The paths inside it must name
# `/srv/silkgrain/current/...` and never a release directory: `pm2 reload` re-spawns from the
# path it was started with, so a release-pinned path would reload the OLD code and the health
# check below would happily pass on it.
# At the repository root, not under deploy/ - task 9.1 put it there because PM2 reads it
# from the release root and because `ecosystem.config.js` would be parsed as ESM.
ECOSYSTEM_REL=ecosystem.config.cjs

# The API binds 127.0.0.1:3001 only. The probe goes straight at it rather than through Nginx:
# this script changed the application, not the web server, and a 502 from Nginx during the
# reload window would be indistinguishable from an application that failed to boot.
HEALTH_URL=http://127.0.0.1:3001/ready
HEALTH_ATTEMPTS=30
HEALTH_DELAY=2

KEEP_RELEASES=5

# Corepack asks, interactively, before downloading the pnpm version pinned in package.json.
# Over SSH with no tty that question is a hang, not a prompt.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# ---------------------------------------------------------------------------------------------

say() { printf '==> [%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '!!  [%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  printf '\nFAILED: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: deploy.sh <git-ref>

  <git-ref>   a branch, tag or commit sha that exists in /srv/silkgrain/shared/repo.git

  deploy.sh main
  deploy.sh v1.4.0
  deploy.sh 4fc4260
USAGE
  exit 2
}

[ $# -eq 1 ] || usage
REF="$1"
case "$REF" in -*) usage ;; esac

[ "$(id -u)" -ne 0 ] || die "run as the deploy user, not root. Root-owned files in a release
  directory make the next deploy fail on the install, and the API must not run as root."

# ---------------------------------------------------------------------------------------------
# One deploy at a time. Two of these racing would interleave two `pnpm install` runs over one
# store and switch the symlink twice in an order neither of them chose. rollback.sh takes the
# same lock, because a rollback during a deploy is the same collision wearing a different name.
# ---------------------------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || die "another deploy or rollback holds ${LOCK_FILE}. Wait for it, or find out why
  it did not finish before taking the lock away from it."

# ---------------------------------------------------------------------------------------------
# Preconditions. All of them checked here, before anything is created, so a missing binary costs
# a second rather than a half-built release directory to clean up.
# ---------------------------------------------------------------------------------------------
for tool in git node pnpm pm2 curl tar flock; do
  command -v "$tool" >/dev/null 2>&1 || die "\`${tool}\` is not on PATH for the deploy user.
  If it is nvm's node, the login shell has to source nvm - a non-interactive ssh does not."
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node ${NODE_MAJOR} is below the engines floor of 20.11.0."
[ "$NODE_MAJOR" -eq 22 ] || warn "Node ${NODE_MAJOR}, not the 22 LTS this is deployed and tested on."

[ -f "$ENV_FILE" ] || die "${ENV_FILE} does not exist. Secrets live there and only there -
  never inside a release, or a rollback would restore an old secret with the old code."

# The env file is the whole shop: database, JWT secrets, Stripe, S3. Group- or world-readable is
# not a style point, it is every credential the site has.
ENV_MODE="$(stat -c '%a' "$ENV_FILE")"
[ "$ENV_MODE" = "600" ] || die "${ENV_FILE} is mode ${ENV_MODE}, expected 600.
  Fix it with: chmod 600 ${ENV_FILE} && chown deploy:deploy ${ENV_FILE}"

[ -d "$MIRROR" ] || die "no git mirror at ${MIRROR}. Create it once, as deploy:
  git clone --mirror <repository url> ${MIRROR}"

# `logs` because ecosystem.config.cjs points out_file and error_file into it; on a clean box
# PM2 cannot open either stream and the first deploy fails with nothing written down about why.
mkdir -p "$RELEASES" "${SHARED}/backups" "${SHARED}/logs"

# ---------------------------------------------------------------------------------------------
# 1. Resolve the ref to a sha. Everything after this point refers to the sha and never to the
#    ref, so a branch that moves mid-deploy cannot produce a release built from two commits.
# ---------------------------------------------------------------------------------------------
say "fetching ${MIRROR}"
git -C "$MIRROR" remote update --prune

SHA="$(git -C "$MIRROR" rev-parse --verify --quiet "${REF}^{commit}")" || SHA=""
[ -n "$SHA" ] || die "\`${REF}\` is not a commit in the mirror. If it was pushed a moment ago,
  the fetch above should have found it - check you pushed to the remote the mirror clones."

SUBJECT="$(git -C "$MIRROR" log -1 --format='%s' "$SHA")"
say "deploying ${REF} -> ${SHA} (${SUBJECT})"

# ---------------------------------------------------------------------------------------------
# 2. Unpack.
# ---------------------------------------------------------------------------------------------
STAMP="$(date -u +%Y%m%d%H%M%S)"
RELEASE="${RELEASES}/${STAMP}"
[ ! -e "$RELEASE" ] || die "${RELEASE} already exists. Two deploys in the same second is not a
  thing that happens by accident; find out what the other one is doing."

PREVIOUS=""
if [ -L "$CURRENT" ]; then
  PREVIOUS="$(readlink -f "$CURRENT")"
  say "current release is ${PREVIOUS##*/}"
else
  say "no current release - this is the first deploy"
fi

mkdir -p "$RELEASE"
# `git archive` rather than a checkout: the release gets the tree and no `.git`, so nothing on the
# server can be committed to by accident and a stray local change cannot survive into the next
# deploy.
git -C "$MIRROR" archive --format=tar "$SHA" | tar -x -C "$RELEASE"

# Read by rollback.sh and by whoever is reading this directory at 3am wondering what is in it.
cat >"${RELEASE}/RELEASE" <<META
ref=${REF}
sha=${SHA}
subject=${SUBJECT}
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
deployed_by=$(id -un)@$(uname -n)
META

# The one copy of the secrets, linked rather than copied. `pnpm db:migrate` runs from source
# through tsx, and `loadDotEnv` resolves four directories up from src/config/ - which is this
# release - so the link is what feeds the migration its DATABASE_URL.
#
# It is NOT what feeds the running API. tsup bundles the server to apps/api/dist/server.js, and
# the same four directories up from there lands on /srv/silkgrain/releases, where no .env exists.
# The API takes its environment from PM2 instead (task 9.1's ecosystem file reads shared/.env).
# Nothing here papers over that: if PM2 does not supply it, `loadEnv` throws at boot and the
# health check in step 7 rolls this deploy back rather than leaving a dead site up.
ln -s "$ENV_FILE" "${RELEASE}/.env"

# ---------------------------------------------------------------------------------------------
# 3. Install and build. NODE_ENV must not be `production` here: pnpm would skip devDependencies
#    and the build needs every one of them - turbo, vite, tsup, tsc. The runtime gets its
#    NODE_ENV from shared/.env, which is where it belongs.
# ---------------------------------------------------------------------------------------------
unset NODE_ENV

cd "$RELEASE"

PNPM_WANTED="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)"
PNPM_FOUND="$(pnpm --version)"
[ "$PNPM_WANTED" = "$PNPM_FOUND" ] || die "pnpm ${PNPM_FOUND} is installed, package.json pins
  ${PNPM_WANTED}. Let corepack pin it rather than installing one globally:
  corepack enable && corepack prepare pnpm@${PNPM_WANTED} --activate"

say "pnpm install --frozen-lockfile"
# Frozen, always: a lockfile the deploy is allowed to rewrite means the versions running in
# production are not the versions anything was tested against.
pnpm install --frozen-lockfile

say "pnpm build"
pnpm build

# A build can exit 0 and still have produced nothing useful - a filter that matched no package,
# a cached turbo run against an empty output directory. These three artefacts are what Nginx and
# PM2 are about to be pointed at, so their absence is a failure here rather than a 404 later.
for artefact in apps/api/dist/server.js apps/web/dist/index.html apps/admin/dist/index.html; do
  [ -s "${RELEASE}/${artefact}" ] || die "the build produced no ${artefact}.
  Nothing is switched: ${CURRENT} still points at the release that was serving before."
done

# ---------------------------------------------------------------------------------------------
# 4. The dump, before the migration.
#
#    The new release's copy of the script, not the running one's: a fix to the backup ships with
#    the deploy that carries it. It writes progress to stderr and the finished path to stdout.
# ---------------------------------------------------------------------------------------------
BACKUP_SCRIPT="${RELEASE}/deploy/backup-db.sh"
[ -f "$BACKUP_SCRIPT" ] || die "${BACKUP_SCRIPT} is missing from this release. It is the only
  thing standing between a forward-only migration and an unrecoverable one; the deploy stops."
# The executable bit is carried in git, but a tarball unpacked under a restrictive umask is not
# the place to discover that it was not.
[ -x "$BACKUP_SCRIPT" ] || chmod +x "$BACKUP_SCRIPT"

say "backing up the database before migrating"
BACKUP_STATUS=0
DUMP="$("$BACKUP_SCRIPT")" || BACKUP_STATUS=$?

case "$BACKUP_STATUS" in
  0) say "dump: ${DUMP}" ;;
  # 3 means the dump is complete and verified but the off-site copy is not. That is a problem for
  # tonight and not for this deploy: what the next twenty minutes might need is a file on this
  # disk, and it is there. Stopping here would leave the site on the old code because a bucket
  # was unreachable.
  3) warn "the dump was not uploaded off-site - see above. Continuing on the local copy:
  ${DUMP}" ;;
  *) die "the pre-deploy backup failed, so the migration was not run and nothing was switched.
  Fix the backup first. Migrations are forward-only (D-17) and this dump is the only way back
  across one." ;;
esac

[ -s "$DUMP" ] || die "the backup script exited ${BACKUP_STATUS} but named no readable dump.
  Nothing was migrated and nothing was switched."

# Recorded against the release, because "which dump was taken before this one migrated" is the
# question a recovery starts with, and `ls -lt` on the backups directory only answers it by
# guessing from timestamps.
printf 'dump=%s\n' "$DUMP" >>"${RELEASE}/RELEASE"

# ---------------------------------------------------------------------------------------------
# 5. Migrate.
# ---------------------------------------------------------------------------------------------
say "pnpm db:migrate"
if ! (cd "${RELEASE}/apps/api" && pnpm db:migrate); then
  die "the migration failed. Nothing was switched - the old release is still serving - but the
  database may be part-migrated: drizzle records each file in __drizzle_migrations as it lands,
  so re-running applies only what is left. If the schema is wrong rather than incomplete, the
  way back is the dump, not a down migration:
    gunzip -c ${DUMP} | mysql <database>"
fi

# ---------------------------------------------------------------------------------------------
# 6. Switch, atomically. `ln -sfn` on an existing link is unlink-then-symlink, and a request
#    arriving between the two finds no `current` at all; writing the new link under a temporary
#    name and renaming it over the old one is a single rename(2), so the path never stops
#    resolving to a complete release.
#
#    Nginx needs no reload for the static half: its `root` runs through `current` and is resolved
#    per request, so the new index.html is served the moment the rename lands. The exception is
#    `open_file_cache`, which would hold descriptors for the old release's files until its
#    inactive timer expires - if it is ever turned on in the site config, this script has to
#    reload Nginx here as well.
# ---------------------------------------------------------------------------------------------
switch_to() {
  local target="$1"
  ln -sfn "$target" "${APP_ROOT}/.current.new"
  mv -T "${APP_ROOT}/.current.new" "$CURRENT"
}

reload_pm2() {
  local config="${CURRENT}/${ECOSYSTEM_REL}"
  # `--update-env` so a changed env in the ecosystem file is picked up; without it PM2 reuses the
  # environment the process was first started with, and a rotated secret would take a full
  # `pm2 delete` to apply.
  if pm2 jlist 2>/dev/null | grep -qF "\"name\":\"${PM2_APP}\""; then
    pm2 reload "$config" --update-env
  else
    say "${PM2_APP} is not in the process list - starting it"
    pm2 start "$config" --update-env
  fi
}

# Check the ecosystem file BEFORE the symlink moves, not inside `reload_pm2`.
#
# It used to be the first line of that function, which runs one line after `switch_to`. A missing
# or renamed file therefore killed the script with `current` already pointing at the new release:
# Nginx serving the new bundles - its `root` resolves through the symlink on every request - while
# PM2 still ran the old API, with no health check and no revert. That is exactly the half-state
# this script exists to make impossible, and it was deterministic rather than a race.
[ -f "${RELEASE}/${ECOSYSTEM_REL}" ] ||
  die "no PM2 ecosystem file at ${RELEASE}/${ECOSYSTEM_REL} - refusing to switch."

say "switching current -> ${STAMP}"
switch_to "$RELEASE"

# `reload_pm2` guarded, for the same reason: `pm2 reload` exits non-zero when an app is `errored`,
# and under `set -e` a bare call would abort here - after the switch, before the health check, and
# before the revert path that prints where the dump is.
if ! reload_pm2; then
  say "pm2 reload failed - putting ${CURRENT} back"
  if [ -n "$PREVIOUS" ]; then
    switch_to "$PREVIOUS"
    reload_pm2 || say "the reload of the previous release ALSO failed - inspect \`pm2 list\` by hand"
  else
    say "there is no previous release to fall back to - this was the first deploy"
  fi
  die "deploy aborted at the reload. THE DATABASE WAS NOT ROLLED BACK; the pre-deploy dump is
  ${DUMP:-in ${APP_ROOT}/shared/backups}."
fi

# ---------------------------------------------------------------------------------------------
# 7. Prove it came up, or put it back.
#
#    /ready answers 503 rather than 200 when MySQL or Redis did not respond, so `curl -f` is the
#    whole assertion. The budget has to outlast a cluster reload: each worker gets up to 10s of
#    graceful shutdown (SHUTDOWN_TIMEOUT_MS in apps/api/src/server.ts) before the new one boots.
# ---------------------------------------------------------------------------------------------
wait_for_ready() {
  local attempt body
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    if body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
      printf '%s\n' "$body"
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

say "waiting for ${HEALTH_URL} (up to $((HEALTH_ATTEMPTS * HEALTH_DELAY))s)"
if READY="$(wait_for_ready)"; then
  say "ready: ${READY}"
else
  warn "${HEALTH_URL} did not answer 200 within $((HEALTH_ATTEMPTS * HEALTH_DELAY))s"

  if [ -z "$PREVIOUS" ]; then
    die "there is no previous release to go back to - this was the first deploy. ${CURRENT} is
  left pointing at ${STAMP} so you can read the logs:
    pm2 logs ${PM2_APP} --lines 200"
  fi

  warn "rolling back to ${PREVIOUS##*/}"
  switch_to "$PREVIOUS"
  reload_pm2

  if READY="$(wait_for_ready)"; then
    warn "rolled back, and ${PREVIOUS##*/} is serving again: ${READY}"
  else
    warn "the previous release is not answering either - this is an outage, not a bad deploy.
  Look at the dependencies before the code: /ready is 503 when MySQL or Redis is down."
  fi

  die "deploy of ${SHA} failed its health check and was rolled back.

  THE DATABASE WAS NOT ROLLED BACK. Migrations are forward-only (D-17), so ${PREVIOUS##*/} is
  now running against whatever schema step 5 produced. If that combination is broken, restore
  the pre-deploy dump:
    gunzip -c ${DUMP} | mysql <database>

  The failed release is kept at ${RELEASE} - read its logs with:
    pm2 logs ${PM2_APP} --lines 200"
fi

# Persist the process list so a reboot brings the API back. Only after a healthy deploy: saving a
# crash-looping process list is saving the outage.
pm2 save --force >/dev/null

# ---------------------------------------------------------------------------------------------
# 8. Prune. The current release and the one before it are never candidates, whatever the count
#    says - the second is what an automatic rollback needs and what rollback.sh defaults to.
# ---------------------------------------------------------------------------------------------
say "pruning to the last ${KEEP_RELEASES} releases"
mapfile -t ALL_RELEASES < <(
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    grep -E '^[0-9]{14}$' | sort
)

TOTAL=${#ALL_RELEASES[@]}
if [ "$TOTAL" -gt "$KEEP_RELEASES" ]; then
  for old in "${ALL_RELEASES[@]:0:$((TOTAL - KEEP_RELEASES))}"; do
    victim="${RELEASES}/${old}"
    # Belt and braces around an `rm -rf` that runs unattended: the name came from a 14-digit
    # match under $RELEASES, and it is still checked against the two directories that must
    # survive before anything is removed.
    [ "$victim" != "$RELEASE" ] || continue
    [ "$victim" != "$PREVIOUS" ] || continue
    say "removing ${old}"
    rm -rf -- "$victim"
  done
fi

say "deployed ${SHA} as ${STAMP}"
