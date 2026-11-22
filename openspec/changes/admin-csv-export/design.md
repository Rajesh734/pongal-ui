# Design: admin-csv-export

## Context

See proposal.md for motivation and specs for behaviour. The app is reachable only through the existing Cloudflare Tunnel (no published host port, per foundation D10). Cloudflare Access (Zero Trust Free plan) handles organizer sign-in. After sign-in, Cloudflare forwards each request with a `Cf-Access-Jwt-Assertion` header: a JWT signed with Cloudflare's private key for the team, carrying the user's `email`, `iss = https://<team>.cloudflareaccess.com`, `aud = [<application AUD tag>]` and `exp`. The public keys are published at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.

## Goals / Non-Goals

**Goals:**
- Defence in depth: Access stops strangers at Cloudflare, and the app independently rejects any `/admin` request without a valid token for this application.
- A CSV export that organizers can open in Excel with no import wizard and no formula risk.

**Non-Goals:**
- App-managed passwords or sessions.
- Report pages beyond simple counts; XLSX.

## Decisions

### D1. Verify the Access JWT with `jose`
An `onRequest` hook on the admin route prefix calls `jwtVerify(token, createRemoteJWKSet(new URL('https://<team>/cdn-cgi/access/certs'), { cooldownDuration: 60_000 }), { issuer: 'https://<team>', audience: CF_ACCESS_AUD, algorithms: ['RS256'] })`. On success, `request.adminEmail = payload.email`. On any failure, it returns 403 with the shared page. A JWKS fetch failure with no cached keys returns 503.
- *Trust Access alone (no app check)* - rejected: anyone reaching the container another way (LAN, a mistaken tunnel route, Access accidentally disabled) would see personal data.
- *Hand-written RS256 verification* - rejected: easy to get wrong; `jose` is small, dependency-free and widely used.
- *Check only the `Cf-Access-Authenticated-User-Email` header* - rejected: plain header, trivially spoofed.

### D2. Route prefix and path matching
Admin routes are registered in a Fastify plugin with `prefix: '/admin'` and the hook inside that plugin, so every current and future admin route inherits the check. Fastify matches routes case-sensitively and does not decode `%2F` into a path separator, so `/ADMIN` and `/admin%2F` reach the 404 handler, which never renders admin data.
- *Global hook comparing `url.startsWith('/admin')`* - rejected: brittle with case and encoding variants.

### D3. Disabled-but-safe when not configured
If either setting is missing, the admin plugin registers a hook that always returns 403, and startup logs the warning. Public pages are unaffected, so the survey can launch before Access is set up.

### D4. CSV generation
A small hand-written serializer, with no dependency:
- Prefix a UTF-8 BOM (`\uFEFF`) so Excel detects UTF-8 (Tamil names). Use CRLF line endings.
- Cell guard: if the value starts with `=`, `+`, `-`, `@`, `\t` or `\r`, prefix `'`. Then quote the value if it contains `,`, `"`, CR or LF, doubling any inner quotes.
- Mobile is formatted as `617-555-0123` (no leading `+`), so it is not mangled by the guard or by Excel's number handling.
- Times are formatted `YYYY-MM-DD HH:mm` in the event timezone. Weighted values use `toFixed(2)`.
- Data comes from one query joining responses (active only), households, days, headcounts and roles, aggregated in JS. This is fine for hundreds of rows.
- *csv-stringify / papaparse* - rejected: one more dependency for about 30 lines; the formula guard still has to be written by hand.
- *XLSX now* - rejected: deferred to the report change, as agreed.

### D5. Counts on `/admin`
One aggregate query per event: active responses and the sum of headcounts. The survey state comes from `surveyState`.

### D6. Cloudflare Access setup (runbook)
1. Zero Trust -> Settings -> Authentication: keep **One-time PIN**; optionally add **Google**.
2. Access -> Applications -> Add -> Self-hosted: domain `<hostname>`, path `admin` (covers `/admin*`), session duration **24h**.
3. Policy "Organizers": Action Allow, Include -> Emails: the organizer list.
4. Copy the **AUD tag** from the application overview; the team domain is in Settings -> Custom Pages.
5. NAS `.env`: `CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`, `CF_ACCESS_AUD=<tag>`; restart.
6. Organizers turn on 2-Step Verification for their email accounts.

## Risks / Trade-offs

- [An organizer's mailbox is compromised] -> Ask organizers to enable 2-Step Verification on their email; 24h sessions; revoke sessions in Zero Trust -> Users.
- [Access policy path typo leaves `/admin` public at Cloudflare] -> The app check still returns 403. Deployment task 5.3 checks both layers.
- [Cloudflare key endpoint down] -> 503 on admin pages only; the survey is unaffected.
- [CSV opened in other tools may show a leading `'` on guarded cells] -> Accepted; it's the standard mitigation, and only cells starting with risky characters are affected.

## Migration Plan

1. Deploy with the settings unset: admin returns 403 and the survey works.
2. Create the Access application and policy, set the two settings, and restart.
3. Verify both layers (tasks 5.x). Rollback: unset the settings (admin disabled) or remove the Access app. Data is unaffected.
