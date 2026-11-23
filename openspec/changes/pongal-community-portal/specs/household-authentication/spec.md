# Spec Delta

## Purpose

Lets a family manage its household profile and event registrations through verified Google or email sign-in, while preserving guest registration for families that do not want an account.

## ADDED Requirements

### Requirement: Household account signup methods
The system SHALL allow a household to create or access an account with Google or with an email address and password. Manual accounts MUST verify control of the email address before accessing linked registrations.

#### Scenario: Manual signup
- **WHEN** a visitor submits a valid email and password for manual signup
- **THEN** the system sends a one-time verification link and displays "Check your email to verify your account."

#### Scenario: Google signup
- **WHEN** a visitor signs in with a valid Google credential whose email is verified
- **THEN** the system signs in the matching household or creates a household and displays "You are signed in."

#### Scenario: Unverified Google email
- **WHEN** a Google credential does not assert a verified email
- **THEN** the system denies account access and displays "We couldn't verify your Google account. Try another sign-in method."

### Requirement: Manual email verification
The system SHALL verify manual account email ownership with a single-use, time-limited link before allowing access to household registrations.

#### Scenario: Verification succeeds
- **WHEN** a visitor opens a valid unused verification link
- **THEN** the household email is marked verified and the system displays "Your email is verified. You can now access your household account."

#### Scenario: Verification link is expired or reused
- **WHEN** a visitor opens an expired or previously used verification link
- **THEN** the system does not change account access and displays "This verification link is no longer valid. Request a new link."

### Requirement: Verified identity links to one household
The system SHALL normalize email addresses before matching identities and SHALL link a verified account to the existing household with the same email, without creating a duplicate household.

#### Scenario: Existing guest household is claimed
- **GIVEN** a guest registration exists for `priya@example.com`
- **WHEN** Priya verifies an account for ` Priya@Example.COM `
- **THEN** the account can access that household's registration and displays "Your household registration is now linked to your account."

#### Scenario: Different email cannot claim a household
- **GIVEN** a guest registration belongs to `priya@example.com`
- **WHEN** an account verified as `other@example.com` requests that registration
- **THEN** the system does not reveal or link Priya's registration and displays "We couldn't find a registration for this account."

### Requirement: Login and logout
The system SHALL provide login and logout for household accounts and MUST NOT expose authentication credentials in browser-readable storage.

#### Scenario: Manual login succeeds
- **WHEN** a verified household submits the correct email and password
- **THEN** the system starts an authenticated session and displays "You are signed in."

#### Scenario: Login fails
- **WHEN** a visitor submits an unknown email, an incorrect password, or an unverified manual account
- **THEN** the system denies access and displays "Invalid email or password."

#### Scenario: Logout
- **GIVEN** a household is signed in
- **WHEN** a member selects "Log out"
- **THEN** the session ends and the system displays "You are signed out."

### Requirement: Household profile access
The system SHALL allow an authenticated household to view and update its primary contact details without exposing those details to other households.

#### Scenario: Household views its profile
- **GIVEN** Priya is signed in to `priya@example.com`
- **WHEN** she opens her profile
- **THEN** the profile shows only the contact details associated with her household

#### Scenario: Unauthenticated profile request
- **WHEN** a visitor without an active household session opens the profile page
- **THEN** the system redirects to login and displays "Sign in to view your household profile."