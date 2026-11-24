# community-site (Pongal UI)

Community website for our yearly celebrations. The first app is the Pongal 2027 interest survey; event registration and other small community apps follow. It runs on a Synology NAS in Docker behind Cloudflare Tunnel and keeps data permanently for year-over-year history.

Stack: Node.js 26, Fastify 5, Eta server-rendered pages, Drizzle ORM on PGlite (embedded Postgres) or PostgreSQL, Zod, Vitest.

## Run locally

Requires Node.js 26 (`nvm use`).

```sh
npm ci
cp .env.example .env    # dummy values only
npm run dev             # http://localhost:3000/healthz
```

`.env.example` stores the database in `./data/pglite`. Leave `PGLITE_DATA_DIR` empty for an in-memory database. Events are defined in `config/events/*.yaml` and loaded at startup.

## Test

```sh
npm test
```

## Database migrations

Edit `src/db/schema/index.js`, then run `npm run db:generate`. Migrations in `drizzle/` run automatically at startup.

## Deploy

Every push runs **Build** (tests, then the image is pushed to GHCR as `sha-<commit>`). A green Build on `main` deploys to `non-prod` automatically; `production` is deployed with **Actions > Deploy > Run workflow**. Setup and operations: [docs/deploy-nas.md](docs/deploy-nas.md).

Plans and specs live in `openspec/`.
