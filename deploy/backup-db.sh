#!/usr/bin/env bash
#
# Dump the production database, compress it, verify it, keep fourteen days of them locally and
# put a copy somewhere the machine is not.
#
# The failure this exists to prevent is the backup that is not one. There are four ways to get
# that, and each has a line in this file arguing with it:
#
#   * `mysqldump | gzip` without `pipefail` exits 0 when mysqldump dies half way, because gzip
#     succeeded at compressing the truncated half. The file looks fine until the restore.
#   * a dump written straight to its final name is indistinguishable, in `ls`, from a complete
#     one. This writes `.part` and renames only after the dump has been read back.
#   * a password on the command line is readable by every user on the box for as long as the
#     dump runs - `ps auxww` prints it. Credentials are read from shared/.env into a 0600
#     defaults file instead, and that file is removed on any exit.
#   * a copy that only exists on the machine whose disk you are afraid of losing is not an
#     off-site backup. The upload is not optional without saying so explicitly.
#
#   backup-db.sh                  dump, verify, rotate, upload
#   backup-db.sh --no-upload      local only - for an ad-hoc dump before running SQL by hand
#
# deploy.sh runs it before every migration, and it is safe to run from cron as the deploy user -
# the fourteen-day rotation below only means anything if something takes a dump every night:
#
#   17 3 * * *  /srv/silkgrain/current/deploy/backup-db.sh
#
# Progress goes to stderr; the path of the finished dump is the only thing on stdout, so a caller
# can capture it. deploy.sh does exactly that.
#
# Exit codes, because deploy.sh treats two of them differently:
#
#   0   the dump is complete, verified and uploaded
#   3   the dump is complete and verified, the upload failed. The path is still on stdout: a
#       deploy that is about to migrate has what it needs to go back, so this does not stop it.
#   1   no usable dump. Nothing that depends on one may continue.

set -euo pipefail

APP_ROOT=/srv/silkgrain
SHARED="${APP_ROOT}/shared"
ENV_FILE="${SHARED}/.env"
BACKUPS="${SHARED}/backups"

RETENTION_DAYS=14
# Where the copies land in the bucket. Kept in one place so a lifecycle rule can be written
# against the prefix rather than against the whole bucket.
S3_PREFIX=database

UPLOAD=yes
for arg in "$@"; do
  case "$arg" in
    --no-upload) UPLOAD=no ;;
    *)
      printf 'usage: backup-db.sh [--no-upload]\n' >&2
      exit 2
      ;;
  esac
done

