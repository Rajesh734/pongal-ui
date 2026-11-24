# Spec Delta

## Purpose

Provides a clear public entry point for Pongal event details and household registration, alongside account and organizer-facing pages, while preserving the existing interest survey for future reuse.

## ADDED Requirements

### Requirement: Home is the public landing page
The root route SHALL render the Pongal event Home page with event details and a prominent registration action. The event date and final agenda MUST come from organizer-approved event information.

#### Scenario: Visitor opens the site root
- **WHEN** a visitor opens `/`
- **THEN** the Home page is shown with event details and a "Register" link to `/register`

#### Scenario: Final event details are not yet provided
- **WHEN** the event date or agenda has not been approved
- **THEN** the page does not present prior-year flyer details as confirmed 2027 information

### Requirement: Portal navigation exposes the agreed pages
The public navigation SHALL include Home, Register, and About. On admin pages, the header navigation SHALL show the organizer links instead of the public links. On narrow screens the header links SHALL move into a three-line menu icon at the top left. Open menus MUST close when the visitor clicks or taps outside them or presses Escape. The navigation MUST NOT expose the existing interest survey.

#### Scenario: Signed-out visitor sees navigation
- **WHEN** a signed-out visitor opens the Home page
- **THEN** navigation offers Home, Register, and About, and there is no Interest Survey link

#### Scenario: Mobile visitor uses the menu
- **WHEN** a visitor opens the site on a 360 px wide screen
- **THEN** a three-line menu icon at the top left reveals Home, About, and Register without horizontal scrolling

#### Scenario: Visitor dismisses an open menu
- **WHEN** the navigation or account menu is open and the visitor clicks outside it or presses Escape
- **THEN** the menu closes without a second click on its icon

### Requirement: Account menu offers household actions
Account actions SHALL appear in a dropdown opened from a user icon at the top right: Sign in and Sign up for signed-out visitors, and Profile, My Registrations, and Log out for signed-in households. Households with active check-in permission SHALL also see Scan Passes.

#### Scenario: Signed-out visitor opens the account menu
- **WHEN** a signed-out visitor opens the user icon menu
- **THEN** it offers Sign in and Sign up

#### Scenario: Signed-in household sees navigation
- **WHEN** a household is signed in
- **THEN** the user icon menu offers Profile, My Registrations, and a protected Log out action

#### Scenario: Check-in volunteer sees the scanner link
- **GIVEN** a signed-in household has active check-in permission
- **WHEN** it opens the user icon menu
- **THEN** the menu also offers Scan Passes, and households without that permission do not see it

### Requirement: Existing survey stays out of navigation
The existing interest survey implementation and data SHALL be retained, but portal navigation MUST NOT link to it.

#### Scenario: Existing survey is retained but hidden
- **WHEN** a visitor uses the portal navigation
- **THEN** no menu item or Home-page action links to the existing interest survey, while its implementation and stored data remain available for future reuse

### Requirement: About page presents community information
The system SHALL provide an About page for the Eastcoast Tamil Community with organizer-approved community information and contact details.

#### Scenario: Visitor opens About
- **WHEN** a visitor selects "About"
- **THEN** the page shows the approved community description and organizer contact information

### Requirement: Consistent site identity and readable forms
The header SHALL show the community logo on both sides of the site name with the same orientation. The browser favicon SHALL use the site's cream background color. Form inputs, including email and phone fields, MUST share one width within a form, and sign-in, sign-up, profile, and registration forms MUST stay within a readable maximum width on wide screens.

#### Scenario: Visitor views the header and favicon
- **WHEN** a visitor opens any portal page
- **THEN** both header logos face the same direction and the browser tab icon uses the cream site background

#### Scenario: Visitor uses a form on a laptop
- **WHEN** a visitor opens sign-up or registration on a 1440 px wide screen
- **THEN** the form and the Google sign-up button stay at a fixed readable width instead of spanning the screen

### Requirement: Inline validation matches server validation
Required portal form fields SHALL show an inline message when the visitor moves to the next input and again on submit. Each field MUST show at most one message at a time. The server MUST apply the same rules and reject invalid input when browser checks are bypassed.

#### Scenario: Visitor tabs out of an invalid field
- **WHEN** a visitor enters an invalid email or a phone number that is not 10 digits and moves to the next input
- **THEN** the field is marked invalid and a single message explains how to fix it

#### Scenario: Visitor keeps editing a field
- **WHEN** a visitor types and deletes repeatedly in a field that has a message
- **THEN** the message updates in place and is not duplicated

#### Scenario: Browser checks are bypassed
- **WHEN** a request with invalid values reaches the server directly
- **THEN** the server rejects it with the matching validation message

### Requirement: Household registration history is private
The system SHALL show an authenticated household its current and prior event registrations, their payment status, and passes for confirmed registrations. A household MUST NOT see another household's registration.

#### Scenario: Household views its registrations
- **GIVEN** Priya is signed in and has one pending and one confirmed registration
- **WHEN** she opens My Registrations
- **THEN** both registrations and their current statuses are shown, with a QR pass only for the confirmed registration

#### Scenario: Signed-out visitor requests registration history
- **WHEN** a signed-out visitor opens My Registrations
- **THEN** the system directs the visitor to log in and displays "Sign in to view your registrations."

#### Scenario: Household requests another family's registration
- **WHEN** Priya requests a registration belonging to another household
- **THEN** the system reveals no registration data and displays "We couldn't find that registration."