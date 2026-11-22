# Turnstile and NAS Deployment Recovery Runbook

Recover the Pongal survey when the NAS container is unhealthy, the site returns Cloudflare 502, Turnstile reports an invalid site key, or form submission reports that the spam check is not configured.

## Objective

- Restore the `community-site-non-prod` container on the Synology NAS.
- Configure the Cloudflare Turnstile site key and secret from the same widget.
- Ensure the container user can read the mounted secret without making it world-readable.
- Verify the public survey can submit and return a private edit link.

## Prerequisites

- SSH access to the Synology NAS with permission to use `sudo`.
- The Cloudflare Turnstile widget site key and secret.
- The deployment directory:

  ```text
  /volume1/platform/docker/non-prod/community-site
  ```

- The image tag recorded in `.deployed-tag`.
- Never paste a Turnstile secret into chat, Git, `.env`, or `docker-compose` configuration.

## Steps

### 1. Confirm the failure

```sh
cd /volume1/platform/docker/non-prod/community-site

sudo docker inspect community-site-non-prod \
  --format 'status={{.State.Status}} health={{.State.Health.Status}} exit={{.State.ExitCode}}'

sudo docker logs --tail 100 community-site-non-prod
```

A restarting container with `health=unhealthy` and `exit=1` indicates a startup failure. The most useful log messages are `Cannot read secret file`, `Turnstile rejected the secret key`, or `IMAGE_TAG` missing.

**Verification**: The output identifies whether the failure is startup, permissions, configuration, or image-related.

### 2. Configure the public site key

In Cloudflare Dashboard, open **Turnstile**, select the widget, and add this exact hostname to its allowed hostnames:

```text
pongal.pranphoto.win
```

Use the widget's **Site Key** in the NAS `.env` file. Do not use the secret key as the site key, and do not include `https://` or a path.

```sh
sudo vi .env
```

The setting should look like this:

```dotenv
TURNSTILE_SITE_KEY=<public site key>
```

The site key and secret must belong to the same widget. For local `localhost` testing, use Cloudflare test keys or a widget that allows `localhost`.

**Verification**: The public page renders the Turnstile widget without `invalid sitekey`.

### 3. Store the server secret

Copy the **Secret Key** from the same Cloudflare widget. Store only the value in the host file; do not add `TURNSTILE_SECRET=`.

The host file is:

```text
/volume1/platform/docker/non-prod/community-site/secrets/turnstile_secret
```

Use a hidden-input prompt so the value is not displayed or saved in shell history:

```sh
read -rs TURNSTILE_SECRET
printf '%s' "$TURNSTILE_SECRET" \
  | sudo tee secrets/turnstile_secret >/dev/null
unset TURNSTILE_SECRET
```

Compose mounts this file in the container as:

```text
/run/secrets/turnstile_secret
```

**Verification**: Check only that the file exists and is non-empty; never print its contents:

```sh
sudo test -s secrets/turnstile_secret \
  && echo 'Turnstile secret exists and is non-empty'
```

### 4. Recover from a secret permission failure

The container runs as a non-root application user. Docker file access uses the container's numeric UID/GID, not necessarily the NAS group name `deploy`.

If the container is restarting and cannot be inspected, temporarily make the file readable to confirm the diagnosis:

```sh
sudo chmod 444 secrets/turnstile_secret
```

Start it using the recorded image tag. Put the variables after `sudo env`; otherwise `sudo` may drop them:

```sh
TAG=$(sudo cat .deployed-tag)

sudo env IMAGE_TAG="$TAG" APP_ENV=non-prod HOST_PORT=3101 \
  docker compose up -d --force-recreate
```

Once the container is running, get its actual IDs:

```sh
APP_UID=$(sudo docker exec community-site-non-prod id -u)
APP_GID=$(sudo docker exec community-site-non-prod id -g)

echo "container UID=$APP_UID GID=$APP_GID"
```

Assign those numeric IDs to the host secret and restore least-privilege permissions:

```sh
sudo chown "$APP_UID:$APP_GID" secrets/turnstile_secret
sudo chmod 400 secrets/turnstile_secret
```

Recreate the container again:

```sh
sudo env IMAGE_TAG="$TAG" APP_ENV=non-prod HOST_PORT=3101 \
  docker compose up -d --force-recreate
```

Do not leave the secret at mode `444`. Do not assume `deploy:deploy` is a valid group; numeric ownership is the reliable fix.

**Verification**: The container remains running after the permission is changed to `400`.

### 5. Verify the deployment

```sh
sudo docker inspect community-site-non-prod \
  --format 'status={{.State.Status}} health={{.State.Health.Status}} exit={{.State.ExitCode}}'

sudo docker exec community-site-non-prod \
  test -r /run/secrets/turnstile_secret

curl -i http://localhost:3101/healthz
```

Expected results include `status=running`, `health=healthy`, a successful secret-read check, and an HTTP `200` health response.

**Verification**: Open `https://pongal.pranphoto.win/s/pongal-2027`, complete Turnstile, submit the survey, and confirm that a private edit link is returned.

## Verification

- [ ] The Turnstile widget uses the real site key for the widget that includes `pongal.pranphoto.win`.
- [ ] The secret file contains only the matching widget secret.
- [ ] The secret file is mode `400` and owned by the container's numeric UID/GID.
- [ ] `community-site-non-prod` is running and healthy.
- [ ] `http://localhost:3101/healthz` returns HTTP `200` on the NAS.
- [ ] The public form submits and returns a private edit link.

## Common Issues

| Problem | Likely Cause | Resolution |
| --- | --- | --- |
| `IMAGE_TAG` missing | `sudo` dropped the shell variable | Use `sudo env IMAGE_TAG="$TAG" APP_ENV=non-prod HOST_PORT=3101 docker compose ...` |
| `Cannot read secret file for TURNSTILE_SECRET` | The file is missing or unreadable by the container UID | Temporarily use mode `444`, obtain the container UID/GID, then `chown UID:GID` and restore mode `400` |
| `invalid sitekey` | A secret was used as the site key, or the site key is stale/incorrect | Put the public Site Key in `.env` and add `pongal.pranphoto.win` to the widget hostnames |
| `Our spam check isn't set up correctly` | Cloudflare rejected the server secret, usually `invalid-input-secret` | Replace the host secret with the Secret Key from the same widget as the site key |
| `deploy:deploy` is an invalid group | The NAS has no group named `deploy` | Use numeric container UID/GID ownership instead |
| Cloudflare returns `502 Bad Gateway` | The origin container is restarting or not listening | Check container logs, fix startup/permissions, then verify `/healthz` locally on the NAS |
| Widget says `For testing only` | A Cloudflare test site key is deployed | Replace it with the production Site Key for the intended widget |

## Reference Materials

- **Related documentation:** [NAS deployment guide](../deploy-nas.md)
- **Cloudflare Turnstile:** Cloudflare Dashboard > Turnstile > widget > Settings
- **Compose configuration:** [compose.yaml](../../compose.yaml)
