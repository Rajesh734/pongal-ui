# Tasks: platform-foundation

## 1. Repository setup

- [x] 1.1 Commit `openspec/` and `.agents/` to `main` as the initial commit, then create branch `feature/pongal-2027-survey`; verify `git branch --show-current` prints it (all three changes land on this branch)
- [x] 1.2 Replace `.github/workflows/ci.yml` with the Build workflow (see 8.3); verify only `build.yml` and `deploy.yml` remain in `.github/workflows/`
- [x] 1.3 Create `.nvmrc` with `20` and `.gitignore` with `node_modules/`, `.env`, `secrets/`, `data/`; verify `git check-ignore secrets/x data/x .env` lists all three

## 2. Project skeleton

- [x] 2.1 Write new `package.json` (`"type": "module"`, `engines.node >=20`, scripts `start`, `dev`, `test`, `db:generate`) and install runtime deps (fastify, @fastify/view, eta, @fastify/static, @fastify/formbody, @fastify/helmet, @fastify/rate-limit, @electric-sql/pglite, pg, drizzle-orm, zod, yaml) and dev deps (vitest, drizzle-kit); verify `npm ci` succeeds and run a Trivy dependency scan with no new high/critical findings
- [x] 2.2 Create the folder layout from design D2 with placeholder `index` files; verify `node --check src/server.js` passes
- [x] 2.3 Add `.env.example` with dummy values for every setting in design D3, `DB_DRIVER=pglite`, and Cloudflare's public Turnstile test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`); verify no real secret is present by searching the diff for "secret" values other than placeholders

## 3. Configuration and secrets

- [x] 3.1 Implement `src/config.js` with `NAME`/`NAME_FILE` resolution (file wins, trimmed) and Zod validation for the settings in design D3
- [x] 3.2 Add unit tests in `test/config.test.js` for scenarios "Secret read from file", "File value wins over plain variable", "Secret file missing", "Missing required secret", "Invalid port"; verify `npx vitest run test/config.test.js` passes
- [x] 3.3 Log effective config with secrets masked as `[set]`/`[not set]`; add test for scenario "Startup log" asserting the secret value is absent from captured log output; verify it passes

## 4. Server core

- [x] 4.1 Implement `src/server.js` `buildApp(config)` registering helmet (CSP `script-src 'self' https://challenges.cloudflare.com`, no `unsafe-eval`, `frameguard: deny`, `referrerPolicy: no-referrer`), formbody, static, Eta views, and `X-Robots-Tag: noindex, nofollow`; verify the app starts with `npm run dev`
- [x] 4.2 Add tests (Fastify `inject`) for scenarios "Headers present" and "Script source restricted"; verify they pass
- [x] 4.3 Implement `GET /robots.txt` and `GET /healthz` (runs `select 1`); add tests for scenarios "robots.txt", "Healthy" and "Database unavailable" (stubbed failing db); verify they pass
- [x] 4.4 Configure pino serializers per design D8 (route pattern, no body, no raw URL); add tests for scenarios "Form submission logged" and "Token in URL not logged" capturing log output; verify they pass
- [x] 4.5 Add 404 and 500 handlers with Eta pages showing the exact messages and request ID; add tests for scenarios "Unknown page" and "Unexpected error"; verify they pass

## 5. Database layer

- [x] 5.1 Implement `src/db/index.js` driver factory (PGlite with `citext` contrib, persistent or in-memory; `pg` Pool for postgres) and startup checks; add tests for scenarios "Unsupported driver", "PostgreSQL connection settings" and "Embedded in-memory database for tests"; verify they pass
- [x] 5.2 Define Drizzle schema for `households`, `events`, `event_days`, `change_history` per design D6 and generate the first migration (with `CREATE EXTENSION IF NOT EXISTS citext` first); verify `drizzle/0000_*.sql` contains only portable SQL (no `CREATE FUNCTION`, no triggers)
- [x] 5.3 Run migrations at startup before `listen`; add tests for scenarios "Fresh database", "Restart with no new migrations" and "Failed migration"; verify they pass on in-memory PGlite
- [x] 5.4 Add test for scenario "Embedded database with persistent folder" using a temp `PGLITE_DATA_DIR`; verify it passes
- [x] 5.5 Implement `src/db/history.js` `writeHistory` and a transaction helper; add tests for scenarios "Household created" and "Change fails" (forced error inside transaction); verify they pass
- [x] 5.6 Implement a households repo with lower-case email lookup, soft delete (`deleted_at`) and active-only reads; add tests for scenarios "Mixed-case email" and "Soft delete"; verify they pass
- [x] 5.7 Add `src/core/time.js` (UTC <-> event timezone, "Fri, Nov 20, 8:30 PM ET" format) using `Intl`; add test for scenario "Display in event timezone"; verify it passes

## 6. Event catalog

- [x] 6.1 Implement the Zod event-config schema and loader for `config/events/*.yaml` per design D7, including timezone check, close-after-open, duplicate slug and duplicate code checks with the exact messages; add tests for scenarios "Valid event file", "Close before open", "Unknown timezone", "Duplicate slug" and "Duplicate option code"; verify they pass
- [x] 6.2 Write `config/events/pongal-2027.yaml` with the agreed values (opens 2026-11-20T20:00, closes 2026-11-24T23:59, America/New_York, Sat Jan 16 / Sun Jan 17, bands, roles, options, weights); verify the loader accepts it in a test
- [x] 6.3 Implement seeding by slug with `config_hash` comparison and history (actor `system`); add tests for scenarios "First start", "Close time extended", "Unchanged file" and "File removed next year"; verify they pass
- [x] 6.4 Implement `surveyState(event, now)`; add tests for scenarios "Before opening", "Open" and "Closed at exact close time"; verify they pass

