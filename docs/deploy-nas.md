ls -la /volume1/platform/docker/non-prod/community-site   # .env, secrets/, data/ present

# Runbook: deploy community-site on the Synology NAS

The app runs as one Docker Compose service per environment (`non-prod`, `production`) on the Synology DS920+, reachable only through the existing Cloudflare Tunnel container (`cloudflare-pranphoto`, which also serves Synology Photos). That container uses host networking, so each environment publishes its port on the NAS loopback address only (`127.0.0.1:3101` non-prod, `127.0.0.1:3100` production): the tunnel reaches it through `localhost`, LAN devices cannot. PostgreSQL 18 Alpine runs separately in `/volume1/docker/kalanjiyam`; app containers join its internal `kalanjiyam-net` with no published database port. The old `data/pglite` directory is retained until its data-migration decision is complete.

For the completed PostgreSQL installation and app connection procedure, see the [PostgreSQL 18 NAS runbook](runbooks/2026-11-23-postgresql-18-nas.md). The app uses the existing `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD_FILE` settings. Keep this repository's `drizzle.config.js` and `drizzle/` migrations; do not copy the alternate migration path from the original setup notes.

For a live outage involving an unhealthy container, Turnstile errors, unreadable secret files, or a missing `IMAGE_TAG`, use the focused [Turnstile and NAS recovery runbook](runbooks/2026-11-22-turnstile-nas-recovery.md).

How releases flow:

- **Build** (`.github/workflows/build.yml`) runs the tests on every push and pushes the image `ghcr.io/rajesh734/pongal-ui/community-site:sha-<7-char commit>` to GHCR (not for pull requests).
- **Deploy** (`.github/workflows/deploy.yml`) joins the tailnet, connects to the NAS over SSH and runs `scripts/nas-deploy.sh`: pull the image, stop the old container, copy `data/pglite` to `data/pre-deploy/<old-tag>`, start the new tag and wait for `healthy`. If it is not healthy within 2 minutes, the old tag is started again and the job fails.
  - A successful Build on `main` deploys to `non-prod` automatically.
  - `production` is deployed by hand: **Actions > Deploy > Run workflow**, environment `production`, tag `sha-xxxxxxx`.

Sections 1-6 are one-time setup. Run NAS commands over SSH as an administrator (`sudo -i`) unless the step says otherwise.

## 1. Folder layout on the NAS

```text
/volume1/platform/docker/
  non-prod/community-site/      owner: deploy user
  prod/community-site/          owner: deploy user
    compose.yaml                copied from the repository by every deploy
    .env                        APP_ENV, HOST_PORT, non-secret settings
    .deployed-tag               image tag currently running (written by deploys)
      secrets/                    owner 1000, mode 711; files mode 400
        database_password        PostgreSQL app-role password (per environment)
      edit_token_key
      qr_pass_encryption_key
      turnstile_secret
      smtp_pass
    data/                       owner 1000, mode 700
      pglite/                   retained legacy data; not used in PostgreSQL mode
      backups/                  legacy PGlite backups, if present
      pre-deploy/<tag>/         database copy taken before each deploy (newest 3 kept)
```

Use the same deploy user as your other app (it already runs `/usr/local/bin/docker` over SSH). Replace `<deploy-user>` below with its name.

```sh
for env in non-prod prod; do
  d=/volume1/platform/docker/$env/community-site
  mkdir -p "$d/secrets" "$d/data"
  chown <deploy-user> "$d"
done
```

## 2. Secret files (per environment)

Secrets never go in `.env`, `compose.yaml`, GitHub or the repository. Use different values for `non-prod` and `prod`. Type them without echoing them to the screen or to shell history:

