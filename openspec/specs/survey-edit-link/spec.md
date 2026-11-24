# survey-edit-link Specification

## Purpose

Gives each family a private link to review and change its own survey answers while the survey is open, without accounts or passwords, and without exposing one family's answers to anyone else.

## Requirements

### Requirement: Edit link issued on every public submission
Each successful save from the public form SHALL issue a new unguessable edit link `/s/<event-slug>/edit/<token>` (at least 256 bits of randomness) and MUST make any earlier link for that response stop working. Only a keyed hash of the token SHALL be stored.

#### Scenario: Link on confirmation page
- **WHEN** Priya's response is saved from the public form
- **THEN** the confirmation page shows a link of the form `https://<host>/s/pongal-2027/edit/<43-character token>`, a "Copy link" button, and the text "Save this link to change your answers until Tuesday, November 24 at 11:59 PM ET."

#### Scenario: Older link replaced
- **GIVEN** Priya received edit link A
- **WHEN** someone submits the public form again with `priya@example.com` and receives link B
- **THEN** link A no longer works and link B does

#### Scenario: Token not stored in plain form
- **WHEN** a response with edit link token `T` is saved
- **THEN** the database does not contain `T` in any column

### Requirement: Edit page shows the family's saved answers
Opening a valid edit link while the survey is open SHALL show the form pre-filled with the response's saved answers. The email MUST be shown read-only with the note "To change your email, please contact the organizers."

#### Scenario: Pre-filled form
- **GIVEN** Priya's saved response has 3 adults & kids 11+, Saturday = Definitely, food Veg
- **WHEN** she opens her edit link
- **THEN** the form shows those values and her email `priya@example.com` as read-only text

### Requirement: Saving through the edit link
Submitting from the edit page SHALL apply the same validation as the public form, replace the response's answers, keep the same edit link working, and write history with actor `public`. Any email value in the submission MUST be ignored.

#### Scenario: Successful edit
- **WHEN** Priya changes adults from 3 to 4 on her edit page and submits
- **THEN** the response shows 4 adults, the page says "Thank you, Priya! We've updated your family's response for Pongal 2027.", and the same edit link still works

#### Scenario: Tampered email ignored
- **WHEN** an edit submission includes `email=other@example.com`
- **THEN** the response stays linked to `priya@example.com`

#### Scenario: Invalid edit
- **WHEN** Priya submits her edit page with no day selected
- **THEN** nothing is saved and the days field shows "Please pick at least one day you could attend."

### Requirement: Invalid edit links
An edit link that is unknown, replaced, malformed or points to a removed response MUST return `404` with "This edit link isn't valid anymore. Please use your latest link, or fill in the survey again." and a link to the survey, and MUST NOT reveal which case applied.

#### Scenario: Replaced link
- **WHEN** someone opens a replaced edit link
- **THEN** the response is `404` with "This edit link isn't valid anymore. Please use your latest link, or fill in the survey again."

#### Scenario: Removed response
- **GIVEN** an organizer removed Priya's response
- **WHEN** she opens her edit link
- **THEN** the response is `404` with the same message

### Requirement: Edit links stop when the survey closes
When the survey state is `closed`, opening or submitting an edit link MUST show the event's closed message and MUST NOT show or change any answers.

#### Scenario: Open after close
- **WHEN** Priya opens her valid edit link on Nov 25, 2026
- **THEN** the page shows "The Pongal 2027 interest survey is now closed. Thank you for your interest! Organizers will share next steps soon." and no answers

### Requirement: Optional edit-link email
When SMTP is configured, after each public-form save the system SHALL email the edit link to the household's email, with subject "Your Pongal 2027 survey link" and the text "If you didn't fill in this survey, please reply to this email." The email MUST NOT contain the survey answers. Saves through the edit link MUST NOT send email.

#### Scenario: Email sent
- **GIVEN** SMTP settings are configured
- **WHEN** Priya's response is saved from the public form
- **THEN** one email with the edit link is sent to `priya@example.com` and the confirmation page adds "We've also emailed this link to priya@example.com."

#### Scenario: SMTP not configured
- **GIVEN** no SMTP settings
- **WHEN** a response is saved
- **THEN** no email is attempted and the confirmation page does not mention email

#### Scenario: Sending fails
- **WHEN** the SMTP server rejects the message
- **THEN** the response stays saved, the confirmation page does not mention email, and the error is logged without the email address

### Requirement: Edit-link email limited per recipient
The system MUST send at most 3 edit-link emails per recipient address per hour. Saves beyond the limit SHALL still succeed without sending email.

#### Scenario: Fourth save in an hour
- **GIVEN** 3 edit-link emails were sent to `priya@example.com` in the last hour
- **WHEN** another public-form save for `priya@example.com` succeeds
- **THEN** no email is sent and the confirmation page does not mention email
