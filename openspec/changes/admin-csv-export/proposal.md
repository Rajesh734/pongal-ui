# Proposal: admin-csv-export

## Why

Organizers want to watch the survey's trend every day while it is open and keep their own copy of the responses. The full decision report can wait until the survey closes, but a protected CSV download is needed from launch night. Admin pages hold personal data, so they must be reachable only by named organizers. That protection must hold even if the container is reached without going through Cloudflare.

## What Changes

- **Add** Cloudflare Access (Zero Trust Free plan, up to 50 organizers) in front of `/admin*`, with organizers signing in with a one-time email code (Google login optional).
- **Add** app-side verification of the Access token on every `/admin*` request: Cloudflare signature, issuer (team domain) and audience (the admin application's AUD tag). Requests without a valid token get `403`.
- **Add** an admin home page `/admin` listing events with active response counts (families and people) and a download link.
- **Add** CSV export of active responses per event, opening cleanly in Excel (UTF-8, Tamil names intact), protected against spreadsheet formula injection, and including weighted headcount per day.
- **Add** runbook steps for creating the Access application, policy, session length and the two non-secret settings.

## Capabilities

### New Capabilities

- `admin-access`: Who can reach admin pages and how each admin request is verified.
- `survey-csv-export`: Downloading an event's survey responses as a CSV file.

### Modified Capabilities

_None._

## Impact

- New module `src/modules/admin/`; new dependency `jose` for JWT verification.
- Uses `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` settings (non-secret) from the foundation config.
- Cloudflare dashboard: one self-hosted Access application on `<hostname>/admin*` with an allow policy listing organizer emails.
- Depends on `platform-foundation` and `pongal-2027-interest-survey`.

## Out of Scope

- Decision report page, charts, weighted totals summary page, XLSX export (later `decision-report` change).
- Soft delete, restore and anonymize from the admin UI; past-event history pages (later `admin-moderation` change).
- Role-based permissions between organizers (all allowed organizers see everything).
