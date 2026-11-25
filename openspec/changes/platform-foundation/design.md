# Design: platform-foundation

## Context

See proposal.md for motivation. Constraints that shape the approach:

- Runs on a Synology DS920+ (Celeron J4125, 4 GB RAM) in Docker, reached only through the existing Cloudflare Tunnel container. Only one NAS exists. **Update (Nov 2026):** PostgreSQL 18 Alpine now runs as a separate stack on the NAS (`/volume1/docker/kalanjiyam`, network `kalanjiyam-net`), so non-production and production use PostgreSQL; PGlite is kept for development and tests. The original plan below (production on PGlite, D9) is superseded where noted.
- The NAS is reachable for administration only over Tailscale with SSH; another app already deploys to it from GitHub Actions this way, and this change follows that pattern.
- The repository is public, so workflow logs are world-readable.
- Real family data is collected from launch, so the database is production data from day one: it needs backups (PostgreSQL 18 backup service in production; the PGlite job in D9 only for the embedded driver).
- Synology has no built-in secret vault; secrets must stay out of the repo and out of `docker inspect`.
- The tech stack, folder layout and data rules come from `openspec/config.yaml`.

## Goals / Non-Goals

**Goals:**
- A minimal, single-process server that later apps add modules to (`src/modules/<feature>`).
- One schema and one set of migrations that run on both PGlite and PostgreSQL.
- Secrets read from files mounted by Docker Compose, with plain env vars for local development.
- Event and survey settings changed by editing YAML and restarting, with no code change.

**Non-Goals:**
- Running more than one app replica (PGlite allows a single writer).
- Copying PGlite data into PostgreSQL (later `postgres-cutover` change).
- Any user-facing page except health, robots and error pages.

## Decisions

### D1. Replace NestJS with Fastify + plain JavaScript ES modules
Follow the stack in `config.yaml`: Fastify 5, Eta views, `@fastify/helmet`, `@fastify/static`, `@fastify/formbody`, `@fastify/rate-limit`, no front-end build.
- *Keep NestJS/TypeScript* - rejected: needs a build step, heavier on the Celeron, and conflicts with the documented stack.
- *Express* - rejected: Fastify has built-in schema hooks, faster startup and maintained plugins for every need above.

### D2. Folder layout
```
src/
  server.js            build app, register plugins, listen
  config.js            env + _FILE loading, validation (Zod)
  core/                logger, errors, health, time helpers, backup job
  db/
    index.js           driver factory -> { db (drizzle), close() }
    schema/*.js        drizzle tables
    history.js         writeHistory(tx, entity, id, action, snapshot, actor)
  modules/<feature>/   routes, service, repo, schema, messages, views
  shared/              code served to browser too (Zod schemas, messages)
  public/              css, alpine, vendored ESM
config/events/*.yaml
drizzle/               generated SQL migrations
```

### D3. Configuration and secrets: `NAME` or `NAME_FILE`
`config.js` resolves each setting: if `NAME_FILE` is set, read and trim the file; else use `NAME`. An empty result from either source counts as not set, so an optional secret that is not in use (e.g. `SMTP_PASS` before SMTP is set up) is an empty file. Compose requires every listed secret file to exist, so the file cannot simply be left out. All settings are validated with Zod at startup; failures exit with code 1 and a message naming the setting. The effective config is logged with secrets shown as `[set]` / `[not set]`.

| Setting | Secret | Required | Notes |
|---|---|---|---|
| `PORT` | no | default 3000 | |
| `NODE_ENV` | no | default `development` | |
| `DB_DRIVER` | no | yes | `pglite` or `postgres` |
| `PGLITE_DATA_DIR` | no | no | unset = in-memory |
| `DATABASE_HOST/PORT/NAME/USER` | no | when postgres | |
| `DATABASE_PASSWORD` | yes | when postgres | |
| `BACKUP_DIR` | no | no | backups off when unset |
| `EDIT_TOKEN_KEY` | yes | yes | used by the survey change |
| `TURNSTILE_SITE_KEY` | no | no | public, sent to browsers |
| `TURNSTILE_SECRET` | yes | no | survey change |
| `SMTP_HOST/PORT/USER/FROM` | no | no | survey change |
| `SMTP_PASS` | yes | no | survey change |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | no | admin change | |