## 7. Nightly backup

- [x] 7.1 Implement the backup job per design D9 (02:00 event time, `pglite-YYYY-MM-DD.tar.gz`, keep 14, errors logged not thrown); add tests with a fake clock for scenarios "Daily backup written", "Retention" and "Backup fails"; verify they pass

## 8. Container, Compose, CI/CD and runbook

- [ ] 8.1 Write `Dockerfile` per design D10 (node:20-alpine, `npm ci --omit=dev`, user `node`, HEALTHCHECK); verify in the Build workflow run that the image builds for `linux/amd64` and `id -u` prints `1000`
- [ ] 8.2 Write `compose.yaml` per design D10 (`image: ghcr.io/rajesh734/pongal-ui/community-site:${IMAGE_TAG}`, no `build:`, `container_name: community-site-${APP_ENV}`, no `ports:`, external network placeholder `cloudflare`, `./data:/data`, file-based `secrets:` for `edit_token_key`, `turnstile_secret`, `smtp_pass`, `_FILE` env vars) and `secrets.example/` with dummy files; verify `IMAGE_TAG=x APP_ENV=non-prod docker compose config` succeeds (in CI or on the NAS) and shows no `ports:`
- [ ] 8.3 Write `.github/workflows/build.yml` per design D11 (test job, then Buildx `linux/amd64` push to GHCR with `sha-<short>`/branch/`latest` tags, no push on pull requests, uid check on the pushed `sha-` tag); verify a push of the feature branch runs both jobs green and the package appears under the repository's Packages
- [x] 8.4 Write `.github/workflows/deploy.yml` per design D12 (`workflow_run` on Build success on `main` -> `non-prod`; `workflow_dispatch` with `environment` and required `image_tag`; per-environment `concurrency`; `tailscale/github-action@v3` with OAuth and `tag:ci`; SSH with pinned `NAS_KNOWN_HOSTS`; copy compose, pull, stop, copy `data/pglite` to `data/pre-deploy/<previous-tag>` keeping 3, start, wait for `healthy`, update `.deployed-tag` or roll back to the previous tag and fail; delete the key file); verify the YAML parses and no step prints or writes an app secret
- [ ] 8.5 Rewrite `docs/deploy-nas.md` for design D10-D12: per-environment folder layout under `/volume1/platform/docker/{non-prod,prod}/community-site`, secret files with `read -rs` / `openssl rand`, `chown 1000:1000` + `chmod 400`/`700`, `.env` values (`APP_ENV`, non-secret settings), NAS deploy user + SSH key + `NAS_KNOWN_HOSTS` from `ssh-keyscan`, one-time `docker login ghcr.io` with a read-only token, Tailscale `tag:ci` tag owner + ACL + OAuth client, GitHub Environments and secrets (production reviewer), cloudflared network name, Tunnel hostnames per environment, Hyper Backup with client-side encryption of `data/backups`, restore from a nightly backup or a pre-deploy copy, rotating a secret, manual rollback by tag; verify every NAS command in it during tasks 9.1-9.6
- [x] 8.6 Rewrite `README.md` (purpose, local run with `.env.example`, `npm test`, link to runbook); verify the local-run steps work from a fresh clone; add one line on how Build and Deploy run

## 9. Deploy and verify on the NAS

- [ ] 9.1 NAS prep per the runbook: create both environment folders, secret files, `.env` files and the deploy user; log in to GHCR; verify `ls -l secrets` shows owner `1000` and mode `-r--------` in each environment and `ssh <deploy-user>@<nas-tailnet-name> docker ps` works from a tailnet device
- [ ] 9.2 Tailscale and GitHub prep per the runbook: `tag:ci` owner and ACL, OAuth client, Environments `non-prod`/`production` with secrets and a required reviewer on `production`; verify a manual Deploy of the first `sha-` tag to `non-prod` connects and passes the SSH step
- [ ] 9.3 Merge to `main`; verify Build publishes `sha-<short>`, Deploy runs automatically to `non-prod`, the container `community-site-non-prod` is `healthy`, `.deployed-tag` holds the tag, and `docker inspect` shows no secret values in `Env`
- [ ] 9.4 Add the Cloudflare Tunnel public hostnames for both environments; verify `https://<hostname>/healthz` returns `{"status":"ok","db":"ok"}` and `https://<hostname>/weather` returns the 404 page on non-prod
- [ ] 9.5 Rollback drill on non-prod: dispatch Deploy with a tag whose container cannot become healthy (e.g. one built with a deliberately failing `/healthz`, or a temporarily unreadable secret file); verify the job fails, the previous tag is running and healthy again, and `.deployed-tag` is unchanged
- [ ] 9.6 Dispatch Deploy to `production` with the verified `sha-` tag; verify `https://<prod-hostname>/healthz` is ok, then restart the container and confirm the seeded event still exists and `data/pglite` is non-empty
- [ ] 9.7 Verify the NAS has no published port: `curl http://<nas-ip>:3000/healthz` from another LAN device fails to connect
