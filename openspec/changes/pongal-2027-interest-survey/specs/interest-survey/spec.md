# Spec Delta

## Purpose

Lets each family tell organizers, without commitment, whether and how they might attend an event, so organizers can decide on the event and size venue, food and contribution. One response is kept per family per event.

## ADDED Requirements

### Requirement: Survey page follows the event window
The survey page at `/s/<event-slug>` SHALL show the form only while the event's survey state is `open`. Before opening it MUST show "The <event name> interest survey opens on <weekday>, <month> <day> at <time> ET." and after closing it MUST show the event's configured closed message. An unknown slug MUST return the 404 page.

#### Scenario: Before opening
- **GIVEN** `pongal-2027` opens 2026-11-20 8:00 PM ET
- **WHEN** a visitor opens `/s/pongal-2027` at 7:30 PM ET that day
- **THEN** no form is shown and the page says "The Pongal 2027 interest survey opens on Friday, November 20 at 8:00 PM ET."

#### Scenario: Open
- **WHEN** a visitor opens `/s/pongal-2027` at 8:05 PM ET on Nov 20, 2026
- **THEN** the survey form is shown

#### Scenario: Closed
- **GIVEN** `pongal-2027` closes 2026-11-24 11:59 PM ET
- **WHEN** a visitor opens `/s/pongal-2027` on Nov 25, 2026
- **THEN** no form is shown and the page says "The Pongal 2027 interest survey is now closed. Thank you for your interest! Organizers will share next steps soon."

#### Scenario: Submission after closing
- **GIVEN** a visitor loaded the form at 11:50 PM ET on Nov 24
- **WHEN** they submit at 12:01 AM ET on Nov 25
- **THEN** nothing is saved and the closed message is shown

#### Scenario: Unknown event
- **WHEN** a visitor opens `/s/diwali-1999`
- **THEN** the response is `404` with "Sorry, we couldn't find that page."

### Requirement: Home page leads to the current survey
`GET /` SHALL redirect to the survey of the event whose survey is not closed and has the latest open time. If every survey is closed, it MUST show "There are no open surveys right now. Please check back later."

#### Scenario: One current survey
- **GIVEN** `pongal-2027` survey is `open`
- **WHEN** a visitor opens `/`
- **THEN** they are redirected (302) to `/s/pongal-2027`

### Requirement: Survey fields
The form SHALL ask, in order: name, email, mobile (optional), days they can attend (one checkbox per event day), how likely per selected day (Definitely / Likely / Maybe), headcount per configured age band, food preference, volunteer roles (optional, multiple), interest in a cultural performance (Yes / Maybe / No), comfortable contribution per adult (configured options), comments (optional) and consent. Labels and options MUST come from the event config.

#### Scenario: Pongal 2027 form
- **WHEN** the form for `pongal-2027` is shown
- **THEN** it shows day checkboxes "Saturday, Jan 16" and "Sunday, Jan 17", headcount fields "Adults & kids 11+", "Kids 5-10" and "Kids under 5", food options "Veg", "Non-veg", "Either is fine", the eight volunteer roles, contribution options "$15", "$20", "$25", "Flexible", and the consent text "I agree that organizers may contact me by email, phone or WhatsApp about Pongal 2027. My details are visible only to organizers and won't be shared."

#### Scenario: Likelihood appears per selected day
- **WHEN** a visitor ticks "Sunday, Jan 17" only
- **THEN** one likelihood question "How likely are you to attend on Sunday, Jan 17?" is shown and none for Saturday

### Requirement: Name validation
Name MUST be required, trimmed, 2-80 characters, and contain only letters from any script, spaces, apostrophes, periods and hyphens.

#### Scenario: Missing name
- **WHEN** the form is submitted with name ` ` (a space)
- **THEN** the name field shows "Please enter your name (at least 2 letters)."

#### Scenario: Tamil name accepted
- **WHEN** the form is submitted with name `பிரியா Raman`
- **THEN** the name is accepted

#### Scenario: Name with digits
- **WHEN** the form is submitted with name `Priya123`
- **THEN** the name field shows "Please use letters, spaces, apostrophes, periods or hyphens in your name."

