# admin-access Specification

## Purpose

Ensures that only organizers approved in Cloudflare Access can reach admin pages and personal data, and that the app itself verifies this on every admin request.

## Requirements

### Requirement: Admin requests require a valid Access token
Every request to `/admin` or any path under `/admin/` MUST carry a `Cf-Access-Jwt-Assertion` token that is signed by a current key of the configured Cloudflare Access team, has issuer `https://<team domain>`, has the configured AUD tag in its audience, and is not expired. Otherwise the system MUST respond `403` with "You don't have access to this page." and no personal data.

#### Scenario: Valid token
- **GIVEN** `CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com` and `CF_ACCESS_AUD=abc123`
- **WHEN** `GET /admin` arrives with a token signed by that team's key, issuer `https://yourteam.cloudflareaccess.com`, audience `["abc123"]`, expiring in 1 hour
- **THEN** the admin page is shown

#### Scenario: No token
- **WHEN** `GET /admin/events/pongal-2027/responses.csv` arrives without `Cf-Access-Jwt-Assertion`
- **THEN** the response is `403` with "You don't have access to this page."

#### Scenario: Token for another application
- **WHEN** a correctly signed token arrives whose audience is `["dsm-app-aud"]`
- **THEN** the response is `403` with "You don't have access to this page."

#### Scenario: Expired token
- **WHEN** a correctly signed token arrives that expired 1 minute ago
- **THEN** the response is `403` with "You don't have access to this page."

#### Scenario: Forged token
- **WHEN** a token arrives signed by a key that is not one of the team's published keys
- **THEN** the response is `403` with "You don't have access to this page."

#### Scenario: Look-alike path
- **WHEN** a request arrives for `/ADMIN` or `/admin%2F` without a token
- **THEN** the response is `403` or `404`, never an admin page

### Requirement: Public pages need no token
Paths outside `/admin` MUST NOT require an Access token.

#### Scenario: Survey without token
- **WHEN** `GET /s/pongal-2027` arrives without `Cf-Access-Jwt-Assertion`
- **THEN** the survey page is served normally

### Requirement: Admin configuration required to serve admin pages
When `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` is missing, the system SHALL still start and serve public pages, MUST answer every admin request with `403`, and SHALL log "Admin pages are disabled: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set." at startup.

#### Scenario: Not configured
- **GIVEN** `CF_ACCESS_AUD` is not set
- **WHEN** `GET /admin` arrives with any token
- **THEN** the response is `403` with "You don't have access to this page."

### Requirement: Signing keys refreshed automatically
The system SHALL fetch the team's public signing keys from `https://<team domain>/cdn-cgi/access/certs`, cache them, and refetch when a token names an unknown key, at most once per minute.

#### Scenario: Cloudflare rotates keys
- **GIVEN** cached keys K1 and K2
- **WHEN** a valid token signed with new key K3 arrives
- **THEN** the keys are refetched once and the request succeeds

#### Scenario: Key endpoint unreachable
- **WHEN** keys cannot be fetched and none are cached
- **THEN** the response is `503` with "Admin sign-in check is temporarily unavailable. Please try again in a minute."

### Requirement: Admin identity shown and recorded
The system SHALL take the organizer's email from the verified token, show it on admin pages as "Signed in as <email>", and use it as the actor for any data change made from admin pages.

#### Scenario: Signed-in banner
- **WHEN** organizer `rajesh@example.com` opens `/admin`
- **THEN** the page shows "Signed in as rajesh@example.com"