- *Plain env vars in Compose* - rejected: visible in Container Manager UI and `docker inspect`.
- *HashiCorp Vault / Infisical / Vaultwarden on the NAS* - rejected: memory and maintenance cost for five values on a 4 GB box.
- *Docker Swarm secrets* - rejected: Swarm mode not needed; Compose file-based secrets give the same `/run/secrets` mount without it.
- *Drop unused optional secrets from `compose.yaml` per environment* - rejected: one Compose file serves both environments, and editing it on the NAS is overwritten by every deploy.
- *Put a placeholder value in the unused secret file* - rejected: the app would treat it as a real password and try to use it.

### D4. Database driver factory with Drizzle
`db/index.js` returns a Drizzle instance over `@electric-sql/pglite` (with the `citext` contrib extension) or over `pg` (`node-postgres` Pool). Migrations are generated by `drizzle-kit generate` as plain SQL and applied at startup by Drizzle's migrator for the chosen driver.
- Portable SQL only: `uuid` with `gen_random_uuid()` (core since PG13, available in PGlite), `timestamptz`, `jsonb`, `citext`, partial unique indexes. No PL/pgSQL, no triggers, no server-specific extensions besides `citext`.
- `CREATE EXTENSION IF NOT EXISTS citext` is the first migration. On PostgreSQL the runbook has a superuser create it once, because the app's least-privilege role cannot.
- *SQLite for dev* - rejected: different SQL dialect from production.
- *Wait for PostgreSQL* - rejected: blocks tonight's launch.

### D5. Audit history written by the repository layer in the same transaction
Every repo write runs inside a transaction and calls `writeHistory` with the row as it is after the change. Actor values: `public`, `system`, or the admin's email.
- *Database triggers* - rejected: PL/pgSQL behaviour and permissions differ between PGlite and the restricted Postgres role, and triggers cannot see the app-level actor.

### D6. Data model

```
households
  id            uuid pk default gen_random_uuid()
  email         citext not null unique
  name          text not null
  mobile_e164   text null            check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$')
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()
  deleted_at    timestamptz null
  anonymized_at timestamptz null

events
  id                uuid pk
  slug              text not null unique  check (slug ~ '^[a-z0-9-]+$')
  name              text not null
  timezone          text not null
  survey_opens_at   timestamptz not null
  survey_closes_at  timestamptz not null  check (survey_closes_at > survey_opens_at)
  config_snapshot   jsonb not null
  config_hash       text not null         -- sha256 of normalized config, skip-unchanged check
  created_at, updated_at timestamptz not null

event_days
  id        uuid pk
  event_id  uuid not null references events(id)
  day_date  date not null
  label     text not null
  sort      int not null
  unique (event_id, day_date)

change_history
  id          bigint generated always as identity pk
  entity_type text not null
  entity_id   text not null
  action      text not null check (action in ('create','update','delete','restore','anonymize'))
  snapshot    jsonb not null
  actor       text not null
  created_at  timestamptz not null default now()
  index (entity_type, entity_id, created_at)
```
Survey tables are added by the survey change on top of this.

