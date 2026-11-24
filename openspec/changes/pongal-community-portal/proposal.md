# Proposal: Pongal Community Portal

## Why

The current site serves an interest survey, while organizers now need a usable Pongal event portal for household registration, payment tracking, cultural performances, volunteering, and event-day check-in. Families should be able to register without an account, while verified household accounts provide a way to manage registrations across visits and years.

## What Changes

- Add a Home page with event details and a primary registration link, plus Registration, About, Profile, and My Registrations pages. Remove the existing interest survey from navigation but retain its implementation and data for future reuse; Google Forms will serve this year's survey.
- Add household accounts with Google sign-in or manual email/password signup, email verification for manual accounts, login/logout, and secure linking to matching guest registrations.
- Add family registration with named attendees and event-date age bands: age 11+ at $35, age 5-10 at $25, and under 5 free. Collect a primary contact's mobile and an optional distinct WhatsApp number, with country selectors defaulting to US +1.
- Collect up to two cultural performances per household, with participant names, performance details, duration limits, and a short compere introduction. More than two performances direct the family to contact an organizer.
- Collect volunteer interest and existing volunteer roles for named attendees, without requiring names to be re-entered.
- Track Zelle payments as pending until an organizer verifies them through the existing admin access. Issue a QR entry pass only after payment is confirmed; allow authorized, organizer-approved check-in users to scan passes.
- Add a protected organizer dashboard with separate Registrations, Payments, Volunteers, and Check-in Access pages; provide a per-event attendee roster and CSV export.
- Add an English-default language selector for English, Tamil, Telugu, Kannada, and Malayalam across the site.
- Extend the existing Drizzle schema and migrations while retaining PGlite for current development and tests.

## Capabilities

### New Capabilities

- `household-authentication`: Household accounts, Google and manual sign-in, email verification, sessions, and guest-registration linking.
- `event-registration`: Household attendee registration, fee calculation, cultural performance details, volunteer selections, guest access, and payment-pending state.
- `event-check-in`: QR passes, authorized scanning, duplicate-scan handling, and check-in records.
- `organizer-operations`: Payment verification, volunteer reporting, and administrator-controlled check-in permissions.
- `community-portal`: Home, About, Profile, My Registrations, navigation, and survey visibility.
- `site-localization`: Language selection and translated server-rendered pages and validation messages.

### Modified Capabilities

None. The project has no durable specs yet; existing survey and foundation work remains unchanged.

## Impact

- New feature modules and views under `src/modules/`, shared locale/message data, and new Drizzle schema definitions and migrations under `src/db/` and `drizzle/`.
- Uses the existing PostgreSQL/PGlite driver selection, SMTP settings, and admin authentication. Google sign-in requires verifying the configured Google client and allowing its browser origin in the site's security policy.
- Requires event date, final agenda, venue, and About-page content from the organizer before publication.

## Out of Scope

- Importing existing PGlite data into PostgreSQL; retain it until organizers decide what historical survey data to migrate.
- Automated WhatsApp messaging, online payment processing, and offline QR scanning.
- Removing the existing interest-survey code or data, or adding Tulu translations.
- Treating the prior-year flyer schedule as final 2027 event details.