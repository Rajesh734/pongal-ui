# event-registration Specification

## Purpose

Lets a household register its family for a Pongal event, submit cultural and volunteer details, and follow payment status through confirmation without requiring an account.

## Requirements

### Requirement: Guest and household registration
The system SHALL allow a household to submit a registration as a guest or while signed in. Every new registration MUST send a secure link to retrieve the registration and payment status to the registration email when email delivery is configured.

#### Scenario: Guest registration is saved
- **WHEN** a guest submits a valid household registration
- **THEN** the system saves it as payment pending, sends a secure access link, and displays "Your registration is saved. Payment is pending."

#### Scenario: Signed-in household registers
- **WHEN** a signed-in household submits a valid registration
- **THEN** the registration is linked to that household, appears in My Registrations, and the secure access link is emailed to the household email

#### Scenario: Guest access link is invalid
- **WHEN** a guest opens an expired or invalid registration link
- **THEN** the system reveals no registration details and displays "This registration link is no longer valid."

### Requirement: Attendee names and age bands
Each registration MUST include a named primary contact in the first attendee row. The primary contact MUST use the age-11-or-older band, which the portal treats as the adult contact band, and the form MUST NOT allow that age band to change or remove the primary contact. Additional attendees MAY use any configured age band.

#### Scenario: Primary contact and child attendees are registered
- **WHEN** a household enters Priya as the primary contact and adds Arun (age 5 through 10) and Nila (under age 5)
- **THEN** Priya is stored once as the adult primary contact, child age selections remain available, and all names and age bands appear in the registration summary

#### Scenario: Additional adult attendee is submitted
- **WHEN** an additional attendee uses the age-11-or-older band
- **THEN** the system accepts that attendee and includes the adult fee in the total

#### Scenario: Household adds another attendee
- **WHEN** a household selects "Add attendee"
- **THEN** the new row offers Age 11+, Age 5-10, and Under 5 and defaults to Age 11+

#### Scenario: Primary contact age is fixed
- **WHEN** a household starts a registration
- **THEN** the first attendee is fixed to the age-11-or-older contact band and cannot be removed

#### Scenario: No attendees are entered
- **WHEN** a household submits a registration with no attendees
- **THEN** the system does not save it and displays "Add at least one attendee to continue."

#### Scenario: Attendee name is missing
- **WHEN** an attendee row has no name
- **THEN** the system does not save it and displays "Enter a name for each attendee."

### Requirement: Registration fee calculation
The system SHALL calculate the total from the event-date age band: $35 for each attendee age 11 or older, $25 for each attendee age 5 through 10, and $0 for each attendee under age 5. Cultural performances MUST NOT add a fee.

#### Scenario: Mixed-age household total
- **WHEN** a household registers one primary contact age 11 or older, one attendee age 5 through 10, and one attendee under age 5
- **THEN** the displayed total is $60 and the summary shows each age-band subtotal

#### Scenario: Age-band selection changes
- **WHEN** a household changes an attendee from under age 5 to age 5 through 10
- **THEN** the displayed total increases by $25 before submission

### Requirement: Primary contact and phone numbers
Each registration MUST include one primary contact name, email, and mobile number. The primary contact name MUST be taken from the first attendee row and MUST NOT be entered twice. Mobile and distinct WhatsApp numbers MUST support international country codes and default to US +1. Each national phone number MUST contain exactly 10 digits, excluding its country calling code. A separate WhatsApp number is optional and MUST require consent for event-related WhatsApp contact.

#### Scenario: Different WhatsApp number is provided
- **WHEN** the primary contact selects India +91 for a WhatsApp number different from the mobile number and gives consent
- **THEN** the registration stores the two normalized numbers separately

#### Scenario: WhatsApp number is the same as the mobile number
- **WHEN** the contact ticks "My WhatsApp number is the same as my mobile number" and gives consent
- **THEN** the separate WhatsApp fields are hidden, the mobile number is stored as the WhatsApp number, and an invalid mobile number is reported only once under the mobile number

#### Scenario: WhatsApp number has no consent
- **WHEN** a contact enters a WhatsApp number without agreeing to event-related WhatsApp contact
- **THEN** the system does not save the number and displays "Please agree before we contact you on WhatsApp."

#### Scenario: Invalid phone number
- **WHEN** a contact submits a national phone number with fewer or more than 10 digits
- **THEN** the system does not save it and displays "Enter a 10-digit mobile number."

### Requirement: Cultural performance entries
A household MAY submit up to two performances. Each entry MUST include a performance name or type, participant or group name, participant count, duration, and a short compere introduction.

#### Scenario: Performance details are submitted
- **WHEN** a household submits one performance with a title, named participants, duration, and introduction
- **THEN** those details appear in the household registration and organizer report

