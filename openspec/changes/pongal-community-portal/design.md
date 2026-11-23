# Design

## Context

See proposal.md and the capability specs for scope and observable behavior. The application is a Node.js/Fastify server-rendered site using Eta, Alpine.js, Drizzle, PGlite for current development/tests, and PostgreSQL as the supported production driver. Existing data is centered on `households`, `events`, and `change_history`; each schema migration must work on both database drivers.

## Goals / Non-Goals

**Goals:**
- Extend the existing household/event model instead of introducing a separate user-owned registration model.
- Keep guest registration available, protect household identity and registration access, and retain an auditable payment/check-in history.
- Keep UI translations in the application and event facts in event configuration; do not require a translation service at runtime.
- Keep the PostgreSQL service private to the application network and preserve PGlite compatibility for this change.

**Non-Goals:**
- Importing existing PGlite data into PostgreSQL before the existing survey history has been reviewed.
- Automated Zelle confirmation, WhatsApp messaging, or offline check-in.
- Removing survey code or existing response data.

## Decisions

### D1. Extend the existing server-rendered application

Add focused feature modules for household authentication, registration, and check-in, and add routes/views to the existing organizer module. Keep Eta as the page renderer and Alpine.js for optional browser enhancement; all form validation remains enforced by the server.

- **Alternative: build a client-side single-page application.** Rejected because it adds a build/runtime layer and weakens the existing no-JavaScript form path without helping this workflow.
- **Alternative: add a separate portal service.** Rejected because it would duplicate sessions, database access, and deployment on the NAS.

### D2. Keep the household as the account and registration owner

`households` remains the durable identity keyed by case-insensitive email. A guest registration creates or updates a household even when it has no login credentials. Once the same email is verified, an account authenticates that household; registration rows continue to reference `household_id`, not a new `user_id`.

| Table | Key fields and constraints |
| --- | --- |
| `households` (existing) | `id` UUID primary key; unique `email` (`citext`); current contact name and E.164 mobile; add optional WhatsApp E.164 number and consent timestamp. |
| `household_auth` (new) | `household_id` primary key and FK to `households`; nullable `password_hash`; nullable unique `google_sub`; `email_verified_at`; timestamps. At least one sign-in method is required for an enabled account. |
| `household_sessions` (new) | UUID primary key; household FK; unique `token_hash`; expiry, creation, and last-use timestamps. |
| `email_verification_tokens` (new) | UUID primary key; household FK; unique token hash; expiry and consumed timestamp. Tokens are single-use. |
| `registration_access_tokens` (new) | UUID primary key; registration FK; unique token hash; expiry and revoked timestamp for guest access. |

Email is normalized before household lookup. Google identity is associated only after validating the Google credential and its verified email; manual identity is not allowed to access household registrations until its verification token is consumed. Password material and bearer tokens are never stored in plaintext.

- **Alternative: add `user_id` to survey and registration rows.** Rejected because a household is already the owner of survey responses, and a second ownership model would fragment a family's history.
- **Alternative: create a household for every login provider.** Rejected because it would split one family's registrations when it uses Google and email/password with the same verified email.

### D3. Store registration details as event-specific records

Use integer cents for money and snapshot each attendee's calculated fee at submission so later price changes do not rewrite historical registrations. The current household contact remains reusable, while each registration retains the contact details and consent that applied to that event.

| Table | Key fields and constraints |
| --- | --- |
| `registrations` (new) | UUID primary key; FKs to `events` and `households`; contact name/email/mobile/WhatsApp snapshots; WhatsApp consent timestamp; status (`payment_pending`, `confirmed`, `cancelled`); total cents; timestamps and `deleted_at`; one active registration per household and event. |
| `registration_attendees` (new) | UUID primary key; registration FK; attendee name; age band (`11_plus`, `5_to_10`, `under_5`); fee cents; `willing_to_volunteer` boolean. |
| `registration_performances` (new) | UUID primary key; registration FK; performance title/type; group or participant names; participant count; duration minutes; compere introduction. At most two entries per registration; duration is validated against participant count. |
| `registration_volunteer_roles` (new) | Attendee FK plus role code as a composite primary key. Role codes are limited to the agreed existing list. |
| `registration_payments` (new) | UUID primary key; unique registration FK; amount cents; status (`pending`, `confirmed`); payer name and Zelle reference; declaration time; verifying organizer identity and confirmation time. |
| `registration_passes` (new) | UUID primary key; unique registration FK; unique hash of a random pass token; issue and revocation timestamps. No personal data is embedded in the QR value. |
| `registration_check_ins` (new) | UUID primary key; unique registration FK for one household check-in; check-in time and the authenticated household account that performed it. |
| `check_in_permissions` (new) | UUID primary key; unique household FK for an active grant; organizer identity, grant time, and revocation time. A grant applies to the household account, not to an individual attendee. |

Payment confirmation and check-in actions write `change_history` snapshots in the same transaction. Use foreign keys, `CHECK` constraints, unique indexes, and soft deletion where applicable; keep migration SQL compatible with both PGlite and PostgreSQL.

- **Alternative: store all attendees and performances in one JSON document.** Rejected because reporting, role assignment, fee calculation, and check-in need independently addressable rows and constraints.
- **Alternative: treat the payment declaration as proof.** Rejected because Zelle does not provide this app a payment confirmation event; organizers must verify the receiving account.

### D4. Use a pending-to-confirmed payment lifecycle

Registration submission creates a pending record and stores its calculated amount. The app displays Zelle instructions and accepts payer name/reference data, but only an authorized organizer action changes payment status to confirmed. That action issues the QR pass. Use the existing Cloudflare Access-protected organizer authentication; check-in permission is a separate, revocable household-account grant.

