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
The public navigation SHALL include Home, Register, and About. Signed-in households SHALL also have My Registrations and Profile access; signed-out visitors SHALL have login and signup access. The navigation MUST NOT expose the existing interest survey.

#### Scenario: Signed-out visitor sees navigation
- **WHEN** a signed-out visitor opens the Home page
- **THEN** navigation offers Home, Register, About, Log in, and Sign up, with no Interest Survey link

#### Scenario: Signed-in household sees navigation
- **WHEN** a household is signed in
- **THEN** navigation offers My Registrations, Profile, and Log out in addition to the public pages

#### Scenario: Existing survey is retained but hidden
- **WHEN** a visitor uses the portal navigation
- **THEN** no menu item or Home-page action links to the existing interest survey, while its implementation and stored data remain available for future reuse

### Requirement: About page presents community information
The system SHALL provide an About page for the Eastcoast Tamil Community with organizer-approved community information and contact details.

#### Scenario: Visitor opens About
- **WHEN** a visitor selects "About"
- **THEN** the page shows the approved community description and organizer contact information

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