# Spec Delta

## Purpose

Lets a family manage its household profile and event registrations through verified Google or email sign-in, while preserving guest registration for families that do not want an account.

## ADDED Requirements

### Requirement: Manual accounts can recover passwords
The system SHALL provide a time-limited, single-use password reset link for verified manual accounts and SHALL direct Google-only accounts to Google sign-in instead of offering a password reset.

#### Scenario: Manual account requests a reset
- **GIVEN** Priya has a verified manual account
- **WHEN** she submits her email on "Forgot password"
- **THEN** the system emails a one-time reset link and displays "Check your email for a password reset link."

#### Scenario: Manual password is updated
- **GIVEN** Priya opens a valid password reset link
- **WHEN** she submits a password between 8 and 256 characters
- **THEN** the password is updated, the link cannot be reused, and the system displays "Your password has been updated. You can now sign in."

#### Scenario: Google-only account requests a reset
- **GIVEN** Priya's household account was created with Google and has no manual password
- **WHEN** she submits her email on "Forgot password"
- **THEN** the system displays "This household account was created with Google. Please use Google to sign in instead of resetting a password."

### Requirement: Household account signup methods
The system SHALL allow a household to create or access an account with Google or with an email address and password. Manual signup MUST collect the first name, last name, email, and password, and MUST verify control of the email address before accessing linked registrations. The signup page MUST offer Google sign-up when a Google client ID is configured.

#### Scenario: Manual signup
- **WHEN** a visitor submits a first name, last name, valid email, and a password of at least 8 characters
- **THEN** the system stores the household name as "First Last", sends a one-time verification link, and displays "Check your email to verify your account."

#### Scenario: Manual signup is missing a name
- **WHEN** a visitor omits the first or last name
- **THEN** the system creates no account and displays "Enter your first and last name, a valid email address, and a password of at least 8 characters."

#### Scenario: Email delivery is not configured
- **WHEN** a visitor submits manual signup while SMTP is not configured
- **THEN** the system creates no session and displays "Email delivery is not configured. Contact the organizers to complete sign-up."

#### Scenario: Google signup
- **WHEN** a visitor signs in with a valid Google credential whose email is verified
- **THEN** the system signs in the matching household or creates a household and displays "You are signed in."

#### Scenario: Unverified Google email
- **WHEN** a Google credential does not assert a verified email
- **THEN** the system denies account access and displays "We couldn't verify your Google account. Try another sign-in method."

#### Scenario: Google sign-in completes through the popup
- **WHEN** a visitor selects a Google account in the Google sign-in popup
- **THEN** the popup returns the credential to the portal page, the popup closes, and the household is signed in

#### Scenario: Google sign-in completes by redirect
- **WHEN** Google posts the credential from `accounts.google.com` instead of using the popup
- **THEN** the system accepts it only when the `g_csrf_token` cookie and form value match and the ID token verifies

### Requirement: Form submissions are protected against cross-site requests
Every state-changing form post MUST come from the configured `APP_BASE_URL` origin and carry a matching anti-CSRF token. A browser that sends `Origin: null` MUST be accepted only when `Sec-Fetch-Site` is `same-origin` and the request host matches the configured origin. The Google credential callback MUST use Google's `g_csrf_token` check instead of the site origin check.

#### Scenario: Form is posted from another site
- **WHEN** a sign-in, sign-up, or registration form is posted from an origin other than `APP_BASE_URL`
- **THEN** the system rejects it, displays "We could not verify where this request came from. Please reload the page and try again.", and logs the received origin and the expected `APP_BASE_URL` without logging tokens

#### Scenario: Same-origin post with an opaque origin
- **WHEN** a browser posts a portal form with `Origin: null`, `Sec-Fetch-Site: same-origin`, and the configured host
- **THEN** the system accepts the request after its anti-CSRF token check passes

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