```sh
cd /volume1/platform/docker/prod/community-site     # repeat for non-prod

# PostgreSQL app-role password (the DB stays on kalanjiyam-net)
read -rs DBP && printf '%s' "$DBP" > secrets/database_password && unset DBP

# Dedicated key for encrypting recoverable QR pass tokens. Keep a protected recovery copy.
openssl rand -base64 32 > secrets/qr_pass_encryption_key

# Random key for signing survey edit links
openssl rand -base64 48 > secrets/edit_token_key

# Turnstile secret key (Cloudflare dashboard > Turnstile > site > Settings)
read -rs TS && printf '%s' "$TS" > secrets/turnstile_secret && unset TS

# SMTP password (app password from the mail provider)
read -rs SP && printf '%s' "$SP" > secrets/smtp_pass && unset SP
# No SMTP yet? Create the file empty instead; the app treats it as not set:
# : > secrets/smtp_pass

chown -R 1000:1000 secrets data   # replace with the container's numeric UID:GID if different
chmod 700 data
chmod 711 secrets   # deploy user may resolve the paths for Compose, but not list or read them
chmod 400 secrets/*
ls -l secrets   # each file: -r-------- 1 1000 1000
```

The `1000:1000` values are examples, not a guaranteed NAS account or group name. Docker checks the numeric UID/GID used by the image. If a secret is unreadable, follow the recovery runbook to obtain the IDs with `docker exec`, then use `chown UID:GID`; do not assume `deploy:deploy` exists as a group.

If a secret file is unreadable, the container stops with `Cannot read secret file for <NAME>: <path>` and the deploy rolls back.

## 3. Non-secret settings (`.env`, per environment)

Create `.env` in each environment folder (owner `<deploy-user>`). Do not add any secret here.

```sh
APP_ENV=prod                      # non-prod in the non-prod folder; names the container community-site-<APP_ENV>
HOST_PORT=3100                    # 3101 in the non-prod folder; bound to 127.0.0.1 only
DB_DRIVER=postgres
DATABASE_HOST=kalanjiyam
DATABASE_PORT=5432
DATABASE_NAME=samugam              # production; use a separate DB for non-prod
DATABASE_USER=samugam_app          # production; use a separate role for non-prod
APP_BASE_URL=https://<public-hostname>
GOOGLE_CLIENT_ID=<Google client ID>
TURNSTILE_SITE_KEY=<public site key from Cloudflare Turnstile>
SMTP_HOST=<smtp host>
SMTP_PORT=587
SMTP_USER=<smtp user>
SMTP_FROM="Pongal 2027 <no-reply@example.org>"
CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<Access application AUD tag>
```

The production database is `samugam` with login `samugam_app`. Do not point non-production at that database. Create a separate non-prod database and role with `/volume1/docker/kalanjiyam/scripts/add-app-db.sh pongal_nonprod`, then set `DATABASE_NAME=pongal_nonprod` and `DATABASE_USER=pongal_nonprod_app` in non-prod `.env`. Store each environment's own database password in `secrets/database_password`.

Compose mounts that secret as `/run/secrets/database_password`; it passes `DATABASE_PASSWORD_FILE` to the app, not the password itself. The app expects separate `DATABASE_*` settings, not the `DATABASE_URL` shown in the original Step 10 example. Keep the existing repository Drizzle configuration and `drizzle/` migrations. Migrations run at app startup; there is no `npm run seed` command.

Leave the SMTP values empty (and `secrets/smtp_pass` empty) to run without email: guest registrations still show their access link on screen, but manual household signup and email verification are unavailable. Email is sent only when `SMTP_HOST`, `SMTP_USER`, `SMTP_FROM`, and `SMTP_PASS` are configured.

### Google sign-in setup

In Google Cloud Console, select the project that owns sign-in, configure the OAuth consent screen, and create an OAuth client ID of type **Web application**. Add the exact public origin from `APP_BASE_URL` to **Authorized JavaScript origins** (scheme, hostname, and port only). Add `<APP_BASE_URL>/api/auth/google` to **Authorized redirect URIs**. For local development with `APP_BASE_URL=http://localhost:3000`, use `http://localhost:3000` and `http://localhost:3000/api/auth/google` respectively. Add test users if the consent screen is in testing mode.

Set `GOOGLE_CLIENT_ID` in each environment's `.env` to that web client ID, then recreate the app container. Do not use a sample or dummy ID; Google rejects origins that are not registered on the client. `APP_BASE_URL` must exactly match the origin used by visitors, including HTTPS and any non-default port.

### Optional: Gmail for account and registration emails

