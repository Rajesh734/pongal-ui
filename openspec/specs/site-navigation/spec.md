# site-navigation Specification

## Purpose

Defines the header, menus and account access that every page shares, so people can always find navigation and their account on a phone or a laptop.

## Requirements

### Requirement: Header layout
The header SHALL keep the site identity centered in the header at every screen width, the navigation menu button at the left on screens narrower than 64rem, and the account button at the top right at every width.

#### Scenario: Phone width
- **GIVEN** a 360px wide screen
- **WHEN** any page loads
- **THEN** the menu button is at the left, "Eastcoast Tamil Community" is centered, and the account button is at the right edge

#### Scenario: Laptop width
- **GIVEN** a screen 64rem or wider
- **WHEN** any page loads
- **THEN** the menu button is hidden, the links appear in a row under the header, the identity stays centered, and the account button stays at the top right

### Requirement: Navigation links
Public pages SHALL offer Home, About and Register. Organizer pages SHALL offer Dashboard, Registrations, Payments, Volunteers, Check-in Access, Scan Passes and Public site, and mark the current page with `aria-current="page"`.

#### Scenario: Organizer navigation
- **WHEN** an organizer opens `/admin/payments`
- **THEN** the link "Payments" is marked as the current page

### Requirement: Account menu
The account button SHALL open a menu. A signed-in household MUST see its name, Profile and My Registrations, plus Scan Passes only when it holds check-in permission, and Log out. A visitor MUST see Sign in and Sign up. The button needs an accessible name "Account menu" and a person icon.

#### Scenario: Signed-out visitor
- **WHEN** a visitor opens the account menu
- **THEN** it shows "Sign in" and "Sign up"

#### Scenario: Signed-in household without scan access
- **GIVEN** a signed-in household with no check-in permission
- **WHEN** it opens the account menu
- **THEN** it shows its name, "Profile", "My Registrations" and "Log out", and no "Scan Passes"

### Requirement: Menu dismissal
Open menus SHALL close when the user clicks outside them or presses Escape, and Escape MUST return focus to the menu button.

#### Scenario: Escape closes the menu
- **GIVEN** the account menu is open
- **WHEN** the user presses Escape
- **THEN** the menu closes and the account button has focus

### Requirement: Highlighted page messages
Every page-level message SHALL appear in a bordered, tinted callout. A message reporting a failed or rejected action MUST be styled as an error (red tones plus a warning marker, so it does not rely on color alone) and announced to assistive technology as an alert. A confirmation MUST be styled distinctly in green and MUST NOT use the error style.

#### Scenario: Duplicate registration is rejected
- **GIVEN** a household already has an active registration for the event
- **WHEN** it submits another registration
- **THEN** "An active registration already exists for this household and event." is shown in the error callout at the top of the page
