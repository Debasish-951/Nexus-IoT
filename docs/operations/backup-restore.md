# Backup and Restore

This is the procedure for backing up and restoring one installation running on a VM, as described in [vm-deployment-checklist.md](vm-deployment-checklist.md). Each company has its own installation (see [new-company-installation.md](new-company-installation.md)), so each one needs its own backups.

> **Status:** the commands below follow standard PostgreSQL and Linux tooling, but this procedure has not yet been run end to end on a production VM. Run the restore test in section 5 once before relying on it.

## 1. What must be backed up

A working restore needs all three of these. Missing any one of them loses data.

| Item | Where it is | Why it matters |
|---|---|---|
| PostgreSQL database | The database in `DATABASE_URL` | Users, assets, templates, dashboards, alarm rules, API clients, telemetry, alarms, audit logs |
| Uploaded files | `UPLOAD_DIR`, or `/opt/nexus-iot/artifacts/api-server/var/uploads` if it is not set | Media Library files and attachments. They are not stored in the database. |
| Encryption key | `SECRETS_ENC_KEY` (or the file named by `SECRETS_ENC_KEY_FILE`) in `/opt/nexus-iot/.env` | Broker passwords, destination credentials and ingest URL tokens are encrypted with it. Without the same key, a restored database cannot decrypt them, and every broker, destination and ingest URL must be set up again. |

Also keep a copy of `/opt/nexus-iot/.env` and the nginx site file, so the server can be rebuilt with the same settings.

**Store the encryption key separately from the backups**, for example in the company password manager. A backup and the key together give full access to every stored credential.

## 2. Nightly backup

### 2.1 Create the backup user and folder

```bash
sudo useradd --system --home /var/backups/nexus --shell /usr/sbin/nologin nexus-backup
sudo install -d -o nexus-backup -g nexus-backup -m 700 /var/backups/nexus
```

Give the backup user read access to the uploads folder (for example by adding it to the `nexus` group, if the folder is group-readable) and a PostgreSQL login that may read every table. A dedicated read-only role is best:

```sql
CREATE ROLE nexus_backup LOGIN PASSWORD '<strong password>';
GRANT CONNECT ON DATABASE <dbname> TO nexus_backup;
GRANT USAGE ON SCHEMA public TO nexus_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nexus_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO nexus_backup;
```

Put its connection details in `/var/backups/nexus/.pgpass` (mode 600, owned by `nexus-backup`):

```
<host>:5432:<dbname>:nexus_backup:<strong password>
```

### 2.2 Create an encryption passphrase for the backups

Backups contain personal data and password hashes, so they are encrypted with `gpg` before they leave the folder.

```bash
sudo -u nexus-backup sh -c 'umask 077; openssl rand -base64 48 > /var/backups/nexus/.backup-passphrase'
```

Copy this passphrase into the password manager too. Without it, the backups cannot be opened.

### 2.3 The backup script

The repository ships a ready script, `scripts/ops/nexus-backup.sh`. It does what the script below does, and also copies the files off the VM when `OFFSITE_CMD` is set and reports every run to the app, so Data Management → Archives & backups shows the status and raises an alert when backups stop or fail. Install it instead of the script below:

```bash
sudo install -m 755 /opt/nexus-iot/scripts/ops/nexus-backup.sh /usr/local/bin/nexus-backup
# set DB_HOST, DB_NAME, UPLOADS, DEST (and optionally OFFSITE_CMD) at the top of the file
```

Allow it to report, once, as the database owner:

```sql
GRANT INSERT ON backup_runs TO nexus_backup;
```

The minimal version, without reporting, for reference. Create `/usr/local/bin/nexus-backup` (mode 755):

```bash
#!/bin/sh
# Nightly backup of one Nexus-IoT installation: database + uploads, encrypted.
set -eu

DB_HOST="<host>"
DB_NAME="<dbname>"
UPLOADS="/opt/nexus-iot/artifacts/api-server/var/uploads"   # or your UPLOAD_DIR
DEST="/var/backups/nexus"
KEEP_DAYS=14
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PASS="$DEST/.backup-passphrase"
export PGPASSFILE="$DEST/.pgpass"
umask 077

# Database, in PostgreSQL's custom format (compressed, restorable table by table).
pg_dump --host "$DB_HOST" --username nexus_backup --format custom --no-owner --no-privileges \
  "$DB_NAME" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASS" \
  -o "$DEST/db-$STAMP.dump.gpg"

# Uploaded files.
tar -C "$(dirname "$UPLOADS")" -czf - "$(basename "$UPLOADS")" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASS" \
  -o "$DEST/uploads-$STAMP.tar.gz.gpg"

# Check the database file can be read back before deleting older backups.
gpg --batch --quiet --decrypt --passphrase-file "$PASS" "$DEST/db-$STAMP.dump.gpg" \
  | pg_restore --list > /dev/null

find "$DEST" -name '*.gpg' -mtime +"$KEEP_DAYS" -delete
echo "Backup $STAMP completed"
```

