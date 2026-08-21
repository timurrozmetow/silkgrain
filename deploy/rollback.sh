#!/usr/bin/env bash
#
# Point `current` back at an earlier release and reload PM2.
#
# The failure this exists to prevent is the rollback that looks like it worked. Putting the code
# back is thirty seconds of symlink and reload; the database does not come with it. Migrations in
# this repository are forward-only (decision D-17) - there are no `down` files, deliberately,
# because a hand-written `down` is the one piece of SQL nobody tests until the night it is needed.
# So a rollback across a schema change leaves old code reading a schema it was never written for,
# and the symptoms are silent: a column that no longer exists, an enum that grew a value, a NOT
# NULL that arrived after the release you just went back to.
#
# This script therefore does two things beyond the symlink. It compares the drizzle journal of the
# release it is leaving with the journal of the release it is going to, and REFUSES if they differ.
# And it says, every single time, in its own output, that the database was not rolled back.
#
#   rollback.sh                             go back to the release before the current one
#   rollback.sh 20260821113045              go back to a named release
#   rollback.sh --list                      show what is available
#   rollback.sh <release> --i-have-restored-the-database
#                                           proceed across a migration difference, which is only
#                                           true if you have actually restored the pre-deploy dump
#
# Run as `deploy`, never as root.

set -euo pipefail

# ---------------------------------------------------------------------------------------------
# The topology. Repeated in deploy.sh and backup-db.sh rather than sourced: during an incident,
# each of these three has to work on its own, without a fourth file being present and correct.
# ---------------------------------------------------------------------------------------------
APP_ROOT=/srv/silkgrain
RELEASES="${APP_ROOT}/releases"
SHARED="${APP_ROOT}/shared"
CURRENT="${APP_ROOT}/current"
LOCK_FILE="${SHARED}/deploy.lock"

PM2_APP=silkgrain-api
# At the repository root, not under deploy/ - task 9.1 put it there because PM2 reads it
# from the release root and because `ecosystem.config.js` would be parsed as ESM.
ECOSYSTEM_REL=ecosystem.config.cjs

HEALTH_URL=http://127.0.0.1:3001/ready
HEALTH_ATTEMPTS=30
HEALTH_DELAY=2

JOURNAL_REL=apps/api/drizzle/meta/_journal.json

# ---------------------------------------------------------------------------------------------

say() { printf '==> [%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '!!  [%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  printf '\nREFUSED: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: rollback.sh [<release>] [--i-have-restored-the-database]
       rollback.sh --list

  <release>   a directory name under /srv/silkgrain/releases, e.g. 20260821113045.
              Defaults to the release immediately before the current one.

This does NOT roll the database back. See the header of this file.
USAGE
  exit 2
}

TARGET_NAME=""
FORCED=no
for arg in "$@"; do
  case "$arg" in
    --list) LIST=yes ;;
    --i-have-restored-the-database) FORCED=yes ;;
    -*) usage ;;
    *)
      [ -z "$TARGET_NAME" ] || usage
      TARGET_NAME="$arg"
      ;;
  esac
done

[ "$(id -u)" -ne 0 ] || die "run as the deploy user, not root."

list_releases() {
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null |
    grep -E '^[0-9]{14}$' | sort
}

release_line() {
  local name="$1" marker=" "
  [ "${RELEASES}/${name}" = "${CURRENT_RELEASE:-}" ] && marker="*"
  local sha="unknown" subject=""
  if [ -f "${RELEASES}/${name}/RELEASE" ]; then
    sha="$(sed -n 's/^sha=//p' "${RELEASES}/${name}/RELEASE")"
    subject="$(sed -n 's/^subject=//p' "${RELEASES}/${name}/RELEASE")"
  fi
  printf '  %s %s  %s  %s\n' "$marker" "$name" "${sha:0:8}" "$subject"
}

CURRENT_RELEASE=""
if [ -L "$CURRENT" ]; then
  CURRENT_RELEASE="$(readlink -f "$CURRENT")"
