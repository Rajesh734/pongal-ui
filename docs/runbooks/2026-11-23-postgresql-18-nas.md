# PostgreSQL 18 Alpine NAS Setup Runbook

Record and complete the private PostgreSQL 18 deployment on the Synology NAS and connect the Pongal application without publishing the database port.

## Objective

- Run PostgreSQL 18 Alpine in the NAS Docker network `kalanjiyam-net` with no published PostgreSQL port.
- Connect the Pongal application using its existing PostgreSQL driver and Drizzle migrations.
- Keep production and non-production databases and credentials separate.

## Prerequisites

- Synology Container Manager and SSH access to the NAS.
- PostgreSQL stack at `/volume1/docker/kalanjiyam` created using the PostgreSQL 18 `6A` Compose variant.
- The PostgreSQL stack completed through its first-start verification: `samugam` database, `samugam_app` login, PostgreSQL 18.x, `citext`, and network `kalanjiyam-net`.
- A local password manager for the generated NAS credentials. Do not put credentials in this runbook, Git, chat, or application logs.
- Application folders under `/volume1/platform/docker/{non-prod,prod}/community-site`.

## Steps

### 1. Preserve the completed database setup

The NAS database setup is recorded as completed through Step 9, using the PostgreSQL 18 `6A` Compose configuration. The stack uses `postgres:18-alpine`, stores data under `/volume1/docker/kalanjiyam/data`, and has no published port. Its internal network is `kalanjiyam-net`; the database service name is `kalanjiyam`.

The initial cleanup in the original setup is destructive. Do not repeat it after the PostgreSQL volume contains data. Do not display or paste the generated `.env` passwords.

**Verification**: On the NAS, `docker compose ps` shows `kalanjiyam` healthy and no published port. `docker exec kalanjiyam psql -U samugam_app -d samugam -c 'SELECT version();'` reports PostgreSQL 18.x.

### 2. Configure production application connectivity

The repository does not consume `DATABASE_URL`; it expects separate `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD` settings. Keep the existing `drizzle.config.js` and `drizzle/` migration directory. Do not replace them with the alternate `src/db/migrations` configuration from the original setup notes.

In `/volume1/platform/docker/prod/community-site/.env`, set non-secret connection values:

```dotenv
DB_DRIVER=postgres
DATABASE_HOST=kalanjiyam
DATABASE_PORT=5432
DATABASE_NAME=samugam
DATABASE_USER=samugam_app
APP_BASE_URL=https://<production-hostname>
GOOGLE_CLIENT_ID=<Google client ID>
```

Create `secrets/database_password` containing only the generated `samugam_app` password. Generate the dedicated QR encryption key on the NAS and store a protected recovery copy in the organizers' password manager:

```sh
openssl rand -base64 32 > secrets/qr_pass_encryption_key
```

Do not print or paste the key. Set ownership and permissions so the app container can read both files (`1000:1000`, mode `400`, consistent with the app image). Compose mounts them as `/run/secrets/database_password` and `/run/secrets/qr_pass_encryption_key`; the app receives only their `*_FILE` paths, not plaintext secret environment values. Losing the QR key makes stored encrypted pass tokens unrecoverable; rotating it requires retaining the old key until all existing passes are re-encrypted or retired.

**Verification**: `docker compose config` succeeds in the production folder. `docker inspect community-site-prod --format '{{range .Config.Env}}{{println .}}{{end}}'` shows `DB_DRIVER=postgres`, `DATABASE_HOST=kalanjiyam`, `DATABASE_PASSWORD_FILE=/run/secrets/database_password`, and `QR_PASS_ENCRYPTION_KEY_FILE=/run/secrets/qr_pass_encryption_key`, but no secret values.

### 3. Create isolated non-production database access

Do not point non-production at the production `samugam` database. On the NAS, use the existing `scripts/add-app-db.sh` helper to create a dedicated `pongal_nonprod` database and `pongal_nonprod_app` login. Store that generated password in the non-production folder's `secrets/database_password`, and set the non-production `.env` to `DATABASE_NAME=pongal_nonprod` and `DATABASE_USER=pongal_nonprod_app`.

Add `pongal_nonprod` to the PostgreSQL backup service's database list. Keep the production and non-production password files distinct. The `add-app-db.sh` output includes a connection string with the generated password; keep it in the local terminal/password manager and do not paste it into chat or documentation.

