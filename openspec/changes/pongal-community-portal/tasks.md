# Tasks

## 1. Data model and migrations

- [x] 1.1 Extend the Drizzle household schema for auth and contact preferences; verify `npm run db:generate` produces the expected SQL.
- [x] 1.2 Add registration, attendee, performance, volunteer-role, and payment tables with keys, checks, and indexes; verify the generated migration applies to in-memory PGlite.
- [x] 1.3 Add guest access-token, QR-pass, session, check-in, and check-in-permission tables; verify token uniqueness and foreign-key constraints in migration tests.
- [x] 1.4 Add transactional history snapshots for registration, payment, permission, and check-in changes; verify failed writes roll back both data and history.

## 2. Household authentication

- [x] 2.1 Implement manual signup and Google credential verification for household accounts; verify signup, Google signup, and unverified-Google scenarios with service tests.
- [x] 2.2 Implement one-time email verification links; verify successful, expired, and reused-link scenarios and their exact messages.
- [x] 2.3 Link verified identities to the existing case-insensitive household; verify matching guest registration access and different-email denial scenarios.
- [x] 2.4 Implement login, logout, and secure session lifecycle; verify successful login, generic login failure, logout, and expired-session scenarios.
- [x] 2.5 Add authenticated household profile reads and updates; verify own-profile access and unauthenticated redirection without exposing another household's data.
- [x] 2.6 Add auth route tests for rate limits, CSRF/origin rejection, and session-cookie flags; verify no credential or token is written to browser-readable storage.
- [x] 2.7 Collect first and last name for manual signup, show Google sign-up on the signup page, and explain when SMTP is not configured; verify name validation and the SMTP message.

## 3. Household registration

- [x] 3.1 Implement guest and signed-in registration creation plus secure guest access links; verify guest save, account registration, and invalid-link scenarios.
- [x] 3.2 Build the attendee editor with the adult primary contact fixed in row one and all age bands available for additional attendees; verify age restrictions and attendee summaries.
- [x] 3.3 Implement integer-cent pricing and live totals; verify the mixed-age $95 example and total recalculation when an age band changes.
- [x] 3.4 Use attendee one as the primary contact and enforce exactly 10 national digits for international mobile/WhatsApp numbers; verify US +1 defaults, India +91, and consent.
- [x] 3.5 Add the repeatable cultural-performance form and duration rules; verify one entry, the two-entry limit, all three duration thresholds, missing details, and organizer-contact message.
- [x] 3.6 Add per-attendee volunteer opt-in and the agreed role checkboxes; verify selected attendee names and roles appear in reports without re-entry, with no roles for non-volunteers and rejection of tampered roles.
- [x] 3.7 Implement Zelle instructions, an explicit pay-later choice, and payer declaration; verify payment remains pending until organizer confirmation and messaging prevents duplicate payment.
- [x] 3.8 Implement registration edit/access behavior and status messages; verify pending guest access, confirmed account history, and that no QR pass appears before payment confirmation.
- [x] 3.9 Add registration service tests confirming every mutation writes a history snapshot and duplicate submissions for the same household/event do not create duplicate active registrations.

## 4. Organizer payment and reporting

- [x] 4.1 Add the pending-payment queue using existing organizer authentication; verify it shows household, amount, payer, and reference, and denies non-organizers.
- [x] 4.2 Implement organizer payment confirmation and audit details; verify a verified transfer confirms once and an unmatched transfer remains pending.
- [x] 4.3 Extend the registration report with attendees, performances, and volunteer selections; verify named volunteers and selected roles are filterable and non-volunteers are omitted.
- [x] 4.4 Add administrator controls for check-in grants and revocations; verify grant, revoke, audit record, and denial for contacts without a verified household account.
- [x] 4.5 Add the protected admin navigation and separate activity pages; verify all four pages use existing organizer authentication.
- [x] 4.6 Add event/payment-status filters to the attendee roster; verify matching and empty-result scenarios.
- [x] 4.7 Add UTF-8 per-attendee registration CSV export; verify household/payment fields repeat, formula-leading values are neutralized, and non-organizers receive no data.

## 5. QR passes and event check-in