fi

mapfile -t AVAILABLE < <(list_releases)

if [ "${LIST:-no}" = yes ]; then
  printf 'releases under %s (* = current):\n' "$RELEASES"
  for name in "${AVAILABLE[@]}"; do release_line "$name"; done
  exit 0
fi

[ -n "$CURRENT_RELEASE" ] || die "${CURRENT} is not a symlink, so there is nothing to roll back
  from. Deploy instead: deploy.sh <ref>"

# ---------------------------------------------------------------------------------------------
# The same lock deploy.sh takes. Rolling back while a deploy is mid-build would have the two of
# them writing the symlink in whatever order they finished in.
# ---------------------------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || die "a deploy or another rollback holds ${LOCK_FILE}."

# ---------------------------------------------------------------------------------------------
# Which release.
# ---------------------------------------------------------------------------------------------
if [ -z "$TARGET_NAME" ]; then
  PREVIOUS=""
  FOUND_CURRENT=no
  for name in "${AVAILABLE[@]}"; do
    if [ "${RELEASES}/${name}" = "$CURRENT_RELEASE" ]; then
      FOUND_CURRENT=yes
      break
    fi
    PREVIOUS="$name"
  done

  # Without this, the loop above would fall off the end with PREVIOUS holding the NEWEST release
  # and this script would cheerfully "roll back" onto it.
  [ "$FOUND_CURRENT" = yes ] || die "${CURRENT} points at ${CURRENT_RELEASE}, which is not one of
  the timestamped directories under ${RELEASES}. Name the release you want explicitly."

  [ -n "$PREVIOUS" ] || die "no release older than ${CURRENT_RELEASE##*/} is kept. Deploys prune
  to the last 5, so if this is the only one left the way back is a deploy of the older ref."
  TARGET_NAME="$PREVIOUS"
fi

