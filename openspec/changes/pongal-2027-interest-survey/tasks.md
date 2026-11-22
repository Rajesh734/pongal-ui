# Tasks: pongal-2027-interest-survey

## 1. Data model

- [x] 1.1 Add Drizzle tables `survey_responses`, `response_days`, `response_headcounts`, `response_volunteer_roles` per design D4 and generate migration `0001_survey`; verify it applies on in-memory PGlite in a test and contains the partial unique index `WHERE deleted_at IS NULL`

## 2. Shared schema and messages

- [x] 2.1 Create `src/shared/survey-messages.js` with every message from the specs (exact text, templated day/limit/count values); verify by a test that snapshots all rendered messages for the Pongal 2027 config
- [x] 2.2 Create `src/shared/survey-schema.js` `buildSurveySchema(survey, days)` with normalisation per design D2; verify `node --check` and that it imports only `/vendor/zod.mjs`-compatible Zod APIs
- [x] 2.3 Add unit tests `test/survey-schema.test.js` for scenarios "Missing name", "Tamil name accepted", "Name with digits", "Name too long", "Missing email", "Malformed email", "Normalised email"; verify they pass
- [x] 2.4 Add unit tests for scenarios "Formatted number", "Country code included", "Too few digits", "Invalid area code", "Left empty"; verify they pass
- [x] 2.5 Add unit tests for scenarios "No day selected", "Missing likelihood", "Stale likelihood ignored", "No adults", "Too many kids", "Not a whole number", "Group too large", "Blank kids fields"; verify they pass
- [x] 2.6 Add unit tests for scenarios "Missing food preference", "Missing cultural interest", "Missing contribution", "Tampered role", "Comments too long", "Consent not given"; verify they pass
- [x] 2.7 Serve `src/shared/` at `/shared/` and vendored Zod ESM at `/vendor/zod.mjs`; verify `GET /shared/survey-schema.js` returns `200` with `content-type` JavaScript

## 3. Save service

- [x] 3.1 Implement token helpers (generate 32-byte base64url, HMAC hash, format check) per design D6; add test for scenario "Token not stored in plain form" (scan all columns of saved rows); verify it passes
- [x] 3.2 Implement `saveFromPublicForm` per design D5 (household upsert lock, update-or-insert, child replacement, new token, history); add tests for scenarios "First submission", "Resubmission with same email", "Previously removed response"; verify they pass
- [x] 3.3 Add the single-retry on unique violation and a test for scenario "Simultaneous submissions" (two concurrent saves on PGlite; and on Postgres in CI if available); verify exactly one active response remains
- [x] 3.4 Implement `saveFromEditLink` (same token kept, email ignored); add tests for scenarios "Successful edit" and "Tampered email ignored" at service level; verify they pass
- [x] 3.5 Add CLI `npm run survey:remove -- <event-slug> <email>` that soft-deletes the active response through the repo with history actor `system` (stop-gap until admin moderation; run with the site stopped per design D10); verify with a test that the row gets `deleted_at` and a `delete` history row

## 4. Public survey pages

- [x] 4.1 Implement `GET /` redirect and `GET /s/:event` with window states using `surveyState`; add `inject` tests for scenarios "Before opening", "Open", "Closed", "Unknown event", "One current survey" with a fake clock; verify they pass
- [x] 4.2 Build `survey-form.eta` and the page layout per design D9 from event config; add an `inject` test for scenario "Pongal 2027 form" asserting labels, options and the consent text; verify it passes
- [x] 4.3 Implement `POST /s/:event` (validate, save, 303 to `/s/:event/edit/:token?saved=new|updated`); add tests for scenarios "Server check with scripts disabled", "Single error summary" and "Submission after closing"; verify they pass
- [x] 4.4 Implement the confirmation view on the edit route with `?saved`; add tests for scenarios "New response confirmation", "Replaced response confirmation", "Refresh does not resubmit" and "Link on confirmation page"; verify they pass
- [ ] 4.5 Write mobile-first `public/css/site.css` per design D9; verify scenarios "Small phone" and "Keyboards" manually in Chrome DevTools at 360 px and on one iPhone and one Android phone, and record the result in the PR

## 5. Browser enhancement

- [x] 5.1 Vendor `@alpinejs/csp` and write `public/js/survey.js` (`Alpine.data('surveyForm')`: blur/submit validation with the shared schema, likelihood per ticked day, comments counter, copy-link); verify no CSP violations in the browser console
- [x] 5.2 Verify scenarios "Browser check on blur", "Likelihood appears per selected day" and "Live counter" manually in a browser (or with a small Playwright script if time allows) and record the result in the PR

