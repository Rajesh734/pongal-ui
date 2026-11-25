# Environment and Secrets

Source of truth: `src/config.js` (Zod). Startup fails with a clear message if a required setting is missing or invalid. Any setting `NAME` can instead be supplied as `NAME_FILE` (path to a file whose trimmed contents are the value; an empty file counts as not set). Secrets are never logged: the startup summary prints `[set]` or `[not set]`.

| Variable | Required | Secret | Default / format | Purpose |
|---|---|---|---|---|
| `PORT` | no | no | 3000; integer 1-65535 | HTTP listen port |
| `NODE_ENV` | no | no | `development` \| `production` \| `test` (default `development`) | Enables `Secure` cookies and production checks |
| `APP_BASE_URL` | no | no | http(s) URL | Absolute links in emails and origin checks |
| `DB_DRIVER` | yes | no | `pglite` \| `postgres` | Selects the database driver |
| `PGLITE_DATA_DIR` | no | no | directory path | Persistent PGlite data (in-memory when unset) |
| `DATABASE_HOST` | if `postgres` | no | text | PostgreSQL host |
| `DATABASE_PORT` | no | no | 5432 | PostgreSQL port |
| `DATABASE_NAME` | if `postgres` | no | text | Database name |
| `DATABASE_USER` | if `postgres` | no | text | Database user |
| `DATABASE_PASSWORD` | if `postgres` | yes | text | Database password |
| `BACKUP_DIR` | no | no | directory path | PGlite backups only |
| `EDIT_TOKEN_KEY` | yes | yes | any non-empty text | Key for survey edit-link tokens |
| `QR_PASS_ENCRYPTION_KEY` | production only | yes | base64 of exactly 32 bytes (`openssl rand -base64 32`) | AES-256-GCM key for entry-pass tokens |
| `TURNSTILE_SITE_KEY` | no | no | text | Cloudflare Turnstile widget key; widget is omitted when unset |
| `TURNSTILE_SECRET` | no | yes | text | Turnstile server verification |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`, `SMTP_PASS` | no | `SMTP_PASS` only | port 1-65535, default 587 | Email is enabled only when host, user, password and from are set; the port is optional |
| `GOOGLE_CLIENT_ID` | no | no | text | Google sign-in; button hidden when unset |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | production admin | no | text | Verify the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) for `/admin` |
| `ADMIN_DEV_EMAIL` | no | no | email; only when `NODE_ENV=development` | Opens `/admin` on localhost without Access |

## Validation rules
- `DB_DRIVER=postgres` requires host, name, user and password.
- `NODE_ENV=production` requires `QR_PASS_ENCRYPTION_KEY`.
- `ADMIN_DEV_EMAIL` outside development is a startup error.
- Port values must be whole numbers 1-65535; URLs must use http or https.

## Docker Compose secrets
File-based secrets live in `secrets/` (template in `secrets.example/`): `database_password`, `edit_token_key`, `qr_pass_encryption_key`, `smtp_pass`, `turnstile_secret`. Compose mounts each and sets the matching `*_FILE` variable.

## Fixed site constants
`src/core/site.js`: site name "Eastcoast Tamil Community", location "New Hampshire, USA". Logo is `src/public/img/logo.svg` (preferred) or `logo.png`, used in both header ends (26x56) and as the apple-touch icon.

## Local development example
```
PORT=3131 APP_BASE_URL=http://localhost:3131 NODE_ENV=development \
DB_DRIVER=pglite PGLITE_DATA_DIR=./data/pglite-local \
EDIT_TOKEN_KEY=<any text> QR_PASS_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
ADMIN_DEV_EMAIL=dev@example.com node src/server.js
```
The Turnstile values above are Cloudflare's public always-pass test keys.
