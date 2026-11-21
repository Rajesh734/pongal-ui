# Design: pongal-2027-interest-survey

## Context

See proposal.md for motivation and specs for behaviour. This change builds on `platform-foundation`: Fastify + Eta, Drizzle over PGlite/Postgres, `households`/`events`/`event_days`/`change_history`, event config in YAML, and settings `EDIT_TOKEN_KEY`, `TURNSTILE_*`, `SMTP_*`. The foundation CSP forbids `unsafe-eval` and inline scripts. Everything runs in a single process.

## Goals / Non-Goals

**Goals:**
- One validation definition, generated from the event config, used unchanged in the browser and on the server.
- Safe overwrite-by-email with full history, and edit links that cannot be guessed or reused after replacement.
- The survey still works without JavaScript, without Turnstile keys and without SMTP.

**Non-Goals:**
- Accounts, logins or email verification before saving.
- Admin views (separate change).
- Durable rate-limit counters across restarts.

## Decisions

### D1. Routes and post/redirect/get flow
| Method | Path | Purpose |
|---|---|---|
| GET | `/` | redirect to current survey |
| GET | `/s/:event` | form / not-open / closed |
| POST | `/s/:event` | validate, save, 303 to confirmation |
| GET | `/s/:event/edit/:token` | edit form, or confirmation when `?saved=new|updated[&emailed=1]` |
| POST | `/s/:event/edit/:token` | validate, save, 303 to `...?saved=updated` |

The confirmation is the edit-link URL with a `saved` flag, so reloading never resubmits and the summary always shows the saved answers. `Referrer-Policy: no-referrer` (foundation) keeps the token out of outgoing referrers.
- *Render confirmation directly from POST* - rejected: reload resubmits.
- *Session cookie flash* - rejected: adds cookie/session handling for no gain.

### D2. Shared schema generated from event config
`src/shared/survey-schema.js` exports `buildSurveySchema(survey, days)` returning a Zod schema, and `src/shared/survey-messages.js` holds every message template. The server imports both. The browser loads them as ES modules from `/shared/*`, with Zod served from a vendored ESM file `/vendor/zod.mjs`. The page embeds the event's survey config as `<script type="application/json" id="survey-config">`. Input normalisation (trim, lowercase email, phone digits to E.164, blank counts to 0, ignore likelihood for unticked days) lives in the same module, so both sides produce identical values.
- *Separate client and server rules* - rejected: they drift apart, which is how last year's form went wrong.
- *HTML5 attributes only* - rejected: generic browser messages, which was problem 2 last year.

### D3. Alpine.js CSP build for progressive enhancement
Use `@alpinejs/csp` (no `eval`), with logic registered through `Alpine.data('surveyForm', ...)` in `/js/survey.js`: blur and submit validation, showing likelihood per ticked day, the comments counter and the copy-link button. Without JS the form posts normally and the server validates.
- *Standard Alpine build* - rejected: needs `unsafe-eval`, which the CSP forbids.
- *Plain JS with no Alpine* - acceptable, but Alpine is the project's chosen enhancement layer.

### D4. Data model (migration `0001_survey`)
```
survey_responses
  id                  uuid pk default gen_random_uuid()
  event_id            uuid not null references events(id)
  household_id        uuid not null references households(id)
  food_code           text not null
  cultural_code       text not null
  contribution_code   text not null
  comments            text null  check (char_length(comments) <= 2000)
  consent_at          timestamptz not null
  edit_token_hash     text not null unique
  edit_token_issued_at timestamptz not null
  created_at, updated_at timestamptz not null default now()
  deleted_at          timestamptz null
  unique index ux_response_active on (event_id, household_id) where deleted_at is null

response_days
  response_id   uuid references survey_responses(id)
  event_day_id  uuid references event_days(id)
  likelihood    text not null check (likelihood in ('definitely','likely','maybe'))
  primary key (response_id, event_day_id)

response_headcounts
  response_id uuid references survey_responses(id)
  band_code   text not null
  count       int not null check (count between 0 and 100)
  primary key (response_id, band_code)

response_volunteer_roles
  response_id uuid references survey_responses(id)
  role_code   text not null
  primary key (response_id, role_code)
```
Option codes are checked against the event config by the shared schema. The database checks only broad sanity limits, so config changes never need a migration. Child rows are replaced as a set on every save (delete then insert inside the transaction). This is not respondent-data deletion: the parent response survives and history keeps every version.
- *JSONB `answers` column* - rejected: harder to aggregate for the report, and no per-field constraints.
- *Fixed headcount columns* - rejected: bands are configurable per event.

### D5. Save algorithm (one transaction)
1. `INSERT INTO households ... ON CONFLICT (email) DO UPDATE SET name, mobile_e164, updated_at RETURNING *`. This creates or updates the household and locks its row until commit, so saves for the same email run one after another.
2. Select the active response for (event, household). If found, update its fields and replace its children; otherwise insert a new one.
3. Public form: generate a new token and store `HMAC-SHA256(EDIT_TOKEN_KEY, token)`, which replaces any previous link. Edit link: keep the token.
4. Write history for the household (`create`/`update`) and the response (`create`/`update`), with a snapshot that includes days, headcounts and roles, and actor `public`.
5. Commit, then send the email if configured (D8), then 303 redirect.