say() { printf '==> [%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '!!  [%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  printf '\nFAILED: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -ne 0 ] || die "run as the deploy user, not root - the dumps must stay owned by
  deploy, or the next rotation cannot remove them."

[ -f "$ENV_FILE" ] || die "${ENV_FILE} does not exist."
for tool in mysqldump gzip find; do
  command -v "$tool" >/dev/null 2>&1 || die "\`${tool}\` is not on PATH. mysqldump comes from
  the mysql-client package; it must be the 8.0 client, since an older one cannot read some of
  what an 8.0 server will hand it."
done

mkdir -p "$BACKUPS"

# ---------------------------------------------------------------------------------------------
# Reading .env.
#
# Deliberately not `source`: that would execute the file, and a `$` or a backtick in a password
# is a shell expansion rather than a character. This reads one key at a time, takes the last
# assignment (the same rule dotenv follows), and unwraps quotes the way dotenv does.
# ---------------------------------------------------------------------------------------------
env_value() {
  local key="$1" line value
  # `|| true`, because `pipefail` makes a grep that matched nothing fail the whole pipeline, and
  # a key that is simply absent is an answer rather than an error - the caller decides.
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  value="${line#*=}"

  case "$value" in
    \"*\")
      value="${value#\"}"
      value="${value%\"}"
      ;;
    \'*\')
      value="${value#\'}"
      value="${value%\'}"
      ;;
    *)
      # An unquoted value ends at an inline comment, and then at its own trailing whitespace.
      value="${value%%[[:space:]]#*}"
      value="${value%"${value##*[![:space:]]}"}"
      ;;
  esac

  printf '%s' "$value"
}

# Percent-decoding, because a URL is where these credentials live and a password with a `/`, `@`
# or `:` in it has to be encoded there. A literal backslash must be encoded too - `%b` would
# otherwise read it as an escape - which a URL requires anyway.
urldecode() { printf '%b' "${1//%/\\x}"; }

# my.cnf is not shell, but it does have its own quoting: inside double quotes a backslash escapes,
# and outside them a `#` starts a comment. Both are characters a generated password can contain.
escape_cnf() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

DATABASE_URL="$(env_value DATABASE_URL)"
[ -n "$DATABASE_URL" ] || die "DATABASE_URL is not set in ${ENV_FILE}."

case "$DATABASE_URL" in
  mysql://*) ;;
  *) die "DATABASE_URL is not a mysql:// URL: it starts \"${DATABASE_URL%%:*}\"." ;;
esac

# Split on the LAST `@` rather than the first: a password containing an unencoded `@` is invalid
# in a URL and turns up anyway, and splitting on the first one would silently take half of it as
# the username and the rest as a hostname.
REST="${DATABASE_URL#mysql://}"
CREDENTIALS="${REST%@*}"
LOCATION="${REST##*@}"

case "$CREDENTIALS" in
  *:*)
    DB_USER="$(urldecode "${CREDENTIALS%%:*}")"
    DB_PASSWORD="$(urldecode "${CREDENTIALS#*:}")"
    ;;
  *)
    DB_USER="$(urldecode "$CREDENTIALS")"
    DB_PASSWORD=""
    ;;
esac

HOSTPORT="${LOCATION%%/*}"
DB_NAME="${LOCATION#*/}"
DB_NAME="${DB_NAME%%\?*}"
case "$HOSTPORT" in
  *:*)
    DB_HOST="${HOSTPORT%%:*}"
    DB_PORT="${HOSTPORT##*:}"
    ;;
  *)
    DB_HOST="$HOSTPORT"
    DB_PORT=3306
    ;;
esac

[ -n "$DB_NAME" ] || die "DATABASE_URL names no database: ${DATABASE_URL%%:*}://...@${HOSTPORT}/"
[ -n "$DB_USER" ] || die "DATABASE_URL carries no username."

# ---------------------------------------------------------------------------------------------
# The credentials file. 0600 by umask before it exists rather than chmod after, so there is no
# instant at which it is readable; removed by the trap on every exit path, including a failure
# inside mysqldump.
# ---------------------------------------------------------------------------------------------
OLD_UMASK="$(umask)"
umask 077
DEFAULTS_FILE="$(mktemp "${TMPDIR:-/tmp}/silkgrain-backup.XXXXXXXX")"
umask "$OLD_UMASK"
trap 'rm -f "$DEFAULTS_FILE"' EXIT

{
  printf '[client]\n'
  printf 'user="%s"\n' "$(escape_cnf "$DB_USER")"
  printf 'password="%s"\n' "$(escape_cnf "$DB_PASSWORD")"
  printf 'host="%s"\n' "$(escape_cnf "$DB_HOST")"
  printf 'port=%s\n' "$DB_PORT"
} >"$DEFAULTS_FILE"

# ---------------------------------------------------------------------------------------------
# The dump.
# ---------------------------------------------------------------------------------------------
STAMP="$(date -u +%Y%m%d%H%M%S)"
TARGET="${BACKUPS}/${DB_NAME}-${STAMP}.sql.gz"
PARTIAL="${TARGET}.part"

say "dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT} as ${DB_USER}"

