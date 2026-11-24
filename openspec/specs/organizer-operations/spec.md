# organizer-operations Specification

## Purpose

Gives existing authorized organizers the information and controls needed to verify Zelle payments, review family and volunteer registrations, and approve check-in users.

## Requirements

### Requirement: Organizer dashboard separates activities
The organizer dashboard SHALL provide separate pages for registrations, payment review, volunteer reporting, and check-in access, protected by existing organizer authentication.

#### Scenario: Organizer navigates between activities
- **WHEN** an authorized organizer opens the admin dashboard
- **THEN** the site header menu (mobile menu and desktop navigation) offers "Dashboard", "Registrations", "Payments", "Volunteers", "Check-in Access", "Scan Passes", and "Public site" as separate pages, marks the current page, and the pages themselves do not repeat this navigation below the header

#### Scenario: Organizer reviews a wide table on a phone
- **WHEN** an organizer views the payment or check-in access table on a screen narrower than 48rem
- **THEN** each row is shown as a stacked card with every column label and value visible, including the "Confirm payment" action, without horizontal scrolling or rotating the device

#### Scenario: Organizer scrolls registration and volunteer reports
- **WHEN** an organizer views the Registrations or Volunteers table on a screen narrower than the table
- **THEN** the table keeps its columns on one line and scrolls horizontally inside the page with a visible scrollbar and a "Scroll sideways to see all columns" hint, while the page itself does not scroll sideways

#### Scenario: Organizer reads attendees grouped by household
- **WHEN** an organizer views the Registrations or Volunteers table
- **THEN** each household appears once, with its contact name and email together in a single Household cell spanning its attendee rows, and on Registrations the performances, amount, and payment status also appear once per household

#### Scenario: Organizer reviews tables on a desktop
- **WHEN** an organizer views an admin table on a wide screen
- **THEN** the admin page uses a wider layout and the table scrolls horizontally within the page if it still does not fit

#### Scenario: Organizer reads attendee ages
- **WHEN** an organizer views registrations, volunteers, or the CSV export
- **THEN** the column is labelled "Age group" and values are shown as "11+", "5-10", or "0-4"

#### Scenario: Unauthenticated visitor opens an organizer page
- **WHEN** a visitor without organizer authentication requests any organizer page
- **THEN** no organizer data is returned and access is denied

#### Scenario: Developer tests organizer pages locally
- **GIVEN** NODE_ENV is development, Cloudflare Access is not configured, and ADMIN_DEV_EMAIL is set
- **WHEN** a request reaches an organizer page directly from localhost without proxy headers
- **THEN** the page is shown as that email, while proxied, non-localhost, and non-development requests are still denied and configuration refuses ADMIN_DEV_EMAIL outside development

#### Scenario: Organizer access is misconfigured
- **WHEN** a request is denied because the Cloudflare Access token is missing, has the wrong audience, has the wrong issuer, or has no email
- **THEN** the visitor sees "You don't have access to this page." and the server logs the specific reason without logging the token

### Requirement: Organizer registration roster
An authorized organizer SHALL be able to view and filter event registrations by event and payment status, including household contact, attendee names and age bands, amount, and registration status.

#### Scenario: Organizer filters registrations
- **WHEN** an organizer selects the Pongal event and "Payment pending"
- **THEN** the roster shows only matching households and displays "No registrations match these filters." when none match

### Requirement: Organizer exports attendee registrations
An authorized organizer SHALL be able to export the selected event's registrations as UTF-8 CSV with one row per attendee and household/payment fields repeated for each attendee. The export MUST prevent spreadsheet formula injection.

#### Scenario: Organizer exports registrations
- **WHEN** an organizer exports the Pongal event roster
- **THEN** the CSV contains each attendee's name and age band, household contact details, registration status, payment status, and amount due

#### Scenario: Export protects spreadsheet cells
- **WHEN** an exported field begins with a spreadsheet formula character
- **THEN** the CSV encodes the value as text so a spreadsheet does not execute it as a formula

#### Scenario: File name, encoding and columns
- **WHEN** an organizer exports `pongal-2027` registrations
- **THEN** the download is named `pongal-2027-registrations.csv`, starts with a UTF-8 byte-order mark so Excel shows Tamil names correctly, uses CRLF line endings, and quotes every cell
- **AND** the header row is: Event, Registration ID, Household contact, Email, Mobile, WhatsApp, Attendee, Age group, Volunteer roles, Registration status, Payment status, Amount due (USD), Payer name, Zelle reference, Performance, Participants, Duration minutes, Compere introduction

#### Scenario: Status filter applies to the export
- **WHEN** an organizer exports with the status filter set to `payment_pending`
- **THEN** only attendees of registrations in that status are exported