If the partial unique index still rejects an insert (two saves racing on different connections in Postgres), retry the transaction once. The retry takes the update path.

### D6. Edit token
32 bytes from `crypto.randomBytes`, base64url-encoded (43 characters). Stored as a hex HMAC-SHA256 keyed by `EDIT_TOKEN_KEY` and looked up by that hash. Malformed tokens (wrong length or alphabet) return 404 before any database lookup.
- *Store plain token* - rejected: a database copy would leak every family's edit link.
- *bcrypt/argon2* - rejected: deterministic lookup needed; 256-bit random tokens make an HMAC sufficient.
- *Signed JWT link with no state* - rejected: can't be cancelled when a newer submission replaces it.

### D7. Abuse protection
- Turnstile: the widget script `https://challenges.cloudflare.com/turnstile/v0/api.js` and `frame-src https://challenges.cloudflare.com` are added to the CSP. The server POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response` and `remoteip`, using `AbortSignal.timeout(5000)`. On timeout it fails closed.
- Client IP: `CF-Connecting-IP`, falling back to the socket address. This is safe because the container has no published port, so only `cloudflared` reaches it.
- `@fastify/rate-limit` in memory: global 120 requests/min per IP, plus a route-level 10/hour per IP shared by both POST routes.
- Honeypot: a visually hidden `website` input (off-screen, `tabindex=-1`, `autocomplete=off`, `aria-hidden`).
- `bodyLimit: 16384` on the POST routes, with a custom 413 page.
- *Redis or database counters* - rejected: one process, and a restart resetting counters is acceptable.

### D8. Email via nodemailer and Gmail SMTP
The transport is created only when `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are all set (Gmail: `smtp.gmail.com`, port 587, STARTTLS, app password). Sending happens after commit with a 10-second timeout. The per-recipient limit (3/hour) is an in-memory map of recent send times keyed by email. A plain-text and a simple HTML body contain the event name, the link, the close time and the "If you didn't fill in this survey" note, and no answers.
- *Send before commit* - rejected: an email could point to an unsaved response.
- *Background queue* - rejected: not worth it at this volume; a slow send only delays one redirect.

### D9. Views and mobile-first CSS
One Eta partial `survey-form.eta` is used for both new and edit (the edit view renders email as read-only text). Each field has a `<label>`, an error `<p id="<field>-error" role="alert">` linked with `aria-describedby`, and focus moves to the summary on server errors. CSS is a single column, 16 px base font (prevents iOS zoom), 44 px minimum targets, `inputmode="numeric"` with `pattern="[0-9]*"` for counts, `type="tel"` with `autocomplete="tel-national"`, `type="email"` with `autocomplete="email"`, and no fixed widths.

### D10. Removal CLI runs with the site stopped
`npm run survey:remove -- <event-slug> <email>` soft-deletes one active response through the repo with history actor `system`. Production uses PGlite with a data folder, and PGlite allows only one process per data folder, so the CLI must not run beside the live server. Run it in a one-off container while the site is stopped: `docker compose stop community-site`, then `docker compose run --rm community-site npm run survey:remove -- ...`, then `docker compose start community-site`. With Postgres it can run at any time.
- *`docker compose exec` into the running container* - rejected: two PGlite processes on one data folder can corrupt it.
- *Admin HTTP endpoint for removal* - rejected: admin pages and Cloudflare Access come in `admin-csv-export`; this is a stop-gap.

## Risks / Trade-offs

- [Anyone who knows a family's email can overwrite its answers] -> Every version is in history for an admin restore later. If SMTP is on, the real owner gets an email with "If you didn't fill in this survey". The older edit link stops working, so the person who overwrote it gains no ongoing view of the family's later answers.
- [The "We've updated" message reveals that an email had already responded] -> Accepted: low sensitivity, and it was agreed for clarity.
- [In-memory rate limits reset on restart] -> Accepted at this scale.
- [Launching without Turnstile keys] -> The honeypot and rate limits still apply. Turnstile turns on as soon as the keys are set and the container restarts.
- [A Gmail outage or limit (about 500 recipients/day)] -> Email is optional; the link is always on screen.
- [Shared ESM in the browser needs a modern browser] -> Without module support the form still works through server-side validation.

## Migration Plan

1. Merge after `platform-foundation` tasks pass, on the same branch.
2. On the NAS: put the real Turnstile secret into `secrets/turnstile_secret`, set `TURNSTILE_SITE_KEY` in `.env`, and optionally set up the Gmail app password in `secrets/smtp_pass` plus the `SMTP_*` settings.
3. Before 8:00 PM ET, temporarily set `opens_at` earlier on a test copy or run locally to smoke-test, then deploy with the real window.
4. Rollback: set `closes_at` to now and restart (survey shows the closed message), or `docker compose down`. Data is kept.