### D7. Event config in YAML, validated with Zod, seeded by slug
Example `config/events/pongal-2027.yaml`:
```yaml
slug: pongal-2027
name: Pongal 2027
timezone: America/New_York
days:
  - { date: 2027-01-16, label: "Saturday, Jan 16" }
  - { date: 2027-01-17, label: "Sunday, Jan 17" }
survey:
  opens_at: 2026-11-20T20:00
  closes_at: 2026-11-24T23:59
  closed_message: "The Pongal 2027 interest survey is now closed. Thank you for your interest! Organizers will share next steps soon."
  likelihood_weights: { definitely: 1.0, likely: 0.75, maybe: 0.4 }
  headcount_bands:
    - { code: adult_11_plus, label: "Adults & kids 11+", min: 1, max: 10, price_tier: full }
    - { code: kids_5_10,     label: "Kids 5-10",         min: 0, max: 10, price_tier: reduced }
    - { code: kids_under_5,  label: "Kids under 5",      min: 0, max: 10, price_tier: free }
  max_total_people: 15
  food_options:        [{ code: veg, label: Veg }, { code: non_veg, label: Non-veg }, { code: either, label: "Either is fine" }]
  volunteer_roles:     [culturals, food_serving, stage_setup, hosting, decoration, registration_desk, photography, cleanup]  # with labels
  cultural_options:    [yes, maybe, no]
  contribution_options: [{ code: usd_15, label: "$15" }, { code: usd_20, label: "$20" }, { code: usd_25, label: "$25" }, { code: flexible, label: "Flexible" }]
  comments_max: 500
```
Local times are converted to UTC with the event timezone. Seeding upserts by slug and compares `config_hash`, so history is written only when something changed. Option codes are stable keys stored in survey rows; labels can change freely.
- *Reference tables for roles/bands/options* - rejected: each yearly tweak would need a migration; codes plus a snapshot keep history readable.
- *Admin UI for event settings* - rejected for now: not needed for one event a year.

### D8. Logging with pino and redaction
Fastify's pino logger with a custom serializer that logs only `reqId`, method, `routeOptions.url` (the route pattern, never the raw URL), status and duration. Request bodies are never logged. Error logs include the error message and stack, not the request body.

### D9. Nightly PGlite backup inside the app
**Scope update:** this job now serves only `DB_DRIVER=pglite` (development and the legacy PGlite folder). Production dumps come from the PostgreSQL 18 backup service; see `openspec/specs/platform-quality`.

PGlite allows one process to open the data folder, so the backup runs inside the app: a timer fires at 02:00 event time and calls PGlite's `dumpDataDir()`, writing a gzip tarball to `BACKUP_DIR`, then deletes all but the newest 14. Hyper Backup copies `BACKUP_DIR` (consistent snapshots), not the live data folder.
- *Hyper Backup of the live `pglite/` folder* - rejected: copying files under an open database can produce an unusable copy.
- *DSM scheduled `docker exec`* - rejected: needs a second process opening the same data folder.

### D10. Container and Compose
- Image: `node:26-alpine` (Node 26 LTS), `npm ci --omit=dev`, runs as `node` (uid 1000), `HEALTHCHECK` calling `/healthz`. Built by CI for `linux/amd64` (the J4125 is x86-64) and published as `ghcr.io/rajesh734/pongal-ui/community-site`.
- `compose.yaml`: project `name: community-site-${APP_ENV}` (both environment folders are called `community-site`, so without it they would share one Compose project), service `community-site` using `image: ghcr.io/rajesh734/pongal-ui/community-site:${IMAGE_TAG}` (no `build:`), `container_name: community-site-${APP_ENV}`, port 3000 **published on the NAS loopback only** (`127.0.0.1:${HOST_PORT}:3000`, `HOST_PORT` from `.env`), because the existing `cloudflared` container (`cloudflare-pranphoto`, also serving Synology Photos) runs in host network mode and reaches services through `localhost`; volumes `./data:/data`; Compose `secrets:` from `./secrets/<name>` files; non-secret settings from `.env`. The same file serves both environments.
- One folder per environment: `/volume1/platform/docker/{non-prod,prod}/community-site/` owned by the deploy user, holding `compose.yaml`, `.env` (`APP_ENV`, `HOST_PORT`, non-secret settings), `secrets/` (owner 1000, mode 711 so the deploy user can resolve the paths for Compose but not list or read them; files mode 400), `data/` (owner 1000, mode 700) and `.deployed-tag` (the image tag that is running).
- `HOST_PORT` is `3101` for non-prod and `3100` for production (3000 is used by another app on the NAS). Cloudflare Tunnel public hostnames point to `http://localhost:3101` and `http://localhost:3100`.
- *Publish port 3000 on all NAS interfaces* - rejected: anyone on the LAN could bypass Cloudflare.
- *Shared Docker network with `cloudflared`* - rejected: the existing tunnel container uses host networking and cannot join another network.
- *Second `cloudflared` container for this app* - rejected: another tunnel and token to manage and more memory on a 4 GB NAS.
- *Switch the Photos tunnel container to bridge networking* - rejected: risks breaking remote access to Synology Photos.
- *Build the image on the NAS* - rejected: slow on the Celeron and needs the source tree on the NAS.