- **Alternative: infer payment from a checkbox or submitted reference.** Rejected because neither proves funds were received.
- **Alternative: give every volunteer organizer access.** Rejected because volunteering and check-in authorization are separate decisions controlled in the admin UI.

### D5. Use opaque tokens for guest access, sessions, and QR passes

Generate cryptographically random tokens, store only keyed hashes or cryptographic hashes, and send user-facing links through the existing SMTP transport. Use an HTTP-only, secure-in-production, SameSite=Lax session cookie and validate state-changing requests against the request origin and an anti-CSRF token. The check-in page requires an authenticated account with an active check-in grant.

- **Alternative: place attendee data or sequential registration IDs in QR codes.** Rejected because the QR is visible to anyone who can photograph it and must not disclose personal data or be guessable.
- **Alternative: save authentication or guest tokens in browser local storage.** Rejected because browser scripts could read them.

### D6. Verify Google sign-in on the server

Use the Google Identity Services credential and verify its signature, issuer, audience, expiry, and `email_verified` claim on the server before creating a session. The client ID is public configuration; no client secret is sent to the browser. Add only the required Google script origin to the existing CSP and use the application's CSRF protections for the credential submission.

- **Alternative: trust an email address sent by browser code.** Rejected because a visitor can alter it.
- **Alternative: use an unverified profile response.** Rejected because guest household linking depends on verified email ownership.

### D7. Keep translations static and server-rendered

Store English, Tamil, Telugu, Kannada, and Malayalam message catalogs in shared application resources. Render pages and validation messages in the selected locale, default to English, and persist the preference in a non-authentication locale cookie. Use the same message catalog for server validation and browser enhancement; do not translate user-entered names or compere introductions.

- **Alternative: call a translation service at runtime.** Rejected because it exposes event content to an external service, depends on network availability, and can produce inconsistent payment or safety instructions.
- **Alternative: save translated UI strings in PostgreSQL.** Rejected because release-managed UI copy is application content, not event registration data.

### D8. Keep event values in the existing event catalog

Add registration prices, age-band labels, performance limits, and the approved 2027 agenda to the event configuration. Seed a snapshot into the existing event model so a later configuration edit does not alter historical registrations. The prior-year flyer is a planning reference only; date and agenda values remain unset until approved.

- **Alternative: hard-code Pongal dates, prices, and limits in routes.** Rejected because event values change by year and belong with the event definition.

### D9. Use the existing database driver and private network

Define the added tables in `src/db/schema/index.js` and generate numbered migrations under `drizzle/`. Apply the same migrations on PGlite and PostgreSQL at startup. Keep PGlite for automated tests; deploy both NAS app environments with `DB_DRIVER=postgres`, separate databases and roles, and the existing `DATABASE_*` settings through environment/secret files. Attach the app and PostgreSQL containers to the private `kalanjiyam-net` and publish no PostgreSQL port.

- **Alternative: point non-production and production to the same database.** Rejected because test registrations could mix with production family and payment data.
- **Alternative: replace PGlite in automated tests.** Rejected because the existing in-memory migration tests are fast and still verify portable SQL.
- **Alternative: create tables manually in pgAdmin.** Rejected because migrations keep development, tests, and future deployments on the same schema version.

### D10. Organize admin work into protected pages and safe exports

Keep one organizer dashboard with separate Registrations, Payments, Volunteers, and Check-in Access pages. Reuse the current Cloudflare Access verification for every admin route. The event roster is filterable by event and payment status. Export one attendee per CSV row, repeat household and payment columns, encode as UTF-8, and neutralize spreadsheet formulas.

- **Alternative: place all actions and PII on one unfiltered admin page.** Rejected because distinct pages are easier to scan and reduce unnecessary exposure of registration details.
- **Alternative: export one household per row with a variable number of attendee columns.** Rejected because a row per attendee is stable for reporting and avoids a different CSV shape for each family.

## Risks / Trade-offs

- [SMTP is unavailable] -> Manual verification and guest recovery links cannot be delivered; production portal setup must configure and verify SMTP before enabling these flows.
- [Organizer confirms the wrong transfer] -> Show exact amount, payer, and reference together; record organizer and timestamp for audit and correction.
- [Household credentials are shared] -> Check-in grants are explicit and revocable, but they apply to the household account; do not grant them to a household unless its account holder is trusted.
- [Venue network is unavailable] -> Online QR validation cannot proceed; offline scanning is intentionally excluded, so organizers need a manual attendee-list fallback.
- [A release changes fee or locale data] -> Snapshot attendee fees and event configuration at registration time; retain registration history.
- [Google OAuth setup differs from GIS requirements] -> Verify the configured client ID and authorized origin before enabling the Google button; do not request or store a browser-side client secret.
- [CSV fields contain spreadsheet formulas] -> Neutralize formula-leading values and test exports with Excel-compatible inputs.

## Migration Plan

1. Add schema definitions and additive migrations; run them against in-memory PGlite tests.
2. Deploy non-production against its separate PostgreSQL database and verify migrations, registration, and health before production.
3. Configure production with the `samugam` database and `samugam_app` role; keep database credentials in the mounted secret file and publish no database port.
4. Preserve existing PGlite data. Decide separately whether to import any survey history before retiring the old data volume.
5. Configure SMTP and the Google client origin before enabling email verification and Google sign-in in production.
6. Configure event date, venue, agenda, and final copy from organizer-approved values before public launch.
7. To roll back application code, redeploy the previous image. Do not drop PostgreSQL tables or registration data; additive migrations remain in place.

## Open Questions

- The organizer will provide the 2027 event date, venue, final schedule, and About-page copy before launch.
- Confirm the Google Cloud client's authorized JavaScript origin during implementation without sharing its client secret.
- Decide whether the existing PGlite survey history should be imported into PostgreSQL before removing its retained data volume.