#### Scenario: Name too long
- **WHEN** the form is submitted with a name of 81 letters
- **THEN** the name field shows "Your name can be up to 80 characters."

### Requirement: Email validation
Email MUST be required, at most 254 characters, a valid address with a domain containing a dot, and SHALL be stored trimmed and in lower case.

#### Scenario: Missing email
- **WHEN** the form is submitted with an empty email
- **THEN** the email field shows "Please enter your email address."

#### Scenario: Malformed email
- **WHEN** the form is submitted with email `priya@gmail`
- **THEN** the email field shows "That email doesn't look right. Please check it, e.g. name@example.com."

#### Scenario: Normalised email
- **WHEN** the form is submitted with email ` Priya@Example.COM `
- **THEN** the response is saved for `priya@example.com`

### Requirement: Mobile validation
Mobile MUST be optional. When given, after removing spaces, dots, dashes, parentheses and a leading `+1` or `1`, it MUST be 10 digits whose area code and exchange each start with 2-9, and SHALL be stored as `+1` followed by the 10 digits.

#### Scenario: Formatted number
- **WHEN** the form is submitted with mobile `(617) 555-0123`
- **THEN** the mobile is saved as `+16175550123`

#### Scenario: Country code included
- **WHEN** the form is submitted with mobile `+1 617.555.0123`
- **THEN** the mobile is saved as `+16175550123`

#### Scenario: Too few digits
- **WHEN** the form is submitted with mobile `617-555-012`
- **THEN** the mobile field shows "Please enter a 10-digit US mobile number, e.g. 617-555-0123."

#### Scenario: Invalid area code
- **WHEN** the form is submitted with mobile `123-555-0123`
- **THEN** the mobile field shows "Please enter a 10-digit US mobile number, e.g. 617-555-0123."

#### Scenario: Left empty
- **WHEN** the form is submitted with no mobile
- **THEN** the response is saved with no mobile

### Requirement: Days and likelihood validation
At least one event day MUST be selected, and each selected day MUST have a likelihood of Definitely, Likely or Maybe. Likelihood values for unselected days MUST be ignored.

#### Scenario: No day selected
- **WHEN** the form is submitted with no day ticked
- **THEN** the days field shows "Please pick at least one day you could attend."

#### Scenario: Missing likelihood
- **WHEN** the form is submitted with Saturday ticked and no likelihood for Saturday
- **THEN** the Saturday likelihood field shows "Please tell us how likely you are to attend on Saturday, Jan 16."

#### Scenario: Stale likelihood ignored
- **WHEN** the form is submitted with only Sunday ticked, Sunday = Likely, and a leftover Saturday = Definitely
- **THEN** only Sunday = Likely is saved

### Requirement: Headcount validation
Each age band count MUST be a whole number within the band's configured range, and the total across bands MUST NOT exceed the configured maximum.

#### Scenario: No adults
- **WHEN** the form is submitted with "Adults & kids 11+" = 0
- **THEN** that field shows "Adults & kids 11+ must be between 1 and 10."

#### Scenario: Too many kids
- **WHEN** the form is submitted with "Kids 5-10" = 11
- **THEN** that field shows "Please enter a number from 0 to 10."

#### Scenario: Not a whole number
- **WHEN** the form is submitted with "Kids under 5" = `1.5`
- **THEN** that field shows "Please enter a whole number."

#### Scenario: Group too large
- **WHEN** the form is submitted with 8 adults & kids 11+, 5 kids 5-10 and 3 kids under 5 (16 people)
- **THEN** the headcount section shows "That's a large group. For more than 15 people, please contact the organizers."

#### Scenario: Blank kids fields
- **WHEN** the form is submitted with "Kids 5-10" and "Kids under 5" left blank
- **THEN** both are saved as 0

### Requirement: Choice fields validation
Food preference, cultural interest and contribution MUST each be one of the configured options. Volunteer roles MUST be optional and contain only configured roles.

#### Scenario: Missing food preference
- **WHEN** the form is submitted without a food preference
- **THEN** that field shows "Please choose a food preference."

#### Scenario: Missing cultural interest
- **WHEN** the form is submitted without a cultural interest answer
- **THEN** that field shows "Please tell us if you're interested in a cultural performance."

