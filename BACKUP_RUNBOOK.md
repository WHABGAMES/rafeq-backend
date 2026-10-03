# Rafeq Platform Backup Runbook — v2

## Protection layers

1. DigitalOcean Managed PostgreSQL provides daily backups and point-in-time recovery for the previous seven days.
2. The application creates a daily independent logical dump in a private S3-compatible bucket.
3. Independent dumps stream directly through AES-256-GCM encryption (no plaintext dump on disk), use multipart upload, and are verified after upload by size, SHA-256 metadata, and encryption-key fingerprint.

The independent copy includes the complete PostgreSQL database. It therefore includes conversations, messages, reports, accounts, settings, audit records, and future tables without maintaining a manual allowlist.

Runtime environment secrets are intentionally not copied into the database dump. Source code is protected by GitHub and ephemeral Redis data (OTP codes, rate-limit counters, short-lived cache/session state) is intentionally rebuilt after recovery. Disaster recovery therefore also requires a separately controlled inventory of DigitalOcean environment-variable names and independently escrowed secret values; never place those values in this repository or the administration UI.

## Required production configuration

- `BACKUP_ENABLED=true`
- `BACKUP_RETENTION_DAYS=30` (accepted range: 7–365)
- `BACKUP_ENCRYPTION_KEY`: exactly 64 hexadecimal characters generated from a cryptographically secure source
- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_REGION`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_ACCESS_KEY`
- `BACKUP_S3_SECRET_KEY`

The bucket must be private. Its credentials should be restricted to the backup prefix and only allow put, head, and delete operations. Keep a sealed copy of every historical `BACKUP_ENCRYPTION_KEY` outside DigitalOcean; a backup without the matching key is intentionally unrecoverable. The administration page records a non-secret 16-character key fingerprint for each backup so operators can select the correct historical key after rotation.

## Normal operation

- A scheduled job is queued daily at 02:00 UTC. If no recent completed copy exists, additional recovery windows run at 03:00 and 06:00 UTC.
- The database guarantees that only one job can be pending/running.
- A worker atomically claims the oldest pending job.
- A running worker writes a heartbeat every 30 seconds. Only a job whose heartbeat has been stale for 15 minutes is returned to the queue at application startup, preventing duplicate work during long dumps.
- Expired objects are removed according to the configured retention period; their metadata remains as `expired` for auditability.
- Owners can request a manual backup from `/super-admin/backups`; the operation requires a 2FA-verified admin session.

## Recovery procedure

Never restore an external dump directly over the production primary.

1. Freeze writes or record the incident time and choose the required recovery point.
2. Prefer DigitalOcean point-in-time recovery when the required point is within seven days.
3. For an independent backup, retrieve the object and its recorded SHA-256 value.
4. Verify SHA-256 before decryption.
5. Match the backup's key fingerprint to the separately stored historical encryption key, then decrypt and authenticate it:

   ```bash
   BACKUP_ENCRYPTION_KEY=<64-hex-key> npm run backup:decrypt -- \
     --input backup.pgdump.enc \
     --output backup.pgdump \
     --sha256 <digest-from-admin-page>
   ```

   The tool verifies SHA-256, the `RFBACK01` header, and the AES-GCM authentication tag. It deletes partial output on any failure.
6. Restore the custom-format dump with `pg_restore` into a newly created isolated PostgreSQL database.
7. Run migrations only if the restored application version requires them.
8. Validate row counts and sample conversations, reports, users, stores, and audit records. Run application health and authentication tests against the isolated database.
9. Obtain owner approval, then switch the application connection to the recovered database.
10. Keep the previous database read-only until the recovery is accepted.

## Recovery drill

At least quarterly, restore the latest independent backup to a temporary database and record:

- backup ID and timestamp;
- checksum verification;
- restore start/end time;
- schema and row-count checks;
- application smoke-test result;
- reviewer and cleanup confirmation.

A backup is not considered proven until a recovery drill succeeds.
