# platform-runtime Specification

## Purpose

Defines how the community-site server starts, loads configuration and secrets, reports health, protects responses with security headers, and logs without exposing personal data.

## Requirements

### Requirement: Configuration from environment and secret files
The system SHALL read each setting from its environment variable, and for secret settings SHALL also accept `<NAME>_FILE` pointing to a file whose trimmed contents are the value. When both are set, the `_FILE` value MUST win. An empty value, whether an empty variable or a secret file that is empty after trimming, MUST be treated as not set.

#### Scenario: Secret read from file
- **GIVEN** `EDIT_TOKEN_KEY_FILE=/run/secrets/edit_token_key` and that file contains `k3y-value\n`
- **WHEN** the server starts
- **THEN** the edit token key in use is `k3y-value`

#### Scenario: File value wins over plain variable
- **GIVEN** `TURNSTILE_SECRET=from-env` and `TURNSTILE_SECRET_FILE` pointing to a file containing `from-file`
- **WHEN** the server starts
- **THEN** the Turnstile secret in use is `from-file`

#### Scenario: Secret file missing
- **GIVEN** `EDIT_TOKEN_KEY_FILE=/run/secrets/missing` and no such file exists
- **WHEN** the server starts
- **THEN** startup fails with the message "Cannot read secret file for EDIT_TOKEN_KEY: /run/secrets/missing"

#### Scenario: Empty secret file for an optional setting
- **GIVEN** `SMTP_PASS_FILE=/run/secrets/smtp_pass` and that file is empty or contains only `\n`
- **WHEN** the server starts
- **THEN** it starts normally and logs `SMTP_PASS: [not set]`

#### Scenario: Empty secret file for a required setting
- **GIVEN** `EDIT_TOKEN_KEY_FILE=/run/secrets/edit_token_key` and that file is empty
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "Missing required setting: EDIT_TOKEN_KEY (set EDIT_TOKEN_KEY or EDIT_TOKEN_KEY_FILE)"

### Requirement: Refuse to start without required settings
The system MUST stop at startup with a non-zero exit code when a required setting is missing or invalid, naming the setting but never printing any secret value.

#### Scenario: Missing required secret
- **GIVEN** neither `EDIT_TOKEN_KEY` nor `EDIT_TOKEN_KEY_FILE` is set
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "Missing required setting: EDIT_TOKEN_KEY (set EDIT_TOKEN_KEY or EDIT_TOKEN_KEY_FILE)"

#### Scenario: Invalid port
- **GIVEN** `PORT=abc`
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "Invalid setting PORT: must be a whole number between 1 and 65535"

### Requirement: Secret values never appear in logs or responses
The system MUST NOT write any secret value to logs, error pages or HTTP responses.

#### Scenario: Startup log
- **GIVEN** `TURNSTILE_SECRET_FILE` contains `0x4AAA-real-secret`
- **WHEN** the server starts and logs its effective configuration
- **THEN** the log shows `TURNSTILE_SECRET: [set]` and does not contain `0x4AAA-real-secret`

### Requirement: Health endpoint
The system SHALL expose `GET /healthz` returning JSON with the server and database status and no personal data.

#### Scenario: Healthy
- **WHEN** a client requests `GET /healthz` and the database answers a test query
- **THEN** the response is `200` with body `{"status":"ok","db":"ok"}`

#### Scenario: Database unavailable
- **WHEN** a client requests `GET /healthz` and the database test query fails
- **THEN** the response is `503` with body `{"status":"error","db":"unavailable"}`

### Requirement: Security headers on every response
The system SHALL send security headers on every HTML response: a Content-Security-Policy that only allows scripts from the site itself and `https://challenges.cloudflare.com`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`.

#### Scenario: Headers present
- **WHEN** a client requests `GET /healthz` or any HTML page
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`

#### Scenario: Script source restricted
- **WHEN** a client requests any HTML page
- **THEN** the `Content-Security-Policy` header contains `script-src 'self' https://challenges.cloudflare.com` and no `'unsafe-eval'`

### Requirement: Search engines do not index the site
The system SHALL serve `GET /robots.txt` disallowing all crawlers and SHALL send `X-Robots-Tag: noindex, nofollow` on every HTML response.

#### Scenario: robots.txt
- **WHEN** a client requests `GET /robots.txt`
- **THEN** the response is `200` with body `User-agent: *\nDisallow: /`

### Requirement: Logs contain no personal data
The system MUST NOT log request bodies, query strings of form submissions, names, emails, phone numbers or edit-link tokens. Each request log line SHALL include a request ID, method, route pattern, status and duration.

#### Scenario: Form submission logged
- **WHEN** a client posts a form containing `email=priya@example.com`
- **THEN** the request log line contains the request ID, `POST`, the route pattern and the status, and does not contain `priya@example.com`

#### Scenario: Token in URL not logged
- **WHEN** a client requests `/s/pongal-2027/edit/AbC123token`
- **THEN** the logged route is `/s/:event/edit/:token` and the log does not contain `AbC123token`

### Requirement: Friendly error pages
The system SHALL show a friendly HTML page for unknown routes and unexpected errors, without stack traces or internal details.

#### Scenario: Unknown page
- **WHEN** a client requests `GET /weather`
- **THEN** the response is `404` and the page says "Sorry, we couldn't find that page."

#### Scenario: Unexpected error
- **WHEN** a handler throws an unexpected error
- **THEN** the response is `500`, the page says "Something went wrong on our side. Please try again in a few minutes." and shows the request ID, and the log records the error with the same request ID
