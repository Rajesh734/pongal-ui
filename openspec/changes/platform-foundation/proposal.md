# Proposal: platform-foundation

## Why

The repository is empty apart from the OpenSpec plan. The Pongal 2027 Interest Survey must go live tonight (Fri, Nov 20, 2026) on the Synology NAS, and every later app (registration, future community apps) needs the same base: configuration, secrets, a database that runs on PGlite today and PostgreSQL tomorrow, event definitions from config, and an audit trail. Building that base once, first, keeps the survey change small and lets the Postgres switch be a configuration change plus a data copy.

## What Changes

- **Add** repository basics: `package.json`, `.gitignore`, `.nvmrc`, `README.md` and `Dockerfile`.
- **Add** a build workflow that runs the tests and pushes the Docker image to GitHub Container Registry (GHCR), and a deploy workflow that reaches the NAS over Tailscale + SSH. Every push to `main` deploys to `non-prod` automatically; `prod` is deployed by a manual run with a chosen image tag. A deploy that does not become healthy is rolled back to the previous image.
- **Add** a Node.js 26 / Fastify 5 skeleton (ES modules, no front-end build step) with security headers, request IDs, PII-free logging, a health endpoint and friendly 404/500 pages.
- **Add** configuration loading from env vars where each secret can also come from a file (`X_FILE`), so secrets live in Synology-managed Docker Compose secret files and never in the repo. The repo ships only `.env.example` with dummy values and Cloudflare's public Turnstile test keys.
- **Add** a database layer selected by `DB_DRIVER` (`pglite` now, `postgres` later) with Drizzle migrations that run unchanged on both, plus a nightly PGlite backup.
- **Add** the shared data model: `households`, `events`, `event_days`, `change_history`, with soft-delete and audit rules.
- **Add** event definitions in `config/events/*.yaml` (first: `pongal-2027`), validated and seeded at startup, including the configurable survey open/close window.
- **Add** `compose.yaml` and a NAS deployment runbook (one-time NAS, Tailscale and GitHub setup, secret files, permissions, volumes, Hyper Backup, Cloudflare Tunnel routes per environment, rollback).

## Capabilities

### New Capabilities

- `platform-runtime`: Server startup, configuration and secret loading, health endpoint, security headers, error pages and logging rules shared by all apps.
- `data-persistence`: Database driver selection, migrations, audit history, soft-delete, email and timestamp storage rules.
- `event-catalog`: Event definitions from config files, validation, seeding, history retention and survey window state.

### Modified Capabilities

_None - no specs exist yet._

## Impact

- New codebase in an empty repository.
- New dependencies: fastify, @fastify/{view,static,formbody,helmet,rate-limit}, eta, @electric-sql/pglite, pg, drizzle-orm, drizzle-kit, zod, yaml, pino, vitest.
- Deployment target: Docker Compose on the Synology NAS behind the existing Cloudflare Tunnel container, with two environments (`non-prod`, `prod`) in `/volume1/platform/docker/{non-prod,prod}/community-site`.
- New external setup: a GHCR package, GitHub Environments `non-prod` and `prod` with access secrets (NAS host, user, port, SSH key, pinned host key, Tailscale OAuth client), a Tailscale `tag:ci` ACL limited to the NAS SSH port, a NAS deploy user, and a read-only GHCR token on the NAS.

## Out of Scope

- The survey form, edit link and emails (change `pongal-2027-interest-survey`).
- Admin pages, Cloudflare Access verification and CSV export (change `admin-csv-export`).
- Switching prod to PostgreSQL and migrating PGlite data (later change `postgres-cutover`).
- Decision report, XLSX export, soft-delete/restore/anonymize UI, past-event pages, registration.