**Verification**: `docker exec kalanjiyam psql -U pongal_nonprod_app -d pongal_nonprod -c 'SELECT current_user, current_database();'` reports the non-production role/database. Attempts to create a database or connect as the app role to the maintenance database should fail.

### 4. Attach the application to the private database network

The repository Compose file attaches the app to both its default outbound network (needed for email and Cloudflare services) and the external, internal `kalanjiyam-net`. It does not publish PostgreSQL ports. Deploy the updated Compose file to each environment folder and ensure `secrets/database_password` exists before starting the app.

**Verification**: `docker inspect community-site-prod --format '{{json .NetworkSettings.Networks}}'` includes `kalanjiyam-net`. `docker port kalanjiyam` prints no mappings. The app can resolve `kalanjiyam` and pass its health check; PostgreSQL remains unreachable from LAN and public interfaces.

### 5. Apply the application schema

The app's startup sequence applies all migrations from the repository's `drizzle/` directory and seeds event configuration before accepting requests. There is no `npm run seed` command in this repository. The Drizzle schema remains `src/db/schema/index.js`; migrations must remain compatible with PGlite tests and PostgreSQL.

**Verification**: After deployment, `/healthz` returns `{"status":"ok","db":"ok"}`. The app logs indicate healthy startup without exposing passwords. Check the `drizzle.__drizzle_migrations` table using the app role to confirm migrations were applied.

### 6. Preserve and decide the fate of existing PGlite data

The app Compose file retains the existing `./data:/data` volume, but PostgreSQL mode does not read `data/pglite`. Do not delete that volume. Before replacing the currently deployed PGlite-backed production app, decide whether its survey responses and history must be exported/imported into PostgreSQL. This runbook does not perform that data migration.

**Verification**: Confirm `data/pglite` remains present in each app environment and that PostgreSQL contains the expected data before treating the cutover as complete.

### 7. Verify PostgreSQL backups and restore

The selected `6A` setup uses `prodrigestivill/postgres-backup-local:18` with daily backups and retention of 30 days, 8 weeks, and 12 months. Backups are stored under `/volume1/docker/kalanjiyam/backups`; add this folder to the NAS Hyper Backup task with client-side encryption. Include both production and non-production databases in the backup service configuration.

**Verification**: Confirm the backup container completes a backup and the expected database dump appears. Periodically restore a dump into a temporary database, verify its tables, then drop the temporary database.

## Verification

- [ ] PostgreSQL reports version 18.x and the app role owns only its assigned database.
- [ ] PostgreSQL has no published port; only containers on `kalanjiyam-net` can reach it.
- [ ] Production and non-production use separate databases, roles, and password files.
- [ ] App startup applies Drizzle migrations and `/healthz` reports the database healthy.
- [ ] Database backups are present and a restore test succeeds.
- [ ] Existing PGlite data is retained until its migration decision is resolved.

## Common Issues

| Problem | Likely Cause | Resolution |
| --- | --- | --- |
| `DATABASE_HOST` cannot be resolved | App is not attached to the external network or the service name differs | Confirm `kalanjiyam-net` exists, is external in app Compose, and the database container service name is `kalanjiyam`. |
| Password authentication fails | The app secret file does not match the selected database role | Replace the environment's `secrets/database_password` locally from the password manager and verify its owner/mode. Never paste the value into logs or chat. |
| App exits because the QR key is invalid | The QR encryption secret is missing or is not base64 for 32 bytes | Generate a new 32-byte value with `openssl rand -base64 32`, save it locally as `secrets/qr_pass_encryption_key`, set container-readable ownership/mode, then recreate the app. Existing passes require their original key. |
| Migration fails creating `citext` | The application role lacks ownership/extension privileges in its database | Confirm the database is owned by the app role and `citext` is available in the PostgreSQL image. |
| App starts against an empty database | The Compose environment uses the wrong `DATABASE_NAME` | Check the environment-specific `.env`; production uses `samugam`, non-production uses its dedicated database. |
| Compose reports an external network is missing | The database stack has not created `kalanjiyam-net` or the network name differs | Start the PostgreSQL stack and verify with `docker network inspect kalanjiyam-net`. |

## Reference Materials

- **Related documentation:** [NAS deployment](../deploy-nas.md)
- **Application database settings:** [Configuration](../../src/config.js)
- **Database migration runner:** [Database setup](../../src/db/index.js)