### D11. Build workflow: test, then publish the image to GHCR
`.github/workflows/build.yml` (replaces `ci.yml`) runs on push to any branch, on pull request to `main` and on manual dispatch. Every pushed branch gets an image; only `main` is deployed automatically.
- `test` job: `actions/setup-node@v4` with the version in `.nvmrc` (Node 26) and npm cache, `npm ci`, `npm test`. Tests use in-memory PGlite, so no database service is needed. Tests start real PGlite (WASM Postgres) instances, which take several seconds on shared GitHub runners, so `vitest.config.js` raises the per-test and per-hook timeout to 30 s.
- *Keep Vitest's 5 s default timeout* - rejected: the backup test that dumps a real PGlite data folder timed out in CI while passing locally.
- *Mock PGlite in the slow tests* - rejected: those tests exist to prove the real driver and migrations work.
- `build` job (needs `test`, `packages: write`): checks `compose.yaml` with `docker compose config` and that every published port is bound to `127.0.0.1`, then Buildx for `linux/amd64`, tags `sha-<short>`, branch name and `latest` on `main` (from `docker/metadata-action`), GHA layer cache. The built image is loaded locally and must print `1000` for `id -u` before anything is pushed; it is pushed only when the event is not a pull request.
- *Copy the sample's Postgres service, `npm run lint || true` and Codecov* - rejected: no Postgres in tests, a lint step that cannot fail adds nothing, and coverage upload is not needed yet.
- *Sample `verify` job pulling `latest`* - rejected: `latest` may be a different build; verify the exact `sha-` tag.

### D12. Deploy workflow over Tailscale + SSH
`.github/workflows/deploy.yml`:
- Triggers: `workflow_run` when Build completes successfully on `main` deploys tag `sha-<short>` of that commit to `non-prod`; `workflow_dispatch` with inputs `environment` (`non-prod`/`production`) and `image_tag` (required, no `latest`) deploys anything else. GitHub Environment `production` can require a reviewer.
- `concurrency: deploy-<environment>` so two deploys never overlap on one environment.
- Network: `tailscale/github-action@v3` with an OAuth client and ephemeral `tag:ci` node. The tailnet ACL lets `tag:ci` reach only the NAS on its SSH port.
- SSH: dedicated NAS user in the `docker` group with a deploy-only key; host key pinned from the `NAS_KNOWN_HOSTS` secret with `StrictHostKeyChecking=yes`. The key file is deleted at the end of the job.
- Steps on the NAS (`scripts/nas-deploy.sh`, piped over SSH, `set -eu`):
  1. Copy `compose.yaml` from the repository into the environment folder.
  2. `docker pull` the new tag (the NAS is logged in to GHCR once with a read-only token).
  3. Read the previous tag from `.deployed-tag`, `docker compose down`, copy `data/pglite` to `data/pre-deploy/<previous-tag>/` (keep the 3 newest).
  4. `IMAGE_TAG=<new> docker compose up -d`, then wait up to 120 s for Docker health status `healthy`.
  5. Healthy: write the new tag to `.deployed-tag`. Not healthy: print only the container state, exit code, restart count and the recent health-check results (Docker keeps the last 5; never `docker logs`), start the previous tag again and fail the job. Full logs are read on the NAS with `docker logs community-site-<env>`.
