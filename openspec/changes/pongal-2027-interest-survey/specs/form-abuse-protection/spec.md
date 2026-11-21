# Spec Delta

## Purpose

Protects public forms from bots, spam and floods of submissions while keeping the form easy for real families to complete.

## ADDED Requirements

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
- **WHEN** the verification request to Cloudflare times out after 5 seconds
- **THEN** nothing is saved and the top says "We couldn't reach our spam check. Please try again in a minute."

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
