# Proposal: pongal-2027-interest-survey

## Why

Organizers need a non-binding headcount and interest signal for Pongal 2027 (Sat Jan 16 / Sun Jan 17, 2027) to decide whether to run the event and how to size the venue, catering and contribution. Last year's Google Form accepted bad emails, phone numbers and nonsense counts, showed unhelpful errors, and let families submit duplicates. The survey must open tonight (Fri, Nov 20, 2026, 8:00 PM ET) and close around Tue, Nov 24, and it must work well on phones opened from WhatsApp links.

## What Changes

- **Add** a public, mobile-first survey page for event `pongal-2027` that respects the open/close window from the event config and shows friendly not-yet-open and closed messages.
- **Add** 12 survey fields with one shared validation schema that runs both in the browser and on the server, with specific messages next to each field: name, email, optional US mobile, days (Sat/Sun), likelihood per selected day, headcount by age band (11+, 5-10, under 5), food preference, volunteer roles, cultural interest, comfortable contribution per adult, comments and consent.
- **Add** one response per family per event: the same email (any letter case) overwrites the previous answers, last update wins, and every version is kept in history.
- **Add** a confirmation page with a summary and a private edit link. Each public submission issues a new link and cancels the old one. The email is read-only when editing, and links stop working when the survey closes.
- **Add** optional email of the edit link through Gmail SMTP when configured, limited per recipient.
- **Add** abuse protection: Cloudflare Turnstile (when keys are set), a hidden honeypot field, and per-IP rate limits.

## Capabilities

### New Capabilities

- `interest-survey`: The public survey form, its window states, validation rules and messages, saving one response per household per event, and the confirmation page.
- `survey-edit-link`: Private edit links (issue, rotate, edit, expire) and the optional edit-link email.
- `form-abuse-protection`: Bot and spam protection for public forms (Turnstile, honeypot, rate limits).

### Modified Capabilities

_None._

## Impact

- New module `src/modules/survey/`, shared schema and messages in `src/shared/`, Alpine.js and vendored Zod ESM in `src/public/`.
- New migration adding `survey_responses`, `response_days`, `response_headcounts`, `response_volunteer_roles`.
- New dependency: nodemailer. Uses `EDIT_TOKEN_KEY`, `TURNSTILE_*`, `SMTP_*` settings from the foundation.
- Depends on change `platform-foundation`.

## Out of Scope

- WhatsApp number, international phone numbers, pricing tiers shown to families (Registration phase).
- Admin pages, CSV export (change `admin-csv-export`); decision report and XLSX (later).
- Merging two households of the same family; changing email through the edit link.
- Payments, registration, cultural entries, confirmation email for registration.