#### Scenario: Missing contribution
- **WHEN** the form is submitted without a contribution choice
- **THEN** that field shows "Please choose a contribution amount you're comfortable with."

#### Scenario: Tampered role
- **WHEN** the form is submitted with volunteer role `dj`
- **THEN** the roles field shows "Please choose from the listed volunteer roles."

### Requirement: Comments and consent validation
Comments MUST be optional and at most the configured maximum length after trimming. Consent MUST be checked.

#### Scenario: Comments too long
- **WHEN** the form is submitted with 534 characters of comments
- **THEN** the comments field shows "Comments can be up to 500 characters (you have 534)."

#### Scenario: Live counter
- **WHEN** a visitor types 120 characters in comments
- **THEN** the counter under the field reads "120 / 500"

#### Scenario: Consent not given
- **WHEN** the form is submitted without consent
- **THEN** the consent field shows "Please agree so organizers can contact you about the event."

### Requirement: Validation in browser and on server
The same rules and messages SHALL be applied in the browser, when a field loses focus and on submit, and again on the server. The server MUST reject invalid input even if browser checks are bypassed, re-show the form with all entered values kept, show each message next to its field, and show a summary at the top.

#### Scenario: Browser check on blur
- **WHEN** a visitor types `priya@` in email and moves to the next field
- **THEN** "That email doesn't look right. Please check it, e.g. name@example.com." appears under the email field without a page reload

#### Scenario: Server check with scripts disabled
- **GIVEN** JavaScript is disabled
- **WHEN** the form is submitted with an empty name and no day selected
- **THEN** nothing is saved, the form is shown again with the other entered values kept, each field shows its message, and the top says "Please fix the 2 highlighted fields below."

#### Scenario: Single error summary
- **WHEN** the server finds one invalid field
- **THEN** the top says "Please fix the highlighted field below."

### Requirement: One response per family per event
The system SHALL keep at most one active response per household per event, where the household is identified by email. A submission with an email that already has an active response MUST replace that response's answers and the household's name and mobile; the replaced version MUST remain in history.

#### Scenario: First submission
- **WHEN** `priya@example.com` submits for `pongal-2027` for the first time
- **THEN** one household and one response are created and history records action `create` for both with actor `public`

#### Scenario: Resubmission with same email
- **GIVEN** `priya@example.com` has a response with 2 adults
- **WHEN** a new submission arrives for `PRIYA@example.com` with 3 adults
- **THEN** there is still one active response for that household, it shows 3 adults, and history holds both the 2-adult and 3-adult snapshots

#### Scenario: Simultaneous submissions
- **WHEN** two submissions for `priya@example.com` arrive at the same moment
- **THEN** exactly one active response exists afterwards, holding the answers of the submission saved last

#### Scenario: Previously removed response
- **GIVEN** an organizer removed `priya@example.com`'s response (soft delete)
- **WHEN** `priya@example.com` submits again
- **THEN** a new active response is created and the removed one stays removed

### Requirement: Confirmation page
After a successful save the system SHALL show a confirmation page with a heading, a summary of the answers just submitted, and the private edit link. It MUST NOT show any earlier answers.

#### Scenario: New response confirmation
- **WHEN** Priya's first response is saved
- **THEN** the page says "Thank you, Priya! Your family's response for Pongal 2027 has been saved." and lists her answers

#### Scenario: Replaced response confirmation
- **WHEN** a submission replaces an existing response
- **THEN** the page says "Thank you, Priya! We've updated your family's response for Pongal 2027." and lists only the answers just submitted

#### Scenario: Refresh does not resubmit
- **WHEN** the visitor reloads the confirmation page
- **THEN** no new save happens (the submit redirects to the confirmation page)

### Requirement: Usable on a phone
The form MUST be usable at 360 px width without horizontal scrolling, with tap targets at least 44 px high, numeric keypads for counts and phone, the email keyboard for email, and labels that stay visible while typing.

#### Scenario: Small phone
- **WHEN** the form is opened on a 360 px wide screen
- **THEN** no horizontal scrollbar appears and every field and button is fully visible

#### Scenario: Keyboards
- **WHEN** a visitor taps the mobile or a headcount field on a phone
- **THEN** a numeric keypad opens
