ls -la /volume1/platform/docker/non-prod/community-site   # .env, secrets/, data/ present # Runbook: deploy community-site on the Synology NAS

The app runs as one Docker Compose service per environment (`non-prod`, `production`) on the Synology DS920+, reachable only through the existing Cloudflare Tunnel container (`cloudflare-pranphoto`, which also serves Synology Photos). That container uses host networking, so each environment publishes its port on the NAS loopback address only (`127.0.0.1:3101` non-prod, `127.0.0.1:3100` production): the tunnel reaches it through `localhost`, LAN devices cannot. Data lives in an embedded PGlite database in `data/pglite`, with nightly backups in `data/backups`.

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
      edit_token_key
      turnstile_secret
      smtp_pass
    data/                       owner 1000, mode 700
      pglite/                   live database (created by the app)
      backups/                  nightly pglite-YYYY-MM-DD.tar.gz (newest 14 kept)
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

# Random key for signing survey edit links
openssl rand -base64 48 > secrets/edit_token_key

# Turnstile secret key (Cloudflare dashboard > Turnstile > site > Settings)
read -rs TS && printf '%s' "$TS" > secrets/turnstile_secret && unset TS

# SMTP password (app password from the mail provider)
read -rs SP && printf '%s' "$SP" > secrets/smtp_pass && unset SP
# No SMTP yet? Create the file empty instead; the app treats it as not set:
# : > secrets/smtp_pass

chown -R 1000:1000 secrets data
chmod 700 data
chmod 711 secrets   # deploy user may resolve the paths for Compose, but not list or read them
chmod 400 secrets/*
ls -l secrets   # each file: -r-------- 1 1000 1000
```

If a secret file is unreadable, the container stops with `Cannot read secret file for <NAME>: <path>` and the deploy rolls back.

## 3. Non-secret settings (`.env`, per environment)

Create `.env` in each environment folder (owner `<deploy-user>`). Do not add any secret here.

```sh
APP_ENV=prod                      # non-prod in the non-prod folder; names the container community-site-<APP_ENV>
HOST_PORT=3100                    # 3101 in the non-prod folder; bound to 127.0.0.1 only
TURNSTILE_SITE_KEY=<public site key from Cloudflare Turnstile>
SMTP_HOST=<smtp host>
SMTP_PORT=587
SMTP_USER=<smtp user>
SMTP_FROM="Pongal 2027 <no-reply@example.org>"
CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<Access application AUD tag>
```

Leave the four `SMTP_*` values empty (and `secrets/smtp_pass` empty) to run without email: families still see their edit link on screen. Email is only sent when all four values and the password are set.

### Optional: Gmail for edit-link emails

The site can email each family its edit link through a Gmail account (about 500 recipients a day; at most 3 emails per address per hour).

1. Sign in to the Gmail account that should send the emails. Turn on **2-Step Verification** (Google Account > Security > 2-Step Verification). App passwords need it.
2. Create an app password: Google Account > Security > **App passwords** (or <https://myaccount.google.com/apppasswords>). Name it `pongal-ui <environment>`. Google shows a 16-character password once.
3. On the NAS, in the environment folder, store it as the SMTP secret (spaces in the password don't matter, type it as shown):

   ```sh
   chmod 600 secrets/smtp_pass
   read -rs SP && printf '%s' "$SP" > secrets/smtp_pass && unset SP
   chmod 400 secrets/smtp_pass && chown 1000:1000 secrets/smtp_pass
   ```

4. In `.env` set:

   ```sh
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=<the gmail address>
   SMTP_FROM="Pongal 2027 <the gmail address>"
   ```

5. Restart: `IMAGE_TAG=$(cat .deployed-tag) docker compose up -d --force-recreate`. Submit the survey once with your own email and check the message "Your Pongal 2027 survey link" arrives and the confirmation page says "We've also emailed this link to ...".

To try it locally first: `SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=... SMTP_FROM=... SMTP_PASS_FILE=<file with the app password> DB_DRIVER=pglite EDIT_TOKEN_KEY=dev npm start`, then submit at `http://localhost:3000/s/pongal-2027`.

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

On the NAS, check that no secret appears in the container settings (only `*_FILE` paths for `EDIT_TOKEN_KEY`, `TURNSTILE_SECRET` and `SMTP_PASS`):

```sh
docker inspect community-site-prod --format '{{range .Config.Env}}{{println .}}{{end}}'
```

## 7. Off-NAS backups with Hyper Backup

The app writes a consistent snapshot to `data/backups` every night at 02:00 (event time). Back up **that folder only**, never the live `data/pglite` folder.

1. Hyper Backup > Create > Data backup task > choose the destination (cloud or USB).
2. Source: `platform/docker/prod/community-site/data/backups` (add the `non-prod` one too if its data matters).
3. Enable **client-side encryption** and store the encryption password in the organizers' password manager.
4. Schedule: daily at 03:00. Rotation: keep at least 30 versions.

## 8. Roll back a deploy

A deploy that does not become healthy rolls itself back. To go back from a healthy but wrong release, run **Actions > Deploy > Run workflow** with the previous tag (shown in the summary of the earlier Deploy run).

If the bad release changed the database, restore the copy the deploy made just before it started:

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
IMAGE_TAG=$(cat .deployed-tag) docker compose down
ls data/pre-deploy                                   # one folder per previous tag, newest 3 kept
mv data/pglite data/pglite.broken-$(date +%Y%m%d%H%M)
cp -a data/pre-deploy/<previous-tag> data/pglite
```

Then run Deploy with `<previous-tag>`. Data written between that deploy and now is lost, so check the timestamps first.

## 9. Restore from a nightly backup

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
export IMAGE_TAG=$(cat .deployed-tag)
docker compose down
mv data/pglite data/pglite.broken-$(date +%Y%m%d%H%M)
mkdir data/pglite
tar -xzf data/backups/pglite-YYYY-MM-DD.tar.gz -C data/pglite
chown -R 1000:1000 data/pglite
docker compose up -d
docker inspect -f '{{.State.Health.Status}}' community-site-prod   # healthy after ~30 s
```

Remove the `pglite.broken-*` folder only after checking the restored data.

## 10. Rotate a secret

```sh
cd /volume1/platform/docker/prod/community-site     # or non-prod
chmod 600 secrets/smtp_pass
read -rs SP && printf '%s' "$SP" > secrets/smtp_pass && unset SP
chmod 400 secrets/smtp_pass && chown 1000:1000 secrets/smtp_pass
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
