# Spec Delta

## Purpose

Lets authorized organizers and approved check-in volunteers validate confirmed household passes at the event and record attendance without exposing PostgreSQL or unnecessary personal information.

## ADDED Requirements

### Requirement: QR pass privacy and eligibility
Each confirmed registration MUST have a QR pass with an unguessable token that contains no attendee names, email addresses, or phone numbers. A payment-pending registration MUST NOT have a usable entry pass.

#### Scenario: Confirmed pass is scanned
- **GIVEN** a registration is confirmed
- **WHEN** its QR pass is scanned by an authorized check-in user
- **THEN** the system identifies the registration and shows its attendee list

#### Scenario: Unconfirmed pass is scanned
- **GIVEN** a registration is payment pending
- **WHEN** its QR value is scanned
- **THEN** entry is denied and the scanner displays "Payment is not confirmed. Ask an organizer for help."

#### Scenario: Unknown or altered QR value is scanned
- **WHEN** the scanner receives a token that does not match a valid pass
- **THEN** no registration details are shown and the scanner displays "Pass not recognized. Check the QR code or ask an organizer for help."

### Requirement: Check-in access is explicitly granted
Only an authenticated user with check-in permission SHALL be able to open the scanner or record attendance. Volunteer interest alone MUST NOT grant check-in permission, and an administrator SHALL be able to grant or revoke that permission.

#### Scenario: Approved volunteer opens scanner
- **GIVEN** an administrator granted Priya check-in permission
- **WHEN** Priya signs in and opens the account menu
- **THEN** the menu offers "Scan Passes", which opens the event scanner, and the scanner is available to her

#### Scenario: Organizer finds the scanner from the admin menu
- **WHEN** an organizer opens any admin page
- **THEN** the admin menu offers "Scan Passes", and the Check-in Access page explains that scanning requires a household account with check-in permission

#### Scenario: Volunteer has no check-in permission
- **GIVEN** Arun registered as willing to volunteer but has no check-in permission
- **WHEN** Arun opens the scanner
- **THEN** access is denied and the system displays "You don't have permission to check in attendees."

#### Scenario: Permission is revoked
- **GIVEN** Priya has an active session and an administrator revokes her check-in permission
- **WHEN** Priya attempts another scan
- **THEN** the scan is denied and the system displays "Your check-in access has been revoked."

### Requirement: Check-in records identify the operator
The system SHALL record the event, registration, check-in time, and authenticated operator when a household is admitted. A second scan MUST NOT create a second check-in.

#### Scenario: Household checks in
- **GIVEN** Priya's confirmed family registration has not checked in
- **WHEN** an authorized user confirms the scan
- **THEN** the household is checked in once and the system records who checked it in and when

#### Scenario: Pass is scanned twice
- **GIVEN** Priya's household is already checked in
- **WHEN** an authorized user scans its pass again
- **THEN** the existing check-in remains unchanged and the scanner displays "This household was already checked in."

#### Scenario: Scan belongs to another event
- **GIVEN** a scanner is set to the current Pongal event
- **WHEN** a valid pass for a different event is scanned
- **THEN** attendance is not recorded and the scanner displays "This pass is for a different event."

### Requirement: Scanner provides an accessible result
The scanner SHALL show the registration identity and attendee count before check-in and SHALL provide a clear result after each scan.

#### Scenario: Organizer reviews family before admitting
- **WHEN** an authorized user scans a valid, not-yet-checked-in family pass
- **THEN** the scanner shows the household contact name, total attendee count, and each attendee's name and age group in large bold text, with a "Check in household" action

#### Scenario: Scan result is colour coded
- **WHEN** a scan or check-in completes
- **THEN** a successful check-in is shown in a green panel, "This household was already checked in." in a yellow panel, and an invalid, unpaid, or wrong-event pass in a red panel, each with a bold message

#### Scenario: Camera is unavailable
- **WHEN** the browser cannot access the device camera
- **THEN** the scanner displays "Camera access is unavailable. Enter the pass code manually or ask an organizer for help." and offers manual pass-code entry

#### Scenario: Browser has no built-in QR detector
- **GIVEN** a phone browser without BarcodeDetector support, such as iOS Safari
- **WHEN** the volunteer taps "Scan QR code with camera" and allows camera access
- **THEN** the scanner decodes the QR code with a bundled same-origin decoder, and a "Stop camera" action releases the camera