- [x] 5.1 Generate an opaque random pass only after payment confirmation; verify QR payloads contain no personal data and pending registrations have no usable pass.
- [x] 5.2 Build the authenticated mobile scanner and manual-code fallback; verify valid, unpaid, invalid, and wrong-event scan scenarios.
- [x] 5.3 Record household check-in with scanner identity and timestamp; verify one check-in per registration, repeat-scan messaging, and no duplicate history entry.
- [x] 5.4 Enforce the separate check-in permission on every scan; verify approved access, volunteer-without-permission denial, and revocation during an active session.
- [x] 5.5 Add browser tests for camera permission denied, camera unavailable, and successful scan on HTTPS at mobile viewport sizes.
- [x] 5.6 Link the scanner from the admin menu and from the account menu for households with check-in permission; add a vendored jsQR fallback for browsers without BarcodeDetector and a Stop camera control; verify with route and browser tests.
- [x] 5.7 Show scan results in bold, colour-coded panels (green checked in, yellow already checked in, red invalid/unpaid/wrong event); verify the result classes in route tests.

## 6. Portal pages and navigation

- [x] 6.1 Change `/` to render Home with event-configured details and Register CTA; verify the root route and that unapproved date/agenda values are not presented as final.
- [x] 6.2 Add About, Profile, and My Registrations pages; verify approved content, pending/confirmed status, confirmed pass display, and cross-household privacy.
- [x] 6.3 Update signed-in and signed-out navigation; verify the account actions and public links for both states.
- [x] 6.4 Remove Interest Survey links from Home and navigation while retaining its route, source, and data; verify the portal has no survey menu or CTA.
- [x] 6.5 Verify mobile navigation, account menu, registration entry point, and page layout at 360 px without horizontal scrolling.
- [x] 6.6 Add the top-left three-line mobile menu and top-right user-icon account dropdown that close on outside click or Escape; verify signed-in and signed-out menu actions in the browser.
- [x] 6.7 Match header logo orientation, use a cream-background favicon, and constrain auth/registration form widths; verify desktop widths and equal input sizes.
- [x] 6.8 Add blur-time inline validation backed by the same server rules; verify one message per field while typing and deleting.
- [x] 6.9 Show admin table rows as labelled stacked cards on phones and widen admin pages on desktop; rename "Age band" to "Age group" with 11+, 5-10, 0-4 in admin pages and CSV; verify in admin tests.
- [x] 6.10 Reorganize the registration form into numbered sections with plain checkboxes, filled secondary buttons, attendee and performance cards, a WhatsApp same-as-mobile option, role disclosure, and live performance time hints; verify at 390 px and 1280 px and in schema, route, and browser tests.

## 7. Localization

- [ ] 7.1 Add English, Tamil, Telugu, Kannada, and Malayalam message catalogs; verify every portal page has complete required labels and no runtime translation request.
- [ ] 7.2 Persist language selection with English as the default; verify preference across Home, Register, About, Profile, and My Registrations and fallback for an unsupported locale.
- [ ] 7.3 Localize server and browser validation, payment instructions, and status messages; verify validation stays consistent with JavaScript enabled or disabled.
- [ ] 7.4 Verify attendee names and compere introductions remain unchanged when viewed in another locale and all supported scripts render on desktop and mobile.

## 8. Integration and deployment verification

- [x] 8.1 Verify all migrations and core registration/auth tests pass on PGlite; run the full `npm test` suite and resolve regressions.
- [x] 8.6 Harden deployment diagnostics: accept same-origin `Origin: null` posts, log blocked origins and admin denial reasons, allow the GIS popup via `same-origin-allow-popups`, accept Google redirect-mode callbacks via `g_csrf_token`, and validate Compose in CI with all required placeholders.
- [ ] 8.2 Configure both NAS app environments for PostgreSQL over `kalanjiyam-net`, with separate databases/roles and secret-file passwords; verify Compose publishes no PostgreSQL port and the app health check passes.
- [ ] 8.3 Configure Google authorized origins and SMTP in the deployment environment without exposing secrets; verify manual verification, Google sign-in, guest links, and pass delivery end to end.
- [ ] 8.4 Configure organizer-approved 2027 date, venue, agenda, About copy, and payment recipient; verify the public pages show the approved values.
- [ ] 8.5 Deploy to non-production and verify guest registration through organizer payment confirmation, QR delivery, registration CSV, volunteer report, and phone check-in; record the smoke-test result.