# A release name is fourteen digits and nothing else. Checked rather than assumed, because the
# name is pasted straight into the paths below and `rollback.sh ../../something` should be a
# refusal rather than an interesting experiment.
case "$TARGET_NAME" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) die "\`${TARGET_NAME}\` is not a release name. They are UTC timestamps, fourteen digits:
  \`rollback.sh --list\`" ;;
esac

TARGET="${RELEASES}/${TARGET_NAME}"
[ -d "$TARGET" ] || die "${TARGET} does not exist. \`rollback.sh --list\` shows what is kept."
[ "$TARGET" != "$CURRENT_RELEASE" ] || die "${TARGET_NAME} is already the current release."

# A pruned-but-not-quite release, or one whose build was interrupted, is worse than no rollback:
# it would switch the symlink onto a directory Nginx serves nothing from.
for artefact in apps/api/dist/server.js apps/web/dist/index.html apps/admin/dist/index.html; do
  [ -s "${TARGET}/${artefact}" ] || die "${TARGET_NAME} has no ${artefact} - it was never built,
  or a prune caught it half way. Pick another release from \`rollback.sh --list\`."
done

# ---------------------------------------------------------------------------------------------
# The schema question, answered before anything moves.
#
# The journal is drizzle's own list of what has been applied, and it ships inside each release, so
# comparing the two files answers "does the code I am going back to know about the migrations that
# have run" without querying anything. It cannot answer whether the data is still shaped the way
# the old code expects - only the dump can - which is why the banner prints either way.
# ---------------------------------------------------------------------------------------------
# Checked here rather than inside the helper: a `die` from inside `<(...)` below would kill only
# the subshell, `comm` would read an empty list, and the two journals would be reported as
# identical - a silent pass on exactly the question this section exists to ask.
for release in "$CURRENT_RELEASE" "$TARGET"; do
  [ -f "${release}/${JOURNAL_REL}" ] || die "${release##*/} has no ${JOURNAL_REL}. Without it
  there is no way to tell whether this rollback crosses a migration, and guessing is what this
  check exists to prevent."
done

journal_tags() {
  grep -o '"tag"[[:space:]]*:[[:space:]]*"[^"]*"' "${1}/${JOURNAL_REL}" |
    sed 's/.*"\([^"]*\)"$/\1/' | sort
}

AHEAD="$(comm -13 <(journal_tags "$TARGET") <(journal_tags "$CURRENT_RELEASE"))"
BEHIND="$(comm -23 <(journal_tags "$TARGET") <(journal_tags "$CURRENT_RELEASE"))"

if [ -n "$AHEAD" ] || [ -n "$BEHIND" ]; then
  {
    printf '\n'
    printf 'The migration journals differ.\n\n'
    if [ -n "$AHEAD" ]; then
      printf '  applied by %s and unknown to %s:\n' "${CURRENT_RELEASE##*/}" "$TARGET_NAME"
      printf '%s\n' "$AHEAD" | sed 's/^/      /'
    fi
    if [ -n "$BEHIND" ]; then
      printf '  known to %s and not to %s (you are rolling FORWARD, check the argument):\n' \
        "$TARGET_NAME" "${CURRENT_RELEASE##*/}"
      printf '%s\n' "$BEHIND" | sed 's/^/      /'
    fi
    printf '\n'
  } >&2

  if [ "$FORCED" != yes ]; then
    die "this rollback crosses a schema change and the database does not roll back with it.

  Migrations are forward-only (D-17). The way back across one is the dump taken by deploy.sh
  immediately before the migration ran:

    ls -lt ${SHARED}/backups | head
    pm2 stop ${PM2_APP}
    gunzip -c ${SHARED}/backups/<dump>.sql.gz | mysql <database>
    ${0} ${TARGET_NAME} --i-have-restored-the-database

  If you are certain the change was additive and the old code is unaffected by it, the same flag
  is how you say so - but read the migration first, not this paragraph."
  fi

  warn "proceeding across a schema change because --i-have-restored-the-database was passed"
fi

# ---------------------------------------------------------------------------------------------
# Move.
# ---------------------------------------------------------------------------------------------
switch_to() {
  local target="$1"
  # A single rename(2), so `current` never briefly does not exist. See deploy.sh.
  ln -sfn "$target" "${APP_ROOT}/.current.new"
  mv -T "${APP_ROOT}/.current.new" "$CURRENT"
}

reload_pm2() {
  local config="${CURRENT}/${ECOSYSTEM_REL}"
  [ -f "$config" ] || die "no PM2 ecosystem file at ${config}."
  if pm2 jlist 2>/dev/null | grep -qF "\"name\":\"${PM2_APP}\""; then
    pm2 reload "$config" --update-env
  else
    pm2 start "$config" --update-env
  fi
}

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

LEAVING="${CURRENT_RELEASE##*/}"
say "rolling back ${LEAVING} -> ${TARGET_NAME}"
switch_to "$TARGET"
reload_pm2

say "waiting for ${HEALTH_URL} (up to $((HEALTH_ATTEMPTS * HEALTH_DELAY))s)"
if READY="$(wait_for_ready)"; then
  say "ready: ${READY}"
else
  warn "${TARGET_NAME} is not answering /ready either.

  It is left in place rather than switched back - going back and forth between two releases that
  both fail is how an incident gets longer. Read the logs, and remember /ready is 503 when MySQL
  or Redis is down, which is not a code problem at all:
    pm2 logs ${PM2_APP} --lines 200"
fi

# Persisted so a reboot brings back the release that is actually serving, not the one that was
# saved by the deploy this rollback just undid.
pm2 save --force >/dev/null

cat <<BANNER

  Rolled back to ${TARGET_NAME}. THE DATABASE WAS NOT ROLLED BACK.

  Migrations are forward-only (D-17): whatever schema ${LEAVING} left behind is the schema
  ${TARGET_NAME} is now running against. If that turns out to be wrong, the pre-deploy dumps are
  in ${SHARED}/backups and the newest one is the one taken before the last migration ran.

BANNER