# --single-transaction: one consistent snapshot across every table, taken in a REPEATABLE READ
#   transaction, with no lock on anything. Every table in this schema is InnoDB, which is what
#   makes that true; a MyISAM table added later would silently fall outside the snapshot.
#   It is also why the dump can be taken while the shop is taking orders.
# --quick: stream rows rather than buffering a table in memory. `orders` and `audit_log` are the
#   two that grow without bound.
# --no-tablespaces: dumping tablespace info needs the PROCESS privilege, which is global and
#   which the application's own user has no business holding. Without this flag an unprivileged
#   backup fails with "Access denied; you need (at least one of) the PROCESS privilege(s)".
# --set-gtid-purged=OFF: keeps a SET @@GLOBAL.GTID_PURGED out of the file. Restoring one of those
#   into a server that has ever written a transaction fails, and the restore is the moment you
#   least want to be editing a 200 MB SQL file.
# --routines --triggers: the schema has neither today. They are dumped anyway, so that anything
#   added by hand later is in the backup rather than discovered missing during a restore.
# No --databases and no --add-drop-database, deliberately: the file restores into whatever
#   database it is pointed at, so the first restore can go into `silkgrain_restore` and be read
#   before anybody overwrites the live one.
#
# `pipefail` is what makes this honest. Without it, mysqldump dying mid-table still leaves gzip
# exiting 0 and a plausible-looking file on disk.
if ! mysqldump \
  --defaults-extra-file="$DEFAULTS_FILE" \
  --single-transaction \
  --quick \
  --no-tablespaces \
  --set-gtid-purged=OFF \
  --routines \
  --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -6 >"$PARTIAL"; then
  rm -f "$PARTIAL"
  die "mysqldump failed. Nothing was written; the error above is the server's own."
fi

# ---------------------------------------------------------------------------------------------
# Verification. A backup nobody has read back is a hypothesis.
# ---------------------------------------------------------------------------------------------
gzip -t "$PARTIAL" || {
  rm -f "$PARTIAL"
  die "the gzip stream is corrupt. Suspect the disk before the database: df -h ${SHARED}"
}

# mysqldump writes this line last and only after the last row. It is the one cheap check that
# distinguishes a complete dump from a truncated one that happens to gunzip cleanly.
LAST_LINE="$(gzip -dc "$PARTIAL" | tail -n 1)"
case "$LAST_LINE" in
  "-- Dump completed"*) ;;
  *)
    rm -f "$PARTIAL"
    die "the dump does not end with mysqldump's completion marker, so it is truncated.
  Last line was: ${LAST_LINE}"
    ;;
esac

mv -- "$PARTIAL" "$TARGET"
SIZE="$(stat -c '%s' "$TARGET")"
say "wrote ${TARGET} ($((SIZE / 1024)) KiB)"

# ---------------------------------------------------------------------------------------------
# Rotation. Local only: nothing here deletes a remote object, because a rotation bug that can
# reach the off-site copies can delete every backup there has ever been. Expire the S3 prefix
# with a bucket lifecycle rule instead - it is the provider's job and it cannot be given the
# wrong argument at 3am.
# ---------------------------------------------------------------------------------------------
say "removing local dumps older than ${RETENTION_DAYS} days"
find "$BACKUPS" -maxdepth 1 -type f -name '*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete >&2
# A `.part` left behind is a dump that died before this script could clean up after it - a day
# is long enough that one belonging to a running backup is never caught.
find "$BACKUPS" -maxdepth 1 -type f -name '*.sql.gz.part' -mtime +1 -print -delete >&2

# ---------------------------------------------------------------------------------------------
# Off-site.
#
# BACKUP_S3_BUCKET is a separate variable from S3_BUCKET and MUST name a different bucket. The
# application opens S3_BUCKET for anonymous s3:GetObject at first use - product images are public
# by definition, and apps/api/src/modules/media/storage.service.ts writes that policy itself. A
# database dump in that bucket is the whole shop, customers and password hashes included, on a
# URL anybody can guess. This check is the only thing standing between those two facts.
# ---------------------------------------------------------------------------------------------
if [ "$UPLOAD" = no ]; then
  warn "--no-upload: ${TARGET} exists only on this machine"
  printf '%s\n' "$TARGET"
  exit 0
fi