The site can send household verification and guest registration links through a Gmail account (about 500 recipients a day; at most 3 emails per address per hour).

1. Sign in to the Gmail account that should send the emails. Turn on **2-Step Verification** (Google Account > Security > 2-Step Verification). App passwords need it.
2. Create an app password: Google Account > Security > **App passwords** (or <https://myaccount.google.com/apppasswords>). Name it `pongal-ui <environment>`. Google shows a 16-character password once.
3. On the NAS, in the environment folder, store it as the SMTP secret (spaces in the password don't matter, type it as shown):

   ```sh
   chmod 600 secrets/smtp_pass
   read -rs SP && printf '%s' "$SP" > secrets/smtp_pass && unset SP
  chmod 400 secrets/smtp_pass
  APP_UID=$(docker exec community-site-prod id -u)
  APP_GID=$(docker exec community-site-prod id -g)
  chown "$APP_UID:$APP_GID" secrets/smtp_pass
   ```

4. In `.env` set:

   ```sh
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=<the gmail address>
   SMTP_FROM="Pongal 2027 <the gmail address>"
   ```

5. Restart: `IMAGE_TAG=$(cat .deployed-tag) docker compose up -d --force-recreate`. Sign up with an email you can access and confirm the one-time verification link arrives. Guest registrations also send their private access link by email.

To try it locally first, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_FROM`, and `SMTP_PASS` in the ignored `.env` file, then restart with `npm run dev`. Never commit the app password.

If sending fails the response is still saved; the log shows `Edit-link email failed` with the SMTP response code only. To stop emails, revoke the app password in the Google Account (and empty `secrets/smtp_pass`).

### Turnstile troubleshooting

The site key (`TURNSTILE_SITE_KEY` in `.env`) and the secret (`secrets/turnstile_secret`) must come from the **same** widget: Cloudflare dashboard > Turnstile > your widget > Settings. The widget's hostnames must include the survey hostname.

| What you see | Cause | Fix |
|---|---|---|
| "For testing only. If seen, report to site owner." under the widget | `TURNSTILE_SITE_KEY` is a Cloudflare test key (`1x0000…`, `2x0000…`, `3x0000…`) | Put the real site key in `.env` |
| "Our spam check isn't set up correctly. Please contact the organizers." | Cloudflare rejected the secret (it is wrong, empty, or from another widget) | Store the secret of the same widget with `read -rs` (section 10) |
| "We couldn't reach our spam check. Please try again in a minute." | The NAS could not reach Cloudflare within 5 seconds, or Cloudflare had an error | Check the NAS internet connection; it usually clears by itself |
| "We couldn't confirm you're not a robot. Please try again." | The visitor's widget token was missing, expired or reused | Nothing to fix; the visitor submits again |

After changing either key, restart and check the log (it shows only Cloudflare error codes, never the keys):

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
IMAGE_TAG=$(cat .deployed-tag) docker compose up -d --force-recreate
docker logs community-site-prod 2>&1 | grep Turnstile    # community-site-non-prod in non-prod
```

Lines to look for: `Turnstile is using Cloudflare test keys` (replace the keys), `Turnstile rejected the secret key (invalid-input-secret)` (wrong secret), `Turnstile verification unreachable` (network), `Turnstile is not configured` (a key is missing). No output means the keys are set and accepted so far.

### Upgrading a folder from the Docker-network setup

Earlier versions joined the app to the cloudflared Docker network. If an environment folder was set up that way, the next deploy fails with `required variable HOST_PORT is missing a value`. Before deploying:

1. In that folder's `.env`, add `HOST_PORT` (`3101` non-prod, `3100` prod) and delete the `CLOUDFLARE_NETWORK=` line.
2. Check the file: `IMAGE_TAG=check docker compose config -q` in the folder prints nothing.
3. Point the environment's Tunnel public hostname to `http://localhost:<HOST_PORT>` (see [Cloudflare Tunnel routes](#cloudflare-tunnel-routes)).
4. Re-run the failed Deploy run in GitHub Actions.

## 4. Deploy access: SSH key, host key and GHCR login

On your laptop, create a key used only by this repository's deploys:

```sh
ssh-keygen -t ed25519 -N "" -C "pongal-ui deploy" -f ~/.ssh/pongal-ui-deploy
```

Add `~/.ssh/pongal-ui-deploy.pub` as a new line in `~<deploy-user>/.ssh/authorized_keys` on the NAS (folder mode 700, file mode 600, home folder not group-writable).

From a device on the tailnet, record the NAS host key and check its fingerprint against the NAS (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the NAS):

```sh
ssh-keyscan -p <ssh-port> <nas-tailnet-name> > nas_known_hosts
ssh-keygen -lf nas_known_hosts
ssh -i ~/.ssh/pongal-ui-deploy -p <ssh-port> <deploy-user>@<nas-tailnet-name> /usr/local/bin/docker ps
```

Let the NAS pull the private image. On GitHub create a **classic** personal access token with only `read:packages` (Settings > Developer settings > Personal access tokens > Tokens (classic)). Then, **as `<deploy-user>`** on the NAS:

```sh
read -rs T && printf '%s' "$T" | /usr/local/bin/docker login ghcr.io -u rajesh734 --password-stdin && unset T
```

## 5. Tailscale: let GitHub Actions reach the NAS SSH port only

In the Tailscale admin console > **Access controls**, add a tag for CI machines and a rule that lets it reach only the NAS SSH port (keep your existing rules):

```jsonc
"tagOwners": {
  "tag:ci": ["autogroup:admin"]
},
"hosts": {
  "nas": "<NAS tailnet IP, 100.x.y.z>"
},
"acls": [
  // ...existing rules...
  {"action": "accept", "src": ["tag:ci"], "dst": ["nas:<ssh-port>"]}
]
```

If your policy still has the default allow-all rule (`"src": ["*"], "dst": ["*:*"]`), `tag:ci` can reach everything; narrow that rule to `autogroup:member` so the CI tag only gets the rule above.

Then **Settings > OAuth clients** (called *Trust credentials* in newer consoles) > **Generate**: scope **Auth Keys: Write**, tag `tag:ci`. Copy the client ID and secret for the next step. CI machines join as ephemeral nodes and disappear after each run.

## 6. GitHub Environments and secrets

In the repository: **Settings > Environments**:

1. Create `non-prod`.
2. Create `production`: add yourself under **Required reviewers**, and under **Deployment branches** allow only `main`.

Add these secrets to **both** environments:

| Secret | Value |
|---|---|
| `NAS_HOST` | NAS tailnet name, exactly as used in `ssh-keyscan` |
| `NAS_PORT` | NAS SSH port |
| `NAS_USER` | `<deploy-user>` |
| `NAS_SSH_KEY` | contents of `~/.ssh/pongal-ui-deploy` (private key) |
| `NAS_KNOWN_HOSTS` | contents of `nas_known_hosts` |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret |

Delete the local `nas_known_hosts` file afterwards. Keep the private key only in GitHub (and your password manager if you want a copy).

### Cloudflare Tunnel routes

In Cloudflare Zero Trust > Networks > Tunnels > (the `cloudflare-pranphoto` tunnel) > Public Hostname, add one per environment. Existing routes for Synology Photos stay as they are.

| Public hostname | Service |
|---|---|
| non-prod hostname | `HTTP` `localhost:3101` |
| production hostname | `HTTP` `localhost:3100` |

### First deploy and checks

Push to `main` (or run **Deploy** by hand for `non-prod` with the `sha-` tag from the Build summary). Then:

```sh
curl https://<hostname>/healthz          # {"status":"ok","db":"ok"}
curl -i https://<hostname>/weather       # 404 page
curl --max-time 5 http://<nas-ip>:3101/healthz   # from another LAN device: must fail to connect
curl http://localhost:3101/healthz              # on the NAS itself: {"status":"ok","db":"ok"}
```

On the NAS, check that no secret appears in the container settings (only `*_FILE` paths for `DATABASE_PASSWORD`, `QR_PASS_ENCRYPTION_KEY`, `EDIT_TOKEN_KEY`, `TURNSTILE_SECRET` and `SMTP_PASS`):

```sh
docker inspect community-site-prod --format '{{range .Config.Env}}{{println .}}{{end}}'
```

## 7. Off-NAS backups with Hyper Backup

PostgreSQL backups are written by the `kalanjiyam-backup` service to `/volume1/docker/kalanjiyam/backups`; the selected Step 6A configuration schedules daily dumps and retains 30 days, 8 weeks, and 12 months. Back up this folder with Hyper Backup. The app's old `data/pglite` directory is retained legacy data and is not the active database after PostgreSQL cutover.

1. Hyper Backup > Create > Data backup task > choose the destination (cloud or USB).
2. Source: `docker/kalanjiyam/backups` (includes both databases in the stack's backup list).
3. Enable **client-side encryption** and store the encryption password in the organizers' password manager.
4. Schedule after the database's daily dump. Rotation: keep at least 30 versions.

Verify the backup container logs report completed database dumps and periodically restore a dump to a temporary database as described in the [PostgreSQL 18 NAS runbook](runbooks/2026-11-23-postgresql-18-nas.md). Do not use the old PGlite tar commands for PostgreSQL.

## 8. Roll back a deploy

A deploy that does not become healthy rolls the app image back, but it does not roll PostgreSQL schema or data back. The portal migrations are additive; deploy the previous image only when it remains compatible with the applied schema. To go back from a healthy but wrong release, run **Actions > Deploy > Run workflow** with the previous tag (shown in the summary of the earlier Deploy run).

The deploy script still copies `data/pglite` when present; this is only a legacy PGlite safety copy and does not back up PostgreSQL. If PostgreSQL data needs recovery, use a verified dump from `/volume1/docker/kalanjiyam/backups`. Restore to a temporary database first and validate it before changing the live database; do not overwrite `samugam` or `pongal_nonprod` based only on a failed app deploy.

## 9. Restore from a nightly backup

The PostgreSQL 18 backup service produces database dumps under `/volume1/docker/kalanjiyam/backups`. Test a restore into a temporary database first:

```sh
docker exec -it kalanjiyam psql -U postgres -c "CREATE DATABASE restore_test OWNER samugam_app;"
gunzip -c /volume1/docker/kalanjiyam/backups/last/samugam-latest.sql.gz | docker exec -i kalanjiyam psql -U postgres -d restore_test
docker exec -it kalanjiyam psql -U postgres -d restore_test -c '\dt'
docker exec -it kalanjiyam psql -U postgres -c "DROP DATABASE restore_test;"
```

The legacy PGlite tar files, if any, are separate from these PostgreSQL dumps. Do not remove `data/pglite` until the data-migration decision is complete.

## 10. Rotate a secret

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
chmod 600 secrets/smtp_pass
read -rs SP && printf '%s' "$SP" > secrets/smtp_pass && unset SP
chmod 400 secrets/smtp_pass
APP_UID=$(docker exec community-site-prod id -u)
APP_GID=$(docker exec community-site-prod id -g)
chown "$APP_UID:$APP_GID" secrets/smtp_pass
export IMAGE_TAG=$(cat .deployed-tag)
docker compose up -d --force-recreate
```

Rotating `edit_token_key` invalidates every edit link already sent to families. Do it only if the key leaked.

Rotate the GitHub-side access secrets (SSH key, Tailscale OAuth client) by creating the new one, updating the GitHub Environment secret, running a deploy, then deleting the old one.

## 11. Remove a survey response

Until the admin pages exist, an organizer can remove one family's response (for example a test entry). It is a soft delete: the response and its history stay in the database, and the family's edit link stops working.

The database allows only one process at a time, so stop the site first (a few seconds of downtime; the Tunnel shows an error page meanwhile):

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
export IMAGE_TAG=$(cat .deployed-tag)
docker compose stop community-site
docker compose run --rm community-site npm run survey:remove -- pongal-2027 <email>
docker compose start community-site
```

It prints `Removed response <id> from 'pongal-2027'.`, or `No active response for that email` if there is nothing to remove. Never run it with `docker compose exec` while the site is running.

## 12. Stop

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
IMAGE_TAG=$(cat .deployed-tag) docker compose down
```

Data stays in `data/`. Nothing else on the NAS changes.