#### Scenario: Household with several attendees
- **GIVEN** a household registered attendees "Asha Kumar" and "Ravi Kumar" with a total of $30.00
- **WHEN** the CSV is exported
- **THEN** it has one row per attendee, grouped as on the Registrations page: the household contact, email, phone numbers, registration status, payment status, Amount due, payer, Zelle reference and performance cells are filled on the first attendee row only and left blank on the others, while Event, Registration ID and the attendee cells appear on every row, so the Amount due column can be summed

#### Scenario: Registration without attendees
- **GIVEN** a registration with no attendees
- **WHEN** the CSV is exported
- **THEN** it still has one row with the registration cells and blank attendee cells

#### Scenario: Phone numbers stay readable
- **GIVEN** a household mobile number `+16175550123`
- **WHEN** the CSV is exported
- **THEN** the Mobile cell reads `617-555-0123` with no leading apostrophe; a non-US number keeps its leading `+`

#### Scenario: Event without registrations
- **WHEN** an organizer exports an event that has no registrations
- **THEN** the CSV contains only the header row

#### Scenario: Unknown or non-registration event
- **WHEN** an organizer requests the CSV and no registration-enabled event exists
- **THEN** the system responds 404 with "No registration event is available."

#### Scenario: Non-organizer requests CSV
- **WHEN** a user without organizer authentication requests the registration CSV
- **THEN** the system denies access and returns no registration data

### Requirement: Pending-payment review
An authorized organizer SHALL be able to review registrations awaiting payment verification and mark a payment confirmed only after checking the receiving account. The system MUST record the organizer and confirmation time.

#### Scenario: Organizer confirms a Zelle payment
- **GIVEN** a registration is payment pending and its Zelle transfer has been verified
- **WHEN** an authorized organizer marks it paid
- **THEN** the system records the organizer and time, changes the status to confirmed, and makes its QR pass available

#### Scenario: Organizer opens the pending queue
- **WHEN** an authorized organizer opens payment review
- **THEN** the queue shows each pending household, amount due, payer name, and submitted payment reference

#### Scenario: Payment details do not match
- **GIVEN** a pending registration's submitted payment details do not match a received transfer
- **WHEN** an organizer reviews it
- **THEN** the registration remains pending and the organizer can leave it for follow-up

#### Scenario: Non-organizer attempts payment review
- **WHEN** a user without existing organizer access opens payment review
- **THEN** access is denied and the system displays "You don't have permission to view organizer tools."

### Requirement: Registration and volunteer report
The organizer report SHALL show household registration status, attendees, cultural entries, and volunteer role selections associated with each named attendee. Personal registration data MUST remain limited to authorized organizers.

#### Scenario: Organizer reviews volunteer assignments
- **GIVEN** Priya selected "Registration desk" and "Photography" as volunteer roles
- **WHEN** an authorized organizer opens the volunteer report
- **THEN** Priya appears with both selected roles and her household contact

#### Scenario: Household did not opt in to volunteering
- **GIVEN** a household has no attendee marked willing to volunteer
- **WHEN** an organizer opens the volunteer report
- **THEN** no volunteer assignment is shown for that household

#### Scenario: Unauthenticated report request
- **WHEN** a visitor without organizer access opens the registration report
- **THEN** access is denied and no personal registration data is returned

### Requirement: Administrator controls check-in permission
An authorized organizer SHALL be able to grant or revoke check-in permission for a signed-in household account. Volunteer selection MUST NOT automatically grant this permission.

#### Scenario: Organizer grants check-in permission
- **GIVEN** Priya has a verified household account
- **WHEN** an authorized organizer grants her check-in permission
- **THEN** Priya can use the event scanner and the grant is recorded in organizer history

#### Scenario: Organizer grants permission from the volunteer report
- **GIVEN** Priya appears on the Volunteers page and has a verified household account
- **WHEN** the organizer selects "Grant check-in" on her row
- **THEN** the Volunteers page reloads with "Check-in access granted.", keeps the selected role filter, and shows "Access granted" instead of the button on her rows

#### Scenario: Volunteer without a verified account
- **GIVEN** a volunteer's household has no verified account
- **WHEN** the organizer selects "Grant check-in" on that row
- **THEN** the Volunteers page shows, as an error, "This person needs a verified household account before check-in access can be granted."

#### Scenario: Organizer revokes check-in permission
- **GIVEN** Priya has check-in permission
- **WHEN** an authorized organizer revokes it
- **THEN** Priya can no longer scan passes and the revocation is recorded

#### Scenario: Organizer tries to grant permission to a guest without an account
- **WHEN** an organizer selects a registration contact that has no verified household account
- **THEN** the system does not grant scanner access and displays "This person needs a verified household account before check-in access can be granted."