BUCKET="$(env_value BACKUP_S3_BUCKET)"
MEDIA_BUCKET="$(env_value S3_BUCKET)"

if [ -z "$BUCKET" ]; then
  warn "BACKUP_S3_BUCKET is not set in ${ENV_FILE}, so ${TARGET} is on the same disk as the
  database it was taken from. Set it to a PRIVATE bucket - not S3_BUCKET, which the API opens
  for anonymous reads - or pass --no-upload to say the local copy is what you meant."
  printf '%s\n' "$TARGET"
  exit 3
fi

if [ "$BUCKET" = "$MEDIA_BUCKET" ]; then
  die "BACKUP_S3_BUCKET is ${BUCKET}, which is also S3_BUCKET. The API puts a public-read policy
  on that bucket for product images, so this would publish the database. Use another bucket."
fi

if ! command -v aws >/dev/null 2>&1; then
  warn "the aws CLI is not installed, so ${TARGET} was not uploaded.
  Install it, or pass --no-upload if a local dump is genuinely what you want. NOT from apt:
  Ubuntu 24.04 dropped the awscli package from the archive, so that install cannot succeed.
    curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
    unzip -q /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install
  It lands in /usr/local/bin, which is why the cron entry in DEPLOY.md sets PATH."
  printf '%s\n' "$TARGET"
  exit 3
fi

# Credentials default to the application's, because on a one-VPS deployment there is one S3
# account. They are separable so that the day the backups move to a different provider - or to a
# key that can write but not read, which is worth doing - it is a change to .env and not to this
# file.
ENDPOINT="$(env_value BACKUP_S3_ENDPOINT)"
[ -n "$ENDPOINT" ] || ENDPOINT="$(env_value S3_ENDPOINT)"
REGION="$(env_value BACKUP_S3_REGION)"
[ -n "$REGION" ] || REGION="$(env_value S3_REGION)"
ACCESS_KEY="$(env_value BACKUP_S3_ACCESS_KEY_ID)"
[ -n "$ACCESS_KEY" ] || ACCESS_KEY="$(env_value S3_ACCESS_KEY_ID)"
SECRET_KEY="$(env_value BACKUP_S3_SECRET_ACCESS_KEY)"
[ -n "$SECRET_KEY" ] || SECRET_KEY="$(env_value S3_SECRET_ACCESS_KEY)"

if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ] || [ -z "$ENDPOINT" ]; then
  warn "S3 credentials or endpoint are missing from ${ENV_FILE}; ${TARGET} was not uploaded."
  printf '%s\n' "$TARGET"
  exit 3
fi

# Exported into the aws CLI's environment rather than written to ~/.aws/credentials: one fewer
# copy of a secret on disk, and nothing to forget to remove.
export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
export AWS_DEFAULT_REGION="${REGION:-us-east-1}"
export AWS_EC2_METADATA_DISABLED=true

KEY="${S3_PREFIX}/$(basename "$TARGET")"
say "uploading to ${BUCKET}/${KEY}"

if ! aws s3 cp --only-show-errors --endpoint-url "$ENDPOINT" "$TARGET" "s3://${BUCKET}/${KEY}" >&2; then
  warn "the upload failed. ${TARGET} is on this machine and nowhere else."
  printf '%s\n' "$TARGET"
  exit 3
fi

# The upload command exiting 0 says the request was accepted, not that the bytes are there. One
# HEAD is cheap and turns "it seemed to work" into a number that either matches or does not.
REMOTE_SIZE="$(
  aws s3api head-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" --key "$KEY" \
    --query ContentLength --output text 2>/dev/null || printf 'unknown'
)"
if [ "$REMOTE_SIZE" != "$SIZE" ]; then
  warn "the object in ${BUCKET} reports ${REMOTE_SIZE} bytes and the local dump is ${SIZE}.
  Treat the remote copy as unusable until that is explained."
  printf '%s\n' "$TARGET"
  exit 3
fi

say "uploaded ${SIZE} bytes to s3://${BUCKET}/${KEY}"
printf '%s\n' "$TARGET"
