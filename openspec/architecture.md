# Architecture

Read this first when rebuilding or extending the site. Behavior is specified in `openspec/specs/`, tables in `data-model.md`, routes in `route-map.md`, settings and secrets in `environment.md`, pages and layout in `ui-reference.md`. This file explains how the pieces fit.

Not reproducible from text and kept as versioned inputs: `config/events/*.yaml`, `src/shared/i18n/catalogs/*.js` (translations), `src/public/img` and the Pongal SVG art partials, and the vendored libraries in `src/public/vendor`.

## Runtime and stack
- Node.js 26 LTS, plain JavaScript ES modules, no front-end build step.
- Fastify 5 with `@fastify/view` (Eta templates), `static`, `formbody`, `helmet`, `rate-limit`.
- PostgreSQL 18 Alpine in production (a separate stack on the NAS, private Docker network `kalanjiyam-net`, no published port). PGlite (embedded Postgres) for local development and tests. `DB_DRIVER=postgres|pglite` selects one; the same Drizzle SQL migrations in `drizzle/` run on both and are applied at startup.
- Zod validation shared by server and browser; Alpine.js (CSP build) for the survey form; jsQR for the scanner fallback; all vendored under `src/public/vendor` and `src/shared`.
- Vitest for tests. Run `npm test`; tests use in-memory PGlite.

## Folder layout
```
src/server.js            build the app, register plugins and hooks, listen
src/config.js            env and NAME_FILE settings, Zod-validated
src/core/                logger, csrf, locale, abuse (Turnstile), time, backup (PGlite only), health, errors
src/db/                  driver factory, Drizzle schema (schema/index.js), history, seed-events
src/modules/<feature>/   routes.js, service.js, repo.js, views/*.eta   (admin, auth, registration, survey)
src/shared/              code served to the browser too: schemas, pricing, phone countries, i18n catalogs
src/public/              css, js, img, vendor
config/events/*.yaml     event definitions seeded into the database at startup
drizzle/                 generated SQL migrations
```
A new app is a new folder under `src/modules/`.

## Request pipeline (order matters)
1. `onRequest`: resolve the language (`?lang=` or cookie, English default; organizer pages always English), then the household session from the `pongal_session` cookie.
2. Per-route rate limits (global 120 requests per minute per IP; 10 per hour for form posts), then `preValidation` on POST: same-origin check and CSRF token check.
3. `preHandler`: view locals (`t`, `locale`, nav state, `canCheckIn`, `adminPath`, CSRF token for the header form).
4. Handler renders an Eta view inside `modules/survey/views/layout.eta`.
5. Errors and 404 render `core/views/error.eta`; messages are translated.

Admin routes live under `/admin` and require a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, verified with `jose`). `ADMIN_DEV_EMAIL` allows localhost without Access, development only.

## Security
- Helmet with a CSP: scripts from self, Cloudflare Turnstile and Google sign-in, plus one hashed inline import map; `frame-ancestors 'none'`; `Referrer-Policy: no-referrer`.
- Cookies: `pongal_session` (HttpOnly, 14-day household session; only the SHA-256 of the token is stored), `pongal_csrf` (HttpOnly, double-submit token), `pongal_lang` (language, one year). `Secure` is added in production.
- Email verification tokens expire in 24 hours; registration guest links and survey edit links are opaque random tokens stored hashed.
- Entry pass: 32 random bytes (base64url); the database holds its SHA-256 for lookup and the token AES-256-GCM encrypted with `QR_PASS_ENCRYPTION_KEY` (32 bytes, base64) so the household can view the QR again.
- Secrets come from `NAME_FILE` files mounted by Docker Compose; an empty file counts as not set. Never log request bodies or secrets.
- Spreadsheet exports prefix cells that could run as formulas; validated phone numbers are exempt (US numbers are written `617-555-0123`).

## Internationalization
- Languages: English, Tamil, Telugu, Kannada, Malayalam. English is the default and the fallback.
- Catalog keys are the English text itself: `src/shared/i18n/catalogs/{ta,te,kn,ml}.js` map English sentences to translations, with `{name}` placeholders. English needs no file.
- Server: `request.t(key, vars)` and `it.t` in templates. Browser: `pageTranslator()` loads only the page language's catalog (`<html lang>`), so server and browser messages match.
- To add a string: use `t('English text')` in code, add it to all four catalogs; `test/i18n.test.js` fails otherwise. Event-configured labels (survey options, days, roles) are translated through the same catalogs.
- Not translated: organizer pages, CSV exports, text visitors typed.

