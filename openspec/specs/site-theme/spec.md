# site-theme Specification

## Purpose

Defines how the public pages look and feel: the site identity, a per-event festive theme, bilingual section headings and a layout that works from a small phone to a laptop, without hurting accessibility or speed.

## Requirements

### Requirement: Site header with centered organization name
Every survey page SHALL show a header with the organization name "Eastcoast Tamil Community" and, below it, "New Hampshire, USA", centered in the header. When a logo file (`logo.svg`, else `logo.png`) is present in the site's image folder, the header MUST show a small, high-contrast light brand mark immediately before and after the centered identity; the leading logo has alt text "Eastcoast Tamil Community logo" and the trailing duplicate is decorative and hidden from assistive technology. Otherwise the header MUST show the name and location only, with no broken image.

#### Scenario: No logo yet
- **GIVEN** no logo file has been added
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the header shows "Eastcoast Tamil Community" and "New Hampshire, USA" and contains no `<img>` element

#### Scenario: Logo added
- **GIVEN** the organizers added `logo.png` to the site's image folder and restarted the site
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the header shows the logo with alt text "Eastcoast Tamil Community logo", the name and the location

#### Scenario: Both formats present
- **GIVEN** both `logo.svg` and `logo.png` are in the site's image folder
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the header uses `logo.svg`

#### Scenario: Logo is light
- **WHEN** the logo served by the site is measured
- **THEN** it is at most 50 KB and at most 168 px tall

### Requirement: Compact Pongal banner
When an event's theme is `pongal`, its survey pages SHALL show a compact same-origin banner composed from the existing inline SVG motifs for traditional dress, sugarcane, sun and Pongal pot, with the greeting and event name rendered as accessible HTML text. The banner MUST remain a header-sized visual element rather than a full-screen image, and MUST NOT load `pongal-hero.webp`, `pongal-hero-mobile.webp` or `pongal-hero-desktop.webp`. Events without a theme MUST show the header without the banner.

#### Scenario: Pongal 2027 banner
- **GIVEN** `pongal-2027` has theme `pongal`
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the page shows the traditional-dress, sugarcane, sun and Pongal-pot motifs in a compact banner, and "இனிய பொங்கல் நல்வாழ்த்துக்கள்" and "Pongal 2027" as selectable HTML text

#### Scenario: Event without a theme
- **GIVEN** an event config has no `theme`
- **WHEN** a visitor opens its survey page
- **THEN** the page shows the site header and no festive banner

#### Scenario: Invalid theme in config
- **WHEN** an event config sets `theme: diwali`
- **THEN** the site refuses to start and names the file and the setting `theme`

### Requirement: Theme on every survey page
The festive banner and colors SHALL appear on the survey form, the edit form, the confirmation page and the event's message pages (not yet open, closed, invalid edit link, honeypot thank-you). The 404 and server error pages MUST keep working without the event theme.

#### Scenario: Confirmation page themed
- **WHEN** Priya's response is saved and the confirmation page opens
- **THEN** the page shows the Pongal banner above "Thank you, Priya! Your family's response for Pongal 2027 has been saved."

#### Scenario: Closed page themed
- **GIVEN** the survey is closed
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the page shows the Pongal banner and the closed message

### Requirement: Bilingual form sections
The survey form SHALL group its fields into four sections, in this order, each with a Tamil and an English heading: "உங்களைப் பற்றி · About you" (name, email, mobile), "வருகை · Attending" (days, likelihood, headcount), "உணவும் உதவியும் · Food & helping" (food, volunteer roles, cultural performance, contribution) and "நிறைவு · Finish" (comments, consent, submit). Field labels, options and messages MUST stay as specified in `interest-survey`.

#### Scenario: Section headings
- **WHEN** the form for `pongal-2027` is shown
- **THEN** it shows the four section headings in order and each field sits in its section

#### Scenario: Field order unchanged
- **WHEN** the form is shown
- **THEN** the fields appear in the order required by `interest-survey`, from name to consent

### Requirement: Layout from phone to laptop
The pages MUST NOT scroll horizontally at any width from 360 px to 1920 px. At 1024 px and wider, the content SHALL be at most 960 px wide and centred, section cards SHALL be visible as separate panels, and choice lists with four or more options SHALL show in at least two columns. Tap targets MUST stay at least 44 px high at every width.

#### Scenario: Laptop
- **WHEN** the form is opened at 1440 × 900
- **THEN** the content is centred and at most 960 px wide, and the eight volunteer roles show in at least two columns

#### Scenario: Small phone
- **WHEN** the form is opened at 360 px wide
- **THEN** there is no horizontal scrollbar, choices show in one column, and every choice is at least 44 px high

#### Scenario: Tablet
- **WHEN** the form is opened at 768 px wide
- **THEN** there is no horizontal scrollbar and the banner illustrations do not overlap the greeting text

### Requirement: Subtle motion that respects reduced motion
The compact banner MAY gently animate steam rising from the Pongal pot, with each cycle lasting at most 6 seconds and nothing flashing. When the visitor's device asks for reduced motion, the system MUST show the artwork without any animation.

#### Scenario: Reduced motion
- **GIVEN** the device setting "reduce motion" is on
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** no element on the page is animated

#### Scenario: Normal motion
- **GIVEN** "reduce motion" is off
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the steam above the Pongal pot rises gently and the form stays fully usable while it moves

### Requirement: Branded watermark does not hurt access or readability
Public pages MAY show the transparent `logo.svg` as a sparse, irregular arrangement of small, low-opacity, non-interactive watermark marks across the page background and opaque content surfaces. The marks MUST have visible gaps, stay behind page content, MUST NOT affect layout or keyboard navigation, and MUST preserve body text and form-label contrast at least 4.5:1 against their background. The large raster hero assets MUST not be loaded by the banner.

#### Scenario: Screen reader
- **WHEN** a screen reader reads `/s/pongal-2027`
- **THEN** it reads the greeting and headings; decorative SVG motifs and the watermark are hidden from assistive technology

#### Scenario: No outside requests
- **GIVEN** Turnstile is not configured
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the browser makes no request to any other website

#### Scenario: Page weight
- **WHEN** the survey form HTML and stylesheet are measured
- **THEN** no `pongal-hero*.webp` image is loaded and no external image request is made


### Requirement: Highlighted page messages
Every page-level message SHALL appear in a bordered, tinted callout. A message reporting a failed or rejected action MUST be styled as an error (red tones plus a warning marker, so it does not rely on color alone) and announced to assistive technology as an alert. A confirmation or informational message MUST be styled distinctly (green tones) and MUST NOT use the error style.

#### Scenario: Duplicate registration is rejected
- **GIVEN** a household already has an active registration for the event
- **WHEN** it submits another registration
- **THEN** the message "An active registration already exists for this household and event." is shown in the error callout at the top of the page

#### Scenario: Confirmation message
- **GIVEN** an organizer confirms a payment
- **WHEN** the payments page reloads
- **THEN** "Payment confirmed and entry pass issued." is shown in the success callout, not the error callout