### 2.4 Run it every night

`/etc/systemd/system/nexus-backup.service`:

```ini
[Unit]
Description=Nexus IoT nightly backup

[Service]
Type=oneshot
User=nexus-backup
ExecStart=/usr/local/bin/nexus-backup
```

`/etc/systemd/system/nexus-backup.timer`:

```ini
[Unit]
Description=Run the Nexus IoT backup every night

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nexus-backup.timer
sudo systemctl start nexus-backup.service   # run once now
journalctl -u nexus-backup -n 20             # should end with "Backup ... completed"
```

### 2.5 Copy backups off the VM

A backup on the same VM is lost with the VM. Copy `/var/backups/nexus/*.gpg` to separate storage every day (another server, object storage, or the company backup system), using whatever your organisation already runs. Keep at least 30 days off the VM.

## 3. Before every upgrade or schema change

Schema changes are applied with `pnpm --filter @workspace/db run push`, which changes the live database directly. Take a backup first:

```bash
sudo systemctl start nexus-backup.service
journalctl -u nexus-backup -n 5
```

Then run `push` and read its proposed changes before accepting. Never run `push-force` on a live database.

## 4. Restore

Use this to recover from data loss or to move an installation to a new VM.

1. **Stop the API**, so nothing writes during the restore:
   ```bash
   sudo systemctl stop nexus-api
   ```
2. **Put back the encryption key.** Set the same `SECRETS_ENC_KEY` (or key file) in `/opt/nexus-iot/.env` that the backed-up installation used.
3. **Decrypt the backup files** (on the VM, into a private folder):
   ```bash
   umask 077; mkdir -p /tmp/nexus-restore && cd /tmp/nexus-restore
   gpg --decrypt -o db.dump  /var/backups/nexus/db-<STAMP>.dump.gpg
   gpg --decrypt -o uploads.tar.gz /var/backups/nexus/uploads-<STAMP>.tar.gz.gpg
   ```
4. **Restore the database into an empty database.** Do this before running `push`: restoring into tables that `push` already created causes conflicts.
   ```bash
   # As a PostgreSQL administrator. Only when replacing a broken database:
   dropdb --host <host> <dbname>
   createdb --host <host> --owner <app role> <dbname>
   pg_restore --host <host> --dbname <dbname> --no-owner --role <app role> db.dump
   ```
5. **Bring the schema up to date** with the code you are running:
   ```bash
   cd /opt/nexus-iot && pnpm --filter @workspace/db run push
   ```
6. **Restore uploaded files:**
   ```bash
   sudo tar -C /opt/nexus-iot/artifacts/api-server/var -xzf uploads.tar.gz   # or the parent of your UPLOAD_DIR
   sudo chown -R nexus:nexus /opt/nexus-iot/artifacts/api-server/var/uploads
   ```
7. **Start the API and check it:**
   ```bash
   sudo systemctl start nexus-api
   journalctl -u nexus-api -n 50
   ```
   Then sign in, open a dashboard, open an image in the Media Library, and confirm a gateway's readings arrive.
8. **Delete the decrypted files:**
   ```bash
   rm -rf /tmp/nexus-restore
   ```

If the API log reports that broker or destination credentials cannot be decrypted, the key from step 2 does not match the backup. Find the right key, or re-enter those credentials in the app.

## 5. Test the restore every quarter

A backup that has never been restored is not known to work. Every three months, and after any change to this procedure:

1. Restore the latest backup into a separate database on a test machine (steps 3 to 6, using a different database name).
2. Start an API against it with a different port and check sign-in, a dashboard and a Media Library file.
3. Record the date, the backup used, the time it took and any problems.
4. Drop the test database and delete the decrypted files.

## 6. Retention of backups

Backups keep data that was deleted from the live system, including personal data of removed users. Keep them only as long as your recovery needs and data-protection obligations require, and delete older copies from off-VM storage as well. The script above keeps 14 days on the VM.