#### Scenario: Household adds a performance
- **WHEN** a household opens the form, no empty performance entry is shown until it selects "Add performance"
- **THEN** each added performance appears in its own card with example placeholders, compact "Performers" and "Minutes" boxes side by side, a live "Up to N minutes for ..." hint based on the performer count, and a Remove link, and the add action disappears once the maximum is reached

#### Scenario: Contact enters a phone number on a phone
- **WHEN** a contact views the mobile or WhatsApp number on a narrow screen
- **THEN** a compact country-code selector showing only the calling code (for example "+1") sits beside the number field, and opening it lists full country names

#### Scenario: More than two performances are requested
- **WHEN** a household tries to add a third performance
- **THEN** the system blocks the entry and displays "A family may register up to two performances. Contact the organizers for more."

#### Scenario: Duration exceeds the group limit
- **WHEN** a solo performer enters 5 minutes, a group of 2 to 4 enters 6 minutes, or a group of 5 or more enters 8 minutes
- **THEN** the system rejects the duration and displays "The maximum performance time is 4 minutes for a solo, 5 minutes for 2-4 performers, or 7 minutes for 5 or more performers."

#### Scenario: Required performance details are missing
- **WHEN** a performance entry is missing its participant count or compere introduction
- **THEN** the system does not save that entry and displays "Complete the required details for each performance."

### Requirement: Volunteer preferences per attendee
The system SHALL let the household mark each named attendee as willing to volunteer and select one or more existing volunteer roles for that attendee. The form MUST reuse the attendee's entered name and MUST NOT ask for it again. Only attendees age 11 or older MAY volunteer; the form MUST hide volunteer options for younger attendees and the server MUST reject volunteer selections for them.

#### Scenario: Child attendee cannot volunteer
- **WHEN** an attendee's age band is Age 5-10 or Under 5
- **THEN** that attendee's volunteer options are hidden, and a submitted volunteer selection is rejected with "Attendees under age 11 cannot volunteer."

#### Scenario: Attendee selects volunteer roles
- **WHEN** Priya is marked willing to volunteer and selects "Registration desk" and "Photography"
- **THEN** the organizer report associates Priya with both selected roles

#### Scenario: Volunteer roles appear only after opting in
- **WHEN** an attendee is not marked willing to volunteer
- **THEN** the role checkboxes are hidden; ticking "Willing to volunteer" reveals them in a compact grid, clearing it unticks any roles, and the "Choose at least one volunteer role" message appears under the roles only on submit or after the last role is unticked

#### Scenario: Volunteer roles are selected without opting in
- **WHEN** no attendee is marked willing to volunteer
- **THEN** the registration stores no volunteer roles

#### Scenario: Volunteer role is not in the offered list
- **WHEN** a submitted volunteer role is not one of the configured roles
- **THEN** the system rejects the registration and displays "Choose volunteer roles from the listed options."

### Requirement: Zelle payment remains pending until organizer verification
The system SHALL show the total and Zelle payment instructions after registration. A payer's declaration or reference MUST NOT by itself mark a registration paid; only an authorized organizer can confirm payment after checking the receiving account.

#### Scenario: Payment instructions are shown
- **WHEN** a registration is saved
- **THEN** the payment page shows the exact total and "Send your Zelle payment to +1 603 970 0000. Include your family reference in the payment memo."

#### Scenario: Guest reports that payment was sent
- **WHEN** a guest submits the payer name, payment reference, and "I sent this payment" declaration
- **THEN** the registration remains payment pending, confirms the payment was marked as sent, says not to pay again, and explains that an organizer must verify it before the QR code is completed

#### Scenario: Guest chooses to pay later
- **WHEN** a guest saves the registration without declaring payment sent
- **THEN** the registration remains payment pending, the guest can choose "Save registration and pay later," and no QR code is issued

#### Scenario: Registration is not marked paid by a guest
- **WHEN** a guest submits any payment declaration or reference
- **THEN** the registration remains payment pending until an authorized organizer confirms it

### Requirement: QR pass follows confirmed payment
The system MUST issue an entry pass only after an organizer confirms payment. A household MUST be able to retrieve its pass from My Registrations or its secure guest link.

#### Scenario: Organizer confirms payment
- **WHEN** an authorized organizer marks a pending registration paid
- **THEN** the registration becomes confirmed, a QR entry pass is issued, and the household sees "Payment confirmed. Your Pongal entry pass is ready."

#### Scenario: Pass requested before payment confirmation
- **WHEN** a household opens a payment-pending registration
- **THEN** no QR entry pass is shown and the page displays "Your entry pass will be available after payment is confirmed."

#### Scenario: Confirmed registration is viewed again
- **WHEN** a household opens a confirmed registration
- **THEN** its current QR entry pass and attendee list are shown