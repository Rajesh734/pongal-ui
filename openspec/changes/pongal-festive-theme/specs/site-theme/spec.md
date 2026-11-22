# Spec Delta

## Purpose

Defines how the public pages look and feel: the site identity, a per-event festive theme, bilingual section headings and a layout that works from a small phone to a laptop, without hurting accessibility or speed.

## ADDED Requirements

### Requirement: Site header with organization name
Every survey page SHALL show a header with the organization name "Eastcoast Tamil Community" and, below it, "New Hampshire, USA". When a logo file (`logo.svg`, else `logo.png`) is present in the site's image folder, the header MUST show it before the name with the alt text "Eastcoast Tamil Community logo"; otherwise the header MUST show the name and location only, with no broken image.

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

### Requirement: Realistic Pongal hero
When an event's theme is `pongal`, its survey pages SHALL show the provided realistic Pongal hero image with the greeting and event name rendered as accessible HTML over it. The image MUST be same-origin, have useful alt text, and be cropped responsively without distortion. Events without a theme MUST show the header without the hero.

#### Scenario: Pongal 2027 hero
- **GIVEN** `pongal-2027` has theme `pongal`
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the page shows a realistic Pongal hero image, "இனிய பொங்கல் நல்வாழ்த்துக்கள்" and "Pongal 2027" as selectable HTML text

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
The banner SHALL gently animate steam rising from the Pongal pot, with each cycle lasting at most 6 seconds and nothing flashing. When the visitor's device asks for reduced motion, the system MUST show the artwork without any animation.

#### Scenario: Reduced motion
- **GIVEN** the device setting "reduce motion" is on
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** no element on the page is animated

#### Scenario: Normal motion
- **GIVEN** "reduce motion" is off
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the steam above the Pongal pot rises gently and the form stays fully usable while it moves

### Requirement: Hero media does not hurt access or speed
The hero image MUST be same-origin, MUST have useful alt text, MUST be optimized to at most 250 KB, and MUST not be loaded on pages without the `pongal` theme. Body text and form labels MUST have a contrast ratio of at least 4.5:1 against their background, and error messages MUST stay as readable as before.

#### Scenario: Screen reader
- **WHEN** a screen reader reads `/s/pongal-2027`
- **THEN** it reads the hero alt text, greeting and headings

#### Scenario: No outside requests
- **GIVEN** Turnstile is not configured
- **WHEN** a visitor opens `/s/pongal-2027`
- **THEN** the browser makes no request to any other website

#### Scenario: Page weight
- **WHEN** the survey form HTML and stylesheet are measured
- **THEN** the hero image is at most 250 KB and no external image request is made