## Event configuration
`config/events/<slug>.yaml` defines days, survey options and weights, registration prices, performance limits, Zelle phone and volunteer roles. Startup validates it with Zod and upserts the event by slug, storing a snapshot and a hash so history is written only when something changed. Option codes never change; labels may.

## Email
Nodemailer over SMTP, optional (enabled when `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are set; `SMTP_PORT` defaults to 587). Three emails: survey edit link, account verification, registration access link. Each is written in the visitor's language and limited to 3 per recipient per hour.

## Build and deploy
- `Dockerfile`: `node:26-alpine`, `npm ci --omit=dev`, user `node` (uid 1000), health check on `/healthz`.
- `compose.yaml`: one file for both environments; image `ghcr.io/rajesh734/pongal-ui/community-site:${IMAGE_TAG}`; port published on `127.0.0.1:${HOST_PORT}` only (3101 non-prod, 3100 production); file-based secrets; joins `kalanjiyam-net`.
- GitHub Actions: `build.yml` tests, builds `linux/amd64`, checks uid 1000 and loopback-only ports, pushes `sha-<short>` tags to GHCR. `deploy.yml` runs over Tailscale and SSH, auto for non-prod on `main`, manual for production with a chosen tag, with health-gated rollback.
- Runbooks: `docs/deploy-nas.md` and `docs/runbooks/`.

## Visual design and assets
- Mobile-first, 16px base text, tap targets at least 44px, system font stack with Noto Sans Tamil for Tamil text.
- Colors (CSS variables in `src/public/css/site.css`): turmeric `#f2b705`, turmeric-soft `#fde9a6`, marigold `#f28c0f`, cane `#2f7d32`, kumkum `#c62828`, kumkum-dark `#8e1b1b`, maroon `#6d1b1b` (header), clay `#c9692c`, cream `#fff8e7` (page), paper `#fffdf7` (cards), ink `#2b1d0e`, muted `#5d4632`, focus `#1a5fb4`.
- Errors use a red callout (`#fdecea` fill, `#b00020` border, warning mark); confirmations use a green callout.
- Assets in `src/public/img`: `logo.svg` (preferred) or `logo.png`, `favicon.svg`, and the Pongal hero images (`pongal-hero.webp`, `-desktop`, `-mobile`). The festive banner is inline SVG partials in `src/modules/survey/views/themes/pongal/art/` (sun, pot, sugarcane, bull, figures, kolam, thoranam, uriyadi) composed by `banner.eta`; they are decorative and hidden from assistive technology.
- Header: menu button left, site name centered, account icon (person SVG) top right at every width; the language links sit under the header on public pages.

## Settings and authentication
All settings, defaults and validation rules are in `environment.md`. Passwords are hashed with scrypt (random salt, constant-time compare). Google ID tokens are verified on the server against Google's keys.

## Event configuration file (`config/events/<slug>.yaml`)
`config/events/pongal-2027.yaml` is the reference. Its shape:

```yaml
slug: pongal-2027                 # [a-z0-9-]+, unique
name: Pongal 2027
timezone: America/New_York
theme: pongal                     # festive banner theme
days:                             # candidate days
  - { date: 2027-01-16, label: "Saturday, Jan 16" }
survey:
  opens_at: 2026-11-20T20:00      # local to timezone
  closes_at: 2026-11-24T23:59
  closed_message: "..."
  likelihood_weights: { definitely: 1.0, likely: 0.75, maybe: 0.4 }
  headcount_bands:                # code, label, min, max, price_tier
    - { code: adult_11_plus, label: "Adults & kids 11+", min: 1, max: 10, price_tier: full }
  max_total_people: 15
  food_options: [{ code: veg, label: Veg }]
  volunteer_roles: [{ code: culturals, label: Culturals }]
  cultural_options: [{ code: "yes", label: "Yes" }]
  contribution_options: [{ code: usd_20, label: "$20" }]
  comments_max: 500
registration:
  prices_cents: { age_11_plus: 3500, age_5_to_10: 2500, under_5: 0 }
  max_performances: 2
  performance_duration_minutes: { solo: 4, group_2_to_4: 5, group_5_plus: 7 }
  zelle_phone: "+16039700000"
  volunteer_roles: [{ code: culturals, label: Culturals }]   # nine roles, see the file
```
Codes are stored in the database and must never be renamed; labels may change and are translated through the catalogs.

## Local run
`npm ci`, copy `.env.example` to `.env`, then `npm run dev`. Use `DB_DRIVER=pglite` with `PGLITE_DATA_DIR` for a persistent local database and `ADMIN_DEV_EMAIL` to open `/admin` on localhost.
