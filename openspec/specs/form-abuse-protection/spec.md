# form-abuse-protection Specification

## Purpose

Protects public forms from bots, spam and floods of submissions while keeping the form easy for real families to complete.

## Requirements

### Requirement: Turnstile check when configured
When both the Turnstile site key and secret are configured, every public form SHALL include the Turnstile widget, and the server MUST verify the widget token with Cloudflare, passing the visitor's IP, before validating or saving anything.

#### Scenario: Verification passes
- **GIVEN** Turnstile is configured
- **WHEN** a valid form is submitted with a token Cloudflare accepts
- **THEN** the response is saved

#### Scenario: Verification fails
- **WHEN** a form is submitted with a missing or rejected Turnstile token
- **THEN** nothing is saved, the form is shown again with the entered values kept, and the top says "We couldn't confirm you're not a robot. Please try again."

#### Scenario: Cloudflare unreachable
- **WHEN** the verification request to Cloudflare times out after 5 seconds, fails with a network error, or gets an HTTP 5xx answer
- **THEN** nothing is saved, the top says "We couldn't reach our spam check. Please try again in a minute.", and the log records "Turnstile verification unreachable" with the HTTP status or error name only

### Requirement: Turnstile misconfiguration is reported
When Cloudflare rejects the server's secret key (an HTTP 4xx answer, or error code `invalid-input-secret` or `missing-input-secret`), the system MUST NOT save anything, MUST show the visitor a message that does not blame them, and MUST log the Cloudflare error codes so the organizer can fix the keys. Logs of any failed check MUST contain only the HTTP status and Cloudflare error codes, never the secret, the widget token or the visitor's IP.

#### Scenario: Rejected secret key
- **GIVEN** `TURNSTILE_SECRET` does not belong to the widget of `TURNSTILE_SITE_KEY`
- **WHEN** a form is submitted and Cloudflare answers `400` with error code `invalid-input-secret`
- **THEN** nothing is saved, the form is shown again with the entered values kept, the top says "Our spam check isn't set up correctly. Please contact the organizers.", and the log records "Turnstile rejected the secret key (invalid-input-secret) - check TURNSTILE_SECRET and TURNSTILE_SITE_KEY" at error level

### Requirement: Test keys warned at startup
When the Turnstile site key or secret is one of Cloudflare's published test keys (matching `^[123]x0{20,}[A-F]{2}$`), the system SHALL log a warning at startup.

#### Scenario: Test site key
- **GIVEN** `TURNSTILE_SITE_KEY` is `1x00000000000000000000AA`
- **WHEN** the server starts
- **THEN** it logs "Turnstile is using Cloudflare test keys - the widget shows 'For testing only' and does not protect the form."

### Requirement: Turnstile optional until configured
When the Turnstile site key or secret is missing, the system SHALL serve forms without the widget, skip the check, and log a warning at startup.

#### Scenario: Not configured
- **GIVEN** `TURNSTILE_SECRET` is not set
- **WHEN** the server starts
- **THEN** it logs "Turnstile is not configured - public forms rely on the honeypot and rate limits only." and forms work without the widget

### Requirement: Honeypot field
Every public form SHALL include a hidden `website` field that people do not see. When it is filled in, the system MUST NOT save anything and SHALL show "Thank you! Your response has been received." with no edit link.

#### Scenario: Bot fills hidden field
- **WHEN** a submission includes `website=http://spam.example`
- **THEN** nothing is saved, the page says "Thank you! Your response has been received.", and the log records "honeypot triggered" without any submitted values

#### Scenario: Real visitor
- **WHEN** a visitor submits the form normally
- **THEN** the `website` field is empty and the submission is processed

### Requirement: Submission rate limit per IP
The system SHALL allow at most 10 form submissions (public form and edit link combined) per client IP per hour, using the visitor IP forwarded by Cloudflare. Further submissions MUST get `429` with "Too many submissions from your network. Please try again in an hour."

#### Scenario: Eleventh submission
- **GIVEN** 10 submissions came from IP `203.0.113.7` in the last hour
- **WHEN** an 11th submission arrives from `203.0.113.7`
- **THEN** the response is `429` with "Too many submissions from your network. Please try again in an hour." and nothing is saved

#### Scenario: Different IPs
- **GIVEN** 10 submissions came from `203.0.113.7`
- **WHEN** a submission arrives from `198.51.100.4`
- **THEN** it is processed normally

### Requirement: Page request rate limit per IP
The system SHALL allow at most 120 page requests per client IP per minute and MUST answer further requests with `429` and "You're going a bit fast. Please wait a minute and try again."

#### Scenario: Burst of page loads
- **WHEN** IP `203.0.113.7` makes its 121st request within one minute
- **THEN** the response is `429` with "You're going a bit fast. Please wait a minute and try again."

### Requirement: Request size limit
The system MUST reject form submissions larger than 16 KB with `413` and "That submission is too large. Please shorten your comments and try again."

#### Scenario: Oversized body
- **WHEN** a submission of 20 KB arrives
- **THEN** the response is `413` with "That submission is too large. Please shorten your comments and try again." and nothing is saved
