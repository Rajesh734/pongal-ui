# platform-quality Specification

## Purpose

Defines the cross-cutting qualities every page and the deployment must meet: security headers, abuse limits, accessibility, performance, backup and the supported environment.

## Requirements

### Requirement: Security headers
Every response SHALL carry a Content-Security-Policy that allows scripts only from the site itself, Cloudflare Turnstile and Google sign-in; forbids framing (`frame-ancestors 'none'`); and sends `Referrer-Policy: no-referrer`.

#### Scenario: Framing is blocked
- **WHEN** another site embeds a page in a frame
- **THEN** the browser refuses to display it

### Requirement: Request rate limit
The system SHALL limit each client IP to 120 requests per minute across the site, answering excess requests with HTTP 429, and apply stricter limits to sign-in and registration submissions. The client IP MUST be read from the trusted proxy headers set by Cloudflare.

#### Scenario: Burst of requests
- **WHEN** one IP makes more than 120 requests within a minute
- **THEN** the extra requests receive 429 and the site's "too fast" message

### Requirement: Form security
Every state-changing form SHALL include a CSRF token and be accepted only from the site's own origin. Failures MUST respond 403 with "Form security check failed." or "Request origin is not allowed."

#### Scenario: Missing token
- **WHEN** a POST arrives without a valid CSRF token
- **THEN** it is rejected with 403 "Form security check failed." and nothing is saved

### Requirement: Accessibility
All pages SHALL work with keyboard only, show a visible focus outline, give interactive controls at least 44 by 44 px, tie error messages to their fields, and never rely on color alone to convey an error.

#### Scenario: Field error
- **WHEN** a form field is invalid
- **THEN** its message appears next to the field, is announced as an alert, and the field is marked `aria-invalid`

### Requirement: Mobile-first performance
Pages SHALL be usable on a 360px wide phone over a mobile connection: no front-end build step, no web fonts or third-party scripts except Turnstile and Google sign-in, and hero images loaded only where a page needs them.

#### Scenario: Plain page weight
- **WHEN** the home page is measured
- **THEN** it loads without any request to a site other than itself, Turnstile or Google

### Requirement: Backups and restore
Production data SHALL be backed up daily by the PostgreSQL 18 stack's backup service (`prodrigestivill/postgres-backup-local:18`, dumps under `/volume1/docker/kalanjiyam/backups`), retaining 30 daily, 8 weekly and 12 monthly dumps, and the folder MUST be included in the NAS's client-side-encrypted Hyper Backup task. Operators MUST be able to restore a dump into a temporary database to verify it. The built-in nightly archive (14 days) applies only to the embedded development database (`DB_DRIVER=pglite`).

#### Scenario: Restore test
- **WHEN** an operator restores the latest dump into a temporary database
- **THEN** the households, registrations and payments counts match production

### Requirement: Supported environment
The application SHALL run as a non-root user in a Node.js 26 container, connect to PostgreSQL 18 over a private Docker network with no published database port, and expose `/healthz` returning `{"status":"ok","db":"ok"}` only when the database responds.

#### Scenario: Database down
- **WHEN** the database cannot be reached
- **THEN** `/healthz` does not report `db: ok` and the container is marked unhealthy