## 6. Edit link

- [x] 6.1 Implement `GET /s/:event/edit/:token` edit form (pre-filled, email read-only with note) and `POST` save; add tests for scenarios "Pre-filled form", "Successful edit", "Tampered email ignored", "Invalid edit"; verify they pass
- [x] 6.2 Implement the shared invalid-link 404; add tests for scenarios "Older link replaced", "Replaced link", "Removed response" and a malformed token; verify they pass
- [x] 6.3 Apply the closed window to edit routes; add test for scenario "Open after close"; verify it passes

## 7. Abuse protection

- [x] 7.1 Extend the CSP with `https://challenges.cloudflare.com` for `frame-src`; implement Turnstile widget rendering and server verification per design D7; add tests with a stubbed `fetch` for scenarios "Verification passes", "Verification fails", "Cloudflare unreachable"; verify they pass
- [x] 7.2 Add the startup warning when Turnstile is unset; add test for scenario "Not configured"; verify it passes
- [x] 7.3 Add honeypot handling; add tests for scenarios "Bot fills hidden field" and "Real visitor"; verify they pass
- [x] 7.4 Configure rate limits (global 120/min, POST 10/hour per `CF-Connecting-IP`) and 429 pages; add tests for scenarios "Eleventh submission", "Different IPs", "Burst of page loads"; verify they pass
- [x] 7.5 Set `bodyLimit` 16 KB with the 413 page; add test for scenario "Oversized body"; verify it passes
- [x] 7.6 Classify Turnstile outcomes per design D7 (`ok`/`failed`/`misconfigured`/`unreachable`) with the logging it describes; add tests for scenarios "Rejected secret key" and "Cloudflare unreachable" (HTTP 5xx and network error) asserting the logs contain no secret, token or IP; verify they pass
- [x] 7.7 Add the startup warning for Cloudflare test keys; add test for scenario "Test site key"; verify it passes
- [x] 7.8 Add a "Turnstile troubleshooting" section to `docs/deploy-nas.md` ("For testing only" label, "isn't set up correctly" message, how to copy the site key and secret from the same widget, `docker logs ... | grep Turnstile`); verify the commands in it against the compose file

## 8. Edit-link email

- [x] 8.1 Add nodemailer, create the transport only when all `SMTP_*` settings are present, and write the plain-text and HTML templates per design D8; verify `npm audit --omit=dev` reports no high/critical findings (Trivy is not installed locally or in CI)
- [x] 8.2 Send after commit with a 10 s timeout and append `&emailed=1` on success; add tests with a stub transport for scenarios "Email sent", "SMTP not configured", "Sending fails"; verify they pass and that the failure log contains no email address
- [x] 8.3 Add the per-recipient limit (3/hour); add test for scenario "Fourth save in an hour" with a fake clock; verify it passes
- [ ] 8.4 Add a Gmail app password section to `docs/deploy-nas.md` (2-Step Verification, create app password, `secrets/smtp_pass`, `SMTP_*` values); verify by sending one real test email from a local run

## 9. Deploy and verify

- [ ] 9.1 Copy the site key and secret from the **same** Turnstile widget (not Cloudflare's test keys); put the secret on the NAS with `read -rs`, set `TURNSTILE_SITE_KEY` in `.env`, add the survey hostname to the widget's allowed domains; verify the live widget shows no "For testing only" label, a test submission saves, and `docker logs community-site-<env> 2>&1 | grep Turnstile` shows no test-key, rejected-key or not-configured line
- [ ] 9.2 Deploy the new image; verify the container is healthy, `https://<host>/s/pongal-2027` shows the survey (the `0001_survey` migration is applied at startup; a missing table would fail the first save in 9.4), and `docker logs community-site-<env> 2>&1 | grep -c "Turnstile is not configured"` on the NAS prints 0
- [ ] 9.3 Before 8:00 PM ET, verify the live page shows "The Pongal 2027 interest survey opens on Friday, November 20 at 8:00 PM ET."
- [ ] 9.4 After 8:00 PM ET, submit one test response on a phone, then resubmit with the same email in different letter case; verify one response with the second answers, the old edit link returns the invalid-link page, and the new link pre-fills the form
- [ ] 9.5 Remove the test response with the site stopped (design D10): `docker compose stop community-site`, `docker compose run --rm community-site npm run survey:remove -- pongal-2027 <test-email>`, `docker compose start community-site`; verify the CLI prints "Removed response" and the survey shows no active test response (via the CSV export once available), then share `https://<host>/s/pongal-2027` on WhatsApp