- Secrets: GitHub Environments hold only access secrets (`NAS_HOST`, `NAS_USER`, `NAS_PORT`, `NAS_SSH_KEY`, `NAS_KNOWN_HOSTS`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`), stored as environment **secrets** (never variables, which appear unmasked in public logs). Both environments accept deployments from `main` only. App secrets stay in files on the NAS (D3) and never pass through GitHub.
- *Print container logs in the job log* - rejected: job logs are public and the startup line lists private settings (SMTP host and user, Access team domain and AUD).
- *Sample's `sed` of DB passwords into the compose file* - rejected: puts secrets on disk in plain text and into `docker inspect`, against D3.
- *`StrictHostKeyChecking=no`* - rejected: allows a man-in-the-middle to receive the deploy session.
- *Health check with `curl localhost:3000`* - rejected: port 3000 belongs to another app on the NAS; Docker's own health status is used instead.
- *Sample rollback from `docker-compose.yml.backup`* - rejected: that file is never created; the previous image tag is recorded instead.
- *Tailscale auth key* - rejected: keys expire after at most 90 days and would silently break deploys; the OAuth client does not expire.
- *Watchtower auto-pull on the NAS* - rejected: no health-gated rollback and no record of what is deployed.

## Risks / Trade-offs

- [PGlite allows a single writer, so the app can only run one replica] -> Accept for this scale; Compose runs one replica; Postgres cutover removes the limit.
- [PGlite data folder corrupted by a crash] -> Nightly backups plus Hyper Backup copies, and a documented restore step in the runbook.
- [The first-night backup is up to 24 hours old] -> Acceptable for a survey; the CSV export (admin change) gives organizers an extra copy.
- [`citext` needs superuser to create on PostgreSQL] -> Runbook step for the cutover; app role stays least-privilege.
- [Secret files unreadable by uid 1000 cause startup failure] -> Clear startup message names the file; runbook sets `chown 1000:1000` and `chmod 400`.
- [Rolling back the image does not undo a database migration] -> The deploy copies `data/pglite` before starting the new image; the runbook shows how to restore that copy together with the previous tag.
- [CI runners join the tailnet] -> Ephemeral `tag:ci` nodes, ACL limited to the NAS SSH port, deploy user limited to Docker and its folders.
- [Auto-deploy pushes every `main` commit to non-prod] -> Acceptable for non-prod; production deploys stay manual with a chosen tag.
- [Any process on the NAS can reach the app through `127.0.0.1`] -> Only admins run software on the NAS; LAN and internet clients still cannot reach the port.


## Migration Plan

1. Commit the OpenSpec plan to `main`, then on the feature branch add the skeleton (tasks 1-7).
2. Push the branch: the Build workflow tests the code and publishes the image to GHCR (no local Docker needed).
3. One-time setup per the runbook: NAS folders, secret files, `.env`, GHCR login and deploy user; Tailscale tag, ACL and OAuth client; GitHub Environments and secrets; Tunnel routes.
4. Merge to `main`: Deploy runs to `non-prod` automatically. Check it, then run Deploy manually for `production` with the same `sha-` tag.
5. Rollback: run Deploy with the previous tag (recorded in the job log and `.deployed-tag`), or `docker compose down` to stop. Data stays in `./data`. Nothing else on the NAS changes.

## Open Questions

- Name of the existing Docker network used by the `cloudflared` container - resolved: `cloudflare-pranphoto` uses host networking, so the app is published on `127.0.0.1` instead (D10).
- Compose command on the DSM version in use: `docker compose` (v2) or `/usr/local/bin/docker-compose` as in the existing app's deploy. The deploy script uses whichever the NAS has.
- Public hostnames for `non-prod` and `production`.
