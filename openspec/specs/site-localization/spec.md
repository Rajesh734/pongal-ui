# site-localization Specification

## Purpose

Lets visitors use the Pongal portal in English, Tamil, Telugu, Kannada, or Malayalam, with one consistent language choice across pages, forms, and validation messages.

## Requirements

### Requirement: Supported site languages
The site SHALL provide English, Tamil, Telugu, Kannada, and Malayalam. English MUST be selected by default for visitors without a saved language preference.

#### Scenario: First visit uses English
- **WHEN** a visitor opens the portal without a saved language preference
- **THEN** the site displays English and the selector shows "English"

#### Scenario: Visitor selects another language
- **WHEN** a visitor selects Tamil, Telugu, Kannada, or Malayalam
- **THEN** the current page is displayed in the selected language and the selector shows that language

### Requirement: Language preference persists across pages
The site SHALL retain the visitor's language selection across portal pages and later visits until the visitor changes it.

#### Scenario: Visitor navigates after selecting a language
- **GIVEN** a visitor selected Malayalam
- **WHEN** the visitor opens Register and then About
- **THEN** both pages are displayed in Malayalam

#### Scenario: Visitor changes the saved language
- **GIVEN** a visitor previously selected Tamil
- **WHEN** the visitor selects English
- **THEN** English is used on subsequent portal pages and visits

### Requirement: All portal interface text follows the selected language
All user-facing portal labels, navigation, registration and payment instructions, confirmation and status messages, and validation errors SHALL use the selected language. Visitor-entered names and performance introductions MUST be preserved as entered.

#### Scenario: Registration validation uses selected language
- **GIVEN** a visitor selected Telugu
- **WHEN** the visitor submits a registration with a missing attendee name
- **THEN** the validation message is displayed in Telugu and the entered registration values remain unchanged

#### Scenario: User-entered performance introduction is preserved
- **GIVEN** a visitor entered a performance introduction in Tamil
- **WHEN** the registration is viewed in English
- **THEN** the introduction is displayed exactly as entered and is not automatically translated

#### Scenario: Unsupported language preference
- **WHEN** a visitor requests an unsupported language code
- **THEN** the site falls back to English and displays "English is selected because that language is unavailable."

### Requirement: Scope of translation
The selected language SHALL apply to every page: the public portal pages, registration and payment pages, My Registrations, sign-in and profile pages, the interest survey and its confirmation, the check-in scanner, error pages, the header, the browser-side validation and the emails sent to visitors. Event-configured labels such as volunteer roles, survey options and day names MUST be translated from the same catalogs, and any text without a translation MUST fall back to English. Organizer pages, data exports (CSV) and visitor-entered text stay in English or as entered.

#### Scenario: Organizer page while a language is saved
- **GIVEN** a visitor saved Kannada
- **WHEN** an organizer opens `/admin/payments`
- **THEN** the page is displayed in English and shows no language selector

#### Scenario: Interest survey validation
- **GIVEN** a visitor selected Telugu
- **WHEN** the visitor submits the interest survey without a name
- **THEN** the error "Please enter your name (at least 2 letters)." is displayed in Telugu

#### Scenario: Email language
- **GIVEN** a visitor selected Tamil
- **WHEN** the visitor registers and the registration email is sent
- **THEN** the email subject and body are written in Tamil

#### Scenario: Missing translation
- **WHEN** a message has no translation in the selected language
- **THEN** its English text is displayed
