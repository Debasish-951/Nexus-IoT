#!/usr/bin/env bash
# Nightly backup of one Integrated Suite installation: database + uploads,
# encrypted, checked, optionally copied off the VM, and reported to the app so
# Data Management > Backups shows it and alerts when backups stop.
#
# Install as /usr/local/bin/nexus-backup (mode 755) and run it from the systemd
# timer in docs/operations/backup-restore.md. Reporting needs one grant, once:
#
#   GRANT INSERT ON backup_runs TO nexus_backup;
#
# Settings (edit here or set in the service's Environment=):
DB_HOST="${DB_HOST:-<host>}"
DB_NAME="${DB_NAME:-<dbname>}"
DB_USER="${DB_USER:-nexus_backup}"
UPLOADS="${UPLOADS:-/opt/nexus-iot/artifacts/api-server/var/uploads}"   # or your UPLOAD_DIR
DEST="${DEST:-/var/backups/nexus}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# Optional: a command that copies one file off the VM, e.g.
#   OFFSITE_CMD='rclone copy "$1" remote:nexus-backups/'
OFFSITE_CMD="${OFFSITE_CMD:-}"

set -u -o pipefail   # a failed pg_dump must fail the pipe, not only gpg
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PASS="$DEST/.backup-passphrase"
export PGPASSFILE="$DEST/.pgpass"
umask 077

STATUS=ok
MESSAGE="Backup $STAMP completed"
UPLOADS_OK=false
VERIFIED=false
OFFSITE=false
DBFILE="$DEST/db-$STAMP.dump.gpg"
UPFILE="$DEST/uploads-$STAMP.tar.gz.gpg"

fail() { STATUS=failed; MESSAGE="$1"; echo "$1" >&2; }

# Database, in PostgreSQL's custom format (compressed, restorable table by table).
if ! pg_dump --host "$DB_HOST" --username "$DB_USER" --format custom --no-owner --no-privileges "$DB_NAME" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASS" -o "$DBFILE"; then
  fail "Database dump failed"
fi

# Uploaded files.
if [ "$STATUS" = ok ]; then
  if tar -C "$(dirname "$UPLOADS")" -czf - "$(basename "$UPLOADS")" \
    | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASS" -o "$UPFILE"; then
    UPLOADS_OK=true
  else
    fail "Uploads archive failed"
  fi
fi

# Check the database file can be read back before deleting older backups.
if [ "$STATUS" = ok ]; then
  if gpg --batch --quiet --decrypt --passphrase-file "$PASS" "$DBFILE" | pg_restore --list > /dev/null; then
    VERIFIED=true
  else
    fail "The new database backup could not be read back"
  fi
fi

# Audit log chain head (seq, hash and its MAC), kept beside the backup and off the
# database. A later "Verify integrity" must still find this entry unchanged: a head
# that went backwards or changed means entries were removed or rewritten
# (docs/features/audit-log.md). Not fatal: older installs lack audit_checkpoints.
ANCHORFILE="$DEST/audit-anchor-$STAMP.txt"
if [ "$STATUS" = ok ]; then
  psql --host "$DB_HOST" --username "$DB_USER" --dbname "$DB_NAME" --quiet --no-psqlrc --tuples-only --no-align \
    -c "SELECT 'head', seq, hash, hash_alg FROM activity_logs WHERE hash IS NOT NULL AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1" \
    -c "SELECT 'anchor', seq, hash, mac, created_at FROM audit_checkpoints WHERE kind = 'anchor' ORDER BY id DESC LIMIT 1" \
    > "$ANCHORFILE" 2>/dev/null || echo "Could not record the audit log chain head" >&2
fi

# Copy off the VM.
if [ "$STATUS" = ok ] && [ -n "$OFFSITE_CMD" ]; then
  if sh -c "$OFFSITE_CMD" _ "$DBFILE" && sh -c "$OFFSITE_CMD" _ "$UPFILE"; then
    OFFSITE=true
  else
    MESSAGE="$MESSAGE; copy off the VM failed"
  fi
fi

if [ "$STATUS" = ok ]; then
  find "$DEST" -name '*.gpg' -mtime +"$KEEP_DAYS" -delete
fi

SIZE=0
for f in "$DBFILE" "$UPFILE"; do
  [ -f "$f" ] && SIZE=$((SIZE + $(stat -c %s "$f")))
done

# Report to the app. Values are passed as psql variables, never pasted into SQL.
psql --host "$DB_HOST" --username "$DB_USER" --dbname "$DB_NAME" --quiet --no-psqlrc \
  -v started="$STARTED" -v status="$STATUS" -v size="$SIZE" -v location="$DEST" \
  -v uploads="$UPLOADS_OK" -v verified="$VERIFIED" -v offsite="$OFFSITE" -v host="$(hostname)" -v message="$MESSAGE" \
  -c "INSERT INTO backup_runs (started_at, finished_at, status, size_bytes, location, includes_uploads, verified, offsite, host, message)
      VALUES (:'started', now(), :'status', :'size', :'location', :'uploads', :'verified', :'offsite', :'host', :'message')" \
  || echo "Could not report the backup to the app (is INSERT on backup_runs granted?)" >&2

echo "$MESSAGE"
[ "$STATUS" = ok ]
